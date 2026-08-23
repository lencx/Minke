import {
  TELEGRAM_DEFAULT_API_BASE_URL,
  TelegramTransportError,
  type TelegramNetworkFailureKind,
  type TelegramRemoteEffect,
} from "./contract.ts";
import {
  parseApiResponse,
  type TelegramApiFailure,
} from "./protocol.ts";

const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

export interface TelegramNetworkOptions {
  readonly apiBaseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxJsonBytes?: number;
  readonly token: string;
}

export interface TelegramApiCallOptions {
  readonly body?: FormData | Readonly<Record<string, unknown>>;
  readonly effectOnUncertainResponse?: TelegramRemoteEffect;
  readonly method: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TelegramTransportError(
      "invalid-config",
      `${label} must be a positive safe integer`,
    );
  }
  return resolved;
}

export function validateTelegramToken(token: string): string {
  const normalized = token.trim();
  if (
    normalized.length > 256 ||
    !/^[1-9][0-9]*:[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram bot token has an invalid structure",
    );
  }
  return normalized;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? TELEGRAM_DEFAULT_API_BASE_URL);
  } catch {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram API base URL is invalid",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.telegram.org" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram API base URL must use the official HTTPS host",
    );
  }
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path;
  return url.href.replace(/\/$/u, "");
}

function validateMethod(method: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(method)) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram API method is invalid",
    );
  }
  return method;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function networkFailureKind(
  error: unknown,
): TelegramNetworkFailureKind {
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

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Discard errors must not replace the classified transport error.
  }
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    Number.parseInt(declared, 10) > maxBytes
  ) {
    await cancelResponseBody(response);
    throw new TelegramTransportError(
      "payload-too-large",
      "Telegram response exceeds the configured size limit",
    );
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
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
          // Preserve the size-limit error.
        }
        throw new TelegramTransportError(
          "payload-too-large",
          "Telegram response exceeds the configured size limit",
        );
      }
      try {
        result += decoder.decode(value, { stream: true });
      } catch {
        throw new TelegramTransportError(
          "protocol",
          "Telegram response is not valid UTF-8",
        );
      }
    }
    try {
      result += decoder.decode();
    } catch {
      throw new TelegramTransportError(
        "protocol",
        "Telegram response is not valid UTF-8",
      );
    }
    return result;
  } finally {
    reader.releaseLock();
  }
}

function retryAfterFromHeader(
  response: Response,
): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (raw === undefined || !/^[0-9]+$/u.test(raw)) {
    return undefined;
  }
  const milliseconds = Number(raw) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    return MAX_RETRY_AFTER_MS;
  }
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

function retryAfterFromFailure(
  failure: TelegramApiFailure,
): number | undefined {
  const seconds = failure.parameters?.retry_after;
  if (seconds === undefined || seconds < 0) return undefined;
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    return MAX_RETRY_AFTER_MS;
  }
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

function apiFailureError(
  failure: TelegramApiFailure,
  response: Response,
): TelegramTransportError {
  const apiErrorCode = failure.error_code ?? response.status;
  const retryAfterMs =
    retryAfterFromFailure(failure) ??
    retryAfterFromHeader(response);
  const migrateToChatId =
    failure.parameters?.migrate_to_chat_id === undefined
      ? undefined
      : String(failure.parameters.migrate_to_chat_id);
  const shared = {
    apiErrorCode,
    effect: "none" as const,
    migrateToChatId,
    status: response.status,
  };
  if (apiErrorCode === 401 || response.status === 401) {
    return new TelegramTransportError(
      "credential-invalid",
      "Telegram rejected the bot credential",
      shared,
    );
  }
  if (apiErrorCode === 409 || response.status === 409) {
    return new TelegramTransportError(
      "conflict",
      "Telegram rejected the request due to an update-mode conflict",
      shared,
    );
  }
  if (apiErrorCode === 429 || response.status === 429) {
    return new TelegramTransportError(
      "rate-limited",
      "Telegram rate limited the request",
      {
        ...shared,
        retryAfterMs: retryAfterMs ?? 1_000,
        retryable: true,
      },
    );
  }
  const retryable =
    apiErrorCode >= 500 || response.status >= 500;
  return new TelegramTransportError(
    "api",
    "Telegram rejected the API request",
    {
      ...shared,
      retryAfterMs,
      retryable,
    },
  );
}

