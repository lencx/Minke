import {
  HarnessError,
} from "@deepseek-ai/dsh-llm";

/** Stable provider id selected by Minke's product overlay. */
export const MINKE_WEB_SEARCH_PROVIDER_ID = "minke-public-search";

/**
 * Bing's RSS projection is intentionally a best-effort, credential-free
 * default. Deployments can point the provider at a compatible RSS endpoint
 * through `MINKE_WEB_SEARCH_BASE_URL`.
 */
export const MINKE_WEB_SEARCH_DEFAULT_BASE_URL =
  "https://www.bing.com/search";

export const MINKE_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 15_000;
export const MINKE_WEB_SEARCH_DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
export const MINKE_WEB_SEARCH_DEFAULT_USER_AGENT =
  "Minke/0.3.0 (+https://github.com/lencx/Minke)";

const MAX_QUERY_CHARS = 2_048;
const MAX_REQUEST_URL_BYTES = 8_192;
const MAX_REDIRECTS = 3;
const MAX_PARSED_SOURCES = 50;
const MAX_TITLE_CHARS = 512;
const MAX_SNIPPET_CHARS = 2_048;
const MAX_TIMER_MS = 2_147_483_647;
const RSS_CONTENT_TYPE =
  /^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:\s*;|$)/iu;
const UNSAFE_XML_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/iu;
const UNSAFE_TEXT_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface MinkeWebSearchRequest {
  readonly query: string;
  readonly maxResults?: number;
}

export interface MinkeWebSearchSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
}

export interface MinkeWebSearchResult {
  readonly sources: readonly MinkeWebSearchSource[];
  readonly truncated: boolean;
}

export interface MinkeWebSearchProviderOptions {
  readonly baseURL: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly userAgent: string;
}

export class MinkeWebSearchError extends HarnessError {}

/**
 * Credential-free RSS search provider. It sends no cookies, authorization
 * headers, referrers, or ambient browser state.
 */
export class MinkeWebSearchProvider {
  readonly id = MINKE_WEB_SEARCH_PROVIDER_ID;
  private readonly options: MinkeWebSearchProviderOptions;

  constructor(
    options: MinkeWebSearchProviderOptions,
  ) {
    this.options = options;
  }

  available(): boolean {
    return (
      searchEndpoint(this.options.baseURL) !== undefined &&
      positiveInteger(this.options.timeoutMs) &&
      positiveInteger(this.options.maxResponseBytes) &&
      this.options.userAgent.trim().length > 0
    );
  }

