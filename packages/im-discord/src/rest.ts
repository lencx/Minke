import {
  DISCORD_API_BASE_URL,
  DiscordTransportError,
  type DiscordBotIdentity,
  type DiscordDeliveryReceipt,
  type DiscordPreparedDelivery,
  type DiscordRemoteEffect,
  type DiscordTimerPort,
  type ValidateDiscordBotTokenOptions,
} from "./contract.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT =
  "DiscordBot (https://github.com/lencx/Minke, 0.2.0)";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60_000;

export interface DiscordRestClientOptions
  extends Omit<ValidateDiscordBotTokenOptions, "signal"> {}

interface RequestOptions {
  readonly body?: BodyInit;
  readonly effectOnFailure: DiscordRemoteEffect;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly routeKey: string;
  readonly signal?: AbortSignal;
}

export interface DiscordGatewayBot {
  readonly resetAfterMs?: number;
  readonly sessionStartsRemaining?: number;
  readonly url: string;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

const defaultTimers: DiscordTimerPort = Object.freeze({
  clearTimeout: (handle: unknown) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout: (callback: () => void, delayMs: number) =>
    setTimeout(callback, delayMs),
});

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new DiscordTransportError(
      "invalid-config",
      `${label} must be a positive safe integer`,
    );
  }
  return resolved;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function sanitizeToken(token: string): string {
  if (
    typeof token !== "string" ||
    !/^[\x21-\x7e]{1,512}$/u.test(token)
  ) {
    throw new DiscordTransportError(
      "invalid-config",
      "Discord bot token must contain only visible ASCII characters",
    );
  }
  return token;
}

function sanitizeUserAgent(value: string | undefined): string {
  const resolved = value ?? DEFAULT_USER_AGENT;
  if (
    resolved.length === 0 ||
    resolved.length > 256 ||
    !/^[\x20-\x7e]+$/u.test(resolved)
  ) {
    throw new DiscordTransportError(
      "invalid-config",
      "Discord User-Agent must contain visible ASCII characters",
    );
  }
  return resolved;
}

function asRecord(
  value: unknown,
  label: string,
): UnknownRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new DiscordTransportError(
      "protocol",
      `${label} must be an object`,
    );
  }
  return value as UnknownRecord;
}

function requiredString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DiscordTransportError(
      "protocol",
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DiscordTransportError(
      "protocol",
      `${label} must be a string`,
    );
  }
  return value;
}

function optionalRemoteCode(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value)
    ? value
    : undefined;
}

function secondsToMilliseconds(
  value: unknown,
): number | undefined {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  const milliseconds = Math.ceil(seconds * 1_000);
  if (!Number.isSafeInteger(milliseconds)) {
    return MAX_RETRY_AFTER_MS;
  }
  return Math.min(milliseconds, MAX_RETRY_AFTER_MS);
}

function responseRetryAfterMs(
  response: Response,
  body: unknown,
): number | undefined {
  const header = response.headers.get("retry-after");
  const fromHeader =
    header === null
      ? undefined
      : secondsToMilliseconds(header);
  if (fromHeader !== undefined) return fromHeader;
  if (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    return secondsToMilliseconds(
      (body as UnknownRecord).retry_after,
    );
  }
  return undefined;
}

function requestFailure(
  input: {
    readonly aborted: boolean;
    readonly effect: DiscordRemoteEffect;
    readonly timedOut: boolean;
  },
): DiscordTransportError {
  if (input.timedOut) {
    return new DiscordTransportError(
      "timeout",
      "Discord request timed out",
      {
        effect: input.effect,
        retryable: input.effect === "none",
      },
    );
  }
  if (input.aborted) {
    return new DiscordTransportError(
      "aborted",
      "Discord request was aborted",
      { effect: input.effect },
    );
  }
  return new DiscordTransportError(
    "network",
    "Discord network request failed",
    {
      effect: input.effect,
      retryable: input.effect === "none",
    },
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Body disposal must not replace the classified transport failure.
  }
}

