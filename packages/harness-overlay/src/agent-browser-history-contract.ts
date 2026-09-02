import {
  normalizeAgentBrowserUrl,
  type AgentBrowserOwner,
} from "./agent-browser-contract.ts";

export const AGENT_BROWSER_HISTORY_READ_CHANNEL =
  "minke:agent-browser:history:read";
export const AGENT_BROWSER_HISTORY_CLEAR_CHANNEL =
  "minke:agent-browser:history:clear";

export const AGENT_BROWSER_HISTORY_LIMIT = 200;
const MAX_JAVASCRIPT_DATE = 8_640_000_000_000_000;

export type AgentBrowserNavigationKind =
  | "document"
  | "same-document";

export interface AgentBrowserHistoryReadRequest {
  readonly limit: number;
  readonly actor?: AgentBrowserOwner;
}

export interface AgentBrowserHistoryClearRequest {
  readonly confirm: true;
}

export interface AgentBrowserHistoryVisit {
  readonly visitId: number;
  readonly visitedAt: number;
  readonly actor: AgentBrowserOwner;
  readonly navigationKind: AgentBrowserNavigationKind;
  readonly url: string;
  readonly origin: string;
  readonly pathname: string;
  readonly pathKey: string;
  readonly pathVisitCount: number;
  readonly pathAgentVisits: number;
  readonly pathHumanVisits: number;
}

export interface AgentBrowserHistorySnapshot {
  readonly totalVisits: number;
  readonly retainedVisits: number;
  readonly uniquePaths: number;
  readonly agentVisits: number;
  readonly humanVisits: number;
  readonly visits: readonly AgentBrowserHistoryVisit[];
}

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

function nonNegativeInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function positiveInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0 || parsed > maximum) {
    throw new TypeError(`${label} must be a bounded positive integer`);
  }
  return parsed;
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

function parseActor(value: unknown): AgentBrowserOwner {
  if (value !== "agent" && value !== "human") {
    throw new TypeError("invalid Agent Browser history actor");
  }
  return value;
}

function parseNavigationKind(
  value: unknown,
): AgentBrowserNavigationKind {
  if (value !== "document" && value !== "same-document") {
    throw new TypeError(
      "invalid Agent Browser history navigation kind",
    );
  }
  return value;
}

export function parseAgentBrowserHistoryReadRequest(
  value: unknown,
): AgentBrowserHistoryReadRequest {
  const request = record(
    value,
    "Agent Browser history read request",
  );
  if (!exactKeys(request, ["limit"], ["actor"])) {
    throw new TypeError(
      "invalid Agent Browser history read request",
    );
  }
  return {
    limit: positiveInteger(
      request.limit,
      "Agent Browser history limit",
      AGENT_BROWSER_HISTORY_LIMIT,
    ),
    ...(request.actor === undefined
      ? {}
      : { actor: parseActor(request.actor) }),
  };
}

export function parseAgentBrowserHistoryClearRequest(
  value: unknown,
): AgentBrowserHistoryClearRequest {
  const request = record(
    value,
    "Agent Browser history clear request",
  );
  if (
    !exactKeys(request, ["confirm"]) ||
    request.confirm !== true
  ) {
    throw new TypeError(
      "invalid Agent Browser history clear request",
    );
  }
  return { confirm: true };
}

function parseVisit(value: unknown): AgentBrowserHistoryVisit {
  const visit = record(value, "Agent Browser history visit");
  if (
    !exactKeys(visit, [
      "visitId",
      "visitedAt",
      "actor",
      "navigationKind",
      "url",
      "origin",
      "pathname",
      "pathKey",
      "pathVisitCount",
      "pathAgentVisits",
      "pathHumanVisits",
    ])
  ) {
    throw new TypeError("invalid Agent Browser history visit");
  }
  const url = normalizeAgentBrowserUrl(visit.url);
  const parsedUrl = new URL(url);
  const origin = boundedString(
    visit.origin,
    "Agent Browser history origin",
    2_048,
  );
  const pathname = boundedString(
    visit.pathname,
    "Agent Browser history pathname",
    8_192,
  );
  const pathKey = boundedString(
    visit.pathKey,
    "Agent Browser history path key",
    10_240,
  );
  if (
    origin !== parsedUrl.origin ||
    pathname !== parsedUrl.pathname ||
    pathKey !== `${origin}${pathname}`
  ) {
    throw new TypeError(
      "Agent Browser history visit has inconsistent URL fields",
    );
  }
  const pathVisitCount = positiveInteger(
    visit.pathVisitCount,
    "Agent Browser history path visit count",
  );
  const pathAgentVisits = nonNegativeInteger(
    visit.pathAgentVisits,
    "Agent Browser history path agent visits",
  );
  const pathHumanVisits = nonNegativeInteger(
    visit.pathHumanVisits,
    "Agent Browser history path human visits",
  );
  if (pathAgentVisits + pathHumanVisits !== pathVisitCount) {
    throw new TypeError(
      "Agent Browser history path counts are inconsistent",
    );
  }
  return {
    visitId: positiveInteger(
      visit.visitId,
      "Agent Browser history visit id",
    ),
    visitedAt: nonNegativeInteger(
      visit.visitedAt,
      "Agent Browser history visit timestamp",
      MAX_JAVASCRIPT_DATE,
    ),
    actor: parseActor(visit.actor),
    navigationKind: parseNavigationKind(visit.navigationKind),
    url,
    origin,
    pathname,
    pathKey,
    pathVisitCount,
    pathAgentVisits,
    pathHumanVisits,
  };
}

export function parseAgentBrowserHistorySnapshot(
  value: unknown,
): AgentBrowserHistorySnapshot {
  const snapshot = record(
    value,
    "Agent Browser history snapshot",
  );
  if (
    !exactKeys(snapshot, [
      "totalVisits",
      "retainedVisits",
      "uniquePaths",
      "agentVisits",
      "humanVisits",
      "visits",
    ]) ||
    !Array.isArray(snapshot.visits) ||
    snapshot.visits.length > AGENT_BROWSER_HISTORY_LIMIT
  ) {
    throw new TypeError(
      "invalid Agent Browser history snapshot",
    );
  }
  const totalVisits = nonNegativeInteger(
    snapshot.totalVisits,
    "Agent Browser history total visits",
  );
  const retainedVisits = nonNegativeInteger(
    snapshot.retainedVisits,
    "Agent Browser history retained visits",
  );
  const uniquePaths = nonNegativeInteger(
    snapshot.uniquePaths,
    "Agent Browser history unique paths",
  );
  const agentVisits = nonNegativeInteger(
    snapshot.agentVisits,
    "Agent Browser history agent visits",
  );
  const humanVisits = nonNegativeInteger(
    snapshot.humanVisits,
    "Agent Browser history human visits",
  );
  if (
    agentVisits + humanVisits !== totalVisits ||
    retainedVisits > totalVisits ||
    uniquePaths > totalVisits ||
    snapshot.visits.length > retainedVisits
  ) {
    throw new TypeError(
      "Agent Browser history summary counts are inconsistent",
    );
  }
  const visits = snapshot.visits.map(parseVisit);
  for (let index = 1; index < visits.length; index += 1) {
    const previous = visits[index - 1];
    const current = visits[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      (
        current.visitedAt > previous.visitedAt ||
        (
          current.visitedAt === previous.visitedAt &&
          current.visitId > previous.visitId
        )
      )
    ) {
      throw new TypeError(
        "Agent Browser history visits must be newest first",
      );
    }
  }
  return {
    totalVisits,
    retainedVisits,
    uniquePaths,
    agentVisits,
    humanVisits,
    visits,
  };
}