  async search(
    request: MinkeWebSearchRequest,
    signal?: AbortSignal,
  ): Promise<MinkeWebSearchResult> {
    if (aborted(signal)) {
      throw new MinkeWebSearchError(
        "web search aborted",
        "WEB_ABORTED",
      );
    }
    const query = request.query.trim();
    if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
      throw new MinkeWebSearchError(
        `web search query must contain 1–${String(MAX_QUERY_CHARS)} characters`,
        "WEB_SEARCH_INVALID_QUERY",
      );
    }
    const endpoint = searchEndpoint(this.options.baseURL);
    if (endpoint === undefined) {
      throw new MinkeWebSearchError(
        "Minke web search endpoint is invalid",
        "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
      );
    }
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "rss");
    if (isBingHost(endpoint.hostname)) {
      // Bing otherwise localizes pubDate tokens on country redirects, which
      // makes otherwise RFC-822 dates impossible to normalize portably.
      endpoint.searchParams.set("setlang", "en-us");
    }
    if (
      new TextEncoder().encode(endpoint.toString()).byteLength >
      MAX_REQUEST_URL_BYTES
    ) {
      throw new MinkeWebSearchError(
        `web search request URL exceeds ${String(MAX_REQUEST_URL_BYTES)} bytes`,
        "WEB_SEARCH_INVALID_QUERY",
      );
    }

    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new Error("Minke web search timed out")),
      this.options.timeoutMs,
    );
    timer.unref?.();
    const requestSignal =
      signal === undefined
        ? timeout.signal
        : AbortSignal.any([signal, timeout.signal]);

    try {
      const response = await this.request(endpoint, requestSignal);
      return parseRssSearchResult(
        await readResponseText(
          response,
          this.options.maxResponseBytes,
          requestSignal,
        ),
      );
    } catch (error: unknown) {
      if (aborted(signal)) {
        throw new MinkeWebSearchError(
          "web search aborted",
          "WEB_ABORTED",
          { cause: error },
        );
      }
      if (timeout.signal.aborted) {
        throw new MinkeWebSearchError(
          "web search timed out",
          "WEB_SEARCH_TIMEOUT",
          { cause: error },
        );
      }
      if (error instanceof HarnessError) throw error;
      throw new MinkeWebSearchError(
        `web search request failed: ${String(error)}`,
        "WEB_PROVIDER_ERROR",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    initialURL: URL,
    signal: AbortSignal,
  ): Promise<Response> {
    let currentURL = initialURL;
    for (let redirects = 0; ; redirects += 1) {
      let response: Response;
      try {
        response = await fetch(currentURL, {
          method: "GET",
          redirect: "manual",
          headers: {
            accept:
              "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
            "user-agent": this.options.userAgent,
          },
          signal,
        });
      } catch (error: unknown) {
        throw new MinkeWebSearchError(
          `web search transport failed: ${String(error)}`,
          "WEB_PROVIDER_ERROR",
          { cause: error },
        );
      }

      if (!REDIRECT_STATUS.has(response.status)) {
        if (!response.ok) {
          await response.body?.cancel();
          throw new MinkeWebSearchError(
            `web search endpoint returned HTTP ${String(response.status)}`,
            "WEB_PROVIDER_ERROR",
          );
        }
        const contentType = response.headers.get("content-type");
        if (
          contentType === null ||
          !RSS_CONTENT_TYPE.test(contentType)
        ) {
          await response.body?.cancel();
          throw new MinkeWebSearchError(
            `web search endpoint returned unsupported content type "${contentType ?? "unknown"}"`,
            "WEB_SEARCH_UNSUPPORTED_RESPONSE",
          );
        }
        return response;
      }

      if (redirects >= MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new MinkeWebSearchError(
          `web search exceeded ${String(MAX_REDIRECTS)} redirects`,
          "WEB_SEARCH_REDIRECT_BLOCKED",
        );
      }
      const location = response.headers.get("location");
      if (location === null) {
        await response.body?.cancel();
        throw new MinkeWebSearchError(
          "web search redirect omitted its Location header",
          "WEB_SEARCH_REDIRECT_BLOCKED",
        );
      }
      let target: URL;
      try {
        target = new URL(location, currentURL);
      } catch (error: unknown) {
        await response.body?.cancel();
        throw new MinkeWebSearchError(
          "web search redirect contained an invalid URL",
          "WEB_SEARCH_REDIRECT_BLOCKED",
          { cause: error },
        );
      }
      if (!allowedRedirect(currentURL, target)) {
        await response.body?.cancel();
        throw new MinkeWebSearchError(
          `web search refused redirect to ${target.origin}`,
          "WEB_SEARCH_REDIRECT_BLOCKED",
        );
      }
      await response.body?.cancel();
      currentURL = target;
    }
  }
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_TIMER_MS;
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function searchEndpoint(value: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        isLoopbackHost(parsed.hostname)
      )
    ) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return undefined;
  }
  return parsed;
}

function isBingHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "bing.com" || normalized.endsWith(".bing.com");
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}

/**
 * Custom endpoints may only redirect within their own origin. Bing's public
 * RSS endpoint additionally performs HTTPS country-host redirects such as
 * `www.bing.com` → `cn.bing.com`; keep those on Bing and on `/search`.
 */
function allowedRedirect(from: URL, target: URL): boolean {
  if (
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    return false;
  }
  if (from.origin === target.origin) {
    return (
      target.protocol === "https:" || target.protocol === "http:"
    );
  }
  return (
    from.protocol === "https:" &&
    target.protocol === "https:" &&
    isBingHost(from.hostname) &&
    isBingHost(target.hostname) &&
    target.pathname === "/search"
  );
}

