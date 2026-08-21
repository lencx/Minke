export const PLUGIN_DISCOVERY_TOPIC_URL =
  "https://github.com/topics/dsh-plugin";

const PLUGIN_SEARCH_URL = "https://github.com/search";
const PLUGIN_TOPIC_QUALIFIER = "topic:dsh-plugin";
const PLUGIN_TOPIC_QUALIFIER_PATTERN =
  /(?:^|\s)topic:dsh-plugin(?=\s|$)/giu;
const MAX_PLUGIN_SEARCH_LENGTH = 512;

interface InsertedCssWebview {
  readonly isConnected: boolean;
  removeInsertedCSS(key: string): Promise<void>;
}

/**
 * Electron throws synchronously when removeInsertedCSS is called after a
 * webview has detached or before its native guest is ready. A detached guest
 * is being destroyed anyway, so its injected CSS needs no explicit cleanup.
 */
export function removeInsertedWebviewCssSafely(
  view: InsertedCssWebview,
  keys: readonly string[],
): void {
  if (!view.isConnected) return;
  for (const key of keys) {
    try {
      void view.removeInsertedCSS(key).catch(() => {});
    } catch {}
  }
}

function normalizePluginSearchQuery(candidate: string): string {
  return candidate
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_PLUGIN_SEARCH_LENGTH);
}

/**
 * Build a GitHub repository-search URL from plain keywords or advanced
 * qualifiers, always scoped to the DSH plugin topic.
 */
export function createPluginSearchUrl(
  candidate: string,
): string {
  const query = normalizePluginSearchQuery(candidate);
  if (query === "") return PLUGIN_DISCOVERY_TOPIC_URL;

  const userQuery = normalizePluginSearchQuery(
    query.replace(PLUGIN_TOPIC_QUALIFIER_PATTERN, " "),
  );
  const scopedQuery = userQuery === ""
    ? PLUGIN_TOPIC_QUALIFIER
    : `${PLUGIN_TOPIC_QUALIFIER} ${userQuery}`;
  const url = new URL(PLUGIN_SEARCH_URL);
  url.searchParams.set("q", scopedQuery);
  url.searchParams.set("type", "repositories");
  return url.toString();
}

/** Recover the user's editable query from one GitHub search URL. */
export function readPluginSearchQuery(
  candidate: string,
): string | undefined {
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.pathname.replace(/\/+$/u, "") !== "/search"
    ) {
      return undefined;
    }
    const query = normalizePluginSearchQuery(
      url.searchParams.get("q") ?? "",
    );
    return normalizePluginSearchQuery(
      query.replace(PLUGIN_TOPIC_QUALIFIER_PATTERN, " "),
    );
  } catch {
    return undefined;
  }
}
