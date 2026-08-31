import { createHash } from "node:crypto";
import {
  remoteErrorOf,
} from "@deepseek-ai/dsh-typert-protocol";
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

const DEFAULT_POLL_INTERVAL_MS = 200;
const MAX_FAILURE_MESSAGE_LENGTH = 8 * 1024;
const MAX_OPERATION_FINGERPRINTS = 10_000;
const CONSUMED_SESSION_EVENT_TYPES: ReadonlySet<string> =
  new Set([
    "assistant/message",
    "tool/call",
    "tool/result",
    "turn/end",
    "turn/start",
    "user/message",
  ]);

export interface AgentTurnSessionControllerPort {
  create(request: {
    readonly sessionId: string;
  }): Promise<{ readonly sessionId: string }>;
  inspect(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly events: readonly unknown[];
  }>;
  follow?(
    request: {
      readonly address: {
        readonly kind: "session";
        readonly sessionId: string;
      };
    },
    signal: AbortSignal,
  ): AsyncIterable<unknown>;
  prompt(request: {
    readonly requestId: string;
    readonly sessionId: string;
    readonly mode: "queue";
    readonly content: readonly {
      readonly type: "text";
      readonly text: string;
    }[];
  }, signal: AbortSignal): Promise<{
    readonly accepted: true;
  }>;
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
  readonly sessionController: AgentTurnSessionControllerPort;
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

interface OperationInspectionCursor {
  scannedLength: number;
  lastSeq: number;
  lastType: string | undefined;
  latestTurnStart: SessionEventRecord | undefined;
  user: SessionEventRecord | undefined;
  turn: number | undefined;
  turnEnd: SessionEventRecord | undefined;
  closingAssistant: SessionEventRecord | undefined;
  closingProducedPaths: readonly string[];
  readonly toolCalls: Map<string, readonly string[]>;
  readonly producedPaths: Set<string>;
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
): Record<string, unknown> | undefined {
  const event = object(value);
  if (
    event === undefined ||
    typeof event.type !== "string" ||
    !Number.isSafeInteger(event.seq) ||
    Number(event.seq) < 0 ||
    event.data === undefined ||
    (
      event.ignorable !== undefined &&
      event.ignorable !== true
    )
  ) {
    return undefined;
  }
  // SessionController owns persistence compatibility and validates the full
  // event vocabulary before exposing an inspection. Minke only validates the
  // payloads it interprets; unrelated events may legitimately carry scalar
  // data and must remain forward compatible.
  if (
    CONSUMED_SESSION_EVENT_TYPES.has(event.type) &&
    object(event.data) === undefined
  ) {
    return undefined;
  }
  return event;
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

async function controllerCall<Value>(
  operation: string,
  call: () => Promise<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (error) {
    const failure = remoteErrorOf(error);
    if (failure === undefined) throw error;
    throw new AgentTurnControlError(
      "control-rpc-error",
      boundedFailureMessage(
        `${operation} failed (${failure.code}): ` +
          boundedFailureMessage(error),
      ),
    );
  }
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

function nonEmptyString(
  value: unknown,
): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : undefined;
}

function toolArguments(
  event: SessionEventRecord,
): Record<string, unknown> | undefined {
  if (
    event.type !== "tool/call" ||
    typeof event.data.arguments !== "string"
  ) {
    return undefined;
  }
  try {
    return object(JSON.parse(event.data.arguments));
  } catch {
    return undefined;
  }
}

/**
 * Recover paths only from the mutating filesystem tools shipped by Harness.
 * The raw Session log intentionally carries no presentation `view`, so unknown
 * tools are ignored instead of guessing that an arbitrary path-like argument
 * represents a successful write.
 */
function producedPathsForCall(
  event: SessionEventRecord,
): readonly string[] {
  const name = nonEmptyString(event.data.name);
  const args = toolArguments(event);
  if (name === undefined || args === undefined) return [];
  if (name === "write" || name === "edit") {
    const path = nonEmptyString(args.file_path);
    return path === undefined ? [] : [path];
  }
  if (name !== "str_replace_editor") return [];
  if (
    args.command !== "create" &&
    args.command !== "str_replace" &&
    args.command !== "insert"
  ) {
    return [];
  }
  const path = nonEmptyString(args.path);
  return path === undefined ? [] : [path];
}

function successfulToolResultCallId(
  event: SessionEventRecord,
): string | undefined {
  if (
    event.type !== "tool/result" ||
    event.data.error !== undefined
  ) {
    return undefined;
  }
  const message = object(event.data.message);
  const source = object(message?.source);
  const callId = nonEmptyString(source?.callId);
  if (callId === undefined || !Array.isArray(message?.content)) {
    return undefined;
  }
  const result = message.content
    .map(object)
    .find((block) =>
      block?.type === "tool-result" &&
      block.toolCallId === callId
    );
  return result === undefined || result.isError === true
    ? undefined
    : callId;
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

function createInspectionCursor(): OperationInspectionCursor {
  return {
    scannedLength: 0,
    lastSeq: -1,
    lastType: undefined,
    latestTurnStart: undefined,
    user: undefined,
    turn: undefined,
    turnEnd: undefined,
    closingAssistant: undefined,
    closingProducedPaths: [],
    toolCalls: new Map(),
    producedPaths: new Set(),
  };
}

function resetInspectionCursor(
  cursor: OperationInspectionCursor,
): void {
  cursor.scannedLength = 0;
  cursor.lastSeq = -1;
  cursor.lastType = undefined;
  cursor.latestTurnStart = undefined;
  cursor.user = undefined;
  cursor.turn = undefined;
  cursor.turnEnd = undefined;
  cursor.closingAssistant = undefined;
  cursor.closingProducedPaths = [];
  cursor.toolCalls.clear();
  cursor.producedPaths.clear();
}

/**
 * SessionController inspections are immutable append-only prefixes. Remote
 * calls may deserialize them into fresh arrays, so continuation is verified by
 * the prior boundary's stable envelope instead of object identity. A reset or
 * replacement falls back to a complete rescan.
 */
function inspectionPrefixContinues(
  events: readonly unknown[],
  cursor: OperationInspectionCursor,
): boolean {
  if (cursor.scannedLength === 0) return true;
  if (events.length < cursor.scannedLength) return false;
  const boundary = sessionEvent(
    events[cursor.scannedLength - 1],
  );
  return (
    boundary !== undefined &&
    Number(boundary.seq) === cursor.lastSeq &&
    boundary.type === cursor.lastType
  );
}

function consumeOperationEvent(
  event: SessionEventRecord,
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
): void {
  if (event.type === "turn/start") {
    cursor.latestTurnStart = event;
  }
  if (sourceRpcId(event) === input.operationId) {
    assertPersistedInput(event, input);
    cursor.user = event;
    cursor.turn = cursor.latestTurnStart === undefined
      ? undefined
      : numericField(cursor.latestTurnStart.data, "turn");
    cursor.turnEnd = undefined;
    cursor.closingAssistant = undefined;
    cursor.closingProducedPaths = [];
    cursor.toolCalls.clear();
    cursor.producedPaths.clear();
    return;
  }
  if (
    cursor.user === undefined ||
    cursor.turn === undefined ||
    event.seq <= cursor.user.seq ||
    numericField(event.data, "turn") !== cursor.turn ||
    cursor.turnEnd !== undefined
  ) {
    return;
  }
  if (event.type === "tool/call") {
    const callId = nonEmptyString(event.data.callId);
    if (callId !== undefined) {
      cursor.toolCalls.set(
        callId,
        producedPathsForCall(event),
      );
    }
    return;
  }
  const resultCallId = successfulToolResultCallId(event);
  if (resultCallId !== undefined) {
    for (
      const path of cursor.toolCalls.get(resultCallId) ?? []
    ) {
      cursor.producedPaths.add(path);
    }
    return;
  }
  if (event.type === "assistant/message") {
    cursor.closingAssistant = event;
    cursor.closingProducedPaths = [...cursor.producedPaths];
    return;
  }
  if (event.type === "turn/end") {
    cursor.turnEnd = event;
  }
}

function inspectionFromCursor(
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
): OperationInspection {
  const user = cursor.user;
  if (user === undefined) return { state: "absent" };
  const { sessionId } = input;

  const turn = cursor.turn;
  if (turn === undefined) {
    return { state: "needs-older-history" };
  }

  const turnEnd = cursor.turnEnd;
  if (turnEnd === undefined) return { state: "pending" };
  const reason = object(turnEnd.data.reason);
  if (
    reason === undefined ||
    typeof reason.kind !== "string" ||
    reason.kind.length === 0
  ) {
    invalidControlState(
      "invalid-history",
      "session.inspect returned an invalid turn/end reason",
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

  const closingAssistant = cursor.closingAssistant;
  const answer = closingAssistant === undefined
    ? ""
    : assistantText(closingAssistant) ?? "";
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
        producedPaths: cursor.closingProducedPaths,
        result: {
          outcome: "completed",
          sessionId,
          text: answer,
          turn,
          endReason,
        },
      };
}

function inspectOperation(
  rawEvents: readonly unknown[],
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
): OperationInspection {
  if (!inspectionPrefixContinues(rawEvents, cursor)) {
    resetInspectionCursor(cursor);
  }
  for (
    let index = cursor.scannedLength;
    index < rawEvents.length;
    index += 1
  ) {
    const candidate = sessionEvent(rawEvents[index]);
    if (candidate === undefined) {
      invalidControlState(
        "invalid-history",
        "session.inspect returned invalid event ordering",
      );
    }
    const seq = Number(candidate.seq);
    if (seq <= cursor.lastSeq) {
      invalidControlState(
        "invalid-history",
        "session.inspect returned invalid event ordering",
      );
    }
    cursor.scannedLength = index + 1;
    cursor.lastSeq = seq;
    cursor.lastType = String(candidate.type);
    if (
      !CONSUMED_SESSION_EVENT_TYPES.has(
        String(candidate.type),
      )
    ) {
      continue;
    }
    consumeOperationEvent(
      candidate as unknown as SessionEventRecord,
      input,
      cursor,
    );
  }

  return inspectionFromCursor(input, cursor);
}

function appendFollowEvent(
  value: unknown,
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
  allowOverlapThroughSeq: number,
): void {
  const candidate = sessionEvent(value);
  if (candidate === undefined) {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid event",
    );
  }
  const seq = Number(candidate.seq);
  if (seq <= cursor.lastSeq) {
    if (seq <= allowOverlapThroughSeq) return;
    invalidControlState(
      "invalid-history",
      "session.follow returned invalid event ordering",
    );
  }
  cursor.lastSeq = seq;
  cursor.lastType = String(candidate.type);
  if (
    !CONSUMED_SESSION_EVENT_TYPES.has(
      String(candidate.type),
    )
  ) {
    return;
  }
  consumeOperationEvent(
    candidate as unknown as SessionEventRecord,
    input,
    cursor,
  );
}

interface FollowSnapshotRecord {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly event?: unknown;
}

function followSnapshotRecord(
  value: unknown,
): FollowSnapshotRecord {
  const record = object(value);
  const event = object(record?.event);
  if (record?.type === "event") {
    const parsed = sessionEvent(event);
    if (parsed === undefined) {
      invalidControlState(
        "invalid-history",
        "session.follow returned an invalid history event",
      );
    }
    const seq = Number(parsed.seq);
    return { firstSeq: seq, lastSeq: seq, event };
  }
  if (record?.type !== "chunks" || event === undefined) {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid history record",
    );
  }
  const data = object(event.data);
  const payload = event.type === "chunkrow/tool-call-chunks"
    ? data?.args
    : (
        event.type === "chunkrow/text-chunks" ||
        event.type === "chunkrow/reasoning-chunks"
      )
    ? data?.texts
    : undefined;
  if (
    !Number.isSafeInteger(event.seq) ||
    Number(event.seq) < 0 ||
    !Array.isArray(payload) ||
    payload.length === 0 ||
    payload.some((entry) => typeof entry !== "string")
  ) {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid chunk history record",
    );
  }
  const firstSeq = Number(event.seq);
  const lastSeq = firstSeq + payload.length - 1;
  if (!Number.isSafeInteger(lastSeq)) {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid chunk history range",
    );
  }
  return { firstSeq, lastSeq };
}

