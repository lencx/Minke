import { createHash } from "node:crypto";
import {
  agentTurnErrorResponse,
  agentTurnResultResponse,
  isAgentTurnProcessMessage,
  parseAgentTurnProcessRequest,
  type AgentTurnInput,
  type AgentTurnPreview,
  type AgentTurnProcessResponse,
  type AgentTurnResult,
} from "../agent-turn-contract.ts";

const HISTORY_PAGE_MESSAGES = 100;
const DEFAULT_POLL_INTERVAL_MS = 200;
const MAX_FAILURE_MESSAGE_LENGTH = 8 * 1024;
const MAX_OPERATION_FINGERPRINTS = 10_000;

interface RpcError {
  readonly code: string;
  readonly message: string;
}

type RpcResponse<Value> = {
  readonly rpcId: string;
  readonly result:
    | { readonly ok: true; readonly value: Value }
    | { readonly ok: false; readonly error: RpcError };
};

interface HistoryPage {
  readonly events: readonly {
    readonly event: unknown;
    readonly view?: unknown;
  }[];
  readonly hasMore: boolean;
}

export interface AgentTurnSessionsPort {
  create(request: {
    readonly rpcId: string;
    readonly payload: { readonly sessionId: string };
  }): Promise<RpcResponse<{ readonly sessionId: string }>>;
  history(request: {
    readonly rpcId: string;
    readonly payload: {
      readonly sessionId: string;
      readonly beforeSeq?: number;
      readonly maxMessages: number;
    };
  }): Promise<RpcResponse<HistoryPage>>;
  prompt(request: {
    readonly rpcId: string;
    readonly payload: {
      readonly sessionId: string;
      readonly mode: "queue";
      readonly content: readonly {
        readonly type: "text";
        readonly text: string;
      }[];
    };
  }): Promise<
    RpcResponse<{
      readonly accepted: true;
      readonly command?: {
        readonly kind: "success";
        readonly text?: string;
      };
    }>
  >;
}

