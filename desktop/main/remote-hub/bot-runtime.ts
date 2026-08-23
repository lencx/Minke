import {
  botEchoOnlyGatewayIngress,
  pollGatewayProviderOnce,
  type GatewayCipher,
  type GatewayIngressPolicy,
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
import {
  createGatewayMailboxRecovery,
  type GatewayMailboxRecovery,
} from "./mailbox-recovery.ts";

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

export type BotProviderIssue = Exclude<
  BotHubIssue,
  | "agent-route-pending"
  | "credential-read"
  | "credential-store"
  | "gateway-store"
  | "receive"
  | "vault-unavailable"
>;

export interface BotProviderDriver<Identity> {
  readonly provider: BotCredentialProvider;
  candidateHealthIssue?(
    provider: GatewayProviderSession,
  ): BotProviderIssue | undefined;
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
  ): BotProviderIssue;
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
  readonly ingressPolicy?: GatewayIngressPolicy;
  readonly recoverMailbox?: GatewayMailboxRecovery;
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
  | "privileged-intent"
  | "transport-fatal" {
  return (
    issue === "credential-invalid" ||
    issue === "polling-conflict" ||
    issue === "privileged-intent" ||
    issue === "transport-fatal"
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

interface ActiveBotProvider {
  readonly controller: AbortController;
  readonly mailbox: BotMailbox;
  readonly provider: GatewayProviderSession;
  readonly receiveTask: Promise<void>;
}

interface CandidateBotProvider {
  readonly controller: AbortController;
  readonly detachOperation: () => void;
  readonly provider: GatewayProviderSession;
}

type VaultOperationResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "stale" };

type CandidateCommitResult =
  | {
      readonly previous: ActiveBotProvider | undefined;
      readonly status: "activated";
    }
  | {
      readonly issue:
        | BotProviderIssue
        | "credential-store"
        | "gateway-store";
      readonly status: "error";
    }
  | { readonly status: "stale" };

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
  readonly #ingressPolicy: GatewayIngressPolicy;
  readonly #recoverMailbox: GatewayMailboxRecovery;
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
  #providerDrainTail: Promise<void> = Promise.resolve();
  #vaultMutationTail: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(options: BotCapabilityRuntimeOptions<Identity>) {
    this.#driver = options.driver;
    this.#mailboxPath = options.mailboxPath;
    this.#vault = options.vault;
    this.#createMailbox =
      options.createMailbox ?? createSqliteGatewayMailbox;
    this.#pollProviderOnce =
      options.pollProviderOnce ?? pollGatewayProviderOnce;
    this.#ingressPolicy =
      options.ingressPolicy ?? botEchoOnlyGatewayIngress;
    this.#recoverMailbox =
      options.recoverMailbox ??
      createGatewayMailboxRecovery();
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
    let storedResult: VaultOperationResult<
      StoredBotCredential | undefined
    >;
    try {
      storedResult = await this.#serializeVaultOperation(
        controller,
        async () =>
          await this.#vault.readBot(this.#driver.provider),
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (
      storedResult.status === "stale" ||
      !this.#ownsOperation(controller)
    ) {
      return;
    }
    const stored = storedResult.value;
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
      const issue = this.#driver.issue(error, "validate");
      await this.#restoreStoredProviderIfUnowned(controller);
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue,
      });
      return;
    }
    if (!this.#ownsOperation(controller)) return;

    const accountId = this.#driver.identityId(identity);
    const accountLabel = this.#driver.identityLabel(identity);
    const key = accountKey(this.#driver.provider, accountId);
    let previousResult: VaultOperationResult<
      StoredBotCredential | undefined
    >;
    try {
      previousResult = await this.#serializeVaultOperation(
        controller,
        async () =>
          await this.#vault.readBot(this.#driver.provider),
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (
      previousResult.status === "stale" ||
      !this.#ownsOperation(controller)
    ) {
      return;
    }
    const previous = previousResult.value;

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

    const candidate = await this.#startCandidate(
      stored,
      identity,
      controller,
    );
    if (candidate === undefined) {
      const failure = this.#snapshot;
      await this.#restoreStoredProviderIfUnowned(controller);
      if (
        this.#ownsOperation(controller) &&
        failure.state === "error"
      ) {
        this.#publish(failure);
      }
      return;
    }

    let committed: VaultOperationResult<CandidateCommitResult>;
    try {
      committed = await this.#serializeVaultOperation(
        controller,
        async () =>
          await this.#commitCandidate({
            candidate,
            operation: controller,
            previous,
            stored,
          }),
      );
    } catch {
      await this.#closeCandidate(candidate);
      if (this.#ownsOperation(controller)) {
        await this.#restoreStoredProviderIfUnowned(controller);
      }
      if (this.#ownsOperation(controller)) {
        this.#publish({
          state: "error",
          issue: "credential-store",
        });
      }
      return;
    }
    if (
      committed.status === "stale" ||
      committed.value.status === "stale"
    ) {
      await this.#closeCandidate(candidate);
      return;
    }
    if (committed.value.status === "error") {
      await this.#closeCandidate(candidate);
      if (this.#ownsOperation(controller)) {
        await this.#restoreStoredProviderIfUnowned(controller);
      }
      if (this.#ownsOperation(controller)) {
        this.#publish({
          state: "error",
          issue: committed.value.issue,
        });
      }
      return;
    }

    await this.#closeActiveProvider(committed.value.previous);
    const handoffIssue = this.#candidateHealthIssue(
      candidate.provider,
    );
    if (
      handoffIssue !== undefined &&
      this.#provider === candidate.provider
    ) {
      await this.#stopProvider();
      if (this.#ownsOperation(controller)) {
        this.#publish({
          state: "error",
          issue: handoffIssue,
        });
      }
      return;
    }
    if (
      this.#provider === candidate.provider &&
      !candidate.controller.signal.aborted
    ) {
      this.#runReceiveLoop(
        candidate.provider,
        this.#mailbox!,
        candidate.controller,
        stored.accountLabel,
      );
    }
    if (this.#ownsOperation(controller)) {
      this.#publish({
        state: "degraded",
        accountLabel: stored.accountLabel,
        issue: "agent-route-pending",
      });
    }
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
    let storedResult: VaultOperationResult<
      StoredBotCredential | undefined
    >;
    try {
      storedResult = await this.#serializeVaultOperation(
        controller,
        async () =>
          await this.#vault.readBot(this.#driver.provider),
      );
    } catch {
      if (!this.#ownsOperation(controller)) return;
      this.#publish({
        state: "error",
        issue: "credential-read",
      });
      return;
    }
    if (
      storedResult.status === "stale" ||
      !this.#ownsOperation(controller)
    ) {
      return;
    }
    const stored = storedResult.value;
    if (stored === undefined) {
      await this.#stopProvider();
      if (this.#ownsOperation(controller)) {
        this.#publish({ state: "unlinked" });
      }
      return;
    }
    await this.#connectStored(stored, controller);
  }

  async unlink(): Promise<void> {
    this.#assertActive();
    const controller = this.#beginOperation();
    const outcome = await this.#deleteCredential(controller);
    if (outcome.status === "stale") {
      return;
    }
    if (outcome.status === "error") {
      if (this.#ownsOperation(controller)) {
        this.#publish({
          state: "error",
          issue: "credential-store",
        });
      }
      return;
    }
    await this.#closeActiveProvider(outcome.previous);
    if (this.#ownsOperation(controller)) {
      this.#publish({ state: "unlinked" });
    }
  }

  async resetLocal(): Promise<void> {
    this.#assertActive();
    const controller = this.#beginOperation();
    const outcome =
      await this.#resetCredentialAndMailbox(controller);
    if (outcome.status === "stale") {
      return;
    }
    if (outcome.status === "error") {
      if (this.#ownsOperation(controller)) {
        this.#publish({
          state: "error",
          issue: outcome.issue,
        });
      }
      return;
    }
    await this.#closeActiveProvider(outcome.previous);
    if (this.#ownsOperation(controller)) {
      this.#publish({ state: "unlinked" });
    }
  }

  async stopForGatewayReset(): Promise<void> {
    if (this.#disposed) return;
    this.#beginOperation();
    await this.#stopProvider();
    await this.#vaultMutationTail.catch(() => {});
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#operationController?.abort();
    this.#operationController = undefined;
    await this.#stopProvider();
    await this.#vaultMutationTail.catch(() => {});
  }

  async #startCandidate(
    stored: StoredBotCredential,
    identity: Identity,
    operation: AbortController,
  ): Promise<CandidateBotProvider | undefined> {
    const controller = new AbortController();
    const abortFromOperation = (): void =>
      controller.abort(operation.signal.reason);
    const detachOperation = (): void =>
      operation.signal.removeEventListener(
        "abort",
        abortFromOperation,
      );
    operation.signal.addEventListener(
      "abort",
      abortFromOperation,
      { once: true },
    );
    if (operation.signal.aborted) abortFromOperation();

    let provider: GatewayProviderSession | undefined;
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
        detachOperation();
        controller.abort();
        await provider.close().catch(() => {});
        return undefined;
      }
      await provider.start({ signal: controller.signal });
      if (
        !this.#ownsOperation(operation) ||
        controller.signal.aborted
      ) {
        detachOperation();
        controller.abort();
        await provider.close().catch(() => {});
        return undefined;
      }
      return {
        controller,
        detachOperation,
        provider,
      };
    } catch (error) {
      const wasAborted =
        this.#driver.isAborted(error, controller.signal) ||
        !this.#ownsOperation(operation);
      detachOperation();
      controller.abort();
      await provider?.close().catch(() => {});
      if (!wasAborted && this.#ownsOperation(operation)) {
        this.#publish({
          state: "error",
          issue: this.#driver.issue(error, "start"),
        });
      }
      return undefined;
    }
  }

  async #commitCandidate(input: {
    readonly candidate: CandidateBotProvider;
    readonly operation: AbortController;
    readonly previous: StoredBotCredential | undefined;
    readonly stored: StoredBotCredential;
  }): Promise<CandidateCommitResult> {
    try {
      await this.#vault.writeBot(
        this.#driver.provider,
        input.stored,
      );
    } catch {
      await this.#restoreCredential(input.previous);
      return {
        status: "error",
        issue: "credential-store",
      };
    }

    if (!this.#ownsOperation(input.operation)) {
      await this.#restoreCredential(input.previous);
      return { status: "stale" };
    }

    const candidateIssue = this.#candidateHealthIssue(
      input.candidate.provider,
    );
    if (candidateIssue !== undefined) {
      const restored = await this.#restoreCredential(
        input.previous,
      );
      return {
        status: "error",
        issue: restored
          ? candidateIssue
          : "credential-store",
      };
    }

    let mailbox: BotMailbox | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      // Recover before registration so a recovery failure cannot advance the
      // durable generation and fence the still-running provider.
      this.#recoverMailbox(mailbox);
      mailbox.registerAccount(input.candidate.provider.account);
    } catch {
      try {
        mailbox?.close();
      } catch {
        // Preserve the actionable credential/Gateway failure below.
      }
      const restored = await this.#restoreCredential(
        input.previous,
      );
      return {
        status: "error",
        issue: restored
          ? "gateway-store"
          : "credential-store",
      };
    }

    input.candidate.detachOperation();
    const previous = this.#detachActiveProvider();
    this.#provider = input.candidate.provider;
    this.#mailbox = mailbox;
    this.#providerController = input.candidate.controller;
    return {
      previous,
      status: "activated",
    };
  }

  async #deleteCredential(
    operation: AbortController,
  ): Promise<
    | {
        readonly previous: ActiveBotProvider | undefined;
        readonly status: "deleted";
      }
    | { readonly status: "error" }
    | { readonly status: "stale" }
  > {
    let result: VaultOperationResult<
      | {
          readonly previous:
            | ActiveBotProvider
            | undefined;
          readonly status: "deleted";
        }
      | { readonly status: "error" }
      | { readonly status: "stale" }
    >;
    try {
      result = await this.#serializeVaultOperation(
        operation,
        async () => {
          let previous: StoredBotCredential | undefined;
          try {
            previous = await this.#vault.readBot(
              this.#driver.provider,
            );
          } catch {
            return this.#ownsOperation(operation)
              ? { status: "error" }
              : { status: "stale" };
          }
          if (!this.#ownsOperation(operation)) {
            return { status: "stale" };
          }
          try {
            await this.#vault.deleteBot(
              this.#driver.provider,
            );
          } catch {
            await this.#restoreCredential(previous);
            return this.#ownsOperation(operation)
              ? { status: "error" }
              : { status: "stale" };
          }
          if (!this.#ownsOperation(operation)) {
            await this.#restoreCredential(previous);
            return { status: "stale" };
          }
          return {
            previous: this.#detachActiveProvider(),
            status: "deleted",
          };
        },
      );
    } catch {
      return this.#ownsOperation(operation)
        ? { status: "error" }
        : { status: "stale" };
    }
    return result.status === "stale"
      ? { status: "stale" }
      : result.value;
  }

  async #resetCredentialAndMailbox(
    operation: AbortController,
  ): Promise<
    | {
        readonly previous: ActiveBotProvider | undefined;
        readonly status: "reset";
      }
    | { readonly status: "stale" }
    | {
        readonly issue: "credential-store" | "gateway-store";
        readonly status: "error";
      }
  > {
    let result: VaultOperationResult<
      | {
          readonly previous:
            | ActiveBotProvider
            | undefined;
          readonly status: "reset";
        }
      | { readonly status: "stale" }
      | {
          readonly issue:
            | "credential-store"
            | "gateway-store";
          readonly status: "error";
        }
    >;
    try {
      result = await this.#serializeVaultOperation(
        operation,
        async () => {
          let previous: StoredBotCredential | undefined;
          try {
            previous = await this.#vault.readBot(
              this.#driver.provider,
            );
          } catch {
            return {
              status: "error",
              issue: "credential-store",
            };
          }
          if (!this.#ownsOperation(operation)) {
            return { status: "stale" };
          }
          try {
            await this.#vault.deleteBot(
              this.#driver.provider,
            );
          } catch {
            await this.#restoreCredential(previous);
            return this.#ownsOperation(operation)
              ? {
                  status: "error",
                  issue: "credential-store",
                }
              : { status: "stale" };
          }
          if (!this.#ownsOperation(operation)) {
            await this.#restoreCredential(previous);
            return { status: "stale" };
          }

          let mailbox: BotMailbox | undefined;
          try {
            mailbox = this.#createMailbox({
              cipher: this.#vault.gatewayCipher(),
              path: this.#mailboxPath,
            });
            mailbox.removeProviderAccounts(
              this.#driver.provider,
            );
          } catch {
            try {
              mailbox?.close();
            } catch {
              // Preserve the rollback result below.
            }
            const restored =
              await this.#restoreCredential(previous);
            return {
              status: "error",
              issue: restored
                ? "gateway-store"
                : "credential-store",
            };
          }
          try {
            mailbox.close();
          } catch {
            // The reset transaction is already durable.
          }
          return {
            previous: this.#detachActiveProvider(),
            status: "reset",
          };
        },
      );
    } catch {
      return this.#ownsOperation(operation)
        ? {
            status: "error",
            issue: "credential-store",
          }
        : { status: "stale" };
    }
    return result.status === "stale"
      ? { status: "stale" }
      : result.value;
  }

  async #restoreCredential(
    previous: StoredBotCredential | undefined,
  ): Promise<boolean> {
    try {
      if (previous === undefined) {
        await this.#vault.deleteBot(this.#driver.provider);
      } else {
        await this.#vault.writeBot(
          this.#driver.provider,
          previous,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  #serializeVaultOperation<T>(
    operation: AbortController,
    action: () => Promise<T>,
  ): Promise<VaultOperationResult<T>> {
    const result = this.#vaultMutationTail.then(
      async (): Promise<VaultOperationResult<T>> => {
        if (!this.#ownsOperation(operation)) {
          return { status: "stale" };
        }
        return {
          status: "completed",
          value: await action(),
        };
      },
    );
    this.#vaultMutationTail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async #restoreStoredProviderIfUnowned(
    operation: AbortController,
  ): Promise<void> {
    if (
      this.#provider !== undefined ||
      !this.#ownsOperation(operation)
    ) {
      return;
    }
    let storedResult: VaultOperationResult<
      StoredBotCredential | undefined
    >;
    try {
      storedResult = await this.#serializeVaultOperation(
        operation,
        async () =>
          await this.#vault.readBot(this.#driver.provider),
      );
    } catch {
      return;
    }
    if (
      storedResult.status === "stale" ||
      storedResult.value === undefined ||
      !this.#ownsOperation(operation) ||
      this.#provider !== undefined
    ) {
      return;
    }
    await this.#connectStored(storedResult.value, operation);
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

    const candidate = await this.#startCandidate(
      stored,
      identity,
      operation,
    );
    if (candidate === undefined) return;

    let mailbox: BotMailbox | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      this.#recoverMailbox(mailbox);
      mailbox.registerAccount(candidate.provider.account);
    } catch {
      try {
        mailbox?.close();
      } catch {
        // Preserve the actionable Gateway failure.
      }
      await this.#closeCandidate(candidate);
      if (this.#ownsOperation(operation)) {
        this.#publish({
          state: "error",
          issue: "gateway-store",
        });
      }
      return;
    }

    candidate.detachOperation();
    const previous = this.#detachActiveProvider();
    this.#provider = candidate.provider;
    this.#mailbox = mailbox;
    this.#providerController = candidate.controller;
    await this.#closeActiveProvider(previous);
    const handoffIssue = this.#candidateHealthIssue(
      candidate.provider,
    );
    if (
      handoffIssue !== undefined &&
      this.#provider === candidate.provider
    ) {
      await this.#stopProvider();
      if (this.#ownsOperation(operation)) {
        this.#publish({
          state: "error",
          issue: handoffIssue,
        });
      }
      return;
    }
    if (
      this.#provider === candidate.provider &&
      !candidate.controller.signal.aborted
    ) {
      this.#runReceiveLoop(
        candidate.provider,
        mailbox,
        candidate.controller,
        stored.accountLabel,
      );
    }
    if (this.#ownsOperation(operation)) {
      this.#publish({
        state: "degraded",
        accountLabel: stored.accountLabel,
        issue: "agent-route-pending",
      });
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
          ingressPolicy: this.#ingressPolicy,
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

  async #closeCandidate(
    candidate: CandidateBotProvider,
  ): Promise<void> {
    candidate.detachOperation();
    candidate.controller.abort();
    await candidate.provider.close().catch(() => {});
  }

  #candidateHealthIssue(
    provider: GatewayProviderSession,
  ): BotProviderIssue | undefined {
    try {
      return this.#driver.candidateHealthIssue?.(provider);
    } catch {
      return "transport-fatal";
    }
  }

  #detachActiveProvider(): ActiveBotProvider | undefined {
    const provider = this.#provider;
    const mailbox = this.#mailbox;
    const controller = this.#providerController;
    if (
      provider === undefined ||
      mailbox === undefined ||
      controller === undefined
    ) {
      return undefined;
    }
    const active = {
      controller,
      mailbox,
      provider,
      receiveTask: this.#receiveTask,
    };
    this.#provider = undefined;
    this.#mailbox = undefined;
    this.#providerController = undefined;
    this.#receiveTask = Promise.resolve();
    controller.abort();
    return active;
  }

  async #closeActiveProvider(
    active: ActiveBotProvider | undefined,
  ): Promise<void> {
    const drain = this.#providerDrainTail.then(async () => {
      if (active === undefined) return;
      active.controller.abort();
      await active.provider.close().catch(() => {});
      await active.receiveTask.catch(() => {});
      try {
        active.mailbox.close();
      } catch {
        // Closing an already-detached mailbox must not replace channel state.
      }
    });
    this.#providerDrainTail = drain.catch(() => {});
    await drain;
  }

  async #stopProvider(): Promise<void> {
    await this.#closeActiveProvider(
      this.#detachActiveProvider(),
    );
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
