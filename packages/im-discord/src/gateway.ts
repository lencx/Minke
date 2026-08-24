import type {
  GatewayAccount,
  GatewayDeliveryAttempt,
  GatewayDeliveryPreparation,
  GatewayInboundBatch,
  GatewayInboundEvent,
} from "@lencx/minke-im-gateway";
import {
  DISCORD_DEFAULT_GATEWAY_HELLO_TIMEOUT_MS,
  DISCORD_DEFAULT_GATEWAY_INITIAL_READY_TIMEOUT_MS,
  DISCORD_DEFAULT_GATEWAY_OPEN_TIMEOUT_MS,
  DISCORD_DEFAULT_GATEWAY_READY_TIMEOUT_MS,
  DISCORD_DEFAULT_INTENTS,
  DISCORD_DEFAULT_MAX_PENDING_MESSAGES,
  DISCORD_GATEWAY_VERSION,
  DISCORD_MAX_DELIVERY_MESSAGES,
  DiscordTransportError,
  type DiscordBotIdentity,
  type DiscordConnectionState,
  type DiscordGatewayProvider,
  type DiscordProviderOptions,
  type DiscordProviderStatus,
  type DiscordPreparedDelivery,
  type DiscordTimerPort,
  type DiscordWebSocketCloseEvent,
  type DiscordWebSocketFactory,
  type DiscordWebSocketLike,
  type DiscordWebSocketMessageEvent,
  type DiscordWebSocketOpenEvent,
} from "./contract.ts";
import {
  deliverDiscordAttempt,
  discordNonceForOperation,
  prepareDiscordDelivery,
} from "./delivery.ts";
import {
  normalizeDiscordChannelMetadata,
  normalizeDiscordMessage,
  type DiscordChannelMetadata,
} from "./normalize.ts";
import {
  DiscordRestClient,
  normalizeDiscordBotIdentity,
} from "./rest.ts";

const MAX_GATEWAY_PAYLOAD_BYTES = 16 * 1024 * 1024;
const SOCKET_OPEN = 1;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface GatewayPayload {
  readonly d: unknown;
  readonly op: number;
  readonly s: number | null;
  readonly t?: string;
}

interface QueuedMessage {
  readonly checkpoint: string;
  readonly event: GatewayInboundEvent;
}

interface ReceiveWaiter {
  readonly checkpoint: string | null;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (batch: GatewayInboundBatch) => void;
  readonly signal?: AbortSignal;
  readonly abort: () => void;
}

interface ReconnectPlan {
  readonly delayMs?: number;
  readonly resume: boolean;
}

interface Connection {
  helloReceived: boolean;
  opened: boolean;
  startupDeadline?: unknown;
  startupPhase?: "hello" | "open" | "ready";
  readonly resume: boolean;
  readonly socket: DiscordWebSocketLike;
  readonly onClose: (
    event: DiscordWebSocketCloseEvent,
  ) => void;
  readonly onError: () => void;
  readonly onMessage: (
    event: DiscordWebSocketMessageEvent,
  ) => void;
  readonly onOpen: (
    event: DiscordWebSocketOpenEvent,
  ) => void;
}

type UnknownRecord = Record<string, unknown>;

const defaultTimers: DiscordTimerPort = Object.freeze({
  clearTimeout: (handle: unknown) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout: (callback: () => void, delayMs: number) =>
    setTimeout(callback, delayMs),
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

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

function nonEmptyString(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new DiscordTransportError(
      "invalid-config",
      `${label} must not be empty`,
    );
  }
  return value;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function record(
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

function gatewayInteger(
  value: unknown,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new DiscordTransportError(
      "protocol",
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function gatewayString(
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

function gatewayCheckpoint(
  sessionId: string,
  sequence: number,
): string {
  return JSON.stringify([
    "discord-gateway-v1",
    sessionId,
    sequence,
  ]);
}

function validGatewayCheckpoint(value: string): boolean {
  if (value.length > 4_096) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed[0] === "discord-gateway-v1" &&
      typeof parsed[1] === "string" &&
      parsed[1].length > 0 &&
      parsed[1].length <= 1_024 &&
      typeof parsed[2] === "number" &&
      Number.isSafeInteger(parsed[2]) &&
      parsed[2] >= 0
    );
  } catch {
    return false;
  }
}

function trustedGatewayUrl(raw: unknown): string {
  const value = gatewayString(raw, "Gateway resume URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DiscordTransportError(
      "untrusted-url",
      "Discord returned an invalid resume Gateway URL",
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
      "Discord returned an untrusted resume Gateway URL",
    );
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

function gatewayConnectionUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("v", String(DISCORD_GATEWAY_VERSION));
  url.searchParams.set("encoding", "json");
  return url.href;
}

function defaultWebSocketFactory(
  url: string,
): DiscordWebSocketLike {
  if (typeof globalThis.WebSocket !== "function") {
    throw new DiscordTransportError(
      "invalid-config",
      "a WebSocket implementation is required",
    );
  }
  return new globalThis.WebSocket(
    url,
  ) as unknown as DiscordWebSocketLike;
}

function unrefTimer(handle: unknown): void {
  if (
    handle !== null &&
    typeof handle === "object" &&
    "unref" in handle &&
    typeof handle.unref === "function"
  ) {
    handle.unref();
  }
}

function gatewayText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ),
    );
  }
  throw new DiscordTransportError(
    "protocol",
    "Discord Gateway sent an unsupported frame type",
  );
}

