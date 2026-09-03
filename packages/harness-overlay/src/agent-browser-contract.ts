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
export const AGENT_BROWSER_NAVIGATION_CHANNEL =
  "minke:agent-browser:navigation";
export const AGENT_BROWSER_CLOSE_CHANNEL =
  "minke:agent-browser:close";

export const AGENT_BROWSER_OPERATIONS = [
  "open",
  "navigate",
  "history",
  "snapshot",
  "find",
  "locate",
  "click",
  "fill",
  "press",
  "scroll",
  "wait",
  "screenshot",
  "close",
] as const;

export type AgentBrowserOperation =
  typeof AGENT_BROWSER_OPERATIONS[number];
export const AGENT_BROWSER_NODE_ACTIONS = [
  "click",
  "fill",
  "press",
] as const;
export type AgentBrowserNodeAction =
  typeof AGENT_BROWSER_NODE_ACTIONS[number];
export type AgentBrowserOwner = "agent" | "human";
export const AGENT_BROWSER_NAVIGATION_COMMANDS = [
  "back",
  "forward",
  "reload",
  "stop",
] as const;
export type AgentBrowserNavigationCommand =
  typeof AGENT_BROWSER_NAVIGATION_COMMANDS[number];
export const AGENT_BROWSER_SCROLL_DIRECTIONS = [
  "up",
  "down",
  "left",
  "right",
  "top",
  "bottom",
] as const;
export type AgentBrowserScrollDirection =
  typeof AGENT_BROWSER_SCROLL_DIRECTIONS[number];
export const MAX_AGENT_BROWSER_SCROLL_AMOUNT = 10_000;
export const MAX_AGENT_BROWSER_SCROLL_COORDINATE = 100_000_000;
export type AgentBrowserSessionStatus =
  | "pending"
  | "ready"
  | "loading"
  | "paused"
  | "crashed";

export type AgentBrowserCursorPhase =
  | "idle"
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
 * One generation-bound visual cursor state.
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
  readonly navigation?: AgentBrowserNavigationState;
  readonly url?: string;
  readonly title?: string;
  readonly error?: string;
  readonly cursor?: AgentBrowserCursorProjection;
}

export interface AgentBrowserNavigationState {
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export interface AgentBrowserSnapshotNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly depth?: number;
  readonly parentRef?: string;
  readonly actionable?: boolean;
  readonly disabled?: boolean;
  readonly value?: string;
  readonly placeholder?: string;
  readonly url?: string;
  readonly description?: string;
  readonly source?: "accessibility" | "dom" | "accessibility+dom";
  readonly confidence?: "high" | "medium";
  /**
   * Mutation capabilities grounded in this exact snapshot ref.
   *
   * Structural and disabled nodes expose no actions. The runtime still
   * revalidates freshness and interactability immediately before dispatch.
   */
  readonly actions?: readonly AgentBrowserNodeAction[];
  /** True only when this node directly matched the current find query. */
  readonly match?: boolean;
}

const EDITABLE_AGENT_BROWSER_ROLES = new Set([
  "combobox",
  "searchbox",
  "spinbutton",
  "textbox",
]);

/**
 * Conservative static capabilities for a grounded browser node.
 *
 * CDP preflight remains authoritative because role metadata can drift from
 * the live DOM between observation and dispatch.
 */
export function inferAgentBrowserNodeActions(
  node: Pick<
    AgentBrowserSnapshotNode,
    "role" | "actionable" | "disabled"
  >,
): readonly AgentBrowserNodeAction[] {
  if (node.actionable !== true || node.disabled === true) {
    return [];
  }
  return EDITABLE_AGENT_BROWSER_ROLES.has(node.role.toLowerCase())
    ? ["click", "fill", "press"]
    : ["click", "press"];
}

export interface AgentBrowserLocatedNode
  extends AgentBrowserSnapshotNode {
  readonly actionable: true;
  readonly disabled: false;
  readonly match: true;
}

export interface AgentBrowserSessionResult {
  readonly sessionId: string;
  readonly generation: number;
  readonly owner: AgentBrowserOwner;
  readonly status: AgentBrowserSessionStatus;
  readonly snapshotRequired: boolean;
  readonly url?: string;
  readonly title?: string;
}

export interface AgentBrowserClaimControlResult
  extends AgentBrowserSessionResult {
  readonly owner: "agent";
  readonly snapshotRequired: true;
  readonly controlRevision: number;
}

export interface AgentBrowserRefTarget {
  readonly ref: string;
}

export interface AgentBrowserSemanticTarget {
  readonly withinRef?: string;
  readonly role?: string;
  readonly name?: string;
  readonly placeholder?: string;
  readonly url?: string;
  readonly exact: boolean;
  readonly index?: number;
}

export type AgentBrowserTarget =
  | AgentBrowserRefTarget
  | AgentBrowserSemanticTarget;

