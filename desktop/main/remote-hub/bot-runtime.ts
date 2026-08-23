import {
  pollGatewayProviderOnce,
  type GatewayCipher,
  type GatewayMailboxPort,
  type GatewayProviderSession,
} from "@lencx/minke-im-gateway";
import {
  createSqliteGatewayMailbox,
} from "@lencx/minke-im-gateway/sqlite";
import type {
  BotHubIssue,
  BotHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import type {
  BotCredentialProvider,
  StoredBotCredential,
} from "./credential-vault.ts";

interface BotMailbox extends GatewayMailboxPort {
  close(): void;
  getAccountGeneration(accountKey: string): number | undefined;
  recover(input?: { readonly now?: number }): unknown;
  removeProviderAccounts(provider: string): number;
  registerAccount(account: GatewayProviderSession["account"]): void;
}

export interface BotCredentialVaultPort {
  readonly available: boolean;
  deleteBot(provider: BotCredentialProvider): Promise<void>;
  gatewayCipher(): GatewayCipher;
  readBot(
    provider: BotCredentialProvider,
  ): Promise<StoredBotCredential | undefined>;
  writeBot(
    provider: BotCredentialProvider,
    value: StoredBotCredential,
  ): Promise<void>;
}

export interface BotProviderDriver<Identity> {
  readonly provider: BotCredentialProvider;
  createProvider(input: {
    readonly accountKey: string;
    readonly generation: number;
    readonly identity: Identity;
    readonly signal: AbortSignal;
    readonly token: string;
  }): Promise<GatewayProviderSession>;
  identityId(identity: Identity): string;
  identityLabel(identity: Identity): string;
  isAborted(error: unknown, signal: AbortSignal): boolean;
  issue(
    error: unknown,
    phase: "receive" | "start" | "validate",
  ): Exclude<
    BotHubIssue,
    | "agent-route-pending"
    | "credential-read"
    | "credential-store"
    | "gateway-store"
    | "receive"
    | "vault-unavailable"
  >;
  validate(
    token: string,
    options: { readonly signal: AbortSignal },
  ): Promise<Identity>;
}

export interface BotCapabilityRuntimeOptions<Identity> {
  readonly driver: BotProviderDriver<Identity>;
  readonly mailboxPath: string;
  readonly vault: BotCredentialVaultPort;
  readonly createMailbox?: (input: {
    readonly cipher: GatewayCipher;
    readonly path: string;
  }) => BotMailbox;
  readonly pollProviderOnce?: typeof pollGatewayProviderOnce;
  readonly waitBeforeRetry?: (
    signal: AbortSignal,
  ) => Promise<void>;
  readonly onSnapshot?: (snapshot: BotHubSnapshot) => void;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;

function isTerminalReceiveIssue(
  issue: BotHubIssue,
): issue is
  | "credential-invalid"
  | "polling-conflict"
  | "privileged-intent" {
  return (
    issue === "credential-invalid" ||
    issue === "polling-conflict" ||
    issue === "privileged-intent"
  );
}

function waitBeforeRetry(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolvePromise, reject) => {
    const finish = (error?: unknown): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolvePromise();
      else reject(error);
    };
    const onAbort = (): void => finish(signal.reason);
    const timeout = setTimeout(finish, DEFAULT_RETRY_DELAY_MS);
    timeout.unref();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function accountKey(
  provider: BotCredentialProvider,
  accountId: string,
): string {
  return `${provider}:${accountId}`;
}

function nextCredential(
  previous: StoredBotCredential | undefined,
  durableGeneration: number | undefined,
  input: {
    readonly accountId: string;
    readonly accountLabel: string;
    readonly token: string;
  },
): StoredBotCredential {
  const previousGeneration =
    previous?.accountId === input.accountId
      ? previous.generation
      : 0;
  return {
    ...input,
    generation:
      Math.max(previousGeneration, durableGeneration ?? 0) + 1,
  };
}

/**
 * Own one token-authenticated provider without exposing its token or transport
 * details to the renderer.
 */
export class BotCapabilityRuntime<Identity> {
  readonly #driver: BotProviderDriver<Identity>;
  readonly #mailboxPath: string;
  readonly #vault: BotCredentialVaultPort;
  readonly #createMailbox: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["createMailbox"]
  >;
  readonly #pollProviderOnce: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["pollProviderOnce"]
  >;
  readonly #waitBeforeRetry: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["waitBeforeRetry"]
  >;
  readonly #onSnapshot:
    | ((snapshot: BotHubSnapshot) => void)
    | undefined;
  #snapshot: BotHubSnapshot = Object.freeze({
    state: "loading",
  });
  #provider: GatewayProviderSession | undefined;
  #mailbox: BotMailbox | undefined;
  #providerController: AbortController | undefined;
  #operationController: AbortController | undefined;
  #receiveTask: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(options: BotCapabilityRuntimeOptions<Identity>) {
    this.#driver = options.driver;
    this.#mailboxPath = options.mailboxPath;
    this.#vault = options.vault;
    this.#createMailbox =
      options.createMailbox ?? createSqliteGatewayMailbox;
    this.#pollProviderOnce =
      options.pollProviderOnce ?? pollGatewayProviderOnce;
    this.#waitBeforeRetry =
      options.waitBeforeRetry ?? waitBeforeRetry;
    this.#onSnapshot = options.onSnapshot;
  }

  getSnapshot = (): BotHubSnapshot => this.#snapshot;

  async initialize(): Promise<void> {
    this.#assertActive();
    if (!this.#vault.available) {
      this.#publish({
        state: "unavailable",
        issue: "vault-unavailable",
      });
      return;
    }
    const controller = this.#beginOperation();
    let stored: StoredBotCredential | undefined;
    try {
      stored = await this.#vault.readBot(
        this.#driver.provider,
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;
    if (stored === undefined) {
      this.#publish({ state: "unlinked" });
      return;
    }
    await this.#connectStored(stored, controller);
  }

  async connect(token: string): Promise<void> {
    this.#assertActive();
    if (!this.#vault.available) {
      this.#publish({
        state: "unavailable",
        issue: "vault-unavailable",
      });
      return;
    }
    const controller = this.#beginOperation();
    this.#publish({
      state: "connecting",
      accountLabel:
        this.#driver.provider === "telegram"
          ? "Telegram bot"
          : "Discord bot",
    });

    let identity: Identity;
    try {
      identity = await this.#driver.validate(token, {
        signal: controller.signal,
      });
    } catch (error) {
      if (
        !this.#ownsOperation(controller) ||
        this.#driver.isAborted(error, controller.signal)
      ) {
        return;
      }
      this.#publish({
        state: "error",
        issue: this.#driver.issue(error, "validate"),
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;

    const accountId = this.#driver.identityId(identity);
    const accountLabel = this.#driver.identityLabel(identity);
    const key = accountKey(this.#driver.provider, accountId);
    let previous: StoredBotCredential | undefined;
    try {
      previous = await this.#vault.readBot(
        this.#driver.provider,
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;

    let durableGeneration: number | undefined;
    let mailbox: BotMailbox | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      durableGeneration = mailbox.getAccountGeneration(key);
      mailbox.close();
      mailbox = undefined;
    } catch {
      try {
        mailbox?.close();
      } catch {
        // The explicit whole-Gateway recovery path remains available.
      }
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "gateway-store",
      });
      return;
    }
    const stored = nextCredential(
      previous,
      durableGeneration,
      {
        accountId,
        accountLabel,
        token,
      },
    );
    try {
      await this.#vault.writeBot(
        this.#driver.provider,
        stored,
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-store",
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;
    await this.#stopProvider();
    if (!this.#ownsOperation(controller)) return;
    await this.#connectStored(stored, controller, identity);
  }

  async reconnect(): Promise<void> {
    this.#assertActive();
    if (!this.#vault.available) {
      this.#publish({
        state: "unavailable",
        issue: "vault-unavailable",
      });
      return;
    }
    const controller = this.#beginOperation();
    await this.#stopProvider();
    if (!this.#ownsOperation(controller)) return;
    let stored: StoredBotCredential | undefined;
    try {
      stored = await this.#vault.readBot(
        this.#driver.provider,
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;
    if (stored === undefined) {
      this.#publish({ state: "unlinked" });
      return;
    }
    await this.#connectStored(stored, controller);
  }

  async unlink(): Promise<void> {
    this.#assertActive();
    this.#beginOperation();
    await this.#stopProvider();
    if (this.#disposed) return;
    try {
      await this.#vault.deleteBot(this.#driver.provider);
      if (!this.#disposed) this.#publish({ state: "unlinked" });
    } catch {
      if (!this.#disposed) {
        this.#publish({
          state: "error",
          issue: "credential-store",
        });
      }
    }
  }

  async resetLocal(): Promise<void> {
    this.#assertActive();
    this.#beginOperation();
    await this.#stopProvider();
    if (this.#disposed) return;
    let mailbox: BotMailbox | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      mailbox.removeProviderAccounts(this.#driver.provider);
      mailbox.close();
      mailbox = undefined;
    } catch {
      try {
        mailbox?.close();
      } catch {
        // The explicit whole-Gateway recovery path remains available.
      }
      if (!this.#disposed) {
        this.#publish({
          state: "error",
          issue: "gateway-store",
        });
      }
      return;
    }
    if (this.#disposed) return;
    try {
      await this.#vault.deleteBot(this.#driver.provider);
      if (!this.#disposed) this.#publish({ state: "unlinked" });
    } catch {
      if (!this.#disposed) {
        this.#publish({
          state: "error",
          issue: "credential-store",
        });
      }
    }
  }

  async stopForGatewayReset(): Promise<void> {
    if (this.#disposed) return;
    this.#beginOperation();
    await this.#stopProvider();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#operationController?.abort();
    this.#operationController = undefined;
    await this.#stopProvider();
  }

  async #connectStored(
    stored: StoredBotCredential,
    operation: AbortController,
    validatedIdentity?: Identity,
  ): Promise<void> {
    if (!this.#ownsOperation(operation)) return;
    this.#publish({
      state: "connecting",
      accountLabel: stored.accountLabel,
    });
    let identity = validatedIdentity;
    if (identity === undefined) {
      try {
        identity = await this.#driver.validate(stored.token, {
          signal: operation.signal,
        });
      } catch (error) {
        if (
          !this.#ownsOperation(operation) ||
          this.#driver.isAborted(error, operation.signal)
        ) {
          return;
        }
        this.#publish({
          state: "error",
          issue: this.#driver.issue(error, "validate"),
        });
        return;
      }
    }
    if (
      !this.#ownsOperation(operation) ||
      this.#driver.identityId(identity) !== stored.accountId
    ) {
      if (this.#ownsOperation(operation)) {
        this.#publish({
          state: "error",
          issue: "credential-invalid",
        });
      }
      return;
    }

    const controller = new AbortController();
    const abortFromOperation = (): void =>
      controller.abort(operation.signal.reason);
    operation.signal.addEventListener(
      "abort",
      abortFromOperation,
      { once: true },
    );
    if (operation.signal.aborted) abortFromOperation();
    let provider: GatewayProviderSession | undefined;
    let mailbox: BotMailbox | undefined;
    let providerOwned = false;
    try {
      provider = await this.#driver.createProvider({
        accountKey: accountKey(
          this.#driver.provider,
          stored.accountId,
        ),
        generation: stored.generation,
        identity,
        signal: controller.signal,
        token: stored.token,
      });
      if (
        !this.#ownsOperation(operation) ||
        controller.signal.aborted
      ) {
        await provider.close().catch(() => {});
        return;
      }
      try {
        mailbox = this.#createMailbox({
          cipher: this.#vault.gatewayCipher(),
          path: this.#mailboxPath,
        });
      } catch {
        await provider.close().catch(() => {});
        if (this.#ownsOperation(operation)) {
          this.#publish({
            state: "error",
            issue: "gateway-store",
          });
        }
        return;
      }
      mailbox.registerAccount(provider.account);
      mailbox.recover();
      this.#provider = provider;
      this.#mailbox = mailbox;
      this.#providerController = controller;
      providerOwned = true;
      await provider.start({ signal: controller.signal });
      if (
        !this.#ownsOperation(operation) ||
        controller.signal.aborted ||
        this.#provider !== provider
      ) {
        return;
      }
      this.#publish({
        state: "degraded",
        accountLabel: stored.accountLabel,
        issue: "agent-route-pending",
      });
      this.#runReceiveLoop(
        provider,
        mailbox,
        controller,
        stored.accountLabel,
      );
    } catch (error) {
      const wasAborted =
        this.#driver.isAborted(error, controller.signal) ||
        !this.#ownsOperation(operation);
      controller.abort();
      if (
        provider !== undefined &&
        this.#provider === provider
      ) {
        this.#provider = undefined;
        this.#mailbox = undefined;
        this.#providerController = undefined;
        await provider.close().catch(() => {});
        mailbox?.close();
      } else if (!providerOwned) {
        await provider?.close().catch(() => {});
        mailbox?.close();
      }
      if (!wasAborted && !this.#disposed) {
        this.#publish({
          state: "error",
          issue: this.#driver.issue(error, "start"),
        });
      }
    } finally {
      operation.signal.removeEventListener(
        "abort",
        abortFromOperation,
      );
    }
  }

  async #receiveLoop(
    provider: GatewayProviderSession,
    mailbox: BotMailbox,
    controller: AbortController,
    accountLabel: string,
  ): Promise<void> {
    while (
      !this.#disposed &&
      !controller.signal.aborted &&
      this.#provider === provider
    ) {
      try {
        await this.#pollProviderOnce({
          mailbox,
          provider,
          signal: controller.signal,
        });
        const snapshot = this.#snapshot;
        if (
          snapshot.state === "degraded" &&
          snapshot.issue === "receive"
        ) {
          this.#publish({
            state: "degraded",
            accountLabel,
            issue: "agent-route-pending",
          });
        }
      } catch (error) {
        if (this.#driver.isAborted(error, controller.signal)) {
          return;
        }
        const issue = this.#driver.issue(error, "receive");
        if (isTerminalReceiveIssue(issue)) {
          this.#publish({
            state: "error",
            issue,
          });
          controller.abort();
          if (this.#provider === provider) {
            this.#provider = undefined;
            this.#mailbox = undefined;
            this.#providerController = undefined;
            await provider.close().catch(() => {});
            try {
              mailbox.close();
            } catch {
              // Preserve the provider issue as the actionable state.
            }
          }
          return;
        }
        const snapshot = this.#snapshot;
        if (
          snapshot.state !== "degraded" ||
          snapshot.issue !== "receive"
        ) {
          this.#publish({
            state: "degraded",
            accountLabel,
            issue: "receive",
          });
        }
        try {
          await this.#waitBeforeRetry(controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  #beginOperation(): AbortController {
    this.#operationController?.abort();
    const controller = new AbortController();
    this.#operationController = controller;
    return controller;
  }

  #ownsOperation(controller: AbortController): boolean {
    return (
      !this.#disposed &&
      this.#operationController === controller &&
      !controller.signal.aborted
    );
  }

  #runReceiveLoop(
    provider: GatewayProviderSession,
    mailbox: BotMailbox,
    controller: AbortController,
    accountLabel: string,
  ): void {
    const task = this.#receiveLoop(
      provider,
      mailbox,
      controller,
      accountLabel,
    ).catch(() => {});
    this.#receiveTask = task;
    void task.then(() => {
      if (this.#receiveTask === task) {
        this.#receiveTask = Promise.resolve();
      }
    });
  }

  async #stopProvider(): Promise<void> {
    const provider = this.#provider;
    const mailbox = this.#mailbox;
    const controller = this.#providerController;
    this.#provider = undefined;
    this.#mailbox = undefined;
    this.#providerController = undefined;
    controller?.abort();
    await provider?.close().catch(() => {});
    mailbox?.close();
    await this.#receiveTask.catch(() => {});
  }

  #publish(snapshot: BotHubSnapshot): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze(snapshot);
    this.#onSnapshot?.(this.#snapshot);
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error(
        `${this.#driver.provider} capability runtime is disposed`,
      );
    }
  }
}
