import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  pollGatewayProviderOnce,
  type GatewayCipher,
  type GatewayMailboxPort,
  type GatewayProviderSession,
} from "@lencx/minke-im-gateway";
import {
  createSqliteGatewayMailbox,
} from "@lencx/minke-im-gateway/sqlite";
import {
  createWeixinGatewayProvider,
} from "@lencx/minke-im-gateway/weixin";
import {
  beginWeixinLogin,
  createWeixinTransport,
  WeixinTransportError,
  type WeixinLoginFlow,
  type WeixinLoginOptions,
  type WeixinTransport,
} from "@lencx/minke-im-weixin";
import {
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
  type WeixinHubIssue,
  type WeixinHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import type {
  StoredWeixinGrant,
} from "./credential-vault.ts";

interface WeixinVaultPort {
  readonly available: boolean;
  delete(): Promise<void>;
  deleteAllCredentials?(): Promise<void>;
  gatewayCipher(): GatewayCipher;
  read(): Promise<StoredWeixinGrant | undefined>;
  resetGatewayCipher(): Promise<void>;
  write(value: StoredWeixinGrant): Promise<void>;
}

interface WeixinMailbox extends GatewayMailboxPort {
  close(): void;
  getAccountGeneration(accountKey: string): number | undefined;
  recover(input?: { readonly now?: number }): unknown;
  removeProviderAccounts(provider: string): number;
  registerAccount(account: GatewayProviderSession["account"]): void;
}

export interface WeixinCapabilityRuntimeOptions {
  readonly dataHome: string;
  readonly vault: WeixinVaultPort;
  readonly beginLogin?: (
    options: WeixinLoginOptions,
  ) => Promise<WeixinLoginFlow>;
  readonly createTransport?: typeof createWeixinTransport;
  readonly createMailbox?: (input: {
    readonly cipher: GatewayCipher;
    readonly path: string;
  }) => WeixinMailbox;
  readonly createProvider?: (input: {
    readonly accountKey: string;
    readonly generation: number;
    readonly transport: WeixinTransport;
  }) => GatewayProviderSession;
  readonly pollProviderOnce?: typeof pollGatewayProviderOnce;
  readonly waitBeforePoll?: (
    signal: AbortSignal,
  ) => Promise<void>;
  readonly resetGatewayMailbox?: (path: string) => Promise<void>;
  readonly gatewayResetAllowed?: () => boolean;
  readonly createFlowId?: () => string;
}

interface ActiveLogin {
  readonly controller: AbortController;
  readonly flow: WeixinLoginFlow;
  readonly flowId: string;
  readonly previousGrant: StoredWeixinGrant | undefined;
  readonly returnSnapshot: WeixinHubSnapshot;
  flowClosed: boolean;
}

interface CompletedLogin {
  readonly flowId: string;
  readonly previousGrant: StoredWeixinGrant | undefined;
  readonly resultGrant: StoredWeixinGrant;
  readonly returnSnapshot: WeixinHubSnapshot;
}

const DEFAULT_POLL_DELAY_MS = 500;

function waitBeforePoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolvePromise, reject) => {
    const finish = (error?: unknown): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolvePromise();
      else reject(error);
    };
    const onAbort = (): void => finish(signal.reason);
    const timeout = setTimeout(finish, DEFAULT_POLL_DELAY_MS);
    timeout.unref();
    signal.addEventListener("abort", onAbort, {
      once: true,
    });
  });
}

function aborted(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (
      error instanceof Error &&
      (
        error.name === "AbortError" ||
        (
          error instanceof WeixinTransportError &&
          error.code === "aborted"
        )
      )
    )
  );
}

function loginIssue(error: unknown): WeixinHubIssue {
  if (!(error instanceof WeixinTransportError)) {
    return "login-network";
  }
  if (error.code === "session-stale") return "session-stale";
  if (
    error.code === "network" ||
    error.code === "timeout" ||
    error.code === "http"
  ) {
    return "login-network";
  }
  return "login-protocol";
}