interface FollowSnapshotInspection {
  readonly cursor: number;
  readonly gap: boolean;
  readonly inspected: OperationInspection;
}

function consumeFollowSnapshot(
  value: unknown,
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
): FollowSnapshotInspection {
  const frame = object(value);
  if (
    frame?.type !== "snapshot" ||
    !Array.isArray(frame.records) ||
    !Number.isSafeInteger(frame.cursor) ||
    Number(frame.cursor) < -1
  ) {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid opening snapshot",
    );
  }
  const openingCursor = Number(frame.cursor);
  const initialLastSeq = cursor.lastSeq;
  if (openingCursor < initialLastSeq) {
    invalidControlState(
      "invalid-history",
      "session.follow opening cursor regressed behind session.inspect",
    );
  }
  let expectedSeq = initialLastSeq + 1;
  let previousLastSeq = -1;
  const records = frame.records.map(followSnapshotRecord);
  for (const record of records) {
    if (
      record.firstSeq <= previousLastSeq ||
      record.lastSeq > openingCursor
    ) {
      invalidControlState(
        "invalid-history",
        "session.follow returned invalid snapshot ordering",
      );
    }
    previousLastSeq = record.lastSeq;
    if (record.lastSeq < expectedSeq) continue;
    if (record.firstSeq > expectedSeq) {
      return {
        cursor: openingCursor,
        gap: true,
        inspected: inspectionFromCursor(input, cursor),
      };
    }
    expectedSeq = record.lastSeq + 1;
  }
  if (expectedSeq <= openingCursor) {
    return {
      cursor: openingCursor,
      gap: true,
      inspected: inspectionFromCursor(input, cursor),
    };
  }
  for (const record of records) {
    if (record.event !== undefined) {
      appendFollowEvent(
        record.event,
        input,
        cursor,
        initialLastSeq,
      );
    }
  }
  cursor.lastSeq = Math.max(cursor.lastSeq, openingCursor);
  return {
    cursor: openingCursor,
    gap: false,
    inspected: inspectionFromCursor(input, cursor),
  };
}