function httpFailureError(
  response: Response,
  effect: TelegramRemoteEffect,
): TelegramTransportError {
  const status = response.status;
  if (status === 401) {
    return new TelegramTransportError(
      "credential-invalid",
      "Telegram rejected the bot credential",
      { status },
    );
  }
  if (status === 409) {
    return new TelegramTransportError(
      "conflict",
      "Telegram rejected the request due to an update-mode conflict",
      { status },
    );
  }
  if (status === 429) {
    return new TelegramTransportError(
      "rate-limited",
      "Telegram rate limited the request",
      {
        retryAfterMs:
          retryAfterFromHeader(response) ?? 1_000,
        retryable: true,
        status,
      },
    );
  }
  return new TelegramTransportError(
    "http",
    "Telegram returned an HTTP error",
    {
      effect,
      retryable: effect === "none" && status >= 500,
      status,
    },
  );
}

function copyWithEffect(
  error: TelegramTransportError,
  effect: TelegramRemoteEffect,
): TelegramTransportError {
  if (error.effect === effect) return error;
  return new TelegramTransportError(error.code, error.message, {
    apiErrorCode: error.apiErrorCode,
    effect,
    migrateToChatId: error.migrateToChatId,
    networkKind: error.networkKind,
    retryAfterMs: error.retryAfterMs,
    retryable: effect === "none" && error.retryable,
    status: error.status,
  });
}

export class TelegramNetwork {
  readonly #apiBaseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxJsonBytes: number;
  readonly #token: string;

  constructor(options: TelegramNetworkOptions) {
    this.#token = validateTelegramToken(options.token);
    this.#apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new TelegramTransportError(
        "invalid-config",
        "a fetch implementation is required",
      );
    }
    this.#maxJsonBytes = positiveInteger(
      options.maxJsonBytes,
      DEFAULT_MAX_JSON_BYTES,
      "maxJsonBytes",
    );
  }

  async call(
    options: TelegramApiCallOptions,
  ): Promise<unknown> {
    const method = validateMethod(options.method);
    const timeoutMs = positiveInteger(
      options.timeoutMs,
      1,
      "timeoutMs",
    );
    const effect =
      options.effectOnUncertainResponse ?? "none";
    if (options.signal?.aborted === true) {
      throw new TelegramTransportError(
        "aborted",
        "Telegram request was aborted",
        { effect: "none" },
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () =>
      controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref();

    let body: FormData | string | undefined;
    const headers = new Headers({ accept: "application/json" });
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set("content-type", "application/json");
    }

    try {
      const response = await this.#fetch(
        `${this.#apiBaseUrl}/bot${this.#token}/${method}`,
        {
          body,
          headers,
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
        },
      );

      let text: string;
      try {
        text = await readLimitedText(
          response,
          this.#maxJsonBytes,
        );
      } catch (error) {
        if (error instanceof TelegramTransportError) {
          if (!response.ok) {
            throw httpFailureError(response, effect);
          }
          throw copyWithEffect(error, effect);
        }
        throw error;
      }

      let parsed: ReturnType<typeof parseApiResponse>;
      try {
        parsed = parseApiResponse(JSON.parse(text));
      } catch (error) {
        if (error instanceof TelegramTransportError) {
          if (!response.ok) {
            throw httpFailureError(response, effect);
          }
          throw copyWithEffect(error, effect);
        }
        if (!response.ok) {
          throw httpFailureError(response, effect);
        }
        throw new TelegramTransportError(
          "protocol",
          "Telegram returned malformed JSON",
          { effect, status: response.status },
        );
      }

      if (!parsed.ok) {
        throw apiFailureError(parsed, response);
      }
      if (!response.ok) {
        throw new TelegramTransportError(
          "http",
          "Telegram returned an inconsistent HTTP response",
          {
            effect,
            status: response.status,
          },
        );
      }
      return parsed.result;
    } catch (error) {
      if (error instanceof TelegramTransportError) throw error;
      if (timedOut) {
        throw new TelegramTransportError(
          "timeout",
          "Telegram request timed out",
          { effect },
        );
      }
      if (
        controller.signal.aborted ||
        isAbortError(error)
      ) {
        throw new TelegramTransportError(
          "aborted",
          "Telegram request was aborted",
          { effect },
        );
      }
      const networkKind = networkFailureKind(error);
      throw new TelegramTransportError(
        "network",
        "Telegram network request failed",
        {
          effect,
          networkKind,
          retryable: effect === "none" && networkKind !== "tls",
        },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener(
        "abort",
        abortFromCaller,
      );
    }
  }
}
