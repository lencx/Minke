/**
 * HTTPS and wire-metadata implementation adapted from
 * @tencent-weixin/openclaw-weixin@2.4.6 (MIT).
 */
import { randomBytes } from "node:crypto";
import {
  WEIXIN_UPSTREAM_RELEASE,
  WeixinTransportError,
  type WeixinClientMetadata,
  type WeixinDiagnosticEvent,
  type WeixinDiagnosticOperation,
  type WeixinNetworkFailureKind,
  type WeixinNetworkPolicy,
  type WeixinObservability,
  type WeixinRemoteEffect,
} from "./contract.ts";

const DEFAULT_JSON_LIMIT = 2 * 1024 * 1024;
const DEFAULT_MEDIA_LIMIT = 100 * 1024 * 1024;
const DEFAULT_TRUSTED_HOST_SUFFIXES = [".weixin.qq.com"] as const;
export const MINKE_WEIXIN_DEFAULT_BOT_AGENT = "Minke/0.4.0";
const BOT_AGENT_MAX_BYTES = 256;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;
const STALE_SESSION_CODE = -14;

export interface WeixinNetworkOptions
  extends WeixinClientMetadata,
    WeixinNetworkPolicy,
    WeixinObservability {
  readonly fetch?: typeof globalThis.fetch;
  /** @internal Transport lifecycle hook, not part of the package interface. */
  readonly onSessionStale?: () => void;
}

interface RequestOptions {
  readonly baseUrl: string;
  readonly body?: Uint8Array | string;
  readonly effectOnTransportFailure?: WeixinRemoteEffect;
  readonly endpoint: string;
  readonly method: "GET" | "POST";
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly token?: string;
}