async function readResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    Number.isFinite(Number(declared)) &&
    Number(declared) > maxBytes
  ) {
    await response.body?.cancel();
    throw new MinkeWebSearchError(
      `web search response exceeds ${String(maxBytes)} bytes`,
      "WEB_SEARCH_RESPONSE_TOO_LARGE",
    );
  }
  if (response.body === null) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        throw new MinkeWebSearchError(
          `web search response exceeds ${String(maxBytes)} bytes`,
          "WEB_SEARCH_RESPONSE_TOO_LARGE",
        );
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    if (error instanceof HarnessError) throw error;
    throw new MinkeWebSearchError(
      `web search response could not be read: ${String(error)}`,
      "WEB_PROVIDER_ERROR",
      { cause: error },
    );
  } finally {
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw new MinkeWebSearchError(
      "web search response is not valid UTF-8",
      "WEB_SEARCH_INVALID_RESPONSE",
      { cause: error },
    );
  }
}

/** Parse a bounded RSS 2.0 payload into DSH's portable search result shape. */
export function parseRssSearchResult(
  xml: string,
): MinkeWebSearchResult {
  if (UNSAFE_XML_DECLARATION.test(xml)) {
    throw new MinkeWebSearchError(
      "web search RSS contains a forbidden XML declaration",
      "WEB_SEARCH_INVALID_RESPONSE",
    );
  }
  if (
    !/<rss(?:\s[^>]*)?>/iu.test(xml) ||
    !/<channel(?:\s[^>]*)?>/iu.test(xml) ||
    !/<\/channel\s*>/iu.test(xml) ||
    !/<\/rss\s*>/iu.test(xml)
  ) {
    throw new MinkeWebSearchError(
      "web search response is not an RSS channel",
      "WEB_SEARCH_INVALID_RESPONSE",
    );
  }
  const sources: MinkeWebSearchSource[] = [];
  const seen = new Set<string>();
  const items =
    xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/giu) ?? [];
  for (const item of items) {
    const url = portableHttpURL(xmlTag(item, "link"));
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    const title = boundedText(
      normalizedText(xmlTag(item, "title")),
      MAX_TITLE_CHARS,
    );
    const snippet = boundedText(
      normalizedSnippet(xmlTag(item, "description")),
      MAX_SNIPPET_CHARS,
    );
    const publishedAt = normalizedDate(xmlTag(item, "pubDate"));
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    });
    if (sources.length === MAX_PARSED_SOURCES) break;
  }
  return {
    sources,
    truncated: items.length > sources.length &&
      sources.length === MAX_PARSED_SOURCES,
  };
}

function xmlTag(item: string, tag: string): string | undefined {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "iu",
  );
  return expression.exec(item)?.[1];
}

function unwrapCdata(value: string): string {
  return value.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/giu,
    "$1",
  );
}

function decodeXmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: "\u00a0",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu,
    (entity, decimal: string, hexadecimal: string, name: string) => {
      const numeric =
        decimal !== undefined && decimal !== ""
          ? Number.parseInt(decimal, 10)
          : hexadecimal !== undefined && hexadecimal !== ""
            ? Number.parseInt(hexadecimal, 16)
            : undefined;
      if (
        numeric !== undefined &&
        Number.isInteger(numeric) &&
        numeric >= 0 &&
        numeric <= 0x10ffff
      ) {
        return String.fromCodePoint(numeric);
      }
      return named[name?.toLowerCase()] ?? entity;
    },
  );
}

function normalizedText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = decodeXmlEntities(unwrapCdata(value))
    .replace(UNSAFE_TEXT_CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return text === "" ? undefined : text;
}

function normalizedSnippet(
  value: string | undefined,
): string | undefined {
  const decoded = normalizedText(value);
  if (decoded === undefined) return undefined;
  const text = decodeXmlEntities(
    decoded.replace(/<[^>]*>/gu, " "),
  )
    .replace(UNSAFE_TEXT_CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return text === "" ? undefined : text;
}

function boundedText(
  value: string | undefined,
  maxChars: number,
): string | undefined {
  return value === undefined ? undefined : value.slice(0, maxChars);
}

function portableHttpURL(value: string | undefined): string | undefined {
  const text = normalizedText(value);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizedDate(value: string | undefined): string | undefined {
  const text = normalizedText(value);
  if (text === undefined) return undefined;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}
