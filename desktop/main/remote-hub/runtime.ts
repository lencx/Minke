import { join } from "node:path";
import {
  createDiscordGatewayProvider,
  DiscordTransportError,
  type DiscordBotIdentity,
  type DiscordGatewayProvider,
  validateDiscordBotToken,
} from "@lencx/minke-im-discord";
import {
  createTelegramGatewayProvider,
  createTelegramTransport,
  TelegramTransportError,
  type TelegramBotIdentity,
  type TelegramInboundMessage,
  validateTelegramBotToken,
} from "@lencx/minke-im-telegram";
import {
  DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  type BotHubSnapshot,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
  type TelegramNetworkSettings,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  BotCapabilityRuntime,
  type BotAgentRoutePort,
  type BotDirectMessage,
  type BotDirectMessageInput,
  type BotProviderDriver,
} from "./bot-runtime.ts";
import {
  WeixinCapabilityRuntime,
  type WeixinAgentRoutePort,
} from "./weixin-runtime.ts";
import type {
  RemoteHubCredentialVault,
} from "./credential-vault.ts";
import {
  createGatewayMailboxRecovery,
  type GatewayMailboxRecovery,
} from "./mailbox-recovery.ts";

interface WeixinRuntimePort {
  dispatch(value: unknown): Promise<RemoteHubSnapshot>;
  dispose(): Promise<void>;
  getSnapshot(): RemoteHubSnapshot;
  initialize(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

interface BotRuntimePort {
  approvePairing(requestId: string): Promise<void>;
  connect(token: string): Promise<void>;
  dismissPairing(requestId: string): Promise<void>;
  dispose(): Promise<void>;
  getSnapshot(): BotHubSnapshot;
  initialize(): Promise<void>;
  reconnect(): Promise<void>;
  resetLocal(): Promise<void>;
  stopForGatewayReset(): Promise<void>;
  unlink(): Promise<void>;
}

interface TelegramNetworkRuntimePort {
  configure(value: unknown): Promise<void>;
  getSnapshot(): TelegramNetworkSettings;
  initialize(): Promise<void>;
}

interface QueuedRemoteHubCommand {
  readonly exclusive: boolean;
  readonly reject: (error: unknown) => void;
  readonly resolve: (snapshot: RemoteHubSnapshot) => void;
  readonly run: () => Promise<RemoteHubSnapshot>;
}

class RemoteHubCommandBarrier {
  readonly #queue: QueuedRemoteHubCommand[] = [];
  #activeShared = 0;
  #exclusiveActive = false;

  run(
    exclusive: boolean,
    operation: () => Promise<RemoteHubSnapshot>,
  ): Promise<RemoteHubSnapshot> {
    return new Promise<RemoteHubSnapshot>((resolve, reject) => {
      this.#queue.push({
        exclusive,
        reject,
        resolve,
        run: operation,
      });
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#exclusiveActive) return;
    const first = this.#queue[0];
    if (first === undefined) return;
    if (first.exclusive) {
      if (this.#activeShared !== 0) return;
      this.#queue.shift();
      this.#exclusiveActive = true;
      void this.#execute(first, () => {
        this.#exclusiveActive = false;
        this.#drain();
      });
      return;
    }
    while (this.#queue[0]?.exclusive === false) {
      const next = this.#queue.shift();
      if (next === undefined) break;
      this.#activeShared += 1;
      void this.#execute(next, () => {
        this.#activeShared -= 1;
        this.#drain();
      });
    }
  }

  async #execute(
    command: QueuedRemoteHubCommand,
    release: () => void,
  ): Promise<void> {
    try {
      command.resolve(await command.run());
    } catch (error) {
      command.reject(error);
    } finally {
      release();
    }
  }
}

export interface RemoteHubCapabilityRuntimeOptions {
  readonly dataHome: string;
  readonly vault: RemoteHubCredentialVault;
  readonly agentRoute?:
    WeixinAgentRoutePort & BotAgentRoutePort;
  readonly telegramFetch?: typeof globalThis.fetch;
  readonly weixin?: WeixinRuntimePort;
  readonly telegram?: BotRuntimePort;
  readonly telegramNetwork?: TelegramNetworkRuntimePort;
  readonly discord?: BotRuntimePort;
  readonly recoverMailbox?: GatewayMailboxRecovery;
}

export interface TelegramBotDriverOptions {
  readonly fetch?: typeof globalThis.fetch;
}

const NETWORK_ERROR_CODES = new Set([
  "http",
  "network",
  "rate-limited",
  "server",
  "timeout",
]);

function isAbortError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (
      error instanceof Error &&
      error.name === "AbortError"
    )
  );
}

