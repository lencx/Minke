import {
  normalizeAgentBrowserUrl,
  parseAgentBrowserSessionId,
} from "./agent-browser-contract.ts";

export const AGENT_BROWSER_ANNOTATION_START_CHANNEL =
  "minke:agent-browser:annotation:start";
export const AGENT_BROWSER_ANNOTATION_STOP_CHANNEL =
  "minke:agent-browser:annotation:stop";
export const AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL =
  "minke:agent-browser:annotation:refresh";
export const AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL =
  "minke:agent-browser:annotation:event";
export const AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL =
  "minke:agent-browser:annotation:commit";

export const AGENT_BROWSER_ANNOTATION_TARGET_LIMIT = 32;
export const AGENT_BROWSER_ANNOTATION_COMMENT_LIMIT = 2_000;

export interface AgentBrowserAnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export interface AgentBrowserAnnotationRect
  extends AgentBrowserAnnotationPoint {
  readonly width: number;
  readonly height: number;
}

export interface AgentBrowserAnnotationViewport {
  readonly width: number;
  readonly height: number;
}

export interface AgentBrowserAnnotationPage {
  readonly url: string;
  readonly title: string;
  readonly viewport: AgentBrowserAnnotationViewport;
}

export interface AgentBrowserAnnotationTarget {
  readonly targetId: string;
  readonly tag: string;
  readonly role?: string;
  readonly text: string;
  readonly ariaLabel?: string;
  readonly selector: string;
  readonly path: string;
  readonly position: AgentBrowserAnnotationPoint;
  readonly rect: AgentBrowserAnnotationRect;
  readonly viewport: AgentBrowserAnnotationViewport;
  readonly frame: "top document";
}

export interface AgentBrowserAnnotationSession {
  readonly sessionId: string;
  readonly annotationSessionId: string;
  readonly generation: number;
  readonly page: AgentBrowserAnnotationPage;
}

export interface AgentBrowserAnnotationSelectionEvent
  extends AgentBrowserAnnotationSession {
  readonly type: "selected";
  readonly target: AgentBrowserAnnotationTarget;
}

export interface AgentBrowserAnnotationEndedEvent {
  readonly type: "ended";
  readonly sessionId: string;
  readonly annotationSessionId: string;
  readonly generation: number;
  readonly reason:
    | "cancelled"
    | "control_changed"
    | "navigation"
    | "target_gone";
  readonly message?: string;
}

export type AgentBrowserAnnotationEvent =
  | AgentBrowserAnnotationSelectionEvent
  | AgentBrowserAnnotationEndedEvent;

export interface AgentBrowserAnnotationStopRequest {
  readonly sessionId: string;
  readonly annotationSessionId: string;
}

export interface AgentBrowserAnnotationRefreshRequest
  extends AgentBrowserAnnotationStopRequest {
  readonly targetIds: readonly string[];
}

export interface AgentBrowserAnnotationRefreshResult
  extends AgentBrowserAnnotationSession {
  readonly targets: readonly AgentBrowserAnnotationTarget[];
}

export interface AgentBrowserAnnotationCommitResult
  extends AgentBrowserAnnotationRefreshResult {
  readonly mimeType: "image/png";
  readonly data: string;
}

const MAX_ID_LENGTH = 160;
const MAX_URL_LENGTH = 8_192;

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
): void {
  const keys = Object.keys(value);
  if (
    !required.every((key) => keys.includes(key)) ||
    !keys.every(
      (key) => required.includes(key) || optional.includes(key),
    )
  ) {
    throw new TypeError("invalid Agent Browser annotation fields");
  }
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (
    (!allowEmpty && normalized === "") ||
    normalized.length > maxLength
  ) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return normalized;
}

function positiveInteger(
  value: unknown,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function boundedNumber(
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
    throw new TypeError(`${label} must be a bounded number`);
  }
  return value;
}

function parseAnnotationSessionId(value: unknown): string {
  const id = boundedString(
    value,
    "Agent Browser annotation session id",
    MAX_ID_LENGTH,
  );
  if (!/^annotation-[a-zA-Z0-9]+$/u.test(id)) {
    throw new TypeError("invalid Agent Browser annotation session id");
  }
  return id;
}

function parseTargetId(value: unknown): string {
  const id = boundedString(
    value,
    "Agent Browser annotation target id",
    MAX_ID_LENGTH,
  );
  if (!/^target-[a-zA-Z0-9]+$/u.test(id)) {
    throw new TypeError("invalid Agent Browser annotation target id");
  }
  return id;
}

function parsePoint(
  value: unknown,
  label: string,
  minimum = 0,
): AgentBrowserAnnotationPoint {
  const point = record(value, label);
  exactKeys(point, ["x", "y"]);
  return {
    x: boundedNumber(point.x, `${label} x`, minimum, 100_000),
    y: boundedNumber(point.y, `${label} y`, minimum, 100_000),
  };
}

