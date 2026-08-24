import {
  MINKE_WEB_SEARCH_DEFAULT_BASE_URL,
  MINKE_WEB_SEARCH_DEFAULT_MAX_RESPONSE_BYTES,
  MINKE_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
  MINKE_WEB_SEARCH_DEFAULT_USER_AGENT,
  MinkeWebSearchProvider,
  type MinkeWebSearchProviderOptions,
} from "./provider.ts";

export {
  MINKE_WEB_SEARCH_DEFAULT_BASE_URL,
  MINKE_WEB_SEARCH_DEFAULT_MAX_RESPONSE_BYTES,
  MINKE_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
  MINKE_WEB_SEARCH_DEFAULT_USER_AGENT,
  MINKE_WEB_SEARCH_PROVIDER_ID,
  MinkeWebSearchError,
  MinkeWebSearchProvider,
  parseRssSearchResult,
} from "./provider.ts";
export type {
  MinkeWebSearchProviderOptions,
  MinkeWebSearchRequest,
  MinkeWebSearchResult,
  MinkeWebSearchSource,
} from "./provider.ts";

export const name = "minke-web-search";
export const inject = ["web"];

export interface Config {
  /** Credential-free RSS search endpoint. */
  readonly baseURL?: string;
  /** Per-request deadline in milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum accepted RSS response size in bytes. */
  readonly maxResponseBytes?: number;
  /** Transparent product User-Agent for the RSS request. */
  readonly userAgent?: string;
}

interface MinkeWebSearchContext {
  readonly web: {
    registerSearchProvider(provider: MinkeWebSearchProvider): () => void;
  };
}

function resolvedOptions(
  config: Config | undefined,
): MinkeWebSearchProviderOptions {
  return {
    baseURL:
      config?.baseURL?.trim() || MINKE_WEB_SEARCH_DEFAULT_BASE_URL,
    timeoutMs:
      config?.timeoutMs ?? MINKE_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    maxResponseBytes:
      config?.maxResponseBytes ??
      MINKE_WEB_SEARCH_DEFAULT_MAX_RESPONSE_BYTES,
    userAgent:
      config?.userAgent?.trim() ||
      MINKE_WEB_SEARCH_DEFAULT_USER_AGENT,
  };
}

/** Register Minke's credential-free provider into DSH's `ctx.web` seam. */
export function apply(
  ctx: MinkeWebSearchContext,
  config?: Config,
): void {
  const provider = new MinkeWebSearchProvider(
    resolvedOptions(config),
  );
  if (!provider.available()) {
    throw new TypeError("Minke web search configuration is invalid");
  }
  ctx.web.registerSearchProvider(provider);
}
