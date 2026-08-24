/** Private Electron parent ↔ Harness process contract for one Agent turn. */
export const AGENT_TURN_PROCESS_CHANNEL =
  "minke:agent-turn:process";
export const AGENT_TURN_PROTOCOL_VERSION = 1;

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_TEXT_LENGTH = 256 * 1024;
const MAX_RESULT_TEXT_LENGTH = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 8 * 1024;
const MAX_PREVIEWS = 8;
const MAX_PREVIEW_TITLE_LENGTH = 256;
const PREVIEW_ROUTE_PATTERN =
  /^\/minke-preview\/[A-Za-z0-9_-]{22}\/$/u;

export interface AgentTurnInput {
  readonly operationId: string;
  readonly sessionId: string;
  readonly text: string;
}

export interface AgentTurnPreview {
  readonly title: string;
  readonly route: string;
}

export type AgentTurnResult =
  | {
      readonly outcome: "completed";
      readonly sessionId: string;
      readonly text: string;
      readonly turn: number;
      readonly endReason: string;
      readonly previews?: readonly AgentTurnPreview[];
    }
  | {
      readonly outcome: "no-response";
      readonly sessionId: string;
      readonly turn?: number;
      readonly endReason: string;
    }
  | {
      readonly outcome: "failed";
      readonly sessionId: string;
      readonly message: string;
      readonly turn?: number;
      readonly endReason: string;
    };

export interface AgentTurnRunRequest {
  readonly channel: typeof AGENT_TURN_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_TURN_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "agent-turn/run";
  readonly input: AgentTurnInput;
}

export interface AgentTurnCancelRequest {
  readonly channel: typeof AGENT_TURN_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_TURN_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "agent-turn/cancel";
}

export type AgentTurnProcessRequest =
  | AgentTurnRunRequest
  | AgentTurnCancelRequest;

export interface AgentTurnResultResponse {
  readonly channel: typeof AGENT_TURN_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_TURN_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "agent-turn/result";
  readonly result: AgentTurnResult;
}

export interface AgentTurnErrorResponse {
  readonly channel: typeof AGENT_TURN_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_TURN_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "agent-turn/error";
  readonly code: string;
  readonly message: string;
}

export type AgentTurnProcessResponse =
  | AgentTurnResultResponse
  | AgentTurnErrorResponse;

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

function positiveInteger(
  value: unknown,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function nonNegativeInteger(
  value: unknown,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(
      `${label} must be a non-negative safe integer`,
    );
  }
  return Number(value);
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxLength
  ) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const candidate = boundedString(
    value,
    label,
    MAX_IDENTIFIER_LENGTH,
  );
  if (
    candidate.trim() !== candidate ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    throw new TypeError(`${label} has an invalid format`);
  }
  return candidate;
}

function preview(value: unknown): AgentTurnPreview {
  const candidate = record(value, "Agent turn preview");
  if (
    !hasExactKeys(candidate, ["title", "route"]) ||
    typeof candidate.title !== "string" ||
    candidate.title.length === 0 ||
    candidate.title.length > MAX_PREVIEW_TITLE_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(candidate.title) ||
    typeof candidate.route !== "string" ||
    !PREVIEW_ROUTE_PATTERN.test(candidate.route)
  ) {
    throw new TypeError("invalid Agent turn preview");
  }
  return {
    title: candidate.title,
    route: candidate.route,
  };
}

function previews(value: unknown): readonly AgentTurnPreview[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PREVIEWS
  ) {
    throw new TypeError("invalid Agent turn previews");
  }
  return value.map(preview);
}

function parseAgentTurnInput(value: unknown): AgentTurnInput {
  const candidate = record(value, "Agent turn input");
  if (
    !hasExactKeys(candidate, [
      "operationId",
      "sessionId",
      "text",
    ])
  ) {
    throw new TypeError("invalid Agent turn input");
  }
  return {
    operationId: identifier(
      candidate.operationId,
      "Agent turn operation id",
    ),
    sessionId: identifier(
      candidate.sessionId,
      "Agent turn session id",
    ),
    text: boundedString(
      candidate.text,
      "Agent turn text",
      MAX_TEXT_LENGTH,
    ),
  };
}

export function parseAgentTurnResult(
  value: unknown,
): AgentTurnResult {
  const candidate = record(value, "Agent turn result");
  if (candidate.outcome === "completed") {
    if (
      !hasExactKeys(
        candidate,
        [
          "outcome",
          "sessionId",
          "text",
          "turn",
          "endReason",
        ],
        ["previews"],
      )
    ) {
      throw new TypeError("invalid completed Agent turn result");
    }
    return {
      outcome: "completed",
      sessionId: identifier(
        candidate.sessionId,
        "Agent turn session id",
      ),
      text: boundedString(
        candidate.text,
        "Agent turn response text",
        MAX_RESULT_TEXT_LENGTH,
      ),
      turn: nonNegativeInteger(
        candidate.turn,
        "Agent turn number",
      ),
      endReason: identifier(
        candidate.endReason,
        "Agent turn end reason",
      ),
      ...(candidate.previews === undefined
        ? {}
        : { previews: previews(candidate.previews) }),
    };
  }
  if (candidate.outcome === "no-response") {
    if (
      !hasExactKeys(
        candidate,
        ["outcome", "sessionId", "endReason"],
        ["turn"],
      )
    ) {
      throw new TypeError("invalid empty Agent turn result");
    }
    return {
      outcome: "no-response",
      sessionId: identifier(
        candidate.sessionId,
        "Agent turn session id",
      ),
      ...(candidate.turn === undefined
        ? {}
        : {
            turn: nonNegativeInteger(
              candidate.turn,
              "Agent turn number",
            ),
          }),
      endReason: identifier(
        candidate.endReason,
        "Agent turn end reason",
      ),
    };
  }
  if (candidate.outcome === "failed") {
    if (
      !hasExactKeys(
        candidate,
        [
          "outcome",
          "sessionId",
          "message",
          "endReason",
        ],
        ["turn"],
      )
    ) {
      throw new TypeError("invalid failed Agent turn result");
    }
    return {
      outcome: "failed",
      sessionId: identifier(
        candidate.sessionId,
        "Agent turn session id",
      ),
      message: boundedString(
        candidate.message,
        "Agent turn failure",
        MAX_MESSAGE_LENGTH,
      ),
      ...(candidate.turn === undefined
        ? {}
        : {
            turn: nonNegativeInteger(
              candidate.turn,
              "Agent turn number",
            ),
          }),
      endReason: identifier(
        candidate.endReason,
        "Agent turn end reason",
      ),
    };
  }
  throw new TypeError("invalid Agent turn result outcome");
}