function parseViewport(
  value: unknown,
): AgentBrowserAnnotationViewport {
  const viewport = record(
    value,
    "Agent Browser annotation viewport",
  );
  exactKeys(viewport, ["width", "height"]);
  return {
    width: boundedNumber(
      viewport.width,
      "Agent Browser annotation viewport width",
      1,
      100_000,
    ),
    height: boundedNumber(
      viewport.height,
      "Agent Browser annotation viewport height",
      1,
      100_000,
    ),
  };
}

function parseRect(value: unknown): AgentBrowserAnnotationRect {
  const rect = record(value, "Agent Browser annotation rect");
  exactKeys(rect, ["x", "y", "width", "height"]);
  return {
    ...parsePoint(
      { x: rect.x, y: rect.y },
      "Agent Browser annotation rect",
      -100_000,
    ),
    width: boundedNumber(
      rect.width,
      "Agent Browser annotation rect width",
      0.25,
      100_000,
    ),
    height: boundedNumber(
      rect.height,
      "Agent Browser annotation rect height",
      0.25,
      100_000,
    ),
  };
}

function parsePage(value: unknown): AgentBrowserAnnotationPage {
  const page = record(value, "Agent Browser annotation page");
  exactKeys(page, ["url", "title", "viewport"]);
  const url = boundedString(
    page.url,
    "Agent Browser annotation page URL",
    MAX_URL_LENGTH,
  );
  const normalizedUrl = new URL(normalizeAgentBrowserUrl(url));
  if (normalizedUrl.search !== "" || normalizedUrl.hash !== "") {
    throw new TypeError(
      "Agent Browser annotation page URL must omit query and hash",
    );
  }
  return {
    url: normalizedUrl.toString(),
    title: boundedString(
      page.title,
      "Agent Browser annotation page title",
      160,
      true,
    ),
    viewport: parseViewport(page.viewport),
  };
}

export function parseAgentBrowserAnnotationTarget(
  value: unknown,
): AgentBrowserAnnotationTarget {
  const target = record(value, "Agent Browser annotation target");
  exactKeys(
    target,
    [
      "targetId",
      "tag",
      "text",
      "selector",
      "path",
      "position",
      "rect",
      "viewport",
      "frame",
    ],
    ["role", "ariaLabel"],
  );
  if (target.frame !== "top document") {
    throw new TypeError(
      "Agent Browser annotation frame must be top document",
    );
  }
  const role = target.role === undefined
    ? undefined
    : boundedString(
        target.role,
        "Agent Browser annotation role",
        80,
      );
  const ariaLabel = target.ariaLabel === undefined
    ? undefined
    : boundedString(
        target.ariaLabel,
        "Agent Browser annotation aria label",
        500,
      );
  return {
    targetId: parseTargetId(target.targetId),
    tag: boundedString(
      target.tag,
      "Agent Browser annotation tag",
      80,
    ).toLowerCase(),
    ...(role === undefined ? {} : { role }),
    text: boundedString(
      target.text,
      "Agent Browser annotation text",
      500,
      true,
    ),
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    selector: boundedString(
      target.selector,
      "Agent Browser annotation selector",
      1_000,
    ),
    path: boundedString(
      target.path,
      "Agent Browser annotation path",
      1_000,
    ),
    position: parsePoint(
      target.position,
      "Agent Browser annotation position",
    ),
    rect: parseRect(target.rect),
    viewport: parseViewport(target.viewport),
    frame: "top document",
  };
}

export function parseAgentBrowserAnnotationSession(
  value: unknown,
): AgentBrowserAnnotationSession {
  const session = record(
    value,
    "Agent Browser annotation session",
  );
  exactKeys(session, [
    "sessionId",
    "annotationSessionId",
    "generation",
    "page",
  ]);
  return {
    sessionId: parseAgentBrowserSessionId(session.sessionId),
    annotationSessionId: parseAnnotationSessionId(
      session.annotationSessionId,
    ),
    generation: positiveInteger(
      session.generation,
      "Agent Browser annotation generation",
    ),
    page: parsePage(session.page),
  };
}