export const AGENT_BROWSER_FIND_VIEWS = [
  "matches",
  "context",
  "subtree",
] as const;
export type AgentBrowserFindView =
  typeof AGENT_BROWSER_FIND_VIEWS[number];

export interface AgentBrowserFindQuery {
  readonly withinRef?: string;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly placeholder?: string;
  readonly url?: string;
  readonly actionable?: boolean;
  readonly exact: boolean;
  /** Zero-based position after all semantic and scope constraints. */
  readonly index?: number;
}

export interface AgentBrowserSnapshotResult
  extends AgentBrowserSessionResult {
  readonly snapshotId: string;
  readonly nodes: readonly AgentBrowserSnapshotNode[];
  readonly view?: "outline";
  readonly totalNodes?: number;
  readonly actionableNodes?: number;
  readonly indexTruncated?: boolean;
}

export interface AgentBrowserFindResult
  extends AgentBrowserSessionResult {
  readonly snapshotId: string;
  readonly nodes: readonly AgentBrowserSnapshotNode[];
  readonly view: AgentBrowserFindView;
  readonly totalNodes: number;
  readonly actionableNodes: number;
  readonly totalMatches: number;
  readonly offset: number;
  readonly indexTruncated: boolean;
  readonly nextCursor?: string;
}

export interface AgentBrowserLocateResult
  extends AgentBrowserSessionResult {
  readonly snapshotId: string;
  readonly node: AgentBrowserLocatedNode;
}