function parseGatewayPayload(data: unknown): GatewayPayload {
  const text = gatewayText(data);
  if (
    new TextEncoder().encode(text).byteLength >
    MAX_GATEWAY_PAYLOAD_BYTES
  ) {
    throw new DiscordTransportError(
      "payload-too-large",
      "Discord Gateway payload exceeds the local limit",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DiscordTransportError(
      "protocol",
      "Discord Gateway sent malformed JSON",
    );
  }
  const input = record(value, "Gateway payload");
  const op = gatewayInteger(input.op, "Gateway opcode");
  const sequence =
    input.s === undefined || input.s === null
      ? null
      : gatewayInteger(input.s, "Gateway sequence");
  if (
    input.t !== undefined &&
    input.t !== null &&
    typeof input.t !== "string"
  ) {
    throw new DiscordTransportError(
      "protocol",
      "Gateway event name must be a string",
    );
  }
  return {
    d: input.d,
    op,
    s: sequence,
    t:
      input.t === null
        ? undefined
        : input.t as string | undefined,
  };
}

function fatalCloseError(code: number): DiscordTransportError {
  if (code === 4004) {
    return new DiscordTransportError(
      "credential-invalid",
      "Discord Gateway rejected the bot credential",
      {
        gatewayCloseCode: code,
        terminal: "credential-invalid",
      },
    );
  }
  if (code === 4013 || code === 4014) {
    return new DiscordTransportError(
      "invalid-intent",
      "Discord Gateway rejected the configured intents",
      { gatewayCloseCode: code },
    );
  }
  return new DiscordTransportError(
    "gateway-fatal",
    "Discord Gateway rejected the connection configuration",
    { gatewayCloseCode: code },
  );
}

function isFatalCloseCode(code: number): boolean {
  return (
    code === 4004 ||
    code === 4010 ||
    code === 4011 ||
    code === 4012 ||
    code === 4013 ||
    code === 4014
  );
}

function resetsSession(code: number): boolean {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 4007 ||
    code === 4009
  );
}

export function discordAccountKey(botId: string): string {
  if (!/^[0-9]{1,20}$/u.test(botId)) {
    throw new DiscordTransportError(
      "invalid-config",
      "Discord bot id must be a snowflake",
    );
  }
  return `discord:${botId}`;
}