export interface AgentTurnProcessPort {
  readonly connected?: boolean;
  send?(
    message: AgentTurnProcessResponse,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  off(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  off(event: "disconnect", listener: () => void): unknown;
}

interface AgentTurnControlContext {
  effect(
    callback: () => void | (() => void),
    label: string,
  ): unknown;
  readonly apiProxy: {
    readonly sessions: AgentTurnSessionsPort;
  };
}

export interface AgentTurnExecutionOptions {
  readonly pollIntervalMs?: number;
  readonly previewPublisher?: AgentTurnPreviewPublisher;
}

export interface AgentTurnPreviewPublisher {
  publish(input: {
    readonly operationId: string;
    readonly paths: readonly string[];
    readonly sessionId: string;
    readonly turn: number;
  }): Promise<readonly AgentTurnPreview[]>;
}

type OperationInspection =
  | { readonly state: "absent" }
  | { readonly state: "needs-older-history" }
  | { readonly state: "pending" }
  | {
      readonly state: "terminal";
      readonly producedPaths: readonly string[];
      readonly result: AgentTurnResult;
    };

interface SessionEventRecord {
  readonly type: string;
  readonly seq: number;
  readonly data: Record<string, unknown>;
}

interface HistoryEntryRecord {
  readonly event: SessionEventRecord;
  readonly view?: unknown;
}

function object(
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sessionEvent(
  value: unknown,
): SessionEventRecord | undefined {
  const event = object(value);
  const data = object(event?.data);
  if (
    event === undefined ||
    data === undefined ||
    typeof event.type !== "string" ||
    !Number.isSafeInteger(event.seq) ||
    Number(event.seq) < 0
  ) {
    return undefined;
  }
  return {
    type: event.type,
    seq: Number(event.seq),
    data,
  };
}

function validatedHistoryPage(value: unknown): {
  readonly entries: readonly HistoryEntryRecord[];
  readonly hasMore: boolean;
} {
  const page = object(value);
  if (
    page === undefined ||
    !Array.isArray(page.events) ||
    typeof page.hasMore !== "boolean"
  ) {
    invalidControlState(
      "invalid-history",
      "session.history returned an invalid page",
    );
  }
  const entries: HistoryEntryRecord[] = [];
  let previousSeq = -1;
  for (const value of page.events) {
    const entry = object(value);
    const parsed = sessionEvent(entry?.event);
    if (
      parsed === undefined ||
      parsed.seq <= previousSeq
    ) {
      invalidControlState(
        "invalid-history",
        "session.history returned invalid event ordering",
      );
    }
    previousSeq = parsed.seq;
    entries.push({
      event: parsed,
      ...(entry?.view === undefined
        ? {}
        : { view: entry.view }),
    });
  }
  return {
    entries,
    hasMore: page.hasMore,
  };
}

function boundedFailureMessage(value: unknown): string {
  const message =
    value instanceof Error ? value.message : String(value);
  const normalized =
    message.length === 0 ? "Agent turn failed" : message;
  return normalized.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export class AgentTurnControlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentTurnControlError";
    this.code = code;
  }
}

function unwrap<Value>(
  operation: string,
  response: RpcResponse<Value>,
): Value {
  if (response.result.ok) return response.result.value;
  throw new AgentTurnControlError(
    "control-rpc-error",
    boundedFailureMessage(
      `${operation} failed (${response.result.error.code}): ${response.result.error.message}`,
    ),
  );
}

function sameInput(
  left: AgentTurnInput,
  right: AgentTurnInput,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.sessionId === right.sessionId &&
    left.text === right.text
  );
}

function userMessageText(
  event: SessionEventRecord,
): string | undefined {
  if (event.type !== "user/message") return undefined;
  const content = event.data.content;
  if (!Array.isArray(content)) return undefined;
  const blocks: string[] = [];
  for (const value of content) {
    const block = object(value);
    if (
      block?.type !== "text" ||
      typeof block.text !== "string"
    ) {
      return undefined;
    }
    blocks.push(block.text);
  }
  return blocks.join("");
}

function operationConflict(
  operationId: string,
): AgentTurnControlError {
  return new AgentTurnControlError(
    "operation-conflict",
    `Agent turn operation "${operationId}" was reused with different input`,
  );
}

function rememberInput(
  fingerprints: Map<string, string>,
  input: AgentTurnInput,
): void {
  fingerprints.delete(input.operationId);
  fingerprints.set(
    input.operationId,
    inputFingerprint(input),
  );
  while (fingerprints.size > MAX_OPERATION_FINGERPRINTS) {
    const oldest = fingerprints.keys().next().value as
      | string
      | undefined;
    if (oldest === undefined) return;
    fingerprints.delete(oldest);
  }
}

function inputFingerprint(input: AgentTurnInput): string {
  return createHash("sha256")
    .update(input.sessionId)
    .update("\u0000")
    .update(input.text)
    .digest("hex");
}

function controlFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  return error instanceof AgentTurnControlError
    ? {
        code: error.code,
        message: boundedFailureMessage(error),
      }
    : {
        code: "agent-turn-control",
        message: boundedFailureMessage(error),
      };
}

function assertSameInput(
  expected: AgentTurnInput,
  actual: AgentTurnInput,
): void {
  if (!sameInput(expected, actual)) {
    throw operationConflict(actual.operationId);
  }
}

function assertPersistedInput(
  event: SessionEventRecord,
  input: AgentTurnInput,
): void {
  if (userMessageText(event) !== input.text) {
    throw operationConflict(input.operationId);
  }
}

function invalidControlState(
  code: string,
  message: string,
): never {
  throw new AgentTurnControlError(
    code,
    boundedFailureMessage(message),
  );
}

function sendControlError(
  send: (response: AgentTurnProcessResponse) => void,
  requestId: number,
  error: unknown,
): void {
  const failure = controlFailure(error);
  send(
    agentTurnErrorResponse(
      requestId,
      failure.code,
      failure.message,
    ),
  );
}