export interface AgentBrowserScrollResult
  extends AgentBrowserSessionResult {
  /** "page" or the exact observed ref of a scroll container. */
  readonly scope: string;
  readonly beforeX: number;
  readonly beforeY: number;
  readonly afterX: number;
  readonly afterY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly moved: boolean;
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
  | AgentBrowserFindResult
  | AgentBrowserLocateResult
  | AgentBrowserScrollResult
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

/**
 * Correlated Harness → parent request to reclaim one owned tab after the
 * human-takeover turn has reached its terminal idle boundary.
 */
export interface AgentBrowserClaimControlRequest {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "claim-control";
  readonly ownerSessionId: string;
  readonly sessionId: string;
  /** Human-control revision this automatic claim is allowed to supersede. */
  readonly expectedControlRevision: number;
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
  | AgentBrowserClaimControlRequest
  | AgentBrowserReleaseOwnerRequest;

export interface AgentBrowserSuccessResponse {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "response";
  readonly result:
    | AgentBrowserOperationResult
    | AgentBrowserClaimControlResult;
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

/** Parent → Harness lifecycle event for an explicit control handoff. */
export interface AgentBrowserControlChangedEvent {
  readonly channel: typeof AGENT_BROWSER_PROCESS_CHANNEL;
  readonly protocolVersion: typeof AGENT_BROWSER_PROTOCOL_VERSION;
  readonly type: "control-changed";
  readonly ownerSessionId: string;
  readonly sessionId: string;
  readonly owner: AgentBrowserOwner;
  /** Monotonic per-session control intent revision. */
  readonly controlRevision: number;
}

export type AgentBrowserProcessServerMessage =
  | AgentBrowserProcessResponse
  | AgentBrowserControlChangedEvent;

export type AgentBrowserToolPayload =
  | { readonly url: string }
  | { readonly sessionId: string; readonly url: string }
  | {
      readonly sessionId: string;
      readonly command: AgentBrowserNavigationCommand;
    }
  | { readonly sessionId: string }
  | {
      readonly sessionId: string;
      readonly query: AgentBrowserFindQuery;
      readonly view: AgentBrowserFindView;
      readonly depth: number;
      readonly limit: number;
    }
  | {
      readonly sessionId: string;
      readonly cursor: string;
    }
  | {
      readonly sessionId: string;
      readonly code: string;
    }
  | {
      readonly sessionId: string;
      readonly target: AgentBrowserTarget;
    }
  | {
      readonly sessionId: string;
      readonly target: AgentBrowserTarget;
      readonly value: string;
    }
  | {
      readonly sessionId: string;
      readonly key: string;
      readonly target?: AgentBrowserTarget;
    }
  | {
      readonly sessionId: string;
      readonly text: string;
      readonly timeoutMs: number;
    };

const MAX_ID_LENGTH = 160;
const MAX_URL_LENGTH = 8_192;
const MAX_TEXT_LENGTH = 20_000;
export const MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH = 4_096;
const MAX_ERROR_LENGTH = 2_048;
const MAX_SNAPSHOT_NODES = 300;
const MAX_FIND_DEPTH = 8;
const MAX_FIND_LIMIT = 50;
const MAX_INDEXED_TARGET_POSITION = 49_999;
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

function boundedNonNegativeInteger(
  value: unknown,
  label: string,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new TypeError(`${label} must be a bounded integer`);
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
    value !== "idle" &&
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

export function parseAgentBrowserTarget(
  value: unknown,
): AgentBrowserTarget {
  const target = record(value, "Agent Browser target");
  if (Object.hasOwn(target, "ref")) {
    if (!exactKeys(target, ["ref"])) {
      throw new TypeError(
        "Agent Browser ref target cannot include semantic constraints",
      );
    }
    return { ref: parseAgentBrowserRef(target.ref) };
  }
  if (
    !exactKeys(
      target,
      ["exact"],
      [
        "withinRef",
        "role",
        "name",
        "placeholder",
        "url",
        "index",
      ],
    ) ||
    typeof target.exact !== "boolean"
  ) {
    throw new TypeError("invalid Agent Browser semantic target");
  }
  const withinRef = target.withinRef === undefined
    ? undefined
    : parseAgentBrowserRef(target.withinRef);
  const role = target.role === undefined
    ? undefined
    : boundedString(
      target.role,
      "Agent Browser target role",
      80,
    );
  const name = target.name === undefined
    ? undefined
    : boundedString(
      target.name,
      "Agent Browser target accessible name",
      500,
    );
  const placeholder = target.placeholder === undefined
    ? undefined
    : boundedString(
      target.placeholder,
      "Agent Browser target placeholder",
      500,
    );
  const url = target.url === undefined
    ? undefined
    : boundedString(
      target.url,
      "Agent Browser target URL constraint",
      MAX_URL_LENGTH,
    );
  if (
    role === undefined &&
    name === undefined &&
    placeholder === undefined &&
    url === undefined
  ) {
    throw new TypeError(
      "Agent Browser semantic target requires a role, name, placeholder, or URL constraint",
    );
  }
  const index = target.index === undefined
    ? undefined
    : boundedNonNegativeInteger(
      target.index,
      "Agent Browser target index",
      MAX_INDEXED_TARGET_POSITION,
    );
  return {
    ...(withinRef === undefined ? {} : { withinRef }),
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(url === undefined ? {} : { url }),
    exact: target.exact,
    ...(index === undefined ? {} : { index }),
  };
}

function parseAgentBrowserFindView(
  value: unknown,
): AgentBrowserFindView {
  if (
    typeof value !== "string" ||
    !AGENT_BROWSER_FIND_VIEWS.includes(
      value as AgentBrowserFindView,
    )
  ) {
    throw new TypeError("invalid Agent Browser find view");
  }
  return value as AgentBrowserFindView;
}

function parseAgentBrowserFindQuery(
  value: unknown,
): AgentBrowserFindQuery {
  const query = record(value, "Agent Browser find query");
  if (
    !exactKeys(
      query,
      ["exact"],
      [
        "withinRef",
        "role",
        "name",
        "text",
        "placeholder",
        "url",
        "actionable",
        "index",
      ],
    ) ||
    typeof query.exact !== "boolean" ||
    (
      query.actionable !== undefined &&
      typeof query.actionable !== "boolean"
    )
  ) {
    throw new TypeError("invalid Agent Browser find query");
  }
  const withinRef = query.withinRef === undefined
    ? undefined
    : parseAgentBrowserRef(query.withinRef);
  const role = query.role === undefined
    ? undefined
    : boundedString(query.role, "Agent Browser find role", 80);
  const name = query.name === undefined
    ? undefined
    : boundedString(query.name, "Agent Browser find name", 500);
  const text = query.text === undefined
    ? undefined
    : boundedString(query.text, "Agent Browser find text", 2_000);
  const placeholder = query.placeholder === undefined
    ? undefined
    : boundedString(
      query.placeholder,
      "Agent Browser find placeholder",
      500,
    );
  const url = query.url === undefined
    ? undefined
    : boundedString(
      query.url,
      "Agent Browser find URL constraint",
      MAX_URL_LENGTH,
    );
  const index = query.index === undefined
    ? undefined
    : boundedNonNegativeInteger(
        query.index,
        "Agent Browser find index",
        MAX_INDEXED_TARGET_POSITION,
      );
  if (
    withinRef === undefined &&
    role === undefined &&
    name === undefined &&
    text === undefined &&
    placeholder === undefined &&
    url === undefined &&
    query.actionable === undefined
  ) {
    throw new TypeError(
      "Agent Browser find query requires a scope or semantic constraint",
    );
  }
  return {
    ...(withinRef === undefined ? {} : { withinRef }),
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(url === undefined ? {} : { url }),
    ...(query.actionable === undefined
      ? {}
      : { actionable: query.actionable }),
    exact: query.exact,
    ...(index === undefined ? {} : { index }),
  };
}

function parseAgentBrowserScrollDirection(
  value: unknown,
): AgentBrowserScrollDirection {
  if (
    typeof value !== "string" ||
    !AGENT_BROWSER_SCROLL_DIRECTIONS.includes(
      value as AgentBrowserScrollDirection,
    )
  ) {
    throw new TypeError("invalid Agent Browser scroll direction");
  }
  return value as AgentBrowserScrollDirection;
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
    case "history":
      if (!exactKeys(payload, ["sessionId", "command"])) {
        throw new TypeError("invalid Agent Browser history payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        command: parseNavigationCommand(payload.command),
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
    case "find": {
      if (Object.hasOwn(payload, "cursor")) {
        if (!exactKeys(payload, ["sessionId", "cursor"])) {
          throw new TypeError("invalid Agent Browser find cursor payload");
        }
        return {
          sessionId: parseAgentBrowserSessionId(payload.sessionId),
          cursor: parseIdentifier(
            payload.cursor,
            "Agent Browser find cursor",
          ),
        };
      }
      if (
        !exactKeys(
          payload,
          ["sessionId", "query", "view", "depth", "limit"],
        )
      ) {
        throw new TypeError("invalid Agent Browser find payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        query: parseAgentBrowserFindQuery(payload.query),
        view: parseAgentBrowserFindView(payload.view),
        depth: boundedNonNegativeInteger(
          payload.depth,
          "Agent Browser find depth",
          MAX_FIND_DEPTH,
        ),
        limit: (() => {
          const limit = positiveInteger(
            payload.limit,
            "Agent Browser find limit",
          );
          if (limit > MAX_FIND_LIMIT) {
            throw new TypeError(
              `Agent Browser find limit exceeds ${String(MAX_FIND_LIMIT)}`,
            );
          }
          return limit;
        })(),
      };
    }
    case "locate": {
      if (!exactKeys(payload, ["sessionId", "code"])) {
        throw new TypeError("invalid Agent Browser locate payload");
      }
      const code = boundedString(
        payload.code,
        "Agent Browser generated locator code",
        MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH,
      );
      if (!/\S/u.test(code)) {
        throw new TypeError(
          "Agent Browser generated locator code must not be blank",
        );
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        code,
      };
    }
    case "click":
      if (!exactKeys(payload, ["sessionId", "target"])) {
        throw new TypeError("invalid Agent Browser click payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        target: parseAgentBrowserTarget(payload.target),
      };
    case "fill":
      if (!exactKeys(payload, ["sessionId", "target", "value"])) {
        throw new TypeError("invalid Agent Browser fill payload");
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        target: parseAgentBrowserTarget(payload.target),
        value: boundedString(
          payload.value,
          "Agent Browser fill value",
          MAX_TEXT_LENGTH,
          true,
        ),
      };
    case "press":
      if (
        !exactKeys(payload, ["sessionId", "key"], ["target"])
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
        ...(payload.target === undefined
          ? {}
          : { target: parseAgentBrowserTarget(payload.target) }),
      };
    case "scroll": {
      if (
        !exactKeys(
          payload,
          ["sessionId", "direction"],
          ["amount", "withinRef"],
        )
      ) {
        throw new TypeError("invalid Agent Browser scroll payload");
      }
      const direction = parseAgentBrowserScrollDirection(
        payload.direction,
      );
      const edge = direction === "top" || direction === "bottom";
      if (edge && payload.amount !== undefined) {
        throw new TypeError(
          "Agent Browser edge scroll must not include an amount",
        );
      }
      if (!edge && payload.amount === undefined) {
        throw new TypeError(
          "Agent Browser directional scroll requires an amount",
        );
      }
      const amount = payload.amount === undefined
        ? undefined
        : positiveInteger(
          payload.amount,
          "Agent Browser scroll amount",
        );
      if (
        amount !== undefined &&
        amount > MAX_AGENT_BROWSER_SCROLL_AMOUNT
      ) {
        throw new TypeError(
          `Agent Browser scroll amount exceeds ${String(MAX_AGENT_BROWSER_SCROLL_AMOUNT)}`,
        );
      }
      return {
        sessionId: parseAgentBrowserSessionId(payload.sessionId),
        direction,
        ...(amount === undefined ? {} : { amount }),
        ...(payload.withinRef === undefined
          ? {}
          : { withinRef: parseAgentBrowserRef(payload.withinRef) }),
      };
    }
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

export function createAgentBrowserClaimControlRequest(
  requestId: number,
  ownerSessionId: string,
  sessionId: string,
  expectedControlRevision: number,
): AgentBrowserClaimControlRequest {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: positiveInteger(
      requestId,
      "Agent Browser request id",
    ),
    type: "claim-control",
    ownerSessionId:
      parseAgentBrowserOwnerSessionId(ownerSessionId),
    sessionId: parseAgentBrowserSessionId(sessionId),
    expectedControlRevision: positiveInteger(
      expectedControlRevision,
      "Agent Browser expected control revision",
    ),
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

export function createAgentBrowserControlChangedEvent(
  ownerSessionId: string,
  sessionId: string,
  owner: AgentBrowserOwner,
  controlRevision: number,
): AgentBrowserControlChangedEvent {
  return {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId:
      parseAgentBrowserOwnerSessionId(ownerSessionId),
    sessionId: parseAgentBrowserSessionId(sessionId),
    owner: parseOwner(owner),
    controlRevision: positiveInteger(
      controlRevision,
      "Agent Browser control revision",
    ),
  };
}

export function parseAgentBrowserControlChangedEvent(
  value: unknown,
): AgentBrowserControlChangedEvent {
  const event = record(
    value,
    "Agent Browser control changed event",
  );
  if (
    event.channel !== AGENT_BROWSER_PROCESS_CHANNEL ||
    event.protocolVersion !== AGENT_BROWSER_PROTOCOL_VERSION ||
    event.type !== "control-changed" ||
    !exactKeys(event, [
      "channel",
      "protocolVersion",
      "type",
      "ownerSessionId",
      "sessionId",
      "owner",
      "controlRevision",
    ])
  ) {
    throw new TypeError(
      "invalid Agent Browser control changed event",
    );
  }
  return createAgentBrowserControlChangedEvent(
    parseAgentBrowserOwnerSessionId(event.ownerSessionId),
    parseAgentBrowserSessionId(event.sessionId),
    parseOwner(event.owner),
    positiveInteger(
      event.controlRevision,
      "Agent Browser control revision",
    ),
  );
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
  if (request.type === "claim-control") {
    if (
      !exactKeys(request, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
        "ownerSessionId",
        "sessionId",
        "expectedControlRevision",
      ])
    ) {
      throw new TypeError(
        "invalid Agent Browser claim control request",
      );
    }
    return createAgentBrowserClaimControlRequest(
      requestId,
      parseAgentBrowserOwnerSessionId(request.ownerSessionId),
      parseAgentBrowserSessionId(request.sessionId),
      positiveInteger(
        request.expectedControlRevision,
        "Agent Browser expected control revision",
      ),
    );
  }
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

function parseNavigationCommand(
  value: unknown,
): AgentBrowserNavigationCommand {
  if (
    typeof value !== "string" ||
    !AGENT_BROWSER_NAVIGATION_COMMANDS.includes(
      value as AgentBrowserNavigationCommand,
    )
  ) {
    throw new TypeError("invalid Agent Browser navigation request");
  }
  return value as AgentBrowserNavigationCommand;
}

function parseNavigationState(
  value: unknown,
): AgentBrowserNavigationState {
  const navigation = record(
    value,
    "Agent Browser navigation state",
  );
  if (
    !exactKeys(
      navigation,
      ["loading", "canGoBack", "canGoForward"],
    ) ||
    typeof navigation.loading !== "boolean" ||
    typeof navigation.canGoBack !== "boolean" ||
    typeof navigation.canGoForward !== "boolean"
  ) {
    throw new TypeError("invalid Agent Browser navigation state");
  }
  return {
    loading: navigation.loading,
    canGoBack: navigation.canGoBack,
    canGoForward: navigation.canGoForward,
  };
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
      ["url", "title", "error", "cursor", "navigation"],
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
  const navigation = projection.navigation === undefined
    ? undefined
    : parseNavigationState(projection.navigation);
  return {
    sessionId: parseAgentBrowserSessionId(projection.sessionId),
    partition,
    generation: positiveInteger(
      projection.generation,
      "Agent Browser generation",
    ),
    owner: parseOwner(projection.owner),
    status: parseStatus(projection.status),
    ...(navigation === undefined ? {} : { navigation }),
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

export function parseAgentBrowserNavigationRequest(
  value: unknown,
): {
  readonly sessionId: string;
  readonly command: AgentBrowserNavigationCommand;
} {
  const request = record(value, "Agent Browser navigation request");
  if (!exactKeys(request, ["sessionId", "command"])) {
    throw new TypeError("invalid Agent Browser navigation request");
  }
  return {
    sessionId: parseAgentBrowserSessionId(request.sessionId),
    command: parseNavigationCommand(request.command),
  };
}

function parseSessionResult(
  value: unknown,
): AgentBrowserSessionResult {
  const result = record(value, "Agent Browser session result");
  if (
    !exactKeys(
      result,
      [
        "sessionId",
        "generation",
        "owner",
        "status",
        "snapshotRequired",
      ],
      ["url", "title"],
    ) ||
    typeof result.snapshotRequired !== "boolean"
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
    snapshotRequired: result.snapshotRequired,
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
  };
}

function parseSnapshotNode(
  value: unknown,
): AgentBrowserSnapshotNode {
  const node = record(value, "Agent Browser snapshot node");
  if (
    !exactKeys(
      node,
      ["ref", "role", "name"],
      [
        "depth",
        "parentRef",
        "actionable",
        "disabled",
        "value",
        "placeholder",
        "url",
        "description",
        "source",
        "confidence",
        "actions",
        "match",
      ],
    )
  ) {
    throw new TypeError("invalid Agent Browser snapshot node");
  }
  const depth = node.depth === undefined
    ? undefined
    : boundedNonNegativeInteger(
      node.depth,
      "Agent Browser node depth",
      128,
    );
  const parentRef = node.parentRef === undefined
    ? undefined
    : parseAgentBrowserRef(node.parentRef);
  const url = node.url === undefined
    ? undefined
    : boundedString(
      node.url,
      "Agent Browser node URL",
      MAX_URL_LENGTH,
    );
  if (
    node.actionable !== undefined &&
    typeof node.actionable !== "boolean"
  ) {
    throw new TypeError(
      "Agent Browser node actionable must be a boolean",
    );
  }
  if (
    node.disabled !== undefined &&
    typeof node.disabled !== "boolean"
  ) {
    throw new TypeError(
      "Agent Browser node disabled must be a boolean",
    );
  }
  const nodeValue = node.value === undefined
    ? undefined
    : boundedString(
      node.value,
      "Agent Browser node value",
      2_000,
      true,
    );
  const placeholder = node.placeholder === undefined
    ? undefined
    : boundedString(
      node.placeholder,
      "Agent Browser node placeholder",
      500,
      true,
    );
  const description = optionalBoundedString(
    node.description,
    "Agent Browser node description",
    500,
  );
  if (
    node.source !== undefined &&
    node.source !== "accessibility" &&
    node.source !== "dom" &&
    node.source !== "accessibility+dom"
  ) {
    throw new TypeError("invalid Agent Browser node source");
  }
  if (
    node.confidence !== undefined &&
    node.confidence !== "high" &&
    node.confidence !== "medium"
  ) {
    throw new TypeError("invalid Agent Browser node confidence");
  }
  let actions: AgentBrowserNodeAction[] | undefined;
  if (node.actions !== undefined) {
    if (
      !Array.isArray(node.actions) ||
      node.actions.length > AGENT_BROWSER_NODE_ACTIONS.length
    ) {
      throw new TypeError("invalid Agent Browser node actions");
    }
    const seenActions = new Set<AgentBrowserNodeAction>();
    actions = node.actions.map((action) => {
      if (
        typeof action !== "string" ||
        !AGENT_BROWSER_NODE_ACTIONS.includes(
          action as AgentBrowserNodeAction,
        ) ||
        seenActions.has(action as AgentBrowserNodeAction)
      ) {
        throw new TypeError("invalid Agent Browser node actions");
      }
      const parsed = action as AgentBrowserNodeAction;
      seenActions.add(parsed);
      return parsed;
    });
    if (
      actions.length > 0 &&
      (
        node.actionable !== true ||
        node.disabled === true
      )
    ) {
      throw new TypeError(
        "Agent Browser node actions require an enabled actionable node",
      );
    }
  }
  if (
    node.match !== undefined &&
    typeof node.match !== "boolean"
  ) {
    throw new TypeError("invalid Agent Browser node match marker");
  }
  return {
    ref: parseAgentBrowserRef(node.ref),
    role: boundedString(node.role, "Agent Browser node role", 80),
    name: boundedString(
      node.name,
      "Agent Browser node name",
      500,
      true,
    ),
    ...(depth === undefined ? {} : { depth }),
    ...(parentRef === undefined ? {} : { parentRef }),
    ...(node.actionable === undefined
      ? {}
      : { actionable: node.actionable }),
    ...(node.disabled === undefined
      ? {}
      : { disabled: node.disabled }),
    ...(nodeValue === undefined ? {} : { value: nodeValue }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(url === undefined ? {} : { url }),
    ...(description === undefined ? {} : { description }),
    ...(node.source === undefined ? {} : { source: node.source }),
    ...(node.confidence === undefined
      ? {}
      : { confidence: node.confidence }),
    ...(actions === undefined ? {} : { actions }),
    ...(node.match === undefined ? {} : { match: node.match }),
  };
}

function parseSnapshotNodes(value: unknown): AgentBrowserSnapshotNode[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SNAPSHOT_NODES
  ) {
    throw new TypeError("invalid Agent Browser snapshot nodes");
  }
  const nodes = value.map(parseSnapshotNode);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (
      seen.has(node.ref) ||
      (
        node.parentRef !== undefined &&
        !seen.has(node.parentRef)
      )
    ) {
      throw new TypeError(
        "invalid Agent Browser snapshot hierarchy",
      );
    }
    seen.add(node.ref);
  }
  return nodes;
}

function parseLocatedSnapshotNode(
  value: unknown,
  snapshotId: string,
): AgentBrowserLocatedNode {
  const node = parseSnapshotNode(value);
  if (
    node.match !== true ||
    node.actionable !== true ||
    node.disabled !== false
  ) {
    throw new TypeError(
      "Agent Browser locate result must be one direct enabled actionable match",
    );
  }
  const expectedRefPrefix = `${snapshotId}:e`;
  if (!node.ref.startsWith(expectedRefPrefix)) {
    throw new TypeError(
      "Agent Browser locate ref must belong to its snapshot",
    );
  }
  if (
    node.parentRef !== undefined &&
    !node.parentRef.startsWith(expectedRefPrefix)
  ) {
    throw new TypeError(
      "Agent Browser locate parent ref must belong to its snapshot",
    );
  }
  return {
    ...node,
    actionable: true,
    disabled: false,
    match: true,
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
          "snapshotRequired",
          "snapshotId",
          "nodes",
        ],
        [
          "url",
          "title",
          "view",
          "totalNodes",
          "actionableNodes",
          "indexTruncated",
        ],
      ) ||
      (
        result.view !== undefined &&
        result.view !== "outline"
      ) ||
      (
        result.indexTruncated !== undefined &&
        typeof result.indexTruncated !== "boolean"
      )
    ) {
      throw new TypeError("invalid Agent Browser snapshot result");
    }
    const totalNodes = result.totalNodes === undefined
      ? undefined
      : boundedNonNegativeInteger(
        result.totalNodes,
        "Agent Browser indexed node count",
        MAX_INDEXED_TARGET_POSITION + 1,
      );
    const actionableNodes = result.actionableNodes === undefined
      ? undefined
      : boundedNonNegativeInteger(
        result.actionableNodes,
        "Agent Browser actionable node count",
        MAX_INDEXED_TARGET_POSITION + 1,
      );
    if (
      totalNodes !== undefined &&
      actionableNodes !== undefined &&
      actionableNodes > totalNodes
    ) {
      throw new TypeError("invalid Agent Browser snapshot counts");
    }
    return {
      ...parseSessionResult({
        sessionId: result.sessionId,
        generation: result.generation,
        owner: result.owner,
        status: result.status,
        snapshotRequired: result.snapshotRequired,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.title === undefined
          ? {}
          : { title: result.title }),
      }),
      snapshotId: parseIdentifier(
        result.snapshotId,
        "Agent Browser snapshot id",
      ),
      nodes: parseSnapshotNodes(result.nodes),
      ...(result.view === undefined ? {} : { view: "outline" as const }),
      ...(totalNodes === undefined ? {} : { totalNodes }),
      ...(actionableNodes === undefined
        ? {}
        : { actionableNodes }),
      ...(result.indexTruncated === undefined
        ? {}
        : { indexTruncated: result.indexTruncated }),
    };
  }
  if (operation === "find") {
    const result = record(value, "Agent Browser find result");
    if (
      !exactKeys(
        result,
        [
          "sessionId",
          "generation",
          "owner",
          "status",
          "snapshotRequired",
          "snapshotId",
          "nodes",
          "view",
          "totalNodes",
          "actionableNodes",
          "totalMatches",
          "offset",
          "indexTruncated",
        ],
        ["url", "title", "nextCursor"],
      ) ||
      typeof result.indexTruncated !== "boolean"
    ) {
      throw new TypeError("invalid Agent Browser find result");
    }
    const totalNodes = boundedNonNegativeInteger(
      result.totalNodes,
      "Agent Browser indexed node count",
      MAX_INDEXED_TARGET_POSITION + 1,
    );
    const actionableNodes = boundedNonNegativeInteger(
      result.actionableNodes,
      "Agent Browser actionable node count",
      MAX_INDEXED_TARGET_POSITION + 1,
    );
    const totalMatches = boundedNonNegativeInteger(
      result.totalMatches,
      "Agent Browser find match count",
      MAX_INDEXED_TARGET_POSITION + 1,
    );
    const offset = boundedNonNegativeInteger(
      result.offset,
      "Agent Browser find offset",
      MAX_INDEXED_TARGET_POSITION + 1,
    );
    if (actionableNodes > totalNodes) {
      throw new TypeError("invalid Agent Browser find counts");
    }
    return {
      ...parseSessionResult({
        sessionId: result.sessionId,
        generation: result.generation,
        owner: result.owner,
        status: result.status,
        snapshotRequired: result.snapshotRequired,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.title === undefined
          ? {}
          : { title: result.title }),
      }),
      snapshotId: parseIdentifier(
        result.snapshotId,
        "Agent Browser snapshot id",
      ),
      nodes: parseSnapshotNodes(result.nodes),
      view: parseAgentBrowserFindView(result.view),
      totalNodes,
      actionableNodes,
      totalMatches,
      offset,
      indexTruncated: result.indexTruncated,
      ...(result.nextCursor === undefined
        ? {}
        : {
            nextCursor: parseIdentifier(
              result.nextCursor,
              "Agent Browser find cursor",
            ),
          }),
    };
  }
  if (operation === "locate") {
    const result = record(value, "Agent Browser locate result");
    if (
      !exactKeys(
        result,
        [
          "sessionId",
          "generation",
          "owner",
          "status",
          "snapshotRequired",
          "snapshotId",
          "node",
        ],
        ["url", "title"],
      )
    ) {
      throw new TypeError("invalid Agent Browser locate result");
    }
    const session = parseSessionResult({
      sessionId: result.sessionId,
      generation: result.generation,
      owner: result.owner,
      status: result.status,
      snapshotRequired: result.snapshotRequired,
      ...(result.url === undefined ? {} : { url: result.url }),
      ...(result.title === undefined
        ? {}
        : { title: result.title }),
    });
    const snapshotId = parseIdentifier(
      result.snapshotId,
      "Agent Browser snapshot id",
    );
    if (snapshotId !== `s${String(session.generation)}`) {
      throw new TypeError(
        "Agent Browser locate snapshot id must match its generation",
      );
    }
    const node = parseLocatedSnapshotNode(
      result.node,
      snapshotId,
    );
    return {
      ...session,
      snapshotId,
      node,
    };
  }
  if (operation === "scroll") {
    const result = record(value, "Agent Browser scroll result");
    if (
      !exactKeys(
        result,
        [
          "sessionId",
          "generation",
          "owner",
          "status",
          "snapshotRequired",
          "scope",
          "beforeX",
          "beforeY",
          "afterX",
          "afterY",
          "maxX",
          "maxY",
          "moved",
        ],
        ["url", "title"],
      ) ||
      typeof result.moved !== "boolean"
    ) {
      throw new TypeError("invalid Agent Browser scroll result");
    }
    const session = parseSessionResult({
      sessionId: result.sessionId,
      generation: result.generation,
      owner: result.owner,
      status: result.status,
      snapshotRequired: result.snapshotRequired,
      ...(result.url === undefined ? {} : { url: result.url }),
      ...(result.title === undefined
        ? {}
        : { title: result.title }),
    });
    let scope: string;
    if (result.scope === "page") {
      scope = "page";
    } else {
      try {
        scope = parseAgentBrowserRef(result.scope);
      } catch {
        throw new TypeError("invalid Agent Browser scroll scope");
      }
    }
    if (
      scope !== "page" &&
      !scope.startsWith(`s${String(session.generation)}:`)
    ) {
      throw new TypeError(
        "Agent Browser scroll scope must belong to its generation",
      );
    }
    const beforeX = boundedNonNegativeInteger(
      result.beforeX,
      "Agent Browser scroll before x",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const beforeY = boundedNonNegativeInteger(
      result.beforeY,
      "Agent Browser scroll before y",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const afterX = boundedNonNegativeInteger(
      result.afterX,
      "Agent Browser scroll after x",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const afterY = boundedNonNegativeInteger(
      result.afterY,
      "Agent Browser scroll after y",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const maxX = boundedNonNegativeInteger(
      result.maxX,
      "Agent Browser scroll maximum x",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const maxY = boundedNonNegativeInteger(
      result.maxY,
      "Agent Browser scroll maximum y",
      MAX_AGENT_BROWSER_SCROLL_COORDINATE,
    );
    const moved = beforeX !== afterX || beforeY !== afterY;
    if (
      beforeX > maxX ||
      afterX > maxX ||
      beforeY > maxY ||
      afterY > maxY ||
      result.moved !== moved ||
      (moved && !session.snapshotRequired)
    ) {
      throw new TypeError(
        "invalid Agent Browser scroll movement evidence",
      );
    }
    return {
      ...session,
      scope,
      beforeX,
      beforeY,
      afterX,
      afterY,
      maxX,
      maxY,
      moved,
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
          "snapshotRequired",
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
        snapshotRequired: result.snapshotRequired,
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

export function parseAgentBrowserClaimControlResult(
  value: unknown,
): AgentBrowserClaimControlResult {
  const result = record(
    value,
    "Agent Browser claim control result",
  );
  if (
    !exactKeys(
      result,
      [
        "sessionId",
        "generation",
        "owner",
        "status",
        "snapshotRequired",
        "controlRevision",
      ],
      ["url", "title"],
    ) ||
    result.owner !== "agent" ||
    result.snapshotRequired !== true ||
    result.status === "paused" ||
    result.status === "crashed"
  ) {
    throw new TypeError(
      "invalid Agent Browser claim control result",
    );
  }
  return {
    ...parseSessionResult({
      sessionId: result.sessionId,
      generation: result.generation,
      owner: result.owner,
      status: result.status,
      snapshotRequired: result.snapshotRequired,
      ...(result.url === undefined ? {} : { url: result.url }),
      ...(result.title === undefined
        ? {}
        : { title: result.title }),
    }),
    owner: "agent",
    snapshotRequired: true,
    controlRevision: positiveInteger(
      result.controlRevision,
      "Agent Browser control revision",
    ),
  };
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

export function agentBrowserClaimControlSuccessResponse(
  requestId: number,
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
    result: parseAgentBrowserClaimControlResult(result),
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
  operation: AgentBrowserOperation | "claim-control",
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
    return operation === "claim-control"
      ? agentBrowserClaimControlSuccessResponse(
          requestId,
          response.result,
        )
      : agentBrowserSuccessResponse(
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
