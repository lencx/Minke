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
  validateTelegramBotToken,
} from "@lencx/minke-im-telegram";
import {
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  type BotHubSnapshot,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  BotCapabilityRuntime,
  type BotProviderDriver,
} from "./bot-runtime.ts";
import {
  WeixinCapabilityRuntime,
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
  connect(token: string): Promise<void>;
  dispose(): Promise<void>;
  getSnapshot(): BotHubSnapshot;
  initialize(): Promise<void>;
  reconnect(): Promise<void>;
  resetLocal(): Promise<void>;
  stopForGatewayReset(): Promise<void>;
  unlink(): Promise<void>;
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
  readonly weixin?: WeixinRuntimePort;
  readonly telegram?: BotRuntimePort;
  readonly discord?: BotRuntimePort;
  readonly recoverMailbox?: GatewayMailboxRecovery;
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

export function createTelegramBotDriver(): BotProviderDriver<
  TelegramBotIdentity
> {
  const driver: BotProviderDriver<TelegramBotIdentity> = {
    provider: "telegram",
    async validate(token, { signal }) {
      return await validateTelegramBotToken(
        { credential: { token } },
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
    this.#weixin =
      options.weixin ??
      new WeixinCapabilityRuntime({
        dataHome: options.dataHome,
        vault: options.vault,
        recoverMailbox,
        gatewayResetAllowed: () =>
          this.#botGatewayResetAllowed(),
      });
    this.#telegram =
      options.telegram ??
      new BotCapabilityRuntime({
        driver: createTelegramBotDriver(),
        mailboxPath,
        vault: options.vault,
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
      this.#telegram.initialize(),
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
    void this.initialize();
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
        await this.#telegram.connect(command.token);
        return;
      case "telegram/reconnect":
        await this.#telegram.reconnect();
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