interface DirectRequestOptions {
  readonly body?: Uint8Array;
  readonly effectOnTransportFailure?: WeixinRemoteEffect;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: "GET" | "POST";
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly url: string;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} must be a positive integer`,
    );
  }
  return resolved;
}

function normalizeHostSuffix(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized.includes("/") ||
    normalized.includes("@") ||
    normalized.includes(":")
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      "trusted host suffix is invalid",
    );
  }
  return normalized;
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  if (!suffix.startsWith(".")) return host === suffix;
  return host === suffix.slice(1) || host.endsWith(suffix);
}

function buildClientVersion(version: string): number {
  const parts = version.split(".").map((part) =>
    Number.parseInt(part, 10)
  );
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = Number.isFinite(parts[2]) ? parts[2] : 0;
  return (
    ((major ?? 0) & 0xff) << 16 |
    ((minor ?? 0) & 0xff) << 8 |
    ((patch ?? 0) & 0xff)
  );
}

export function sanitizeBotAgent(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    return MINKE_WEIXIN_DEFAULT_BOT_AGENT;
  }
  const printable = [...raw.trim()]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
    .join("")
    .replace(/\s+/gu, " ");
  if (printable === "") return MINKE_WEIXIN_DEFAULT_BOT_AGENT;

  let result = "";
  for (const character of printable) {
    const candidate = `${result}${character}`;
    if (Buffer.byteLength(candidate, "utf8") > BOT_AGENT_MAX_BYTES) break;
    result = candidate;
  }
  return result || MINKE_WEIXIN_DEFAULT_BOT_AGENT;
}

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function networkFailureKind(
  error: unknown,
): WeixinNetworkFailureKind {
  const cause =
    error !== null && typeof error === "object" && "cause" in error
      ? error.cause
      : undefined;
  const code =
    cause !== null &&
    typeof cause === "object" &&
    "code" in cause &&
    typeof cause.code === "string"
      ? cause.code
      : "";
  const searchable = [
    code,
    cause instanceof Error ? cause.name : "",
    cause instanceof Error ? cause.message : "",
    error instanceof Error ? error.name : "",
    error instanceof Error ? error.message : "",
  ].join(" ");
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/iu.test(searchable)) {
    return "dns";
  }
  if (
    /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT/iu
      .test(searchable)
  ) {
    return "connect";
  }
  if (
    /SSL|TLS|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/iu.test(searchable)
  ) {
    return "tls";
  }
  if (/ECONNRESET|EPIPE|UND_ERR_SOCKET/iu.test(searchable)) {
    return "socket";
  }
  return "unknown";
}

function requestBody(
  bytes: Uint8Array | undefined,
): ArrayBuffer | undefined {
  if (bytes === undefined) return undefined;
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function networkError(
  error: unknown,
  effect: WeixinRemoteEffect,
): WeixinTransportError {
  const networkKind = networkFailureKind(error);
  return new WeixinTransportError(
    "network",
    "Weixin network request failed",
    {
      effect,
      networkKind,
      retryable: effect === "none" && networkKind !== "tls",
    },
  );
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  let milliseconds: number;
  if (/^[0-9]+$/u.test(raw)) {
    milliseconds = Number(raw) * 1_000;
  } else {
    const date = Date.parse(raw);
    if (!Number.isFinite(date)) return undefined;
    milliseconds = Math.max(0, date - Date.now());
  }
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    return MAX_RETRY_AFTER_MS;
  }
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

function staleCode(value: unknown): number | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.errcode === STALE_SESSION_CODE) {
    return STALE_SESSION_CODE;
  }
  return record.ret === STALE_SESSION_CODE
    ? STALE_SESSION_CODE
    : undefined;
}

async function readLimitedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.parseInt(declaredLength, 10) > maxBytes
  ) {
    await cancelResponseBody(response);
    throw new WeixinTransportError(
      "payload-too-large",
      "Weixin response exceeds the configured size limit",
    );
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve payload-too-large even when stream cancellation fails.
        }
        throw new WeixinTransportError(
          "payload-too-large",
          "Weixin response exceeds the configured size limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Discard failures must not replace the classified HTTP/protocol error.
  }
}

export class WeixinNetwork {
  readonly maxJsonBytes: number;
  readonly maxMediaBytes: number;

  readonly #botAgent: string;
  readonly #channelVersion: string;
  readonly #clientVersion: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #onDiagnostic?: (event: WeixinDiagnosticEvent) => void;
  readonly #onSessionStale?: () => void;
  readonly #routeTag?: string;
  readonly #trustedHostSuffixes: readonly string[];

  constructor(options: WeixinNetworkOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#onDiagnostic = options.onDiagnostic;
    this.#onSessionStale = options.onSessionStale;
    if (typeof this.#fetch !== "function") {
      throw new WeixinTransportError(
        "invalid-config",
        "a fetch implementation is required",
      );
    }
    this.#channelVersion =
      options.channelVersion?.trim() || WEIXIN_UPSTREAM_RELEASE;
    if (!/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(
      this.#channelVersion,
    )) {
      throw new WeixinTransportError(
        "invalid-config",
        "channelVersion must contain three numeric parts",
      );
    }
    this.#clientVersion = buildClientVersion(this.#channelVersion);
    this.#botAgent = sanitizeBotAgent(options.botAgent);
    const routeTag = options.routeTag?.trim();
    if (
      routeTag !== undefined &&
      routeTag !== "" &&
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(routeTag)
    ) {
      throw new WeixinTransportError(
        "invalid-config",
        "routeTag contains unsupported characters",
      );
    }
    this.#routeTag = routeTag || undefined;
    this.maxJsonBytes = positiveInteger(
      options.maxJsonBytes,
      DEFAULT_JSON_LIMIT,
      "maxJsonBytes",
    );
    this.maxMediaBytes = positiveInteger(
      options.maxMediaBytes,
      DEFAULT_MEDIA_LIMIT,
      "maxMediaBytes",
    );
    this.#trustedHostSuffixes = Object.freeze(
      (
        options.trustedHostSuffixes ??
        DEFAULT_TRUSTED_HOST_SUFFIXES
      ).map(normalizeHostSuffix),
    );
    if (this.#trustedHostSuffixes.length === 0) {
      throw new WeixinTransportError(
        "invalid-config",
        "at least one trusted host suffix is required",
      );
    }
  }

  reportDiagnostic(input: {
    readonly attempt?: number;
    readonly durationMs?: number;
    readonly error: unknown;
    readonly operation: WeixinDiagnosticOperation;
    readonly type: WeixinDiagnosticEvent["type"];
  }): void {
    if (this.#onDiagnostic === undefined) return;
    const error =
      input.error instanceof WeixinTransportError
        ? input.error
        : new WeixinTransportError(
            "network",
            "Weixin operation failed",
          );
    const event: WeixinDiagnosticEvent = Object.freeze({
      attempt: input.attempt,
      durationMs: input.durationMs,
      error: Object.freeze({
        code: error.code,
        effect: error.effect,
        networkKind: error.networkKind,
        remoteCode: error.remoteCode,
        retryAfterMs: error.retryAfterMs,
        status: error.status,
      }),
      operation: input.operation,
      severity: "warning",
      type: input.type,
    });
    try {
      this.#onDiagnostic(event);
    } catch {
      // Observability is never part of transport control flow.
    }
  }

  baseInfo(): {
    readonly bot_agent: string;
    readonly channel_version: string;
  } {
    return {
      bot_agent: this.#botAgent,
      channel_version: this.#channelVersion,
    };
  }

  trustedUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new WeixinTransportError(
        "untrusted-url",
        "Weixin returned an invalid URL",
      );
    }
    const host = url.hostname.toLowerCase();
    const trusted = this.#trustedHostSuffixes.some((suffix) =>
      hostMatchesSuffix(host, suffix)
    );
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      !trusted
    ) {
      throw new WeixinTransportError(
        "untrusted-url",
        "Weixin URL is outside the configured HTTPS host policy",
      );
    }
    return url;
  }

  apiUrl(baseUrl: string, endpoint: string): URL {
    try {
      const base = this.trustedUrl(baseUrl);
      const normalizedBase = base.href.endsWith("/")
        ? base
        : new URL(`${base.href}/`);
      const resolved = new URL(endpoint, normalizedBase);
      this.trustedUrl(resolved.href);
      if (resolved.origin !== normalizedBase.origin) {
        throw new WeixinTransportError(
          "untrusted-url",
          "Weixin endpoint changed the configured origin",
        );
      }
      return resolved;
    } catch (error) {
      if (error instanceof WeixinTransportError) throw error;
      throw new WeixinTransportError(
        "untrusted-url",
        "Weixin endpoint URL is invalid",
      );
    }
  }

  async json(
    options: RequestOptions,
  ): Promise<unknown> {
    const url = this.apiUrl(options.baseUrl, options.endpoint);
    const bytes = await this.#request(
      {
        body:
          typeof options.body === "string"
            ? new TextEncoder().encode(options.body)
            : options.body,
        effectOnTransportFailure: options.effectOnTransportFailure,
        headers: this.#apiHeaders(
          options.method,
          options.token,
        ),
        method: options.method,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        url: url.href,
      },
      async (response) =>
        await readLimitedBytes(response, this.maxJsonBytes),
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new WeixinTransportError(
        "protocol",
        "Weixin returned malformed JSON",
        {
          effect: options.effectOnTransportFailure ?? "none",
        },
      );
    }
    const remoteCode = staleCode(parsed);
    if (remoteCode !== undefined) {
      this.#onSessionStale?.();
      throw new WeixinTransportError(
        "session-stale",
        "Weixin session credential is stale",
        {
          effect: options.effectOnTransportFailure ?? "none",
          remoteCode,
        },
      );
    }
    return parsed;
  }

  async bytes(options: {
    readonly maxBytes?: number;
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
    readonly url: string;
  }): Promise<Uint8Array> {
    const url = this.trustedUrl(options.url);
    return await this.#request(
      {
        method: "GET",
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        url: url.href,
      },
      async (response) =>
        await readLimitedBytes(
          response,
          options.maxBytes ?? this.maxMediaBytes,
        ),
    );
  }

  async upload(options: {
    readonly bytes: Uint8Array;
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
    readonly url: string;
  }): Promise<string> {
    const url = this.trustedUrl(options.url);
    return await this.#request(
      {
        body: options.bytes,
        headers: { "Content-Type": "application/octet-stream" },
        method: "POST",
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        url: url.href,
      },
      async (response) => {
        if (response.status !== 200) {
          await cancelResponseBody(response);
          throw new WeixinTransportError(
            "http",
            "Weixin CDN upload returned an unexpected status",
            {
              retryable: response.status >= 500,
              status: response.status,
            },
          );
        }
        const encryptedParam =
          response.headers.get("x-encrypted-param");
        await cancelResponseBody(response);
        if (
          encryptedParam === null ||
          encryptedParam.trim() === ""
        ) {
          throw new WeixinTransportError(
            "protocol",
            "Weixin CDN response omitted its download parameter",
            { retryable: true },
          );
        }
        return encryptedParam;
      },
    );
  }

  #apiHeaders(
    method: "GET" | "POST",
    token: string | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": String(this.#clientVersion),
    };
    if (this.#routeTag !== undefined) {
      headers.SKRouteTag = this.#routeTag;
    }
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers.AuthorizationType = "ilink_bot_token";
      headers["X-WECHAT-UIN"] = randomWechatUin();
    }
    if (token?.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  async #request<Result>(
    options: DirectRequestOptions,
    consume: (response: Response) => Result | Promise<Result>,
  ): Promise<Result> {
    const controller = new AbortController();
    let abortSource: "external" | "timeout" | undefined;
    const onAbort = () => {
      abortSource ??= "external";
      controller.abort();
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      abortSource ??= "timeout";
      controller.abort();
    }, options.timeoutMs);
    const effect = options.effectOnTransportFailure ?? "none";

    try {
      const response = await this.#fetch(options.url, {
        body: requestBody(options.body),
        headers: options.headers,
        method: options.method,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await cancelResponseBody(response);
        throw new WeixinTransportError(
          "http",
          "Weixin HTTP redirects are not accepted",
          {
            effect,
            retryable: false,
            status: response.status,
          },
        );
      }
      if (!response.ok) {
        const retryDelay = retryAfterMs(response);
        await cancelResponseBody(response);
        throw new WeixinTransportError(
          "http",
          `Weixin request failed with HTTP ${String(response.status)}`,
          {
            effect,
            retryable:
              effect === "none" &&
              (response.status === 429 || response.status >= 500),
            retryAfterMs: retryDelay,
            status: response.status,
          },
        );
      }
      return await consume(response);
    } catch (error) {
      if (error instanceof WeixinTransportError) throw error;
      if (abortSource === "external") {
        const reason = options.signal?.reason;
        if (
          reason instanceof WeixinTransportError &&
          reason.code === "session-stale"
        ) {
          throw new WeixinTransportError(
            "session-stale",
            "Weixin session credential is stale",
            {
              effect,
              remoteCode: reason.remoteCode ?? STALE_SESSION_CODE,
            },
          );
        }
        throw new WeixinTransportError(
          "aborted",
          "Weixin network request was aborted",
          { effect },
        );
      }
      if (abortSource === "timeout") {
        throw new WeixinTransportError(
          "timeout",
          "Weixin network request timed out",
          {
            effect,
            retryable: effect === "none",
          },
        );
      }
      if (isAbortError(error)) {
        throw new WeixinTransportError(
          "aborted",
          "Weixin network request was aborted",
          { effect },
        );
      }
      throw networkError(error, effect);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
