import {
  AGENT_BROWSER_HISTORY_DEFAULT_LIMIT,
  type AgentBrowserHistoryVisit,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";

export const WEB_HISTORY_SUGGESTION_LIMIT =
  AGENT_BROWSER_HISTORY_DEFAULT_LIMIT;

function normalizedHistoryLabel(
  candidate: string | undefined,
): string | undefined {
  const label = candidate?.replace(/\s+/gu, " ").trim();
  return label === undefined || label === "" ? undefined : label;
}

/** Human-readable content first; the compact URL remains the fallback. */
export function webHistoryPrimaryLabel(
  visit: AgentBrowserHistoryVisit,
): string {
  return normalizedHistoryLabel(visit.searchQuery) ??
    normalizedHistoryLabel(visit.title) ??
    webHistoryDisplayAddress(visit.url);
}

function searchTokens(query: string): readonly string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

/** Match every user-facing history field, regardless of primary-label order. */
export function webHistoryMatchesQuery(
  visit: AgentBrowserHistoryVisit,
  query: string,
): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const searchable = [
    visit.searchQuery,
    visit.title,
    visit.url,
    visit.origin,
    visit.pathname,
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n")
    .toLocaleLowerCase();
  return tokens.every((token) => searchable.includes(token));
}

function historySuggestionKey(
  visit: AgentBrowserHistoryVisit,
): string {
  const searchQuery =
    normalizedHistoryLabel(visit.searchQuery)?.toLocaleLowerCase();
  return searchQuery === undefined
    ? visit.pathKey
    : `${visit.pathKey}\n${searchQuery}`;
}

/**
 * Return the newest visit for each browsed page or distinct search.
 *
 * The history contract already orders visits newest-first. De-duplicating by
 * path keeps incidental query strings and hash changes from flooding the
 * address bar, while search content remains independently discoverable.
 */
export function recentWebHistorySuggestions(
  visits: readonly AgentBrowserHistoryVisit[],
  query: string,
  limit = WEB_HISTORY_SUGGESTION_LIMIT,
): readonly AgentBrowserHistoryVisit[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError(
      "Web history suggestion limit must be a positive integer",
    );
  }
  const seenSuggestions = new Set<string>();
  const suggestions: AgentBrowserHistoryVisit[] = [];
  for (const visit of visits) {
    if (!webHistoryMatchesQuery(visit, query)) continue;
    const suggestionKey = historySuggestionKey(visit);
    if (seenSuggestions.has(suggestionKey)) continue;
    seenSuggestions.add(suggestionKey);
    suggestions.push(visit);
    if (suggestions.length === limit) break;
  }
  return suggestions;
}

/** Compact address text that keeps insecure HTTP explicit. */
export function webHistoryDisplayAddress(candidate: string): string {
  const url = new URL(candidate);
  const scheme = url.protocol === "http:" ? "http://" : "";
  const pathname = url.pathname === "/" ? "" : url.pathname;
  return `${scheme}${url.host}${pathname}${url.search}${url.hash}`;
}