function findLastEvent(
  events: readonly SessionEventRecord[],
  predicate: (event: SessionEventRecord) => boolean,
): SessionEventRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && predicate(event)) return event;
  }
  return undefined;
}

function sourceRpcId(event: SessionEventRecord): string | undefined {
  if (event.type !== "user/message") return undefined;
  const source = object(event.data.source);
  return typeof source?.rpcId === "string"
    ? source.rpcId
    : undefined;
}

function numericField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key];
  return Number.isSafeInteger(field) && Number(field) >= 0
    ? Number(field)
    : undefined;
}

function reasonMessage(
  reason: Record<string, unknown>,
  kind: string,
): string {
  if (kind === "error") {
    const error = object(reason.error);
    if (typeof error?.message === "string") {
      return boundedFailureMessage(error.message);
    }
  }
  return `Agent turn ended with ${kind}`;
}

function assistantText(event: SessionEventRecord): string | undefined {
  if (event.type !== "assistant/message") return undefined;
  const message = object(event.data.message);
  if (!Array.isArray(message?.content)) return undefined;
  return message.content
    .flatMap((block) => {
      const candidate = object(block);
      return candidate?.type === "text" &&
          typeof candidate.text === "string"
        ? [candidate.text]
        : [];
    })
    .join("");
}

function producedPathsForTurn(
  entries: readonly HistoryEntryRecord[],
  input: {
    readonly firstSeq: number;
    readonly lastSeq: number;
    readonly turn: number;
  },
): readonly string[] {
  const calls = new Map<string, readonly string[]>();
  const produced = new Set<string>();
  const ordered = [...entries].sort(
    (left, right) => left.event.seq - right.event.seq,
  );
  for (const entry of ordered) {
    const event = entry.event;
    if (
      event.seq <= input.firstSeq ||
      event.seq >= input.lastSeq ||
      numericField(event.data, "turn") !== input.turn
    ) {
      continue;
    }
    if (event.type === "tool/call") {
      const callId = event.data.callId;
      const presentation = object(entry.view);
      const view = object(presentation?.view);
      const isWrite =
        view?.card === "diff" ||
        (
          view?.card === "generic" &&
          view.kind === "edit"
        );
      if (
        typeof callId !== "string" ||
        callId.length === 0 ||
        presentation?.for !== "call" ||
        !isWrite ||
        !Array.isArray(view?.locations)
      ) {
        continue;
      }
      calls.set(
        callId,
        view.locations.flatMap((value) => {
          const location = object(value);
          return typeof location?.path === "string" &&
              location.path.length > 0
            ? [location.path]
            : [];
        }),
      );
      continue;
    }
    if (event.type !== "tool/result") continue;
    const message = object(event.data.message);
    const source = object(message?.source);
    const content = message?.content;
    if (
      typeof source?.callId !== "string" ||
      !Array.isArray(content)
    ) {
      continue;
    }
    const result = object(content[0]);
    if (
      result?.type !== "tool-result" ||
      result.isError === true
    ) {
      continue;
    }
    for (const path of calls.get(source.callId) ?? []) {
      produced.add(path);
    }
  }
  return [...produced];
}

function externalPromptContent(
  text: string,
): readonly {
  readonly type: "text";
  readonly text: string;
}[] {
  if (!text.startsWith("/")) {
    return [{ type: "text", text }];
  }
  // Harness reserves exactly one leading-slash text block for local commands.
  // Two adjacent blocks preserve the external message's exact text while
  // keeping untrusted IM input on the ordinary model-prompt path.
  return [
    { type: "text", text: "/" },
    { type: "text", text: text.slice(1) },
  ];
}

