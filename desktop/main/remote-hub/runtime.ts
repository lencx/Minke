import { join } from "node:path";
import {
  createDiscordGatewayProvider,
  DiscordTransportError,
  type DiscordBotIdentity,
  type DiscordGatewayProvider,
  type DiscordInboundMessage,
  type DiscordWebSocketFactory,
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
  DEFAULT_DISCORD_NETWORK_SNAPSHOT,
  DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  type BotHubSnapshot,
  type DiscordNetworkSnapshot,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
  type TelegramNetworkSettings,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  BotCapabilityRuntime,
  type BotAgentRoutePort,
  type BotInboundMessage,
  type BotInboundMessageInput,
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
  disconnect(): Promise<void>;
  dismissPairing(requestId: string): Promise<void>;
  dispose(): Promise<void>;
  refresh?(): Promise<void>;
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

interface DiscordNetworkRuntimePort {
  configure(value: unknown): Promise<void>;
  getSnapshot(): DiscordNetworkSnapshot;
  initialize(): Promise<void>;
  refresh(): Promise<void>;
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
  readonly credentialClipboard?: {
    writeText(value: string): void | Promise<void>;
  };
  readonly agentRoute?:
    WeixinAgentRoutePort & BotAgentRoutePort;
  readonly telegramFetch?: typeof globalThis.fetch;
  readonly discordFetch?: typeof globalThis.fetch;
  readonly discordWebSocketFactory?: DiscordWebSocketFactory;
  readonly weixin?: WeixinRuntimePort;
  readonly telegram?: BotRuntimePort;
  readonly telegramNetwork?: TelegramNetworkRuntimePort;
  readonly discordNetwork?: DiscordNetworkRuntimePort;
  readonly discord?: BotRuntimePort;
  readonly recoverMailbox?: GatewayMailboxRecovery;
}

export interface TelegramBotDriverOptions {
  readonly fetch?: typeof globalThis.fetch;
}

export interface DiscordBotDriverOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocketFactory?: DiscordWebSocketFactory;
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
  input: BotInboundMessageInput,
): BotInboundMessage | undefined {
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
    conversationKind: "direct",
    senderLabel: telegramSenderLabel(sender),
    ...(message.content.kind === "text" &&
    typeof message.content.text === "string"
      ? { text: message.content.text }
      : {}),
  };
}

function discordSenderLabel(
  author: Record<string, unknown>,
): string {
  const username =
    typeof author.username === "string"
      ? author.username.trim()
      : "";
  const globalName =
    typeof author.globalName === "string"
      ? author.globalName.trim()
      : "";
  const source =
    globalName === ""
      ? username === ""
        ? "Discord user"
        : `@${username}`
      : username === ""
        ? globalName
        : `${globalName} (@${username})`;
  const normalized = source
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return [...(normalized || "Discord user")]
    .slice(0, 128)
    .join("");
}

function stripDiscordBotMention(
  text: string,
  botId: string,
): string {
  return text
    .replaceAll(`<@${botId}>`, " ")
    .replaceAll(`<@!${botId}>`, " ")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .trim();
}

function inspectDiscordMessage(
  input: BotInboundMessageInput,
  options: {
    readonly providerAccountId: string;
  },
): BotInboundMessage | undefined {
  if (input.kind !== "user-message") return undefined;
  const payload = record(input.payload);
  const author = record(payload?.author);
  const context = record(payload?.context);
  if (
    payload === undefined ||
    author === undefined ||
    context === undefined ||
    context.channelId !== input.peerId ||
    input.conversationId !== input.peerId ||
    payload.channelId !== input.peerId ||
    payload.id !== input.nativeId ||
    author.id !== input.senderId ||
    author.bot !== false ||
    (
      payload.messageType !== 0 &&
      payload.messageType !== 19
    )
  ) {
    return undefined;
  }
  const message = payload as unknown as DiscordInboundMessage;
  if (context.kind === "direct") {
    return {
      conversationKind: "direct",
      senderLabel: discordSenderLabel(author),
      text: message.content,
    };
  }
  if (
    (
      context.kind !== "guild-channel" &&
      context.kind !== "guild-thread"
    ) ||
    typeof context.guildId !== "string" ||
    context.guildId !== message.guildId ||
    !Array.isArray(message.mentionedUserIds)
  ) {
    return undefined;
  }
  const mentioned =
    message.mentionedUserIds.includes(
      options.providerAccountId,
    );
  const repliedToBot =
    message.reply?.authorId === options.providerAccountId;
  if (!mentioned && !repliedToBot) return undefined;
  return {
    conversationKind: "group",
    senderLabel: discordSenderLabel(author),
    text: mentioned
      ? stripDiscordBotMention(
          message.content,
          options.providerAccountId,
        )
      : message.content,
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
    inspectMessage: inspectTelegramDirectMessage,
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

export function createDiscordBotDriver(
  options: DiscordBotDriverOptions = {},
): BotProviderDriver<
  DiscordBotIdentity
> {
  const driver: BotProviderDriver<DiscordBotIdentity> = {
    provider: "discord",
    agentReplyPayload(markdown, { input, message }) {
      const payload = input.payload as DiscordInboundMessage;
      return {
        kind: "text",
        text: markdown.trim(),
        ...(message.conversationKind === "group"
          ? {
              replyTo: {
                channelId: input.peerId,
                failIfNotExists: false,
                guildId: payload.guildId,
                messageId: input.nativeId,
              },
            }
          : {}),
      };
    },
    inspectMessage: inspectDiscordMessage,
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
        fetch: options.fetch,
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
        fetch: options.fetch,
        signal: input.signal,
        token: input.token,
        webSocketFactory: options.webSocketFactory,
      });
    },
  };
  return Object.freeze(driver);
}