async function readLimitedJson(
  response: Response,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    Number.parseInt(declared, 10) > MAX_JSON_BYTES
  ) {
    await cancelBody(response);
    throw new DiscordTransportError(
      "payload-too-large",
      "Discord response exceeds the configured size limit",
    );
  }
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Keep the payload-too-large classification.
        }
        throw new DiscordTransportError(
          "payload-too-large",
          "Discord response exceeds the configured size limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DiscordTransportError(
      "protocol",
      "Discord returned malformed JSON",
    );
  }
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function trustedGatewayUrl(raw: unknown): string {
  const value = requiredString(raw, "gateway.url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DiscordTransportError(
      "untrusted-url",
      "Discord returned an invalid Gateway URL",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "wss:" ||
    !(
      host === "discord.gg" ||
      host.endsWith(".discord.gg")
    ) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new DiscordTransportError(
      "untrusted-url",
      "Discord returned an untrusted Gateway URL",
    );
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

export function normalizeDiscordBotIdentity(
  value: unknown,
): DiscordBotIdentity {
  const input = asRecord(value, "Discord bot identity");
  const id = requiredString(input.id, "Discord bot id");
  if (!/^[0-9]{1,20}$/u.test(id)) {
    throw new DiscordTransportError(
      "protocol",
      "Discord bot id is not a snowflake",
    );
  }
  return Object.freeze({
    avatar: optionalString(
      input.avatar,
      "Discord bot avatar",
    ),
    discriminator: optionalString(
      input.discriminator,
      "Discord bot discriminator",
    ),
    globalName: optionalString(
      input.global_name ?? input.globalName,
      "Discord bot global name",
    ),
    id,
    username: requiredString(
      input.username,
      "Discord bot username",
    ),
  });
}

export class DiscordRestClient {
  readonly #closedController = new AbortController();
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #routeBlockedUntil = new Map<string, number>();
  readonly #timers: DiscordTimerPort;
  readonly #token: string;
  readonly #userAgent: string;

  #globalBlockedUntil = 0;

  constructor(options: DiscordRestClientOptions) {
    this.#token = sanitizeToken(options.token);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new DiscordTransportError(
        "invalid-config",
        "a fetch implementation is required",
      );
    }
    this.#timers = options.timers ?? defaultTimers;
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.#userAgent = sanitizeUserAgent(options.userAgent);
  }

  close(): void {
    this.#closedController.abort();
  }

  async validateBot(
    signal?: AbortSignal,
  ): Promise<DiscordBotIdentity> {
    const value = await this.#request({
      effectOnFailure: "none",
      method: "GET",
      path: "/users/@me",
      routeKey: "GET /users/@me",
      signal,
    });
    const input = asRecord(value, "Discord current user");
    if (input.bot !== true) {
      throw new DiscordTransportError(
        "credential-invalid",
        "Discord credential does not belong to a bot user",
        { terminal: "credential-invalid" },
      );
    }
    return normalizeDiscordBotIdentity(input);
  }

  async getGatewayBot(
    signal?: AbortSignal,
  ): Promise<DiscordGatewayBot> {
    const value = await this.#request({
      effectOnFailure: "none",
      method: "GET",
      path: "/gateway/bot",
      routeKey: "GET /gateway/bot",
      signal,
    });
    const input = asRecord(value, "Discord Gateway Bot response");
    const limit =
      input.session_start_limit === undefined
        ? undefined
        : asRecord(
            input.session_start_limit,
            "Discord session start limit",
          );
    const remaining =
      typeof limit?.remaining === "number" &&
      Number.isSafeInteger(limit.remaining) &&
      limit.remaining >= 0
        ? limit.remaining
        : undefined;
    const resetAfterMs =
      typeof limit?.reset_after === "number" &&
      Number.isSafeInteger(limit.reset_after) &&
      limit.reset_after >= 0
        ? Math.min(limit.reset_after, MAX_RETRY_AFTER_MS)
        : undefined;
    if (remaining === 0) {
      throw new DiscordTransportError(
        "rate-limited",
        "Discord Gateway identify quota is exhausted",
        {
          retryAfterMs: resetAfterMs ?? 0,
          retryable: true,
        },
      );
    }
    return Object.freeze({
      resetAfterMs,
      sessionStartsRemaining: remaining,
      url: trustedGatewayUrl(input.url),
    });
  }

  async createMessage(
    delivery: DiscordPreparedDelivery,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<DiscordDeliveryReceipt> {
    const messageReference =
      delivery.replyTo === undefined
        ? undefined
        : {
            channel_id: delivery.replyTo.channelId,
            fail_if_not_exists:
              delivery.replyTo.failIfNotExists ?? false,
            guild_id: delivery.replyTo.guildId,
            message_id: delivery.replyTo.messageId,
            type: 0,
          };
    const payload: Record<string, unknown> = {
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
      content: delivery.text,
      enforce_nonce: true,
      message_reference: messageReference,
      nonce: delivery.nonce,
    };
    let body: BodyInit;
    let headers: Readonly<Record<string, string>> | undefined;
    if (delivery.attachments.length === 0) {
      body = JSON.stringify(payload);
      headers = { "Content-Type": "application/json" };
    } else {
      payload.attachments = delivery.attachments.map(
        (attachment, index) => ({
          description: attachment.description,
          filename: attachment.fileName,
          id: index,
        }),
      );
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      delivery.attachments.forEach((attachment, index) => {
        form.append(
          `files[${index}]`,
          new Blob(
            [copyArrayBuffer(attachment.bytes)],
            {
              type:
                attachment.contentType ??
                "application/octet-stream",
            },
          ),
          attachment.fileName,
        );
      });
      body = form;
    }
    const value = await this.#request({
      body,
      effectOnFailure: "unknown",
      headers,
      method: "POST",
      path:
        `/channels/${encodeURIComponent(
          delivery.channelId,
        )}/messages`,
      routeKey: `POST /channels/${delivery.channelId}/messages`,
      signal: options.signal,
    });
    const response = asRecord(
      value,
      "Discord Create Message response",
    );
    const messageId = requiredString(
      response.id,
      "Discord message id",
    );
    if (!/^[0-9]{1,20}$/u.test(messageId)) {
      throw new DiscordTransportError(
        "protocol",
        "Discord message id is not a snowflake",
        { effect: "unknown" },
      );
    }
    const channelId = requiredString(
      response.channel_id,
      "Discord response channel id",
    );
    if (channelId !== delivery.channelId) {
      throw new DiscordTransportError(
        "protocol",
        "Discord response channel does not match the request",
        { effect: "unknown" },
      );
    }
    return Object.freeze({
      channelId,
      messageId,
      nonce: delivery.nonce,
      outcome: "accepted",
    });
  }

  async #request(options: RequestOptions): Promise<unknown> {
    if (this.#closedController.signal.aborted) {
      throw new DiscordTransportError(
        "aborted",
        "Discord client is closed",
      );
    }
    if (options.signal?.aborted === true) {
      throw new DiscordTransportError(
        "aborted",
        "Discord request was aborted",
      );
    }
    const now = this.#now();
    const blockedUntil = Math.max(
      this.#globalBlockedUntil,
      this.#routeBlockedUntil.get(options.routeKey) ?? 0,
    );
    if (blockedUntil > now) {
      throw new DiscordTransportError(
        "rate-limited",
        "Discord request is locally rate limited",
        {
          retryAfterMs: Math.ceil(blockedUntil - now),
          retryable: true,
        },
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () =>
      controller.abort(options.signal?.reason);
    const abortFromClose = () =>
      controller.abort(this.#closedController.signal.reason);
    options.signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
    this.#closedController.signal.addEventListener(
      "abort",
      abortFromClose,
      { once: true },
    );
    const timeout = this.#timers.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#requestTimeoutMs);
    let response: Response;
    let body: unknown;
    try {
      try {
        response = await this.#fetch(
          `${DISCORD_API_BASE_URL}${options.path}`,
          {
            body: options.body,
            headers: {
              Authorization: `Bot ${this.#token}`,
              "User-Agent": this.#userAgent,
              ...options.headers,
            },
            method: options.method,
            redirect: "error",
            signal: controller.signal,
          },
        );
      } catch {
        throw requestFailure({
          aborted:
            controller.signal.aborted ||
            isAborted(options.signal) ||
            this.#closedController.signal.aborted,
          effect: options.effectOnFailure,
          timedOut,
        });
      }
      try {
        body = await readLimitedJson(response);
      } catch (error) {
        if (!response.ok) {
          body = undefined;
        } else if (
          timedOut ||
          controller.signal.aborted ||
          isAborted(options.signal) ||
          this.#closedController.signal.aborted
        ) {
          throw requestFailure({
            aborted: !timedOut,
            effect: options.effectOnFailure,
            timedOut,
          });
        } else if (error instanceof DiscordTransportError) {
          throw new DiscordTransportError(
            error.code,
            error.message,
            {
              effect: options.effectOnFailure,
            },
          );
        } else {
          throw requestFailure({
            aborted: false,
            effect: options.effectOnFailure,
            timedOut: false,
          });
        }
      }
    } finally {
      this.#timers.clearTimeout(timeout);
      options.signal?.removeEventListener(
        "abort",
        abortFromCaller,
      );
      this.#closedController.signal.removeEventListener(
        "abort",
        abortFromClose,
      );
    }

    this.#recordRateLimit(options.routeKey, response);
    if (response.ok) return body;

    const remote =
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body)
        ? (body as UnknownRecord)
        : undefined;
    const remoteCode = optionalRemoteCode(remote?.code);
    if (response.status === 429) {
      const retryAfterMs =
        responseRetryAfterMs(response, body) ?? 1_000;
      const isGlobal =
        response.headers.get("x-ratelimit-global") === "true" ||
        remote?.global === true;
      const blockedUntil = this.#now() + retryAfterMs;
      if (isGlobal) {
        this.#globalBlockedUntil = Math.max(
          this.#globalBlockedUntil,
          blockedUntil,
        );
      } else {
        this.#routeBlockedUntil.set(
          options.routeKey,
          blockedUntil,
        );
      }
      throw new DiscordTransportError(
        "rate-limited",
        "Discord request was rate limited",
        {
          remoteCode,
          retryAfterMs,
          retryable: true,
          status: response.status,
        },
      );
    }
    if (response.status === 401) {
      throw new DiscordTransportError(
        "credential-invalid",
        "Discord rejected the bot credential",
        {
          remoteCode,
          status: response.status,
          terminal: "credential-invalid",
        },
      );
    }
    if (response.status === 403) {
      throw new DiscordTransportError(
        "forbidden",
        "Discord denied the requested operation",
        { remoteCode, status: response.status },
      );
    }
    if (response.status === 404) {
      throw new DiscordTransportError(
        "not-found",
        "Discord resource was not found",
        { remoteCode, status: response.status },
      );
    }
    if (response.status >= 500) {
      const effect = options.effectOnFailure;
      throw new DiscordTransportError(
        "server",
        "Discord server failed the request",
        {
          effect,
          remoteCode,
          retryable: effect === "none",
          status: response.status,
        },
      );
    }
    throw new DiscordTransportError(
      "http",
      "Discord rejected the request",
      {
        remoteCode,
        status: response.status,
      },
    );
  }

  #recordRateLimit(
    routeKey: string,
    response: Response,
  ): void {
    if (
      response.headers.get("x-ratelimit-remaining") !== "0"
    ) {
      return;
    }
    const resetAfterMs = secondsToMilliseconds(
      response.headers.get("x-ratelimit-reset-after"),
    );
    if (resetAfterMs === undefined) return;
    this.#routeBlockedUntil.set(
      routeKey,
      this.#now() + resetAfterMs,
    );
  }
}

export async function validateDiscordBotToken(
  options: ValidateDiscordBotTokenOptions,
): Promise<DiscordBotIdentity> {
  const client = new DiscordRestClient(options);
  try {
    return await client.validateBot(options.signal);
  } finally {
    client.close();
  }
}
