/** Private Harness ↔ Electron protocol and renderer projection for Agent Tabs. */
export const AGENT_BROWSER_PROCESS_CHANNEL =
  "minke:agent-browser:process";
export const AGENT_BROWSER_PROTOCOL_VERSION = 1;
export const AGENT_BROWSER_IPC_VERSION_ENV =
  "MINKE_AGENT_BROWSER_IPC_VERSION";

export const AGENT_BROWSER_SESSIONS_READ_CHANNEL =
  "minke:agent-browser:sessions:read";
export const AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL =
  "minke:agent-browser:sessions:changed";
export const AGENT_BROWSER_CONTROL_CHANNEL =
  "minke:agent-browser:control";
export const AGENT_BROWSER_CLOSE_CHANNEL =
  "minke:agent-browser:close";

export const AGENT_BROWSER_OPERATIONS = [
  "open",
  "navigate",
  "snapshot",
  "click",
  "fill",
  "press",
  "wait",
  "screenshot",
  "close",
] as const;

export type AgentBrowserOperation =
  typeof AGENT_BROWSER_OPERATIONS[number];
export type AgentBrowserOwner = "agent" | "human";
export type AgentBrowserSessionStatus =
  | "pending"
  | "ready"
  | "loading"
  | "paused"
  | "crashed";

export type AgentBrowserCursorPhase =
  | "moving"
  | "clicking"
  | "typing";

export interface AgentBrowserCursorPoint {
  readonly x: number;
  readonly y: number;
}

export interface AgentBrowserCursorViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * One transient, generation-bound visual cursor event.
 *
 * Coordinates use the guest page's CSS viewport coordinate space. The
 * sequence is monotonically increasing within one Agent Browser session so a
 * renderer can replay equal-position clicks without relying on object
 * identity.
 */
export interface AgentBrowserCursorProjection {
  readonly sequence: number;
  readonly phase: AgentBrowserCursorPhase;
  readonly point: AgentBrowserCursorPoint;
  readonly viewport: AgentBrowserCursorViewport;
  /**
   * Travel time to `point`. Every phase is self-contained because projection
   * consumers may coalesce the preceding `moving` event. Click/type feedback
   * lifetimes are renderer-owned visual constants.
   */
  readonly durationMs: number;
}

export interface AgentBrowserProjection {
  readonly sessionId: string;
  readonly partition: string;
  readonly generation: number;
  readonly owner: AgentBrowserOwner;
  readonly status: AgentBrowserSessionStatus;
  readonly url?: string;
  readonly title?: string;
  readonly error?: string;
  readonly cursor?: AgentBrowserCursorProjection;
}

export interface AgentBrowserSnapshotNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly description?: string;
}

export interface AgentBrowserSessionResult {
  readonly sessionId: string;
  readonly generation: number;
  readonly owner: AgentBrowserOwner;
  readonly status: AgentBrowserSessionStatus;
  readonly url?: string;
  readonly title?: string;
}

export interface AgentBrowserSnapshotResult
  extends AgentBrowserSessionResult {
  readonly snapshotId: string;
  readonly nodes: readonly AgentBrowserSnapshotNode[];
}

export interface AgentBrowserScreenshotResult
  extends AgentBrowserSessionResult {
  readonly mimeType: "image/png";
  readonly data: string;
}

export interface AgentBrowserCloseResult {
  readonly sessionId: string;
  readonly closed: true;
}

export type AgentBrowserOperationResult =
  | AgentBrowserSessionResult
  | AgentBrowserSnapshotResult
  | AgentBrowserScreenshotResult
  | AgentBrowserCloseResult;

export interface AgentBrowserRequest {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "request";
  readonly operation: AgentBrowserOperation;
  readonly ownerSessionId: string;
  readonly payload: Record<string, unknown>;
}

export interface AgentBrowserCancelRequest {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "cancel";
}