function inspectOperation(
  rawEntries: readonly HistoryEntryRecord[],
  input: AgentTurnInput,
): OperationInspection {
  const entries = [...rawEntries]
    .sort(
      (left, right) => left.event.seq - right.event.seq,
    );
  const events = entries.map(({ event }) => event);
  const user = findLastEvent(
    events,
    (event) => sourceRpcId(event) === input.operationId,
  );
  if (user === undefined) return { state: "absent" };
  assertPersistedInput(user, input);
  const { sessionId } = input;

  const turnStart = findLastEvent(
    events,
    (event) =>
      event.seq < user.seq &&
      event.type === "turn/start",
  );
  const turn = turnStart === undefined
    ? undefined
    : numericField(turnStart.data, "turn");
  if (turn === undefined) {
    return { state: "needs-older-history" };
  }

  const turnEnd = events.find(
    (event) =>
      event.seq > user.seq &&
      event.type === "turn/end" &&
      numericField(event.data, "turn") === turn,
  );
  if (turnEnd === undefined) return { state: "pending" };
  const reason = object(turnEnd.data.reason);
  if (
    reason === undefined ||
    typeof reason.kind !== "string" ||
    reason.kind.length === 0
  ) {
    invalidControlState(
      "invalid-history",
      "session.history returned an invalid turn/end reason",
    );
  }
  const endReason = reason.kind;

  if (
    endReason === "aborted" ||
    endReason === "blocked" ||
    endReason === "error" ||
    endReason === "interrupted"
  ) {
    return {
      state: "terminal",
      producedPaths: [],
      result: {
        outcome: "failed",
        sessionId,
        message: reasonMessage(reason, endReason),
        turn,
        endReason,
      },
    };
  }

  const closingAssistant = events
    .filter(
      (event) =>
        event.seq > user.seq &&
        event.seq < turnEnd.seq &&
        event.type === "assistant/message" &&
        numericField(event.data, "turn") === turn,
    )
    .at(-1);
  const answer = closingAssistant === undefined
    ? ""
    : assistantText(closingAssistant) ?? "";
  const producedPaths = closingAssistant === undefined
    ? []
    : producedPathsForTurn(entries, {
        firstSeq: user.seq,
        lastSeq: closingAssistant.seq,
        turn,
      });
  return answer.length === 0
    ? {
        state: "terminal",
        producedPaths: [],
        result: {
          outcome: "no-response",
          sessionId,
          turn,
          endReason,
        },
      }
    : {
        state: "terminal",
        producedPaths,
        result: {
          outcome: "completed",
          sessionId,
          text: answer,
          turn,
          endReason,
        },
      };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : reason === undefined
      ? "Agent turn was cancelled"
      : String(reason),
    reason instanceof Error ? { cause: reason } : undefined,
  );
  error.name = "AbortError";
  throw error;
}

