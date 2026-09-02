import type {
  AgentBrowserHistoryVisit,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";

export const WEB_HISTORY_SUGGESTION_LIMIT = 8;

function searchTokens(query: string): readonly string[] {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * Return the newest visit for each origin/path pair.
 *
 * The history contract already orders visits newest-first. De-duplicating by
 * path keeps query strings and hash changes from flooding the address bar,
 * while the selected row still navigates to the exact most-recent URL.
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
  const tokens = searchTokens(query);
  const seenPaths = new Set<string>();
  const suggestions: AgentBrowserHistoryVisit[] = [];
  for (const visit of visits) {
    if (seenPaths.has(visit.pathKey)) continue;
    seenPaths.add(visit.pathKey);
    const searchable =
      `${visit.url}\n${visit.origin}\n${visit.pathname}`
        .toLocaleLowerCase();
    if (!tokens.every((token) => searchable.includes(token))) {
      continue;
    }
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