/** One-way lifecycle frame releasing every tab owned by one Agent session. */
export interface AgentBrowserReleaseOwnerRequest {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly type: "release-owner";
  readonly ownerSessionId: string;
}

export type AgentBrowserProcessRequest =
  | AgentBrowserRequest
  | AgentBrowserCancelRequest
  | AgentBrowserReleaseOwnerRequest;

export interface AgentBrowserSuccessResponse {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "response";
  readonly result: AgentBrowserOperationResult;
}

export interface AgentBrowserErrorResponse {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "error";
  readonly code: string;
  readonly message: string;
  readonly outcome: "known" | "unknown";
}

export type AgentBrowserProcessResponse =
  | AgentBrowserSuccessResponse
  | AgentBrowserErrorResponse;

export type AgentBrowserToolPayload =
  | { readonly url: string }
  | { readonly sessionId: string; readonly url: string }
  | { readonly sessionId: string }
  | { readonly sessionId: string; readonly ref: string }
  | {
      readonly sessionId: string;
      readonly ref: string;
      readonly value: string;
    }
  | {
      readonly sessionId: string;
      readonly key: string;
      readonly ref?: string;
    }
  | {
      readonly sessionId: string;
      readonly text: string;
      readonly timeoutMs: number;
    };

const MAX_ID_LENGTH = 160;
const MAX_URL_LENGTH = 8_192;
const MAX_TEXT_LENGTH = 20_000;
const MAX_ERROR_LENGTH = 2_048;
const MAX_SNAPSHOT_NODES = 300;
const MAX_SCREENSHOT_BASE64_LENGTH = 8 * 1024 * 1024;
const MAX_CURSOR_COORDINATE = 100_000;
const MAX_CURSOR_DURATION_MS = 2_000;

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