function record(
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function telegramSenderLabel(
  sender: Record<string, unknown>,
): string {
  const username =
    typeof sender.username === "string"
      ? sender.username.trim()
      : "";
  const firstName =
    typeof sender.firstName === "string"
      ? sender.firstName.trim()
      : "";
  const lastName =
    typeof sender.lastName === "string"
      ? sender.lastName.trim()
      : "";
  const source = username === ""
    ? [firstName, lastName].filter(Boolean).join(" ")
    : `@${username}`;
  const normalized = source
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return [...(normalized || "Telegram user")]
    .slice(0, 128)
    .join("");
}

function inspectTelegramDirectMessage(
  input: BotDirectMessageInput,
): BotDirectMessage | undefined {
  if (input.kind !== "user-message") return undefined;
  const payload = record(input.payload);
  const chat = record(payload?.chat);
  const sender = record(payload?.sender);
  const content = record(payload?.content);
  if (
    payload === undefined ||
    chat === undefined ||
    sender === undefined ||
    content === undefined ||
    chat.type !== "private" ||
    chat.id !== input.peerId ||
    payload.peerId !== input.peerId ||
    payload.senderId !== input.senderId ||
    sender.id !== input.senderId ||
    sender.isBot !== false ||
    payload.conversationId !== input.conversationId ||
    payload.id !== input.nativeId ||
    payload.updateType !== "message"
  ) {
    return undefined;
  }
  const message = payload as unknown as TelegramInboundMessage;
  return {
    senderLabel: telegramSenderLabel(sender),
    ...(message.content.kind === "text" &&
    typeof message.content.text === "string"
      ? { text: message.content.text }
      : {}),
  };
}

export function createTelegramBotDriver(
  options: TelegramBotDriverOptions = {},
): BotProviderDriver<
  TelegramBotIdentity
> {
  const driver: BotProviderDriver<TelegramBotIdentity> = {
    provider: "telegram",
    agentReplyPayload(markdown) {
      return {
        kind: "rich-markdown",
        markdown,
      };
    },
    inspectDirectMessage: inspectTelegramDirectMessage,
    async validate(token, { signal }) {
      return await validateTelegramBotToken(
        {
          credential: { token },
          fetch: options.fetch,
        },
        { signal },
      );
    },
    identityId(identity) {
      return identity.id;
    },
    identityLabel(identity) {
      return identity.username === undefined
        ? identity.firstName
        : `@${identity.username}`;
    },
    isAborted(error, signal) {
      return (
        isAbortError(error, signal) ||
        (
          error instanceof TelegramTransportError &&
          error.code === "aborted"
        )
      );
    },
    issue(error, phase) {
      if (error instanceof TelegramTransportError) {
        if (
          error.code === "credential-invalid" ||
          (
            phase === "validate" &&
            error.code === "invalid-config"
          )
        ) {
          return "credential-invalid";
        }
        if (error.code === "conflict") {
          return "polling-conflict";
        }
        if (
          phase === "receive" &&
          error.effect === "unknown"
        ) {
          return "transport-fatal";
        }
        if (NETWORK_ERROR_CODES.has(error.code)) {
          return "network";
        }
        if (phase === "receive") {
          return "transport-fatal";
        }
      }
      return "transport-start";
    },
    async createProvider(input) {
      const transport = createTelegramTransport({
        clearWebhookBeforePolling: "on-receive",
        credential: { token: input.token },
        fetch: options.fetch,
      });
      try {
        const identity = await transport.getMe({
          signal: input.signal,
        });
        if (identity.id !== input.identity.id) {
          throw new TelegramTransportError(
            "credential-invalid",
            "Telegram bot identity changed during connection",
          );
        }
        return createTelegramGatewayProvider({
          accountKey: input.accountKey,
          generation: input.generation,
          transport,
        });
      } catch (error) {
        await transport.close().catch(() => {});
        throw error;
      }
    },
  };
  return Object.freeze(driver);
}

export function createDiscordBotDriver(): BotProviderDriver<
  DiscordBotIdentity
> {
  const driver: BotProviderDriver<DiscordBotIdentity> = {
    provider: "discord",
    candidateHealthIssue(provider) {
      const state = (
        provider as DiscordGatewayProvider
      ).getStatus().state;
      if (state === "ready") return undefined;
      return state === "fatal" || state === "closed"
        ? "transport-fatal"
        : "network";
    },
    async validate(token, { signal }) {
      return await validateDiscordBotToken({
        signal,
        token,
      });
    },
    identityId(identity) {
      return identity.id;
    },
    identityLabel(identity) {
      return identity.globalName === undefined
        ? `@${identity.username}`
        : `${identity.globalName} (@${identity.username})`;
    },
    isAborted(error, signal) {
      return (
        isAbortError(error, signal) ||
        (
          error instanceof DiscordTransportError &&
          error.code === "aborted"
        )
      );
    },
    issue(error, phase) {
      if (error instanceof DiscordTransportError) {
        if (
          error.code === "credential-invalid" ||
          (
            phase === "validate" &&
            error.code === "invalid-config"
          )
        ) {
          return "credential-invalid";
        }
        if (error.code === "invalid-intent") {
          return "privileged-intent";
        }
        if (NETWORK_ERROR_CODES.has(error.code)) {
          return "network";
        }
        if (phase === "receive") {
          return "transport-fatal";
        }
      }
      return "transport-start";
    },
    async createProvider(input): Promise<DiscordGatewayProvider> {
      return await createDiscordGatewayProvider({
        accountKey: input.accountKey,
        bot: input.identity,
        generation: input.generation,
        signal: input.signal,
        token: input.token,
      });
    },
  };
  return Object.freeze(driver);
}

function initialSnapshot(): RemoteHubSnapshot {
  return parseRemoteHubSnapshot({
    revision: 0,
    telegramNetwork: DEFAULT_TELEGRAM_NETWORK_SETTINGS,
    dependencies: {
      credentialVault: "pending",
      agentRoute: "pending",
    },
    channels: {
      weixin: { state: "loading" },
      telegram: { state: "loading" },
      discord: { state: "loading" },
    },
  });
}

function isGatewayStoreFailure(
  snapshot: BotHubSnapshot,
): boolean {
  return (
    snapshot.state === "error" &&
    snapshot.issue === "gateway-store"
  );
}

/**
 * Compose independently recoverable IM capabilities behind one renderer-safe
 * snapshot and one operation-fenced command surface.
 */
export class RemoteHubCapabilityRuntime {
  readonly #commandBarrier = new RemoteHubCommandBarrier();
  readonly #listeners = new Set<() => void>();
  readonly #recoverMailbox: GatewayMailboxRecovery;
  readonly #weixin: WeixinRuntimePort;
  readonly #telegram: BotRuntimePort;
  readonly #telegramNetwork: TelegramNetworkRuntimePort;
  readonly #discord: BotRuntimePort;
  readonly #unsubscribeWeixin: () => void;
  #snapshot = initialSnapshot();
  #initializePromise: Promise<void> | undefined;
  readonly #activeCommands = new Set<
    Promise<RemoteHubSnapshot>
  >();
  #disposed = false;

  constructor(options: RemoteHubCapabilityRuntimeOptions) {
    const mailboxPath = join(
      options.dataHome,
      "minke",
      "im",
      "gateway.sqlite",
    );
    const recoverMailbox =
      options.recoverMailbox ??
      createGatewayMailboxRecovery();
    this.#recoverMailbox = recoverMailbox;
    this.#telegramNetwork =
      options.telegramNetwork ?? {
        async configure(value: unknown) {
          const settings =
            value as TelegramNetworkSettings;
          if (settings.httpProxyUrl !== "") {
            throw new Error(
              "Telegram proxy configuration is unavailable",
            );
          }
        },
        getSnapshot: () => ({
          ...DEFAULT_TELEGRAM_NETWORK_SETTINGS,
        }),
        async initialize() {},
      };
    this.#weixin =
      options.weixin ??
      new WeixinCapabilityRuntime({
        dataHome: options.dataHome,
        vault: options.vault,
        agentRoute: options.agentRoute,
        recoverMailbox,
        gatewayResetAllowed: () =>
          this.#botGatewayResetAllowed(),
      });
    this.#telegram =
      options.telegram ??
      new BotCapabilityRuntime({
        driver: createTelegramBotDriver({
          fetch: options.telegramFetch,
        }),
        mailboxPath,
        vault: options.vault,
        agentRoute: options.agentRoute,
        recoverMailbox,
        onSnapshot: () => this.#publish(),
      });
    this.#discord =
      options.discord ??
      new BotCapabilityRuntime({
        driver: createDiscordBotDriver(),
        mailboxPath,
        vault: options.vault,
        recoverMailbox,
        onSnapshot: () => this.#publish(),
      });
    this.#unsubscribeWeixin = this.#weixin.subscribe(
      () => this.#publish(),
    );
    this.#publish();
  }

  getSnapshot = (): RemoteHubSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    this.#assertActive();
    this.#initializePromise ??= Promise.allSettled([
      this.#weixin.initialize(),
      this.#telegramNetwork
        .initialize()
        .then(() => this.#telegram.initialize()),
      this.#discord.initialize(),
    ]).then(() => this.#publish());
    return this.#initializePromise;
  }

  async dispatch(value: unknown): Promise<RemoteHubSnapshot> {
    this.#assertActive();
    const command = parseRemoteHubCommand(value);
    if (command.kind === "gateway/reset-local") {
      this.#assertGatewayResetAllowed();
    }
    if (
      command.kind !== "gateway/reset-local" &&
      command.kind !== "telegram/connect" &&
      command.kind !== "telegram/network/set"
    ) {
      void this.initialize();
    }
    const operation = this.#commandBarrier.run(
      command.kind === "gateway/reset-local",
      async (): Promise<RemoteHubSnapshot> => {
        if (this.#disposed) return this.#snapshot;
        await this.#dispatch(command);
        this.#publish();
        return this.#snapshot;
      },
    );
    this.#activeCommands.add(operation);
    try {
      return await operation;
    } finally {
      this.#activeCommands.delete(operation);
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeWeixin();
    await Promise.allSettled([
      this.#initializePromise ?? Promise.resolve(),
      ...this.#activeCommands,
      this.#weixin.dispose(),
      this.#telegram.dispose(),
      this.#discord.dispose(),
    ]);
    this.#listeners.clear();
  }

  async #dispatch(command: RemoteHubCommand): Promise<void> {
    switch (command.kind) {
      case "refresh":
        await Promise.all([
          this.#weixin.dispatch(command),
          this.#telegram.reconnect(),
          this.#discord.reconnect(),
        ]);
        return;
      case "gateway/reset-local":
        this.#assertGatewayResetAllowed();
        await Promise.all([
          this.#telegram.stopForGatewayReset(),
          this.#discord.stopForGatewayReset(),
        ]);
        {
          const reset = await this.#weixin.dispatch(command);
          if (reset.channels.weixin.state !== "unlinked") {
            return;
          }
        }
        this.#recoverMailbox.reset?.();
        await Promise.all([
          this.#telegram.reconnect(),
          this.#discord.reconnect(),
        ]);
        return;
      case "telegram/connect":
        await this.#telegramNetwork.initialize();
        await this.#telegram.connect(command.token);
        return;
      case "telegram/network/set": {
        const state = this.#telegram.getSnapshot().state;
        if (
          state === "connecting" ||
          state === "degraded" ||
          state === "pairing" ||
          state === "connected"
        ) {
          throw new Error(
            "Disconnect Telegram before changing its network proxy",
          );
        }
        await this.#telegramNetwork.configure(
          command.settings,
        );
        return;
      }
      case "telegram/reconnect":
        await this.#telegram.reconnect();
        return;
      case "telegram/pairing/approve":
        await this.#telegram.approvePairing(
          command.requestId,
        );
        return;
      case "telegram/pairing/dismiss":
        await this.#telegram.dismissPairing(
          command.requestId,
        );
        return;
      case "telegram/reset-local":
        await this.#telegram.resetLocal();
        return;
      case "telegram/unlink":
        await this.#telegram.unlink();
        return;
      case "discord/connect":
        await this.#discord.connect(command.token);
        return;
      case "discord/reconnect":
        await this.#discord.reconnect();
        return;
      case "discord/reset-local":
        await this.#discord.resetLocal();
        return;
      case "discord/unlink":
        await this.#discord.unlink();
        return;
      case "weixin/link/start":
      case "weixin/link/verify":
      case "weixin/link/cancel":
      case "weixin/reconnect":
      case "weixin/reset-local":
      case "weixin/unlink":
        await this.#weixin.dispatch(command);
    }
  }

  #publish(): void {
    if (this.#disposed) return;
    const weixin = this.#weixin.getSnapshot();
    this.#snapshot = parseRemoteHubSnapshot({
      revision: this.#snapshot.revision + 1,
      telegramNetwork:
        this.#telegramNetwork.getSnapshot(),
      dependencies: weixin.dependencies,
      channels: {
        weixin: weixin.channels.weixin,
        telegram: this.#telegram.getSnapshot(),
        discord: this.#discord.getSnapshot(),
      },
    });
    for (const listener of this.#listeners) listener();
  }

  #botGatewayResetAllowed(): boolean {
    return (
      isGatewayStoreFailure(this.#telegram.getSnapshot()) ||
      isGatewayStoreFailure(this.#discord.getSnapshot())
    );
  }

  #assertGatewayResetAllowed(): void {
    const weixin = this.#snapshot.channels.weixin;
    const weixinFailed =
      weixin.state === "error" &&
      weixin.issue === "gateway-store";
    if (!weixinFailed && !this.#botGatewayResetAllowed()) {
      throw new TypeError(
        "IM Gateway reset is only available after a Gateway store failure",
      );
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Remote Hub runtime is disposed");
    }
  }
}