function initialSnapshot(): RemoteHubSnapshot {
  return parseRemoteHubSnapshot({
    revision: 0,
    telegramNetwork: DEFAULT_TELEGRAM_NETWORK_SETTINGS,
    discordNetwork: DEFAULT_DISCORD_NETWORK_SNAPSHOT,
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
  readonly #credentialClipboard: {
    writeText(value: string): void | Promise<void>;
  };
  readonly #credentialVault: RemoteHubCredentialVault;
  readonly #listeners = new Set<() => void>();
  readonly #recoverMailbox: GatewayMailboxRecovery;
  readonly #weixin: WeixinRuntimePort;
  readonly #telegram: BotRuntimePort;
  readonly #telegramNetwork: TelegramNetworkRuntimePort;
  readonly #discord: BotRuntimePort;
  readonly #discordNetwork: DiscordNetworkRuntimePort;
  readonly #unsubscribeWeixin: () => void;
  #snapshot = initialSnapshot();
  #initializePromise: Promise<void> | undefined;
  readonly #activeCommands = new Set<
    Promise<RemoteHubSnapshot>
  >();
  #disposed = false;

  constructor(options: RemoteHubCapabilityRuntimeOptions) {
    this.#credentialVault = options.vault;
    this.#credentialClipboard =
      options.credentialClipboard ?? {
        writeText() {
          throw new Error(
            "Credential clipboard is unavailable",
          );
        },
      };
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
    this.#discordNetwork =
      options.discordNetwork ?? {
        async configure(value: unknown) {
          const settings = value as {
            readonly httpProxyUrl: string;
          };
          if (settings.httpProxyUrl !== "") {
            throw new Error(
              "Discord proxy configuration is unavailable",
            );
          }
        },
        getSnapshot: () => ({
          ...DEFAULT_DISCORD_NETWORK_SNAPSHOT,
        }),
        async initialize() {},
        async refresh() {},
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
        driver: createDiscordBotDriver({
          fetch: options.discordFetch,
          webSocketFactory:
            options.discordWebSocketFactory,
        }),
        mailboxPath,
        vault: options.vault,
        agentRoute: options.agentRoute,
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
    if (this.#initializePromise === undefined) {
      const telegramNetworkReady =
        this.#telegramNetwork.initialize();
      this.#initializePromise = Promise.allSettled([
        this.#weixin.initialize(),
        telegramNetworkReady.then(() =>
          this.#telegram.initialize(),
        ),
        telegramNetworkReady
          .catch(() => undefined)
          .then(() => this.#discordNetwork.initialize())
          .then(() => this.#discord.initialize()),
      ]).then(() => this.#publish());
    }
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
      command.kind !== "telegram/network/set" &&
      command.kind !== "discord/connect" &&
      command.kind !== "discord/network/set"
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
          this.#telegram.refresh?.() ??
            this.#telegram.reconnect(),
          this.#discordNetwork.refresh().then(
            () =>
              this.#discord.refresh?.() ??
              this.#discord.reconnect(),
          ),
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
          this.#telegram.refresh?.() ??
            this.#telegram.reconnect(),
          this.#discordNetwork.refresh().then(
            () =>
              this.#discord.refresh?.() ??
              this.#discord.reconnect(),
          ),
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
      case "telegram/token/copy":
        await this.#copyBotToken("telegram");
        return;
      case "telegram/disconnect":
        await this.#telegram.disconnect();
        return;
      case "bot/pairing/approve":
        await (
          command.provider === "telegram"
            ? this.#telegram
            : this.#discord
        ).approvePairing(command.requestId);
        return;
      case "bot/pairing/dismiss":
        await (
          command.provider === "telegram"
            ? this.#telegram
            : this.#discord
        ).dismissPairing(command.requestId);
        return;
      case "telegram/reset-local":
        await this.#telegram.resetLocal();
        return;
      case "telegram/unlink":
        await this.#telegram.unlink();
        return;
      case "discord/connect":
        await this.#telegramNetwork
          .initialize()
          .catch(() => undefined);
        await this.#discordNetwork.refresh();
        await this.#discord.connect(command.token);
        return;
      case "discord/network/set": {
        const current = this.#discord.getSnapshot();
        if (
          current.state === "connecting" ||
          current.state === "degraded" ||
          current.state === "pairing" ||
          current.state === "connected"
        ) {
          throw new Error(
            "Disconnect Discord before changing its network proxy",
          );
        }
        await this.#discordNetwork.configure(
          command.settings,
        );
        if (
          current.state === "error" &&
          current.issue === "network" &&
          current.hasStoredCredential
        ) {
          await this.#discord.reconnect();
        }
        return;
      }
      case "discord/reconnect":
        await this.#telegramNetwork
          .initialize()
          .catch(() => undefined);
        await this.#discordNetwork.refresh();
        await this.#discord.reconnect();
        return;
      case "discord/token/copy":
        await this.#copyBotToken("discord");
        return;
      case "discord/disconnect":
        await this.#discord.disconnect();
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

  async #copyBotToken(
    provider: "telegram" | "discord",
  ): Promise<void> {
    const credential =
      await this.#credentialVault.readBot(provider);
    if (credential === undefined) {
      throw new Error(`No saved ${provider} token`);
    }
    await this.#credentialClipboard.writeText(
      credential.token,
    );
  }

  #publish(): void {
    if (this.#disposed) return;
    const weixin = this.#weixin.getSnapshot();
    this.#snapshot = parseRemoteHubSnapshot({
      revision: this.#snapshot.revision + 1,
      telegramNetwork:
        this.#telegramNetwork.getSnapshot(),
      discordNetwork:
        this.#discordNetwork.getSnapshot(),
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