function consumeFollowEvent(
  value: unknown,
  input: AgentTurnInput,
  cursor: OperationInspectionCursor,
  allowOverlapThroughSeq: number,
): OperationInspection {
  const frame = object(value);
  if (frame?.type !== "event") {
    invalidControlState(
      "invalid-history",
      "session.follow returned an invalid event frame",
    );
  }
  appendFollowEvent(
    frame.event,
    input,
    cursor,
    allowOverlapThroughSeq,
  );
  return inspectionFromCursor(input, cursor);
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
  controller: AgentTurnSessionControllerPort,
  input: AgentTurnInput,
  signal: AbortSignal,
  cursor: OperationInspectionCursor,
): Promise<OperationInspection> {
  const inspection = object(
    await controllerCall(
      "session.inspect",
      () => controller.inspect(input.sessionId, signal),
    ),
  );
  if (
    inspection === undefined ||
    !Array.isArray(inspection.events)
  ) {
    invalidControlState(
      "invalid-history",
      "session.inspect returned invalid events",
    );
  }
  const inspected = inspectOperation(
    inspection.events,
    input,
    cursor,
  );
  if (inspected.state === "needs-older-history") {
    invalidControlState(
      "invalid-history",
      "session.inspect could not correlate the operation to a turn",
    );
  }
  return inspected;
}