function accountKey(accountId: string): string {
  return `weixin:${createHash("sha256")
    .update(accountId)
    .digest("hex")
    .slice(0, 32)}`;
}

function accountLabel(accountId: string): string {
  const suffix = createHash("sha256")
    .update(accountId)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `•• ${suffix}`;
}

function nextStoredGrant(
  previous: StoredWeixinGrant | undefined,
  grant: StoredWeixinGrant["grant"],
  durableGeneration: number | undefined,
): StoredWeixinGrant {
  const previousGeneration =
    previous?.grant.accountId === grant.accountId
      ? previous.generation
      : 0;
  return {
    generation:
      Math.max(previousGeneration, durableGeneration ?? 0) + 1,
    grant,
  };
}

function sameCredential(
  left: StoredWeixinGrant["grant"],
  right: StoredWeixinGrant["grant"],
): boolean {
  return (
    left.accountId === right.accountId &&
    left.token === right.token &&
    left.baseUrl === right.baseUrl
  );
}

function sameStoredGrant(
  left: StoredWeixinGrant | undefined,
  right: StoredWeixinGrant,
): boolean {
  return (
    left !== undefined &&
    left.generation === right.generation &&
    sameCredential(left.grant, right.grant)
  );
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

function preemptsLifecycle(command: RemoteHubCommand): boolean {
  return (
    command.kind === "refresh" ||
    command.kind === "gateway/reset-local" ||
    command.kind === "weixin/reconnect" ||
    command.kind === "weixin/reset-local" ||
    command.kind === "weixin/unlink"
  );
}

async function resetGatewayMailbox(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-journal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-wal`, { force: true }),
  ]);
}

/**
 * Own the complete single-account Weixin link and durable receive lifecycle.
 *
 * The renderer gets only a finite projection. Login grant values stay inside
 * this runtime and are committed to the OS-protected vault before transport
 * startup is announced.
 */
export class WeixinCapabilityRuntime {
  readonly #mailboxPath: string;
  readonly #vault: WeixinVaultPort;
  readonly #beginLogin: NonNullable<
    WeixinCapabilityRuntimeOptions["beginLogin"]
  >;
  readonly #createTransport: NonNullable<
    WeixinCapabilityRuntimeOptions["createTransport"]
  >;
  readonly #createMailbox: NonNullable<
    WeixinCapabilityRuntimeOptions["createMailbox"]
  >;
  readonly #createProvider: NonNullable<
    WeixinCapabilityRuntimeOptions["createProvider"]
  >;
  readonly #pollProviderOnce: NonNullable<
    WeixinCapabilityRuntimeOptions["pollProviderOnce"]
  >;
  readonly #waitBeforePoll: NonNullable<
    WeixinCapabilityRuntimeOptions["waitBeforePoll"]
  >;
  readonly #createFlowId: NonNullable<
    WeixinCapabilityRuntimeOptions["createFlowId"]
  >;
  readonly #resetGatewayMailbox: NonNullable<
    WeixinCapabilityRuntimeOptions["resetGatewayMailbox"]
  >;
  readonly #gatewayResetAllowed:
    | (() => boolean)
    | undefined;
  readonly #listeners = new Set<() => void>();
  #snapshot = initialSnapshot();
  #initializePromise: Promise<void> | undefined;
  #commandTail: Promise<RemoteHubSnapshot> = Promise.resolve(
    initialSnapshot(),
  );
  #pendingLoginController: AbortController | undefined;
  #activeLogin: ActiveLogin | undefined;
  #completedLogin: CompletedLogin | undefined;
  #loginTask: Promise<void> = Promise.resolve();
  #provider: GatewayProviderSession | undefined;
  #mailbox: WeixinMailbox | undefined;
  #providerController: AbortController | undefined;
  #receiveTask: Promise<void> = Promise.resolve();
  #initializeMayConnect = true;
  #disposed = false;

  constructor(options: WeixinCapabilityRuntimeOptions) {
    this.#mailboxPath = join(
      options.dataHome,
      "minke",
      "im",
      "gateway.sqlite",
    );
    this.#vault = options.vault;
    this.#beginLogin = options.beginLogin ?? beginWeixinLogin;
    this.#createTransport =
      options.createTransport ?? createWeixinTransport;
    this.#createMailbox =
      options.createMailbox ?? createSqliteGatewayMailbox;
    this.#createProvider =
      options.createProvider ?? createWeixinGatewayProvider;
    this.#pollProviderOnce =
      options.pollProviderOnce ?? pollGatewayProviderOnce;
    this.#waitBeforePoll =
      options.waitBeforePoll ?? waitBeforePoll;
    this.#resetGatewayMailbox =
      options.resetGatewayMailbox ?? resetGatewayMailbox;
    this.#gatewayResetAllowed = options.gatewayResetAllowed;
    this.#createFlowId = options.createFlowId ?? randomUUID;
  }

  getSnapshot = (): RemoteHubSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  async dispatch(value: unknown): Promise<RemoteHubSnapshot> {
    this.#assertActive();
    const command = parseRemoteHubCommand(value);
    if (command.kind === "gateway/reset-local") {
      this.#assertGatewayResetAllowed();
    }
    const preemption = this.#preempt(command);
    const run = async (): Promise<RemoteHubSnapshot> => {
      await preemption;
      if (preemptsLifecycle(command)) {
        await (
          this.#initializePromise ??
          Promise.resolve()
        );
      } else {
        await this.initialize();
      }
      if (this.#disposed) return this.#snapshot;
      switch (command.kind) {
        case "refresh":
        case "weixin/reconnect":
          await this.#reconnect();
          break;
        case "gateway/reset-local":
          this.#assertGatewayResetAllowed();
          await this.#resetGatewayLocal();
          break;
        case "weixin/link/start":
          await this.#startLink();
          break;
        case "weixin/link/verify":
          this.#verify(command);
          break;
        case "weixin/link/cancel":
          await this.#cancelLink(command.flowId);
          break;
        case "weixin/reset-local":
          await this.#resetLocal();
          break;
        case "weixin/unlink":
          await this.#unlink();
          break;
      }
      return this.#snapshot;
    };
    const operation = this.#commandTail.then(run, run);
    this.#commandTail = operation.catch(() => this.#snapshot);
    return await operation;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActiveLogin();
    this.#providerController?.abort();
    const stopProvider = this.#stopProvider();
    await Promise.allSettled([
      this.#initializePromise ?? Promise.resolve(),
      this.#commandTail,
      this.#loginTask,
      stopProvider,
    ]);
    await this.#receiveTask.catch(() => {});
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.#vault.available) {
      this.#publish(
        { state: "unavailable", issue: "vault-unavailable" },
        "unavailable",
      );
      return;
    }
    let stored: StoredWeixinGrant | undefined;
    try {
      stored = await this.#vault.read();
    } catch {
      this.#publish({ state: "error", issue: "credential-read" }, "ready");
      return;
    }
    if (this.#disposed) return;
    if (stored === undefined) {
      this.#publish({ state: "unlinked" }, "ready");
      return;
    }
    if (!this.#initializeMayConnect) return;
    await this.#connect(stored);
  }

  async #reconnect(): Promise<void> {
    if (!this.#vault.available) {
      this.#publish(
        { state: "unavailable", issue: "vault-unavailable" },
        "unavailable",
      );
      return;
    }
    this.#cancelActiveLogin();
    await this.#loginTask.catch(() => {});
    if (this.#disposed) return;
    await this.#stopProvider();
    let stored: StoredWeixinGrant | undefined;
    try {
      stored = await this.#vault.read();
    } catch {
      this.#publish({ state: "error", issue: "credential-read" }, "ready");
      return;
    }
    if (this.#disposed) return;
    if (stored === undefined) {
      this.#publish({ state: "unlinked" }, "ready");
      return;
    }
    await this.#connect(stored);
  }

  async #startLink(): Promise<void> {
    if (!this.#vault.available) {
      this.#publish(
        { state: "unavailable", issue: "vault-unavailable" },
        "unavailable",
      );
      return;
    }
    if (
      this.#activeLogin !== undefined ||
      this.#pendingLoginController !== undefined
    ) {
      return;
    }
    this.#completedLogin = undefined;
    const returnSnapshot = this.#snapshot.channels.weixin;
    let previousGrant: StoredWeixinGrant | undefined;
    try {
      previousGrant = await this.#vault.read();
    } catch {
      this.#publish({
        state: "error",
        issue: "credential-read",
      }, "ready");
      return;
    }
    if (this.#disposed) return;
    await this.#stopProvider();
    if (this.#disposed) return;
    const controller = new AbortController();
    this.#pendingLoginController = controller;
    try {
      const flow = await this.#beginLogin({
        botAgent: "Minke/0.2.0",
        ...(previousGrant === undefined
          ? {}
          : {
              knownBotTokens: [
                previousGrant.grant.token,
              ],
            }),
        signal: controller.signal,
      });
      if (
        this.#disposed ||
        controller.signal.aborted ||
        this.#pendingLoginController !== controller
      ) {
        flow.close();
        return;
      }
      const active: ActiveLogin = {
        controller,
        flow,
        flowId: this.#createFlowId(),
        previousGrant,
        returnSnapshot,
        flowClosed: false,
      };
      this.#pendingLoginController = undefined;
      this.#activeLogin = active;
      this.#publishLinking(active, "waiting");
      this.#runLogin(active);
    } catch (error) {
      const wasAborted = aborted(error, controller.signal);
      const active = this.#activeLogin;
      if (active?.controller === controller) {
        this.#finishActiveLogin(active);
      } else {
        controller.abort();
      }
      if (wasAborted) return;
      this.#publishLoginError(loginIssue(error));
    } finally {
      if (this.#pendingLoginController === controller) {
        this.#pendingLoginController = undefined;
      }
    }
  }

  #verify(
    command: Extract<
      RemoteHubCommand,
      { readonly kind: "weixin/link/verify" }
    >,
  ): void {
    const active = this.#activeLogin;
    const weixin = this.#snapshot.channels.weixin;
    if (
      active === undefined ||
      active.flowId !== command.flowId ||
      weixin.state !== "linking" ||
      weixin.phase !== "verification-required"
    ) {
      throw new TypeError("Weixin login flow is not awaiting verification");
    }
    this.#publishLinking(active, "scanned");
    this.#runLogin(active, command.code);
  }

  async #cancelLink(flowId: string): Promise<void> {
    const active = this.#activeLogin;
    const completed = this.#completedLogin;
    const ownership =
      active?.flowId === flowId
        ? {
            previousGrant: active.previousGrant,
            returnSnapshot: active.returnSnapshot,
            resultGrant: undefined,
          }
        : completed?.flowId === flowId
          ? {
              previousGrant: completed.previousGrant,
              returnSnapshot: completed.returnSnapshot,
              resultGrant: completed.resultGrant,
            }
          : undefined;
    if (ownership === undefined) {
      throw new TypeError("Weixin login flow is no longer active");
    }
    const {
      previousGrant,
      returnSnapshot,
      resultGrant: expectedCurrent,
    } = ownership;
    this.#cancelActiveLogin();
    await this.#loginTask.catch(() => {});
    if (this.#disposed) return;

    let currentGrant: StoredWeixinGrant | undefined;
    if (
      previousGrant !== undefined ||
      expectedCurrent !== undefined
    ) {
      try {
        currentGrant = await this.#vault.read();
      } catch {
        this.#publish({
          state: "error",
          issue: "credential-read",
        }, "ready");
        return;
      }
    }
    if (
      expectedCurrent !== undefined &&
      !sameStoredGrant(currentGrant, expectedCurrent)
    ) {
      throw new TypeError(
        "Weixin login flow was replaced by a newer credential",
      );
    }

    await this.#stopProvider();
    const restored = await this.#restorePreviousGrant(
      previousGrant,
      currentGrant,
    );
    if (!restored) return;
    this.#publish(returnSnapshot, "ready");
  }

  async #driveLogin(
    active: ActiveLogin,
    verificationCode?: string,
  ): Promise<void> {
    let code = verificationCode;
    try {
      while (this.#isActiveLogin(active)) {
        const progress = await active.flow.poll({
          signal: active.controller.signal,
          ...(code === undefined
            ? {}
            : { verificationCode: code }),
        });
        code = undefined;
        if (!this.#isActiveLogin(active)) return;
        switch (progress.status) {
          case "waiting":
            this.#publishLinking(active, "waiting");
            break;
          case "scanned":
            this.#publishLinking(active, "scanned");
            break;
          case "verification-required":
            this.#publishLinking(
              active,
              "verification-required",
            );
            return;
          case "refreshed":
            this.#publishLinking(
              active,
              "waiting",
              progress.challenge,
            );
            break;
          case "already-bound":
            if (active.previousGrant === undefined) {
              this.#finishActiveLogin(active);
              this.#publish({
                state: "error",
                issue: "already-bound",
              }, "ready");
              return;
            }
            this.#closeLoginFlow(active);
            await this.#connect(
              active.previousGrant,
              active.controller.signal,
            );
            this.#finishActiveLogin(
              active,
              active.previousGrant,
            );
            return;
          case "grant-issued":
            this.#publish({
              state: "connecting",
              accountLabel: accountLabel(
                progress.grant.accountId,
              ),
            }, "ready");
            this.#closeLoginFlow(active);
            const stored = await this.#acceptGrant(
              progress.grant,
              active.controller.signal,
            );
            this.#finishActiveLogin(active, stored);
            return;
        }
        await this.#waitBeforePoll(active.controller.signal);
      }
    } catch (error) {
      if (aborted(error, active.controller.signal)) return;
      if (this.#isActiveLogin(active)) {
        this.#finishActiveLogin(active);
        this.#publishLoginError(loginIssue(error));
      }
    }
  }

  async #acceptGrant(
    grant: StoredWeixinGrant["grant"],
    signal: AbortSignal,
  ): Promise<StoredWeixinGrant | undefined> {
    let stored: StoredWeixinGrant;
    try {
      const previous = await this.#vault.read();
      if (this.#disposed || signal.aborted) return undefined;
      const key = accountKey(grant.accountId);
      const mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      let durableGeneration: number | undefined;
      try {
        durableGeneration = mailbox.getAccountGeneration(key);
      } finally {
        mailbox.close();
      }
      stored = nextStoredGrant(
        previous,
        grant,
        durableGeneration,
      );
      if (this.#disposed || signal.aborted) return undefined;
      await this.#vault.write(stored);
    } catch {
      if (this.#disposed || signal.aborted) return undefined;
      this.#publish({
        state: "error",
        issue: "credential-store",
      }, "ready");
      return undefined;
    }
    if (this.#disposed || signal.aborted) return undefined;
    await this.#connect(stored, signal);
    return stored;
  }

  async #connect(
    stored: StoredWeixinGrant,
    parentSignal?: AbortSignal,
  ): Promise<void> {
    const parentAborted = (): boolean =>
      parentSignal?.aborted === true;
    await this.#stopProvider();
    if (
      this.#disposed ||
      parentAborted()
    ) {
      return;
    }
    const label = accountLabel(stored.grant.accountId);
    this.#publish({
      state: "connecting",
      accountLabel: label,
    }, "ready");
    let mailbox: WeixinMailbox | undefined;
    let provider: GatewayProviderSession | undefined;
    let providerOwned = false;
    const controller = new AbortController();
    const abortFromParent = (): void => {
      controller.abort(parentSignal?.reason);
    };
    parentSignal?.addEventListener("abort", abortFromParent, {
      once: true,
    });
    if (parentAborted()) abortFromParent();
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      const transport = this.#createTransport({
        botAgent: "Minke/0.2.0",
        credential: {
          accountId: stored.grant.accountId,
          token: stored.grant.token,
          baseUrl: stored.grant.baseUrl,
        },
      });
      provider = this.#createProvider({
        accountKey: accountKey(stored.grant.accountId),
        generation: stored.generation,
        transport,
      });
      mailbox.registerAccount(provider.account);
      mailbox.recover();
      this.#provider = provider;
      this.#mailbox = mailbox;
      this.#providerController = controller;
      providerOwned = true;
      await provider.start({ signal: controller.signal });
      if (
        this.#disposed ||
        controller.signal.aborted ||
        this.#provider !== provider
      ) {
        return;
      }
      this.#publish({
        state: "degraded",
        accountLabel: label,
        issue: "agent-route-pending",
      }, "ready");
      this.#runReceiveLoop(
        provider,
        mailbox,
        controller,
        label,
      );
    } catch (error) {
      const wasAborted = aborted(error, controller.signal);
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
      if (
        wasAborted ||
        this.#disposed ||
        parentAborted()
      ) {
        return;
      }
      if (
        error instanceof WeixinTransportError &&
        error.code === "session-stale"
      ) {
        this.#publish({
          state: "session-stale",
          issue: "session-stale",
        }, "ready");
      } else {
        this.#publish({
          state: "error",
          issue: "transport-start",
        }, "ready");
      }
    } finally {
      parentSignal?.removeEventListener(
        "abort",
        abortFromParent,
      );
    }
  }

  async #receiveLoop(
    provider: GatewayProviderSession,
    mailbox: WeixinMailbox,
    controller: AbortController,
    label: string,
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
        const weixin = this.#snapshot.channels.weixin;
        if (
          weixin.state === "degraded" &&
          weixin.issue === "receive"
        ) {
          this.#publish({
            state: "degraded",
            accountLabel: label,
            issue: "agent-route-pending",
          }, "ready");
        }
      } catch (error) {
        if (aborted(error, controller.signal)) return;
        if (
          error instanceof WeixinTransportError &&
          error.code === "session-stale"
        ) {
          this.#publish({
            state: "session-stale",
            issue: "session-stale",
          }, "ready");
          controller.abort();
          if (this.#provider === provider) {
            this.#provider = undefined;
            this.#mailbox = undefined;
            this.#providerController = undefined;
            await provider.close().catch(() => {});
            mailbox.close();
          }
          return;
        }
        const weixin = this.#snapshot.channels.weixin;
        if (
          weixin.state !== "degraded" ||
          weixin.issue !== "receive"
        ) {
          this.#publish({
            state: "degraded",
            accountLabel: label,
            issue: "receive",
          }, "ready");
        }
        try {
          await this.#waitBeforePoll(controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  #runLogin(
    active: ActiveLogin,
    verificationCode?: string,
  ): void {
    const task = this.#driveLogin(active, verificationCode)
      .catch(() => {});
    this.#loginTask = task;
    void task.then(() => {
      if (this.#loginTask === task) {
        this.#loginTask = Promise.resolve();
      }
    });
  }

  #runReceiveLoop(
    provider: GatewayProviderSession,
    mailbox: WeixinMailbox,
    controller: AbortController,
    label: string,
  ): void {
    const task = this.#receiveLoop(
      provider,
      mailbox,
      controller,
      label,
    ).catch(() => {});
    this.#receiveTask = task;
    void task.then(() => {
      if (this.#receiveTask === task) {
        this.#receiveTask = Promise.resolve();
      }
    });
  }

  async #unlink(): Promise<void> {
    this.#cancelActiveLogin();
    await this.#loginTask.catch(() => {});
    await this.#stopProvider();
    if (this.#disposed) return;
    try {
      await this.#vault.delete();
      this.#publish({ state: "unlinked" }, "ready");
    } catch {
      this.#publish({
        state: "error",
        issue: "credential-store",
      }, "ready");
    }
  }

  async #resetLocal(): Promise<void> {
    this.#cancelActiveLogin();
    await this.#loginTask.catch(() => {});
    await this.#stopProvider();
    if (this.#disposed) return;
    let mailbox: WeixinMailbox | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      mailbox.removeProviderAccounts("weixin");
      mailbox.close();
      mailbox = undefined;
    } catch {
      try {
        mailbox?.close();
      } catch {
        // The Gateway-wide recovery path remains available below.
      }
      this.#publish({
        state: "error",
        issue: "gateway-store",
      }, "ready");
      return;
    }
    try {
      await this.#vault.delete();
      this.#publish({ state: "unlinked" }, "ready");
    } catch {
      this.#publish({
        state: "error",
        issue: "credential-store",
      }, "ready");
    }
  }

  async #resetGatewayLocal(): Promise<void> {
    this.#cancelActiveLogin();
    await this.#loginTask.catch(() => {});
    await this.#stopProvider();
    if (this.#disposed) return;
    try {
      await this.#resetGatewayMailbox(this.#mailboxPath);
    } catch {
      this.#publish({
        state: "error",
        issue: "gateway-store",
      }, "ready");
      return;
    }
    try {
      await Promise.all([
        this.#vault.deleteAllCredentials?.() ??
          this.#vault.delete(),
        this.#vault.resetGatewayCipher(),
      ]);
      this.#publish({ state: "unlinked" }, "ready");
    } catch {
      this.#publish({
        state: "error",
        issue: "credential-store",
      }, "ready");
    }
  }

  #publishLinking(
    active: ActiveLogin,
    phase: Extract<
      WeixinHubSnapshot,
      { readonly state: "linking" }
    >["phase"],
    challenge = active.flow.challenge,
  ): void {
    if (!this.#isActiveLogin(active)) return;
    this.#publish({
      state: "linking",
      flowId: active.flowId,
      phase,
      challenge: {
        content: challenge.qrContent,
        expiresAt: challenge.expiresAt,
      },
    }, "ready");
  }

  #publishLoginError(issue: WeixinHubIssue): void {
    if (issue === "session-stale") {
      this.#publish({
        state: "session-stale",
        issue,
      }, "ready");
      return;
    }
    this.#publish({
      state: "error",
      issue:
        issue === "vault-unavailable" ||
        issue === "agent-route-pending"
          ? "login-protocol"
          : issue,
    }, "ready");
  }

  #publish(
    weixin: WeixinHubSnapshot,
    credentialVault: "ready" | "unavailable" | "pending",
  ): void {
    if (this.#disposed) return;
    this.#snapshot = parseRemoteHubSnapshot({
      revision: this.#snapshot.revision + 1,
      dependencies: {
        credentialVault,
        agentRoute: "pending",
      },
      channels: {
        weixin,
        telegram: { state: "loading" },
        discord: { state: "loading" },
      },
    });
    for (const listener of this.#listeners) listener();
  }

  #isActiveLogin(active: ActiveLogin): boolean {
    return (
      !this.#disposed &&
      this.#activeLogin === active &&
      !active.controller.signal.aborted
    );
  }

  #finishActiveLogin(
    active: ActiveLogin,
    resultGrant?: StoredWeixinGrant,
  ): void {
    if (this.#activeLogin === active) {
      this.#activeLogin = undefined;
      this.#completedLogin =
        resultGrant === undefined
          ? undefined
          : {
              flowId: active.flowId,
              previousGrant: active.previousGrant,
              resultGrant,
              returnSnapshot: active.returnSnapshot,
            };
    }
    active.controller.abort();
    this.#closeLoginFlow(active);
  }

  #closeLoginFlow(active: ActiveLogin): void {
    if (active.flowClosed) return;
    active.flowClosed = true;
    try {
      active.flow.close();
    } catch {
      // Cleanup must not strand the runtime in an owned login state.
    }
  }

  #cancelActiveLogin(): void {
    const pending = this.#pendingLoginController;
    this.#pendingLoginController = undefined;
    pending?.abort();
    const active = this.#activeLogin;
    this.#activeLogin = undefined;
    this.#completedLogin = undefined;
    active?.controller.abort();
    if (active !== undefined) {
      this.#closeLoginFlow(active);
    }
  }

  async #preempt(command: RemoteHubCommand): Promise<void> {
    if (!preemptsLifecycle(command)) return;
    this.#initializeMayConnect = false;
    this.#cancelActiveLogin();
    const loginTask = this.#loginTask.catch(() => {});
    const stopTask = this.#stopProvider();
    await Promise.all([loginTask, stopTask]);
    // A cancelled login can briefly acquire a provider while completing an
    // already-started credential commit. Fence that late acquisition too.
    await this.#stopProvider();
  }

  async #restorePreviousGrant(
    previousGrant: StoredWeixinGrant | undefined,
    currentGrant: StoredWeixinGrant | undefined,
  ): Promise<boolean> {
    if (previousGrant === undefined) {
      try {
        await this.#vault.delete();
        return true;
      } catch {
        this.#publish({
          state: "error",
          issue: "credential-store",
        }, "ready");
        return false;
      }
    }

    let mailbox: WeixinMailbox | undefined;
    let durableGeneration: number | undefined;
    try {
      mailbox = this.#createMailbox({
        cipher: this.#vault.gatewayCipher(),
        path: this.#mailboxPath,
      });
      durableGeneration = mailbox.getAccountGeneration(
        accountKey(previousGrant.grant.accountId),
      );
      mailbox.close();
      mailbox = undefined;
    } catch {
      try {
        mailbox?.close();
      } catch {
        // The Gateway-wide recovery path remains available.
      }
      this.#publish({
        state: "error",
        issue: "gateway-store",
      }, "ready");
      return false;
    }

    const currentForSameAccount =
      currentGrant?.grant.accountId ===
      previousGrant.grant.accountId
        ? currentGrant
        : undefined;
    const generationFloor = Math.max(
      previousGrant.generation,
      durableGeneration ?? 0,
      currentForSameAccount?.generation ?? 0,
    );
    const replacedCredential =
      (
        currentForSameAccount !== undefined &&
        !sameCredential(
          currentForSameAccount.grant,
          previousGrant.grant,
        )
      ) ||
      (
        durableGeneration !== undefined &&
        durableGeneration > previousGrant.generation
      );
    const restoredGrant: StoredWeixinGrant = {
      generation:
        generationFloor + (replacedCredential ? 1 : 0),
      grant: previousGrant.grant,
    };
    try {
      await this.#vault.write(restoredGrant);
      return true;
    } catch {
      this.#publish({
        state: "error",
        issue: "credential-store",
      }, "ready");
      return false;
    }
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

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Remote Hub runtime is disposed");
    }
  }

  #assertGatewayResetAllowed(): void {
    const weixin = this.#snapshot.channels.weixin;
    if (
      (
        weixin.state !== "error" ||
        weixin.issue !== "gateway-store"
      ) &&
      this.#gatewayResetAllowed?.() !== true
    ) {
      throw new TypeError(
        "IM Gateway reset is only available after a Gateway store failure",
      );
    }
  }
}