export class DiscordGatewayProviderSession
  implements DiscordGatewayProvider {
  readonly account: GatewayAccount;
  readonly bot: DiscordBotIdentity;

  readonly #channels = new Map<
    string,
    DiscordChannelMetadata
  >();
  readonly #gatewayHelloTimeoutMs: number;
  readonly #gatewayInitialReadyTimeoutMs: number;
  readonly #gatewayOpenTimeoutMs: number;
  readonly #gatewayReadyTimeoutMs: number;
  readonly #intents: number;
  readonly #maxPendingMessages: number;
  readonly #now: () => number;
  readonly #operationByNonce = new Map<string, string>();
  readonly #queue: QueuedMessage[] = [];
  readonly #random: () => number;
  readonly #reconnectBackoffMs?: (attempt: number) => number;
  readonly #rest: DiscordRestClient;
  readonly #timers: DiscordTimerPort;
  readonly #token: string;
  readonly #webSocketFactory: DiscordWebSocketFactory;

  #closed = false;
  #connection?: Connection;
  #fatal?: DiscordTransportError;
  #gatewayUrl?: string;
  #hasConnected = false;
  #heartbeatAwaitingAck = false;
  #heartbeatIntervalMs?: number;
  #heartbeatTimer?: unknown;
  #initialReadyDeadline?: unknown;
  #lastSequence: number | null = null;
  #pendingReconnect?: ReconnectPlan;
  #ready?: Deferred<void>;
  #receiveWaiter?: ReceiveWaiter;
  #reconnectAttempt = 0;
  #reconnectTimer?: unknown;
  #resumeGatewayUrl?: string;
  #sessionId?: string;
  #startPromise?: Promise<void>;
  #started = false;
  #state: DiscordConnectionState = "idle";

  constructor(input: {
    readonly bot: DiscordBotIdentity;
    readonly options: DiscordProviderOptions;
    readonly rest: DiscordRestClient;
  }) {
    this.bot = Object.freeze({ ...input.bot });
    this.#rest = input.rest;
    this.#token = input.options.token;
    this.#intents =
      input.options.intents ?? DISCORD_DEFAULT_INTENTS;
    if (
      !Number.isSafeInteger(this.#intents) ||
      this.#intents < 0
    ) {
      throw new DiscordTransportError(
        "invalid-config",
        "intents must be a non-negative safe integer",
      );
    }
    this.#maxPendingMessages = positiveInteger(
      input.options.maxPendingMessages,
      DISCORD_DEFAULT_MAX_PENDING_MESSAGES,
      "maxPendingMessages",
    );
    this.#gatewayOpenTimeoutMs = positiveInteger(
      input.options.gatewayOpenTimeoutMs,
      DISCORD_DEFAULT_GATEWAY_OPEN_TIMEOUT_MS,
      "gatewayOpenTimeoutMs",
    );
    this.#gatewayHelloTimeoutMs = positiveInteger(
      input.options.gatewayHelloTimeoutMs,
      DISCORD_DEFAULT_GATEWAY_HELLO_TIMEOUT_MS,
      "gatewayHelloTimeoutMs",
    );
    this.#gatewayInitialReadyTimeoutMs = positiveInteger(
      input.options.gatewayInitialReadyTimeoutMs,
      DISCORD_DEFAULT_GATEWAY_INITIAL_READY_TIMEOUT_MS,
      "gatewayInitialReadyTimeoutMs",
    );
    this.#gatewayReadyTimeoutMs = positiveInteger(
      input.options.gatewayReadyTimeoutMs,
      DISCORD_DEFAULT_GATEWAY_READY_TIMEOUT_MS,
      "gatewayReadyTimeoutMs",
    );
    this.#now = input.options.now ?? Date.now;
    this.#random = input.options.random ?? Math.random;
    this.#reconnectBackoffMs =
      input.options.reconnectBackoffMs;
    this.#timers = input.options.timers ?? defaultTimers;
    this.#webSocketFactory =
      input.options.webSocketFactory ??
      defaultWebSocketFactory;
    const generation = positiveInteger(
      input.options.generation,
      1,
      "generation",
    );
    const accountKey = nonEmptyString(
      input.options.accountKey,
      "accountKey",
    );
    const expectedAccountKey = discordAccountKey(this.bot.id);
    if (accountKey !== expectedAccountKey) {
      throw new DiscordTransportError(
        "invalid-config",
        "Discord accountKey must be derived from the bot id",
      );
    }
    this.account = Object.freeze({
      accountKey,
      generation,
      provider: "discord",
      providerAccountId: this.bot.id,
      requiresDeliveryContext: false,
    });
  }

  getStatus(): DiscordProviderStatus {
    return Object.freeze({
      botId: this.bot.id,
      lastSequence: this.#lastSequence,
      resumable: this.#canResume(),
      state: this.#state,
    });
  }

  async start(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    this.#throwIfUnavailable();
    if (this.#hasConnected && this.#started) return;
    if (this.#startPromise !== undefined) {
      return await this.#awaitStartWithSignal(
        this.#startPromise,
        options.signal,
      );
    }
    this.#started = true;
    this.#state = "connecting";
    const startPromise = this.#start(options.signal);
    this.#startPromise = startPromise;
    try {
      await startPromise;
    } catch (error) {
      if (!this.#hasConnected && !this.#closed) {
        this.#started = false;
        if (this.#fatal === undefined) this.#state = "idle";
        this.#startPromise = undefined;
      }
      throw error;
    }
  }

  async receive(
    checkpoint: string | null,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<GatewayInboundBatch> {
    if (this.#closed) this.#throwIfUnavailable();
    if (
      checkpoint !== null &&
      !validGatewayCheckpoint(checkpoint)
    ) {
      throw new DiscordTransportError(
        "invalid-state",
        "Discord checkpoint is invalid",
      );
    }
    if (options.signal?.aborted === true) {
      throw new DiscordTransportError(
        "aborted",
        "Discord receive was aborted",
      );
    }
    this.#acknowledgeCheckpoint(checkpoint);
    const next = this.#queue[0];
    if (next !== undefined) {
      return this.#batch(checkpoint, next);
    }
    this.#throwIfUnavailable();
    if (!this.#started || !this.#hasConnected) {
      throw new DiscordTransportError(
        "invalid-state",
        "Discord provider must be started before receive",
      );
    }
    if (this.#receiveWaiter !== undefined) {
      throw new DiscordTransportError(
        "invalid-state",
        "only one Discord receive may be active",
      );
    }
    const pending = deferred<GatewayInboundBatch>();
    const abort = () => {
      if (this.#receiveWaiter?.abort !== abort) return;
      this.#receiveWaiter = undefined;
      pending.reject(
        new DiscordTransportError(
          "aborted",
          "Discord receive was aborted",
        ),
      );
    };
    this.#receiveWaiter = {
      abort,
      checkpoint,
      reject: pending.reject,
      resolve: pending.resolve,
      signal: options.signal,
    };
    options.signal?.addEventListener("abort", abort, {
      once: true,
    });
    return await pending.promise;
  }

  async prepare(
    delivery: GatewayDeliveryPreparation,
    options: { readonly signal?: AbortSignal } = {},
  ) {
    const outcome = await prepareDiscordDelivery(
      delivery,
      options,
    );
    if (outcome.status === "ready") {
      const prepared =
        outcome.preparedPayload as DiscordPreparedDelivery;
      this.#rememberOperation(
        delivery.operationId,
        prepared.messages.length,
      );
    }
    return outcome;
  }

  async deliver(
    attempt: GatewayDeliveryAttempt,
    options: { readonly signal?: AbortSignal } = {},
  ) {
    try {
      this.#rememberOperation(
        attempt.operationId,
        DISCORD_MAX_DELIVERY_MESSAGES,
      );
    } catch {
      return {
        errorCode: "invalid-intent",
        status: "rejected" as const,
      };
    }
    return await deliverDiscordAttempt(
      this.#rest,
      attempt,
      options,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#started = false;
    this.#state = "closed";
    this.#clearHeartbeat();
    this.#clearReconnect();
    this.#clearInitialReadyDeadline();
    this.#rest.close();
    this.#channels.clear();
    this.#operationByNonce.clear();
    this.#queue.length = 0;
    this.#clearSession();
    const error = new DiscordTransportError(
      "gateway-closed",
      "Discord provider is closed",
    );
    this.#ready?.reject(error);
    this.#ready = undefined;
    this.#rejectReceive(error);
    const connection = this.#connection;
    if (connection !== undefined) {
      this.#detach(connection);
      this.#connection = undefined;
      try {
        connection.socket.close(1000, "Client closed");
      } catch {
        // The provider is already closed; socket errors are irrelevant.
      }
    }
  }

  async #start(signal?: AbortSignal): Promise<void> {
    if (isAborted(signal)) {
      this.#started = false;
      throw new DiscordTransportError(
        "aborted",
        "Discord start was aborted",
      );
    }
    const gateway = await this.#rest.getGatewayBot(signal);
    if (isAborted(signal)) {
      this.#started = false;
      throw new DiscordTransportError(
        "aborted",
        "Discord start was aborted",
      );
    }
    this.#gatewayUrl = gateway.url;
    const ready = deferred<void>();
    this.#ready = ready;
    const abort = () => {
      if (this.#ready !== ready || this.#hasConnected) return;
      const error = new DiscordTransportError(
        "aborted",
        "Discord start was aborted",
      );
      this.#ready = undefined;
      this.#started = false;
      this.#state = "idle";
      this.#clearHeartbeat();
      this.#clearReconnect();
      this.#clearInitialReadyDeadline();
      const connection = this.#connection;
      if (connection !== undefined) {
        this.#detach(connection);
        this.#connection = undefined;
        try {
          connection.socket.close(1000, "Start aborted");
        } catch {
          // The start promise is already being rejected.
        }
      }
      ready.reject(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      this.#openConnection(false);
      await ready.promise;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.#ready === ready) this.#ready = undefined;
    }
  }

  async #awaitStartWithSignal(
    promise: Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal === undefined) return await promise;
    if (signal.aborted) {
      throw new DiscordTransportError(
        "aborted",
        "Discord start wait was aborted",
      );
    }
    const aborted = deferred<void>();
    const abort = () =>
      aborted.reject(
        new DiscordTransportError(
          "aborted",
          "Discord start wait was aborted",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([promise, aborted.promise]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  #openConnection(resume: boolean): void {
    if (!this.#started || this.#closed || this.#fatal !== undefined) {
      return;
    }
    const shouldResume = resume && this.#canResume();
    const baseUrl = shouldResume
      ? this.#resumeGatewayUrl
      : this.#gatewayUrl;
    if (baseUrl === undefined) {
      this.#fail(
        new DiscordTransportError(
          "invalid-state",
          "Discord Gateway URL is unavailable",
        ),
      );
      return;
    }
    this.#state = this.#hasConnected
      ? "reconnecting"
      : "connecting";
    let socket: DiscordWebSocketLike;
    try {
      socket = this.#webSocketFactory(
        gatewayConnectionUrl(baseUrl),
      );
    } catch (error) {
      if (
        error instanceof DiscordTransportError &&
        error.code === "invalid-config"
      ) {
        this.#fail(error);
        return;
      }
      this.#scheduleReconnect(shouldResume);
      return;
    }
    const connection: Connection = {
      helloReceived: false,
      opened: false,
      onClose: (event) =>
        this.#onClose(connection, event),
      onError: () => this.#onError(connection),
      onMessage: (event) =>
        this.#onMessage(connection, event),
      onOpen: (event) =>
        this.#onOpen(connection, event),
      resume: shouldResume,
      socket,
    };
    this.#connection = connection;
    try {
      socket.addEventListener("open", connection.onOpen);
      socket.addEventListener("close", connection.onClose);
      socket.addEventListener("error", connection.onError);
      socket.addEventListener(
        "message",
        connection.onMessage,
      );
    } catch {
      this.#fail(
        new DiscordTransportError(
          "invalid-config",
          "Discord WebSocket implementation is incompatible",
        ),
      );
      return;
    }
    this.#armStartupDeadline(
      connection,
      "open",
      this.#gatewayOpenTimeoutMs,
    );
    if (socket.readyState === SOCKET_OPEN) {
      this.#onOpen(connection, {});
    }
  }

  #onOpen(
    connection: Connection,
    _event: DiscordWebSocketOpenEvent,
  ): void {
    if (this.#connection !== connection || connection.opened) {
      return;
    }
    if (connection.socket.readyState !== SOCKET_OPEN) {
      this.#fail(
        new DiscordTransportError(
          "protocol",
          "Discord WebSocket emitted open before entering the open state",
        ),
      );
      return;
    }
    connection.opened = true;
    this.#armStartupDeadline(
      connection,
      "hello",
      this.#gatewayHelloTimeoutMs,
    );
  }

  #onMessage(
    connection: Connection,
    event: DiscordWebSocketMessageEvent,
  ): void {
    if (this.#connection !== connection) return;
    try {
      if (
        !connection.opened &&
        connection.socket.readyState === SOCKET_OPEN
      ) {
        this.#onOpen(connection, {});
      }
      if (!connection.opened) {
        throw new DiscordTransportError(
          "protocol",
          "Discord Gateway sent a frame before the socket opened",
        );
      }
      const payload = parseGatewayPayload(event.data);
      this.#handlePayload(connection, payload);
    } catch (error) {
      this.#fail(
        error instanceof DiscordTransportError
          ? error
          : new DiscordTransportError(
              "protocol",
              "Discord Gateway payload processing failed",
            ),
      );
    }
  }

  #handlePayload(
    connection: Connection,
    payload: GatewayPayload,
  ): void {
    if (payload.s !== null) this.#lastSequence = payload.s;
    switch (payload.op) {
      case 0:
        this.#handleDispatch(payload);
        return;
      case 1:
        this.#sendHeartbeat(connection);
        return;
      case 7:
        this.#requestReconnect({
          delayMs: 0,
          resume: true,
        });
        return;
      case 9: {
        if (typeof payload.d !== "boolean") {
          throw new DiscordTransportError(
            "protocol",
            "Invalid Session payload must be boolean",
          );
        }
        if (!payload.d) this.#clearSession();
        this.#requestReconnect({
          delayMs: this.#invalidSessionDelay(),
          resume: payload.d,
        });
        return;
      }
      case 10:
        this.#handleHello(connection, payload.d);
        return;
      case 11:
        this.#heartbeatAwaitingAck = false;
        return;
      default:
        return;
    }
  }

  #handleHello(
    connection: Connection,
    value: unknown,
  ): void {
    if (connection.helloReceived) {
      throw new DiscordTransportError(
        "protocol",
        "Discord Gateway sent more than one Hello",
      );
    }
    connection.helloReceived = true;
    const input = record(value, "Gateway Hello");
    const interval = gatewayInteger(
      input.heartbeat_interval,
      "Gateway heartbeat interval",
    );
    if (interval <= 0) {
      throw new DiscordTransportError(
        "protocol",
        "Gateway heartbeat interval must be positive",
      );
    }
    this.#armStartupDeadline(
      connection,
      "ready",
      this.#gatewayReadyTimeoutMs,
    );
    this.#heartbeatIntervalMs = interval;
    this.#heartbeatAwaitingAck = false;
    this.#scheduleHeartbeat(
      connection,
      Math.floor(interval * this.#randomUnit()),
    );
    if (connection.resume && this.#canResume()) {
      this.#send(connection, {
        d: {
          seq: this.#lastSequence,
          session_id: this.#sessionId,
          token: this.#token,
        },
        op: 6,
      });
    } else {
      this.#send(connection, {
        d: {
          intents: this.#intents,
          properties: {
            browser: "minke-im-discord",
            device: "minke-im-discord",
            os:
              typeof process === "object"
                ? process.platform
                : "unknown",
          },
          token: this.#token,
        },
        op: 2,
      });
    }
  }

  #handleDispatch(payload: GatewayPayload): void {
    if (payload.s === null || payload.t === undefined) {
      throw new DiscordTransportError(
        "protocol",
        "Discord dispatch is missing sequence or event name",
      );
    }
    const event = payload.t;
    if (event === "READY") {
      const ready = record(payload.d, "Gateway Ready");
      const user = record(ready.user, "Gateway Ready user");
      const botId = gatewayString(
        user.id,
        "Gateway Ready bot id",
      );
      if (botId !== this.bot.id) {
        throw new DiscordTransportError(
          "credential-invalid",
          "Discord Gateway identity differs from REST validation",
          { terminal: "credential-invalid" },
        );
      }
      this.#sessionId = gatewayString(
        ready.session_id,
        "Gateway session id",
      );
      this.#resumeGatewayUrl = trustedGatewayUrl(
        ready.resume_gateway_url,
      );
      this.#markConnected();
      return;
    }
    if (event === "RESUMED") {
      if (!this.#canResume()) {
        throw new DiscordTransportError(
          "protocol",
          "Discord resumed without local session state",
        );
      }
      this.#markConnected();
      return;
    }
    if (event === "GUILD_CREATE") {
      const guild = record(payload.d, "Guild Create");
      this.#cacheChannels(guild.channels);
      this.#cacheChannels(guild.threads);
      return;
    }
    if (event === "THREAD_LIST_SYNC") {
      const sync = record(payload.d, "Thread List Sync");
      this.#cacheChannels(sync.threads);
      return;
    }
    if (
      event === "CHANNEL_CREATE" ||
      event === "CHANNEL_UPDATE" ||
      event === "THREAD_CREATE" ||
      event === "THREAD_UPDATE"
    ) {
      const channel = normalizeDiscordChannelMetadata(
        payload.d,
      );
      this.#channels.set(channel.id, channel);
      return;
    }
    if (
      event === "CHANNEL_DELETE" ||
      event === "THREAD_DELETE"
    ) {
      const channel = normalizeDiscordChannelMetadata(
        payload.d,
      );
      this.#channels.delete(channel.id);
      return;
    }
    if (event !== "MESSAGE_CREATE") return;

    const raw = record(payload.d, "Message Create");
    const channelId = gatewayString(
      raw.channel_id,
      "Message channel id",
    );
    const message = normalizeDiscordMessage(payload.d, {
      channel: this.#channels.get(channelId),
    });
    const mappedOperationId =
      message.author.id === this.bot.id &&
      message.nonce !== undefined
        ? this.#operationByNonce.get(message.nonce)
        : undefined;
    if (
      mappedOperationId !== undefined &&
      message.nonce !== undefined
    ) {
      this.#operationByNonce.delete(message.nonce);
    }
    const inbound: GatewayInboundEvent = Object.freeze({
      conversationId: message.channelId,
      correlationId: mappedOperationId ?? message.nonce,
      kind:
        message.author.id === this.bot.id
          ? "bot-echo"
          : message.author.bot
            ? "system"
            : "user-message",
      nativeId: message.id,
      occurredAt: message.timestamp,
      payload: message,
      peerId: message.channelId,
      senderId: message.author.id,
    });
    const sessionId = this.#sessionId;
    if (sessionId === undefined) {
      throw new DiscordTransportError(
        "protocol",
        "Discord message arrived without an active Gateway session",
      );
    }
    this.#enqueue({
      checkpoint: gatewayCheckpoint(sessionId, payload.s),
      event: inbound,
    });
  }

  #cacheChannels(value: unknown): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      throw new DiscordTransportError(
        "protocol",
        "Discord channel collection must be an array",
      );
    }
    for (const item of value) {
      const channel = normalizeDiscordChannelMetadata(item);
      this.#channels.set(channel.id, channel);
    }
  }

  #rememberOperation(
    operationId: string,
    messageCount: number,
  ): void {
    if (
      !Number.isSafeInteger(messageCount) ||
      messageCount <= 0 ||
      messageCount > DISCORD_MAX_DELIVERY_MESSAGES
    ) {
      throw new TypeError(
        "Discord prepared message count is invalid",
      );
    }
    for (
      let messageIndex = 0;
      messageIndex < messageCount;
      messageIndex += 1
    ) {
      const nonce = discordNonceForOperation(
        operationId,
        messageIndex,
      );
      this.#operationByNonce.delete(nonce);
      this.#operationByNonce.set(nonce, operationId);
    }
    while (this.#operationByNonce.size > 10_000) {
      const oldest =
        this.#operationByNonce.keys().next().value;
      if (oldest === undefined) break;
      this.#operationByNonce.delete(oldest);
    }
  }

  #markConnected(): void {
    const connection = this.#connection;
    if (connection !== undefined) {
      this.#clearStartupDeadline(connection);
    }
    this.#clearInitialReadyDeadline();
    this.#hasConnected = true;
    this.#state = "ready";
    this.#reconnectAttempt = 0;
    this.#ready?.resolve();
  }

  #enqueue(message: QueuedMessage): void {
    const waiter = this.#receiveWaiter;
    if (this.#queue.length >= this.#maxPendingMessages) {
      this.#fail(
        new DiscordTransportError(
          "inbound-overflow",
          "Discord inbound queue reached its pre-admission limit",
        ),
      );
      return;
    }
    this.#queue.push(message);
    if (waiter === undefined) return;
    this.#receiveWaiter = undefined;
    waiter.signal?.removeEventListener(
      "abort",
      waiter.abort,
    );
    waiter.resolve(this.#batch(waiter.checkpoint, message));
  }

  #acknowledgeCheckpoint(checkpoint: string | null): void {
    if (checkpoint === null) return;
    const head = this.#queue[0];
    if (head?.checkpoint === checkpoint) {
      this.#queue.shift();
    }
  }

  #batch(
    checkpoint: string | null,
    message: QueuedMessage,
  ): GatewayInboundBatch {
    return Object.freeze({
      accountKey: this.account.accountKey,
      events: Object.freeze([message.event]),
      fromCheckpoint: checkpoint,
      generation: this.account.generation,
      nextCheckpoint: message.checkpoint,
      observedAt: this.#now(),
    });
  }

  #send(
    connection: Connection,
    payload: unknown,
  ): void {
    if (
      this.#connection !== connection ||
      connection.socket.readyState !== SOCKET_OPEN
    ) {
      this.#requestReconnect({ resume: true });
      return;
    }
    const serialized = JSON.stringify(payload);
    if (
      new TextEncoder().encode(serialized).byteLength > 4_096
    ) {
      throw new DiscordTransportError(
        "invalid-config",
        "Discord Gateway command exceeds 4096 bytes",
      );
    }
    try {
      connection.socket.send(serialized);
    } catch {
      this.#requestReconnect({ resume: true });
    }
  }

  #sendHeartbeat(connection: Connection): void {
    this.#send(connection, {
      d: this.#lastSequence,
      op: 1,
    });
    this.#heartbeatAwaitingAck = true;
  }

  #armStartupDeadline(
    connection: Connection,
    phase: "hello" | "open" | "ready",
    delayMs: number,
  ): void {
    this.#clearStartupDeadline(connection);
    const timer = this.#timers.setTimeout(() => {
      if (
        this.#connection !== connection ||
        connection.startupDeadline !== timer ||
        connection.startupPhase !== phase
      ) {
        return;
      }
      connection.startupDeadline = undefined;
      connection.startupPhase = undefined;
      const label =
        phase === "open"
          ? "socket open"
          : phase === "hello"
            ? "Gateway Hello"
            : "Gateway Ready";
      this.#fail(
        new DiscordTransportError(
          "timeout",
          `Discord ${label} deadline expired`,
          { retryable: true },
        ),
      );
    }, delayMs);
    connection.startupDeadline = timer;
    connection.startupPhase = phase;
    unrefTimer(timer);
  }

  #clearStartupDeadline(connection: Connection): void {
    if (connection.startupDeadline !== undefined) {
      this.#timers.clearTimeout(connection.startupDeadline);
      connection.startupDeadline = undefined;
    }
    connection.startupPhase = undefined;
  }

  #scheduleHeartbeat(
    connection: Connection,
    delayMs: number,
  ): void {
    this.#clearHeartbeatTimer();
    const timer = this.#timers.setTimeout(() => {
      if (this.#connection !== connection) return;
      if (this.#heartbeatAwaitingAck) {
        this.#requestReconnect({
          delayMs: 0,
          resume: true,
        });
        return;
      }
      this.#sendHeartbeat(connection);
      const interval = this.#heartbeatIntervalMs;
      if (interval !== undefined) {
        this.#scheduleHeartbeat(connection, interval);
      }
    }, delayMs);
    this.#heartbeatTimer = timer;
    unrefTimer(timer);
  }

  #clearHeartbeat(): void {
    this.#clearHeartbeatTimer();
    this.#heartbeatIntervalMs = undefined;
    this.#heartbeatAwaitingAck = false;
  }

  #clearHeartbeatTimer(): void {
    if (this.#heartbeatTimer !== undefined) {
      this.#timers.clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
  }

  #onError(connection: Connection): void {
    if (this.#connection !== connection) return;
    this.#requestReconnect({ resume: true });
  }

  #requestReconnect(plan: ReconnectPlan): void {
    if (
      this.#closed ||
      !this.#started ||
      this.#fatal !== undefined
    ) {
      return;
    }
    this.#pendingReconnect = plan;
    this.#state = "reconnecting";
    this.#clearHeartbeat();
    const connection = this.#connection;
    if (connection === undefined) {
      this.#pendingReconnect = undefined;
      this.#scheduleReconnect(
        plan.resume,
        plan.delayMs,
      );
      return;
    }
    this.#clearStartupDeadline(connection);
    try {
      connection.socket.close(4000, "Reconnect");
    } catch {
      this.#detach(connection);
      if (this.#connection === connection) {
        this.#connection = undefined;
      }
      this.#pendingReconnect = undefined;
      this.#scheduleReconnect(
        plan.resume,
        plan.delayMs,
      );
    }
  }

  #onClose(
    connection: Connection,
    event: DiscordWebSocketCloseEvent,
  ): void {
    if (this.#connection !== connection) return;
    this.#detach(connection);
    this.#connection = undefined;
    this.#clearHeartbeat();
    if (this.#closed || !this.#started) return;
    const code =
      typeof event.code === "number" ? event.code : 1006;
    if (isFatalCloseCode(code)) {
      this.#pendingReconnect = undefined;
      this.#fail(fatalCloseError(code));
      return;
    }
    const requested = this.#pendingReconnect;
    this.#pendingReconnect = undefined;
    if (requested !== undefined) {
      this.#scheduleReconnect(
        requested.resume,
        requested.delayMs,
      );
      return;
    }
    if (resetsSession(code)) {
      this.#clearSession();
      this.#scheduleReconnect(false);
      return;
    }
    this.#scheduleReconnect(true);
  }

  #scheduleReconnect(
    resume: boolean,
    explicitDelayMs?: number,
  ): void {
    if (
      this.#closed ||
      !this.#started ||
      this.#fatal !== undefined ||
      this.#reconnectTimer !== undefined
    ) {
      return;
    }
    const shouldResume = resume && this.#canResume();
    this.#state = "reconnecting";
    if (!this.#hasConnected) {
      this.#armInitialReadyDeadline();
    }
    this.#reconnectAttempt += 1;
    let delayMs: number;
    try {
      delayMs =
        explicitDelayMs ??
        this.#backoffDelay(this.#reconnectAttempt);
    } catch (error) {
      this.#fail(
        error instanceof DiscordTransportError
          ? error
          : new DiscordTransportError(
              "invalid-config",
              "Discord reconnect policy failed",
            ),
      );
      return;
    }
    const timer = this.#timers.setTimeout(() => {
      if (this.#reconnectTimer !== timer) return;
      this.#reconnectTimer = undefined;
      this.#openConnection(shouldResume);
    }, delayMs);
    this.#reconnectTimer = timer;
    unrefTimer(timer);
  }

  #backoffDelay(attempt: number): number {
    const supplied = this.#reconnectBackoffMs?.(attempt);
    const value =
      supplied ??
      Math.floor(
        Math.min(
          30_000,
          1_000 * 2 ** Math.min(5, attempt - 1),
        ) *
          (0.5 + this.#randomUnit()),
      );
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 24 * 60 * 60_000
    ) {
      throw new DiscordTransportError(
        "invalid-config",
        "reconnect delay must be a non-negative safe integer",
      );
    }
    return value;
  }

  #invalidSessionDelay(): number {
    return 1_000 + Math.floor(this.#randomUnit() * 4_000);
  }

  #randomUnit(): number {
    const value = this.#random();
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1
    ) {
      throw new DiscordTransportError(
        "invalid-config",
        "random must return a value from 0 through less than 1",
      );
    }
    return value;
  }

  #clearReconnect(): void {
    if (this.#reconnectTimer !== undefined) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#pendingReconnect = undefined;
  }

  #armInitialReadyDeadline(): void {
    if (
      this.#hasConnected ||
      this.#initialReadyDeadline !== undefined
    ) {
      return;
    }
    const timer = this.#timers.setTimeout(() => {
      if (
        this.#initialReadyDeadline !== timer ||
        this.#hasConnected
      ) {
        return;
      }
      this.#initialReadyDeadline = undefined;
      this.#fail(
        new DiscordTransportError(
          "network",
          "Discord Gateway initial Ready deadline expired",
          { retryable: true },
        ),
      );
    }, this.#gatewayInitialReadyTimeoutMs);
    this.#initialReadyDeadline = timer;
    unrefTimer(timer);
  }

  #clearInitialReadyDeadline(): void {
    if (this.#initialReadyDeadline === undefined) return;
    this.#timers.clearTimeout(this.#initialReadyDeadline);
    this.#initialReadyDeadline = undefined;
  }

  #detach(connection: Connection): void {
    this.#clearStartupDeadline(connection);
    try {
      connection.socket.removeEventListener(
        "open",
        connection.onOpen,
      );
      connection.socket.removeEventListener(
        "close",
        connection.onClose,
      );
      connection.socket.removeEventListener(
        "error",
        connection.onError,
      );
      connection.socket.removeEventListener(
        "message",
        connection.onMessage,
      );
    } catch {
      // Listener cleanup is best effort after the connection is fenced.
    }
  }

  #clearSession(): void {
    this.#sessionId = undefined;
    this.#resumeGatewayUrl = undefined;
    this.#lastSequence = null;
  }

  #canResume(): boolean {
    return (
      this.#sessionId !== undefined &&
      this.#resumeGatewayUrl !== undefined &&
      this.#lastSequence !== null
    );
  }

  #fail(error: DiscordTransportError): void {
    if (this.#closed || this.#fatal !== undefined) return;
    this.#fatal = error;
    this.#state = "fatal";
    this.#started = false;
    this.#channels.clear();
    this.#operationByNonce.clear();
    this.#clearSession();
    this.#clearHeartbeat();
    this.#clearReconnect();
    this.#clearInitialReadyDeadline();
    this.#ready?.reject(error);
    this.#ready = undefined;
    this.#rejectReceive(error);
    const connection = this.#connection;
    if (connection !== undefined) {
      this.#detach(connection);
      this.#connection = undefined;
      try {
        connection.socket.close(1000, "Fatal");
      } catch {
        // The classified fatal error is authoritative.
      }
    }
  }

  #rejectReceive(error: DiscordTransportError): void {
    const waiter = this.#receiveWaiter;
    if (waiter === undefined) return;
    this.#receiveWaiter = undefined;
    waiter.signal?.removeEventListener(
      "abort",
      waiter.abort,
    );
    waiter.reject(error);
  }

  #throwIfUnavailable(): void {
    if (this.#fatal !== undefined) throw this.#fatal;
    if (this.#closed) {
      throw new DiscordTransportError(
        "gateway-closed",
        "Discord provider is closed",
      );
    }
  }
}

export async function createDiscordGatewayProvider(
  options: DiscordProviderOptions,
): Promise<DiscordGatewayProvider> {
  const rest = new DiscordRestClient(options);
  try {
    if (options.signal?.aborted === true) {
      throw new DiscordTransportError(
        "aborted",
        "Discord provider creation was aborted",
      );
    }
    const bot =
      options.bot === undefined
        ? await rest.validateBot(options.signal)
        : normalizeDiscordBotIdentity(options.bot);
    return new DiscordGatewayProviderSession({
      bot,
      options,
      rest,
    });
  } catch (error) {
    rest.close();
    throw error;
  }
}