async function waitForPoll(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (delayMs === 0) {
    await Promise.resolve();
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    timeout.unref();
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function inspectPersistedOperation(
  sessions: AgentTurnSessionsPort,
  input: AgentTurnInput,
): Promise<OperationInspection> {
  const entries: HistoryEntryRecord[] = [];
  let beforeSeq: number | undefined;
  let pageNumber = 0;
  while (true) {
    pageNumber += 1;
    const response = await sessions.history({
      rpcId: `${input.operationId}:history:${String(pageNumber)}`,
      payload: {
        sessionId: input.sessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: HISTORY_PAGE_MESSAGES,
      },
    });
    const page = validatedHistoryPage(unwrap(
      "session.history",
      response,
    ));
    const pageEntries = page.entries;
    entries.push(...pageEntries);
    const inspected = inspectOperation(
      entries,
      input,
    );
    if (inspected.state === "terminal") return inspected;
    if (inspected.state === "pending") {
      return inspected;
    }
    if (page.hasMore !== true) {
      if (inspected.state === "needs-older-history") {
        invalidControlState(
          "invalid-history",
          "session.history could not correlate the operation to a turn",
        );
      }
      return inspected;
    }
    const seqs = pageEntries.map(({ event }) => event.seq);
    const oldestSeq = seqs.length === 0
      ? undefined
      : Math.min(...seqs);
    if (
      oldestSeq === undefined ||
      oldestSeq === 0 ||
      oldestSeq === beforeSeq
    ) {
      invalidControlState(
        "invalid-history",
        "session.history pagination did not advance",
      );
    }
    beforeSeq = oldestSeq;
  }
}

async function materializeTerminalResult(
  inspected: Extract<
    OperationInspection,
    { readonly state: "terminal" }
  >,
  input: AgentTurnInput,
  options: AgentTurnExecutionOptions,
): Promise<AgentTurnResult> {
  if (
    inspected.result.outcome !== "completed" ||
    inspected.producedPaths.length === 0 ||
    options.previewPublisher === undefined
  ) {
    return inspected.result;
  }
  const previews = await options.previewPublisher.publish({
    operationId: input.operationId,
    paths: inspected.producedPaths,
    sessionId: input.sessionId,
    turn: inspected.result.turn,
  });
  return previews.length === 0
    ? inspected.result
    : {
        ...inspected.result,
        previews,
      };
}

/**
 * Run or recover one durable Agent turn.
 *
 * The operation id is the prompt rpcId recorded on `user/message`. History is
 * therefore consulted before prompting: retrying the same operation either
 * recovers its terminal result or waits for its already-admitted turn.
 */
export async function runAgentTurnInHarness(
  sessions: AgentTurnSessionsPort,
  input: AgentTurnInput,
  signal: AbortSignal,
  options: AgentTurnExecutionOptions = {},
): Promise<AgentTurnResult> {
  const pollIntervalMs =
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 0
  ) {
    throw new RangeError(
      "Agent turn poll interval must be a non-negative integer",
    );
  }
  throwIfAborted(signal);
  const created = unwrap(
    "session.create",
    await sessions.create({
      rpcId: `${input.operationId}:create`,
      payload: { sessionId: input.sessionId },
    }),
  );
  if (created.sessionId !== input.sessionId) {
    invalidControlState(
      "session-conflict",
      "session.create returned a different session id",
    );
  }

  throwIfAborted(signal);
  let inspected = await inspectPersistedOperation(
    sessions,
    input,
  );
  if (inspected.state === "terminal") {
    return await materializeTerminalResult(
      inspected,
      input,
      options,
    );
  }

  if (inspected.state === "absent") {
    throwIfAborted(signal);
    const prompted = unwrap(
      "session.prompt",
      await sessions.prompt({
        rpcId: input.operationId,
        payload: {
          sessionId: input.sessionId,
          mode: "queue",
          content: externalPromptContent(input.text),
        },
      }),
    );
    if (prompted.accepted !== true) {
      invalidControlState(
        "invalid-prompt-result",
        "session.prompt did not acknowledge the Agent turn",
      );
    }
    if (prompted.command !== undefined) {
      invalidControlState(
        "invalid-prompt-result",
        "external Agent turn unexpectedly dispatched a command",
      );
    }
  }

  while (true) {
    await waitForPoll(pollIntervalMs, signal);
    inspected = await inspectPersistedOperation(
      sessions,
      input,
    );
    if (inspected.state === "terminal") {
      return await materializeTerminalResult(
        inspected,
        input,
        options,
      );
    }
  }
}

function requestIdFrom(value: unknown): number | undefined {
  const requestId = object(value)?.requestId;
  return Number.isSafeInteger(requestId) && Number(requestId) > 0
    ? Number(requestId)
    : undefined;
}

interface ActiveOperation {
  readonly controller: AbortController;
  readonly input: AgentTurnInput;
  readonly requestIds: Set<number>;
}

/**
 * Bind the high-level Agent turn seam to Harness's private parent IPC pipe.
 * Returns false outside Electron child-process mode.
 */
export function installAgentTurnControl(
  ctx: AgentTurnControlContext,
  port: AgentTurnProcessPort =
    process as unknown as AgentTurnProcessPort,
  options: AgentTurnExecutionOptions = {},
): boolean {
  if (
    typeof port.send !== "function" ||
    port.connected === false
  ) {
    return false;
  }
  const operations = new Map<string, ActiveOperation>();
  const requests = new Map<number, ActiveOperation>();
  const fingerprints = new Map<string, string>();
  let disposed = false;

  const send = (response: AgentTurnProcessResponse): void => {
    if (
      disposed ||
      typeof port.send !== "function" ||
      port.connected === false
    ) {
      return;
    }
    try {
      port.send(response, () => {
        // Child-process teardown is handled by the disconnect lifecycle.
      });
    } catch {
      // The parent may disappear between the connectivity check and send.
    }
  };

  const settleOperation = (
    operation: ActiveOperation,
    outcome:
      | { readonly result: AgentTurnResult }
      | { readonly error: unknown },
  ): void => {
    if (
      operations.get(operation.input.operationId) !== operation
    ) {
      return;
    }
    operations.delete(operation.input.operationId);
    for (const requestId of operation.requestIds) {
      requests.delete(requestId);
      if ("result" in outcome) {
        send(
          agentTurnResultResponse(
            requestId,
            outcome.result,
          ),
        );
      } else {
        sendControlError(send, requestId, outcome.error);
      }
    }
    operation.requestIds.clear();
  };

  const detach = (
    requestId: number,
  ): void => {
    const operation = requests.get(requestId);
    if (operation === undefined) return;
    requests.delete(requestId);
    operation.requestIds.delete(requestId);
  };

  const attach = (
    requestId: number,
    operation: ActiveOperation,
  ): void => {
    requests.set(requestId, operation);
    operation.requestIds.add(requestId);
  };

  const start = (
    requestId: number,
    input: AgentTurnInput,
  ): void => {
    const known = fingerprints.get(input.operationId);
    if (
      known !== undefined &&
      known !== inputFingerprint(input)
    ) {
      throw operationConflict(input.operationId);
    }
    const existing = operations.get(input.operationId);
    if (existing !== undefined) {
      assertSameInput(existing.input, input);
      rememberInput(fingerprints, input);
      attach(requestId, existing);
      return;
    }

    rememberInput(fingerprints, input);
    const operation: ActiveOperation = {
      controller: new AbortController(),
      input,
      requestIds: new Set<number>(),
    };
    operations.set(input.operationId, operation);
    attach(requestId, operation);
    void runAgentTurnInHarness(
      ctx.apiProxy.sessions,
      input,
      operation.controller.signal,
      options,
    ).then(
      (result) => settleOperation(operation, { result }),
      (error) => settleOperation(operation, { error }),
    );
  };

  const onMessage = (message: unknown): void => {
    if (!isAgentTurnProcessMessage(message)) return;
    let request;
    try {
      request = parseAgentTurnProcessRequest(message);
    } catch (error) {
      const requestId = requestIdFrom(message);
      if (requestId !== undefined) {
        send(agentTurnErrorResponse(
          requestId,
          "invalid-request",
          boundedFailureMessage(error),
        ));
      }
      return;
    }

    if (request.type === "agent-turn/cancel") {
      detach(request.requestId);
      return;
    }
    if (requests.has(request.requestId)) {
      send(agentTurnErrorResponse(
        request.requestId,
        "duplicate-request",
        "Agent turn request id is already active",
      ));
      return;
    }
    try {
      start(request.requestId, request.input);
    } catch (error) {
      sendControlError(send, request.requestId, error);
    }
  };

  const onDisconnect = (): void => {
    if (disposed) return;
    disposed = true;
    port.off("message", onMessage);
    port.off("disconnect", onDisconnect);
    requests.clear();
    const pending = [...operations.values()];
    operations.clear();
    for (const operation of pending) {
      operation.requestIds.clear();
      operation.controller.abort(
        new Error("Agent turn IPC disconnected"),
      );
    }
    fingerprints.clear();
  };

  port.on("message", onMessage);
  port.on("disconnect", onDisconnect);
  ctx.effect(
    () => () => {
      onDisconnect();
    },
    "minke-host: Agent turn process control",
  );
  return true;
}