function exactKeys(
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

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function boundedFiniteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a bounded finite number`);
  }
  return value;
}

function parseAgentBrowserCursorPhase(
  value: unknown,
): AgentBrowserCursorPhase {
  if (
    value !== "moving" &&
    value !== "clicking" &&
    value !== "typing"
  ) {
    throw new TypeError("invalid Agent Browser cursor phase");
  }
  return value;
}

export function parseAgentBrowserCursorProjection(
  value: unknown,
): AgentBrowserCursorProjection {
  const cursor = record(value, "Agent Browser cursor");
  if (
    !exactKeys(
      cursor,
      ["sequence", "phase", "point", "viewport", "durationMs"],
    )
  ) {
    throw new TypeError("invalid Agent Browser cursor");
  }
  const point = record(cursor.point, "Agent Browser cursor point");
  const viewport = record(
    cursor.viewport,
    "Agent Browser cursor viewport",
  );
  if (
    !exactKeys(point, ["x", "y"]) ||
    !exactKeys(viewport, ["width", "height"])
  ) {
    throw new TypeError("invalid Agent Browser cursor geometry");
  }
  const durationMs = positiveInteger(
    cursor.durationMs,
    "Agent Browser cursor duration",
  );
  if (durationMs > MAX_CURSOR_DURATION_MS) {
    throw new TypeError(
      "Agent Browser cursor duration must be bounded",
    );
  }
  const parsedPoint = {
    x: boundedFiniteNumber(
      point.x,
      "Agent Browser cursor x",
      0,
      MAX_CURSOR_COORDINATE,
    ),
    y: boundedFiniteNumber(
      point.y,
      "Agent Browser cursor y",
      0,
      MAX_CURSOR_COORDINATE,
    ),
  };
  const parsedViewport = {
    width: boundedFiniteNumber(
      viewport.width,
      "Agent Browser cursor viewport width",
      1,
      MAX_CURSOR_COORDINATE,
    ),
    height: boundedFiniteNumber(
      viewport.height,
      "Agent Browser cursor viewport height",
      1,
      MAX_CURSOR_COORDINATE,
    ),
  };
  if (
    parsedPoint.x > parsedViewport.width ||
    parsedPoint.y > parsedViewport.height
  ) {
    throw new TypeError(
      "Agent Browser cursor point must be inside its viewport",
    );
  }
  return {
    sequence: positiveInteger(
      cursor.sequence,
      "Agent Browser cursor sequence",
    ),
    phase: parseAgentBrowserCursorPhase(cursor.phase),
    point: parsedPoint,
    viewport: parsedViewport,
    durationMs,
  };
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

function parseIdentifier(value: unknown, label: string): string {
  const id = boundedString(value, label, MAX_ID_LENGTH);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(id)) {
    throw new TypeError(`${label} has an invalid format`);
  }
  return id;
}

export function normalizeAgentBrowserUrl(
  value: unknown,
): string {
  const candidate = boundedString(
    value,
    "Agent Browser URL",
    MAX_URL_LENGTH,
  );
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new TypeError("invalid Agent Browser URL");
    }
    return url.toString();
  } catch {
    throw new TypeError("invalid Agent Browser URL");
  }
}

export function parseAgentBrowserSessionId(
  value: unknown,
): string {
  return parseIdentifier(value, "Agent Browser session id");
}

export function parseAgentBrowserOwnerSessionId(
  value: unknown,
): string {
  return parseIdentifier(value, "Agent owner session id");
}

export function parseAgentBrowserRef(value: unknown): string {
  const ref = boundedString(value, "Agent Browser ref", MAX_ID_LENGTH);
  if (!/^s\d+:e\d+$/u.test(ref)) {
    throw new TypeError("invalid Agent Browser ref");
  }
  return ref;
}

export function parseAgentBrowserOperation(
  value: unknown,
): AgentBrowserOperation {
  if (
    typeof value !== "string" ||
    !AGENT_BROWSER_OPERATIONS.includes(
      value as AgentBrowserOperation,
    )
  ) {
    throw new TypeError("invalid Agent Browser operation");
  }
  return value as AgentBrowserOperation;
}

export function parseAgentBrowserToolPayload(
  operation: AgentBrowserOperation,
  value: unknown,
): Record<string, unknown> {
  const payload = record(value, `Agent Browser ${operation} payload`);
  switch (operation) {
    case "open":
      if (!exactKeys(payload, ["url"])) {
        throw new TypeError("invalid Agent Browser open payload");
      }
      return { url: normalizeAgentBrowserUrl(payload.url) };
    case "navigate":
      if (!exactKeys(payload, ["sessionId", "url"])) {
        throw new TypeError("invalid Agent Browser navigate payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        url: normalizeAgentBrowserUrl(payload.url),
      };
    case "snapshot":
    case "screenshot":
    case "close":
      if (!exactKeys(payload, ["sessionId"])) {
        throw new TypeError(
          `invalid Agent Browser ${operation} payload`,
        );
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
      };
    case "click":
      if (!exactKeys(payload, ["sessionId", "ref"])) {
        throw new TypeError("invalid Agent Browser click payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        ref: parseAgentBrowserRef(payload.ref),
      };
    case "fill":
      if (!exactKeys(payload, ["sessionId", "ref", "value"])) {
        throw new TypeError("invalid Agent Browser fill payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        ref: parseAgentBrowserRef(payload.ref),
        value: boundedString(
          payload.value,
          "Agent Browser fill value",
          MAX_TEXT_LENGTH,
          true,
        ),
      };
    case "press":
      if (
        !exactKeys(payload, ["sessionId", "key"], ["ref"])
      ) {
        throw new TypeError("invalid Agent Browser press payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        key: boundedString(
          payload.key,
          "Agent Browser key",
          64,
        ),
        ...(payload.ref === undefined
          ? {}
          : { ref: parseAgentBrowserRef(payload.ref) }),
      };
    case "wait": {
      if (
        !exactKeys(
          payload,
          ["sessionId", "text", "timeoutMs"],
        )
      ) {
        throw new TypeError("invalid Agent Browser wait payload");
      }
      const timeoutMs = positiveInteger(
        payload.timeoutMs,
        "Agent Browser wait timeout",
      );
      if (timeoutMs > 30_000) {
        throw new TypeError(
          "Agent Browser wait timeout exceeds 30000 ms",
        );
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        text: boundedString(
          payload.text,
          "Agent Browser wait text",
          2_000,
        ),
        timeoutMs,
      };
    }
  }
}

export function createAgentBrowserRequest(
  requestId: number,
  ownerSessionId: string,
  operation: AgentBrowserOperation,
  payload: unknown,
): AgentBrowserRequest {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent Browser request id",
    ),
    type: "request",
    operation: parseAgentBrowserOperation(operation),
    ownerSessionId:
      parseAgentBrowserOwnerSessionId(ownerSessionId),
    payload: parseAgentBrowserToolPayload(operation, payload),
  };
}

export function createAgentBrowserCancelRequest(
  requestId: number,
): AgentBrowserCancelRequest {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent Browser request id",
    ),
    type: "cancel",
  };
}

export function createAgentBrowserReleaseOwnerRequest(
  ownerSessionId: string,
): AgentBrowserReleaseOwnerRequest {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "release-owner",
    ownerSessionId:
      parseAgentBrowserOwnerSessionId(ownerSessionId),
  };
}

export function isAgentBrowserProcessMessage(
  value: unknown,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "channel") ===
      AGENT_BROWSER_PROCESS_CHANNEL
  );
}

export function parseAgentBrowserProcessRequest(
  value: unknown,
): AgentBrowserProcessRequest {
  const request = record(value, "Agent Browser process request");
  if (
    request.channel !== AGENT_BROWSER_PROCESS_CHANNEL ||
    request.protocolVersion !== AGENT_BROWSER_PROTOCOL_VERSION
  ) {
    throw new TypeError("invalid Agent Browser process request");
  }
  if (request.type === "release-owner") {
    if (
      !exactKeys(request, [
        "channel",
        "protocolVersion",
        "type",
        "ownerSessionId",
      ])
    ) {
      throw new TypeError(
        "invalid Agent Browser release owner request",
      );
    }
    return createAgentBrowserReleaseOwnerRequest(
      parseAgentBrowserOwnerSessionId(request.ownerSessionId),
    );
  }
  const requestId = positiveInteger(
    request.requestId,
    "Agent Browser request id",
  );
  if (request.type === "cancel") {
    if (
      !exactKeys(request, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
      ])
    ) {
      throw new TypeError("invalid Agent Browser cancel request");
    }
    return createAgentBrowserCancelRequest(requestId);
  }
  if (
    request.type !== "request" ||
    !exactKeys(request, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "operation",
      "ownerSessionId",
      "payload",
    ])
  ) {
    throw new TypeError("invalid Agent Browser process request");
  }
  const operation = parseAgentBrowserOperation(request.operation);
  return createAgentBrowserRequest(
    requestId,
    parseAgentBrowserOwnerSessionId(request.ownerSessionId),
    operation,
    request.payload,
  );
}

function parseOwner(value: unknown): AgentBrowserOwner {
  if (value !== "agent" && value !== "human") {
    throw new TypeError("invalid Agent Browser owner");
  }
  return value;
}

function parseStatus(value: unknown): AgentBrowserSessionStatus {
  if (
    value !== "pending" &&
    value !== "ready" &&
    value !== "loading" &&
    value !== "paused" &&
    value !== "crashed"
  ) {
    throw new TypeError("invalid Agent Browser status");
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : boundedString(value, label, maxLength);
}

export function parseAgentBrowserProjection(
  value: unknown,
): AgentBrowserProjection {
  const projection = record(value, "Agent Browser projection");
  if (
    !exactKeys(
      projection,
      [
        "sessionId",
        "partition",
        "generation",
        "owner",
        "status",
      ],
      ["url", "title", "error", "cursor"],
    )
  ) {
    throw new TypeError("invalid Agent Browser projection");
  }
  const partition = boundedString(
    projection.partition,
    "Agent Browser partition",
    MAX_ID_LENGTH,
  );
  if (
    !partition.startsWith("minke-agent-") ||
    partition.startsWith("persist:")
  ) {
    throw new TypeError("invalid Agent Browser partition");
  }
  const url = projection.url === undefined
    ? undefined
    : normalizeAgentBrowserUrl(projection.url);
  const title = optionalBoundedString(
    projection.title,
    "Agent Browser title",
    160,
  );
  const error = optionalBoundedString(
    projection.error,
    "Agent Browser error",
    MAX_ERROR_LENGTH,
  );
  const cursor = projection.cursor === undefined
    ? undefined
    : parseAgentBrowserCursorProjection(projection.cursor);
  return {
    sessionId: parseAgentBrowserSessionId(projection.sessionId),
    partition,
    generation: positiveInteger(
      projection.generation,
      "Agent Browser generation",
    ),
    owner: parseOwner(projection.owner),
    status: parseStatus(projection.status),
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
    ...(error === undefined ? {} : { error }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parseAgentBrowserProjections(
  value: unknown,
): AgentBrowserProjection[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError("invalid Agent Browser projection list");
  }
  return value.map(parseAgentBrowserProjection);
}

export function parseAgentBrowserControlRequest(
  value: unknown,
): { readonly sessionId: string; readonly owner: AgentBrowserOwner } {
  const request = record(value, "Agent Browser control request");
  if (!exactKeys(request, ["sessionId", "owner"])) {
    throw new TypeError("invalid Agent Browser control request");
  }
  return {
    sessionId: parseAgentBrowserSessionId(request.sessionId),
    owner: parseOwner(request.owner),
  };
}

function parseSessionResult(
  value: unknown,
): AgentBrowserSessionResult {
  const result = record(value, "Agent Browser session result");
  if (
    !exactKeys(
      result,
      ["sessionId", "generation", "owner", "status"],
      ["url", "title"],
    )
  ) {
    throw new TypeError("invalid Agent Browser session result");
  }
  const url = result.url === undefined
    ? undefined
    : normalizeAgentBrowserUrl(result.url);
  const title = optionalBoundedString(
    result.title,
    "Agent Browser title",
    160,
  );
  return {
    sessionId: parseAgentBrowserSessionId(result.sessionId),
    generation: positiveInteger(
      result.generation,
      "Agent Browser generation",
    ),
    owner: parseOwner(result.owner),
    status: parseStatus(result.status),
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
  };
}

function parseSnapshotNode(
  value: unknown,
): AgentBrowserSnapshotNode {
  const node = record(value, "Agent Browser snapshot node");
  if (
    !exactKeys(node, ["ref", "role", "name"], ["description"])
  ) {
    throw new TypeError("invalid Agent Browser snapshot node");
  }
  const description = optionalBoundedString(
    node.description,
    "Agent Browser node description",
    500,
  );
  return {
    ref: parseAgentBrowserRef(node.ref),
    role: boundedString(node.role, "Agent Browser node role", 80),
    name: boundedString(
      node.name,
      "Agent Browser node name",
      500,
      true,
    ),
    ...(description === undefined ? {} : { description }),
  };
}

export function parseAgentBrowserOperationResult(
  operation: AgentBrowserOperation,
  value: unknown,
): AgentBrowserOperationResult {
  if (operation === "close") {
    const result = record(value, "Agent Browser close result");
    if (
      !exactKeys(result, ["sessionId", "closed"]) ||
      result.closed !== true
    ) {
      throw new TypeError("invalid Agent Browser close result");
    }
    return {
      sessionId: parseAgentBrowserSessionId(result.sessionId),
      closed: true,
    };
  }
  if (operation === "snapshot") {
    const result = record(value, "Agent Browser snapshot result");
    if (
      !exactKeys(
        result,
        [
          "sessionId",
          "generation",
          "owner",
          "status",
          "snapshotId",
          "nodes",
        ],
        ["url", "title"],
      ) ||
      !Array.isArray(result.nodes) ||
      result.nodes.length > MAX_SNAPSHOT_NODES
    ) {
      throw new TypeError("invalid Agent Browser snapshot result");
    }
    return {
      ...parseSessionResult({
        sessionId: result.sessionId,
        generation: result.generation,
        owner: result.owner,
        status: result.status,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.title === undefined
          ? {}
          : { title: result.title }),
      }),
      snapshotId: parseIdentifier(
        result.snapshotId,
        "Agent Browser snapshot id",
      ),
      nodes: result.nodes.map(parseSnapshotNode),
    };
  }
  if (operation === "screenshot") {
    const result = record(value, "Agent Browser screenshot result");
    if (
      !exactKeys(
        result,
        [
          "sessionId",
          "generation",
          "owner",
          "status",
          "mimeType",
          "data",
        ],
        ["url", "title"],
      ) ||
      result.mimeType !== "image/png"
    ) {
      throw new TypeError("invalid Agent Browser screenshot result");
    }
    const data = boundedString(
      result.data,
      "Agent Browser screenshot",
      MAX_SCREENSHOT_BASE64_LENGTH,
    );
    if (!/^[a-zA-Z0-9+/]+={0,2}$/u.test(data)) {
      throw new TypeError("invalid Agent Browser screenshot");
    }
    return {
      ...parseSessionResult({
        sessionId: result.sessionId,
        generation: result.generation,
        owner: result.owner,
        status: result.status,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.title === undefined
          ? {}
          : { title: result.title }),
      }),
      mimeType: "image/png",
      data,
    };
  }
  return parseSessionResult(value);
}

export function agentBrowserSuccessResponse(
  requestId: number,
  operation: AgentBrowserOperation,
  result: unknown,
): AgentBrowserSuccessResponse {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent Browser request id",
    ),
    type: "response",
    result: parseAgentBrowserOperationResult(operation, result),
  };
}

export function agentBrowserErrorResponse(
  requestId: number,
  error: unknown,
  options: {
    readonly code?: string;
    readonly outcome?: "known" | "unknown";
  } = {},
): AgentBrowserErrorResponse {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent Browser request id",
    ),
    type: "error",
    code: boundedString(
      options.code ?? "agent_browser_error",
      "Agent Browser error code",
      80,
    ),
    message: raw.slice(0, MAX_ERROR_LENGTH),
    outcome: options.outcome ?? "known",
  };
}

export function parseAgentBrowserProcessResponse(
  operation: AgentBrowserOperation,
  value: unknown,
): AgentBrowserProcessResponse {
  const response = record(value, "Agent Browser process response");
  if (
    response.channel !== AGENT_BROWSER_PROCESS_CHANNEL ||
    response.protocolVersion !== AGENT_BROWSER_PROTOCOL_VERSION
  ) {
    throw new TypeError("invalid Agent Browser process response");
  }
  const requestId = positiveInteger(
    response.requestId,
    "Agent Browser request id",
  );
  if (response.type === "response") {
    if (
      !exactKeys(response, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
        "result",
      ])
    ) {
      throw new TypeError("invalid Agent Browser success response");
    }
    return agentBrowserSuccessResponse(
      requestId,
      operation,
      response.result,
    );
  }
  if (
    response.type !== "error" ||
    !exactKeys(response, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "code",
      "message",
      "outcome",
    ]) ||
    (response.outcome !== "known" &&
      response.outcome !== "unknown")
  ) {
    throw new TypeError("invalid Agent Browser error response");
  }
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId,
    type: "error",
    code: boundedString(
      response.code,
      "Agent Browser error code",
      80,
    ),
    message: boundedString(
      response.message,
      "Agent Browser error message",
      MAX_ERROR_LENGTH,
      true,
    ),
    outcome: response.outcome,
  };
}