async function promptAgentTurn(
  controller: AgentTurnSessionControllerPort,
  input: AgentTurnInput,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const prompted = await controllerCall(
    "session.prompt",
    () =>
      controller.prompt({
        requestId: input.operationId,
        sessionId: input.sessionId,
        mode: "queue",
        content: externalPromptContent(input.text),
      }, signal),
  );
  if (prompted.accepted !== true) {
    invalidControlState(
      "invalid-prompt-result",
      "session.prompt did not acknowledge the Agent turn",
    );
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

async function followAgentTurn(
  controller: AgentTurnSessionControllerPort,
  input: AgentTurnInput,
  signal: AbortSignal,
  cursor: OperationInspectionCursor,
  options: AgentTurnExecutionOptions,
): Promise<AgentTurnResult> {
  const follow = controller.follow;
  if (follow === undefined) {
    invalidControlState(
      "invalid-controller",
      "session.follow is unavailable",
    );
  }
  const iterator = await controllerCall(
    "session.follow",
    async () =>
      follow.call(controller, {
        address: {
          kind: "session",
          sessionId: input.sessionId,
        },
      }, signal)[Symbol.asyncIterator](),
  );
  try {
    const opening = await controllerCall(
      "session.follow",
      () => iterator.next(),
    );
    if (opening.done) {
      invalidControlState(
        "invalid-history",
        "session.follow ended before its opening snapshot",
      );
    }
    const snapshot = consumeFollowSnapshot(
      opening.value,
      input,
      cursor,
    );
    let inspected = snapshot.inspected;
    let allowOverlapThroughSeq = -1;
    if (snapshot.gap) {
      inspected = await inspectPersistedOperation(
        controller,
        input,
        signal,
        cursor,
      );
      if (cursor.lastSeq < snapshot.cursor) {
        invalidControlState(
          "invalid-history",
          "session.inspect did not close the session.follow opening gap",
        );
      }
      allowOverlapThroughSeq = cursor.lastSeq;
    }
    if (inspected.state === "needs-older-history") {
      invalidControlState(
        "invalid-history",
        "session.follow could not correlate the operation to a turn",
      );
    }
    if (inspected.state === "terminal") {
      return await materializeTerminalResult(
        inspected,
        input,
        options,
      );
    }
    if (inspected.state === "absent") {
      await promptAgentTurn(controller, input, signal);
    }

    while (true) {
      const next = await controllerCall(
        "session.follow",
        () => iterator.next(),
      );
      if (next.done) {
        invalidControlState(
          "invalid-history",
          "session.follow ended before the Agent turn completed",
        );
      }
      inspected = consumeFollowEvent(
        next.value,
        input,
        cursor,
        allowOverlapThroughSeq,
      );
      if (inspected.state === "needs-older-history") {
        invalidControlState(
          "invalid-history",
          "session.follow could not correlate the operation to a turn",
        );
      }
      if (inspected.state === "terminal") {
        return await materializeTerminalResult(
          inspected,
          input,
          options,
        );
      }
    }
  } finally {
    try {
      await iterator.return?.();
    } catch {
      // The operation result or primary stream error owns this boundary.
    }
  }
}

/**
 * Run or recover one durable Agent turn.
 *
 * The operation id is the prompt requestId recorded as `user/message` rpcId.
 * The durable Session log is therefore inspected before prompting: retrying
 * the same operation either recovers its terminal result or waits for its
 * already-admitted turn.
 */
export async function runAgentTurnInHarness(
  controller: AgentTurnSessionControllerPort,
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
  const created = await controllerCall(
    "session.create",
    () => controller.create({ sessionId: input.sessionId }),
  );
  if (created.sessionId !== input.sessionId) {
    invalidControlState(
      "session-conflict",
      "session.create returned a different session id",
    );
  }

  throwIfAborted(signal);
  const cursor = createInspectionCursor();
  let inspected = await inspectPersistedOperation(
    controller,
    input,
    signal,
    cursor,
  );
  if (inspected.state === "terminal") {
    return await materializeTerminalResult(
      inspected,
      input,
      options,
    );
  }

  if (controller.follow !== undefined) {
    return await followAgentTurn(
      controller,
      input,
      signal,
      cursor,
      options,
    );
  }

  if (inspected.state === "absent") {
    await promptAgentTurn(controller, input, signal);
  }

  while (true) {
    await waitForPoll(pollIntervalMs, signal);
    inspected = await inspectPersistedOperation(
      controller,
      input,
      signal,
      cursor,
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
      ctx.sessionController,
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