export function parseAgentBrowserAnnotationEvent(
  value: unknown,
): AgentBrowserAnnotationEvent {
  const event = record(value, "Agent Browser annotation event");
  if (event.type === "selected") {
    exactKeys(event, [
      "type",
      "sessionId",
      "annotationSessionId",
      "generation",
      "page",
      "target",
    ]);
    return {
      type: "selected",
      ...parseAgentBrowserAnnotationSession({
        sessionId: event.sessionId,
        annotationSessionId: event.annotationSessionId,
        generation: event.generation,
        page: event.page,
      }),
      target: parseAgentBrowserAnnotationTarget(event.target),
    };
  }
  if (event.type !== "ended") {
    throw new TypeError("invalid Agent Browser annotation event");
  }
  exactKeys(
    event,
    [
      "type",
      "sessionId",
      "annotationSessionId",
      "generation",
      "reason",
    ],
    ["message"],
  );
  if (
    event.reason !== "cancelled" &&
    event.reason !== "control_changed" &&
    event.reason !== "navigation" &&
    event.reason !== "target_gone"
  ) {
    throw new TypeError("invalid Agent Browser annotation end reason");
  }
  const message = event.message === undefined
    ? undefined
    : boundedString(
        event.message,
        "Agent Browser annotation end message",
        2_048,
      );
  return {
    type: "ended",
    sessionId: parseAgentBrowserSessionId(event.sessionId),
    annotationSessionId: parseAnnotationSessionId(
      event.annotationSessionId,
    ),
    generation: positiveInteger(
      event.generation,
      "Agent Browser annotation generation",
    ),
    reason: event.reason,
    ...(message === undefined ? {} : { message }),
  };
}

export function parseAgentBrowserAnnotationStartRequest(
  value: unknown,
): { readonly sessionId: string } {
  const request = record(
    value,
    "Agent Browser annotation start request",
  );
  exactKeys(request, ["sessionId"]);
  return {
    sessionId: parseAgentBrowserSessionId(request.sessionId),
  };
}

export function parseAgentBrowserAnnotationStopRequest(
  value: unknown,
): AgentBrowserAnnotationStopRequest {
  const request = record(
    value,
    "Agent Browser annotation stop request",
  );
  exactKeys(request, ["sessionId", "annotationSessionId"]);
  return {
    sessionId: parseAgentBrowserSessionId(request.sessionId),
    annotationSessionId: parseAnnotationSessionId(
      request.annotationSessionId,
    ),
  };
}

export function parseAgentBrowserAnnotationRefreshRequest(
  value: unknown,
): AgentBrowserAnnotationRefreshRequest {
  const request = record(
    value,
    "Agent Browser annotation refresh request",
  );
  exactKeys(request, [
    "sessionId",
    "annotationSessionId",
    "targetIds",
  ]);
  if (
    !Array.isArray(request.targetIds) ||
    request.targetIds.length > AGENT_BROWSER_ANNOTATION_TARGET_LIMIT
  ) {
    throw new TypeError(
      "invalid Agent Browser annotation refresh targets",
    );
  }
  const targetIds = request.targetIds.map(parseTargetId);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new TypeError(
      "Agent Browser annotation target ids must be unique",
    );
  }
  return {
    ...parseAgentBrowserAnnotationStopRequest({
      sessionId: request.sessionId,
      annotationSessionId: request.annotationSessionId,
    }),
    targetIds,
  };
}

export function parseAgentBrowserAnnotationRefreshResult(
  value: unknown,
): AgentBrowserAnnotationRefreshResult {
  const result = record(
    value,
    "Agent Browser annotation refresh result",
  );
  exactKeys(result, [
    "sessionId",
    "annotationSessionId",
    "generation",
    "page",
    "targets",
  ]);
  if (
    !Array.isArray(result.targets) ||
    result.targets.length > AGENT_BROWSER_ANNOTATION_TARGET_LIMIT
  ) {
    throw new TypeError(
      "invalid Agent Browser annotation refresh result",
    );
  }
  return {
    ...parseAgentBrowserAnnotationSession({
      sessionId: result.sessionId,
      annotationSessionId: result.annotationSessionId,
      generation: result.generation,
      page: result.page,
    }),
    targets: result.targets.map(parseAgentBrowserAnnotationTarget),
  };
}

export function parseAgentBrowserAnnotationCommitRequest(
  value: unknown,
): AgentBrowserAnnotationRefreshRequest {
  return parseAgentBrowserAnnotationRefreshRequest(value);
}

export function parseAgentBrowserAnnotationCommitResult(
  value: unknown,
): AgentBrowserAnnotationCommitResult {
  const result = record(
    value,
    "Agent Browser annotation commit result",
  );
  exactKeys(result, [
    "sessionId",
    "annotationSessionId",
    "generation",
    "page",
    "targets",
    "mimeType",
    "data",
  ]);
  if (result.mimeType !== "image/png") {
    throw new TypeError(
      "Agent Browser annotation commit must be a PNG",
    );
  }
  const data = boundedString(
    result.data,
    "Agent Browser annotation screenshot",
    8 * 1024 * 1024,
  );
  if (!/^[a-zA-Z0-9+/]+={0,2}$/u.test(data)) {
    throw new TypeError(
      "invalid Agent Browser annotation screenshot",
    );
  }
  return {
    ...parseAgentBrowserAnnotationRefreshResult({
      sessionId: result.sessionId,
      annotationSessionId: result.annotationSessionId,
      generation: result.generation,
      page: result.page,
      targets: result.targets,
    }),
    mimeType: "image/png",
    data,
  };
}