function requestEnvelope(
  value: Record<string, unknown>,
): {
  readonly requestId: number;
  readonly type: unknown;
} {
  if (
    value.channel !== AGENT_TURN_PROCESS_CHANNEL ||
    value.protocolVersion !== AGENT_TURN_PROTOCOL_VERSION
  ) {
    throw new TypeError("invalid Agent turn process request");
  }
  return {
    requestId: positiveInteger(
      value.requestId,
      "Agent turn request id",
    ),
    type: value.type,
  };
}

export function createAgentTurnRunRequest(
  requestId: number,
  input: AgentTurnInput,
): AgentTurnRunRequest {
  return {
    channel: AGENT_TURN_PROCESS_CHANNEL,
    protocolVersion: AGENT_TURN_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent turn request id",
    ),
    type: "agent-turn/run",
    input: parseAgentTurnInput(input),
  };
}

export function createAgentTurnCancelRequest(
  requestId: number,
): AgentTurnCancelRequest {
  return {
    channel: AGENT_TURN_PROCESS_CHANNEL,
    protocolVersion: AGENT_TURN_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent turn request id",
    ),
    type: "agent-turn/cancel",
  };
}

export function parseAgentTurnProcessRequest(
  value: unknown,
): AgentTurnProcessRequest {
  const candidate = record(value, "Agent turn process request");
  const envelope = requestEnvelope(candidate);
  if (envelope.type === "agent-turn/run") {
    if (
      !hasExactKeys(candidate, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
        "input",
      ])
    ) {
      throw new TypeError("invalid Agent turn run request");
    }
    return createAgentTurnRunRequest(
      envelope.requestId,
      parseAgentTurnInput(candidate.input),
    );
  }
  if (envelope.type === "agent-turn/cancel") {
    if (
      !hasExactKeys(candidate, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
      ])
    ) {
      throw new TypeError("invalid Agent turn cancel request");
    }
    return createAgentTurnCancelRequest(envelope.requestId);
  }
  throw new TypeError("invalid Agent turn process request type");
}

export function agentTurnResultResponse(
  requestId: number,
  result: AgentTurnResult,
): AgentTurnResultResponse {
  return {
    channel: AGENT_TURN_PROCESS_CHANNEL,
    protocolVersion: AGENT_TURN_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent turn request id",
    ),
    type: "agent-turn/result",
    result: parseAgentTurnResult(result),
  };
}

export function agentTurnErrorResponse(
  requestId: number,
  code: string,
  message: string,
): AgentTurnErrorResponse {
  return {
    channel: AGENT_TURN_PROCESS_CHANNEL,
    protocolVersion: AGENT_TURN_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent turn request id",
    ),
    type: "agent-turn/error",
    code: identifier(code, "Agent turn error code"),
    message: boundedString(
      message,
      "Agent turn error message",
      MAX_MESSAGE_LENGTH,
    ),
  };
}

export function parseAgentTurnProcessResponse(
  value: unknown,
): AgentTurnProcessResponse {
  const candidate = record(value, "Agent turn process response");
  if (
    candidate.channel !== AGENT_TURN_PROCESS_CHANNEL ||
    candidate.protocolVersion !== AGENT_TURN_PROTOCOL_VERSION
  ) {
    throw new TypeError("invalid Agent turn process response");
  }
  const requestId = positiveInteger(
    candidate.requestId,
    "Agent turn request id",
  );
  if (candidate.type === "agent-turn/result") {
    if (
      !hasExactKeys(candidate, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
        "result",
      ])
    ) {
      throw new TypeError("invalid Agent turn result response");
    }
    return agentTurnResultResponse(
      requestId,
      parseAgentTurnResult(candidate.result),
    );
  }
  if (candidate.type === "agent-turn/error") {
    if (
      !hasExactKeys(candidate, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
        "code",
        "message",
      ])
    ) {
      throw new TypeError("invalid Agent turn error response");
    }
    return agentTurnErrorResponse(
      requestId,
      identifier(candidate.code, "Agent turn error code"),
      boundedString(
        candidate.message,
        "Agent turn error message",
        MAX_MESSAGE_LENGTH,
      ),
    );
  }
  throw new TypeError("invalid Agent turn process response type");
}

export function isAgentTurnProcessMessage(
  value: unknown,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "channel") === AGENT_TURN_PROCESS_CHANNEL
  );
}
