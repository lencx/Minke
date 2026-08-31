/**
 * Shared desktop/host contract for Minke's credential-free fallback tool.
 * The persisted `fallbackEnabled` key and environment name remain stable for
 * existing installations; they no longer imply a `ctx.web` provider override.
 */

export const MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV =
  "MINKE_WEB_SEARCH_FALLBACK_ENABLED";

export const WEB_SEARCH_SETTINGS_READ_CHANNEL =
  "minke:web-search-settings:read";
export const WEB_SEARCH_SETTINGS_WRITE_CHANNEL =
  "minke:web-search-settings:write";

export interface WebSearchSettings {
  fallbackEnabled: boolean;
}

export const DEFAULT_WEB_SEARCH_SETTINGS: Readonly<WebSearchSettings> =
  Object.freeze({
    fallbackEnabled: true,
  });

/** Validate the complete, deliberately small web-search preference. */
export function parseWebSearchSettings(
  value: unknown,
): WebSearchSettings {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("invalid web search settings");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.fallbackEnabled !== "boolean"
  ) {
    throw new TypeError("invalid web search settings");
  }
  return {
    fallbackEnabled: record.fallbackEnabled,
  };
}
