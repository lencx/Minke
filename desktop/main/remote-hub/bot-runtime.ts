import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  botEchoOnlyGatewayIngress,
  dispatchGatewayProviderOnce,
  pollGatewayProviderOnce,
  routeGatewayInboxOnce,
  type GatewayAgentMailboxPort,
  type GatewayCipher,
  type GatewayInboundKind,
  type GatewayIngressPolicy,
  type GatewayMailboxPort,
  type GatewayOutboxHealth,
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

interface BotMailbox
  extends GatewayMailboxPort, GatewayAgentMailboxPort {
  close(): void;
  getAccountGeneration(accountKey: string): number | undefined;
  inspectOutboxHealth(input: {
    readonly accountKey: string;
    readonly generation: number;
  }): GatewayOutboxHealth;
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
  | "agent"
  | "agent-route-pending"
  | "credential-read"
  | "credential-store"
  | "delivery"
  | "gateway-store"
  | "receive"
  | "vault-unavailable"
>;

type BotHubErrorIssue = Extract<
  BotHubSnapshot,
  { readonly state: "error" }
>["issue"];

type BotHubSnapshotInput =
  | Exclude<BotHubSnapshot, { readonly state: "error" }>
  | {
      readonly state: "error";
      readonly issue: BotHubErrorIssue;
    };

export interface BotInboundMessageInput {
  readonly accountKey?: string;
  readonly conversationId: string;
  readonly kind: GatewayInboundKind;
  readonly nativeId: string;
  readonly payload: unknown;
  readonly peerId: string;
  readonly senderId: string;
}

export interface BotInboundMessage {
  readonly conversationKind: "direct" | "group";
  readonly senderLabel: string;
  readonly text?: string;
}

export interface BotAgentTurnPreview {
  readonly title: string;
  readonly url: string;
}

export type BotAgentTurnResult =
  | {
      readonly outcome: "completed";
      readonly sessionId: string;
      readonly text: string;
      readonly turn: number;
      readonly endReason: string;
      readonly previews?: readonly BotAgentTurnPreview[];
    }
  | {
      readonly outcome: "failed" | "no-response";
      readonly sessionId: string;
      readonly turn?: number;
      readonly endReason: string;
    };

export interface BotAgentRoutePort {
  runAgentTurn(
    input: {
      readonly operationId: string;
      readonly sessionId: string;
      readonly text: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<BotAgentTurnResult>;
}

export interface BotProviderDriver<Identity> {
  readonly provider: BotCredentialProvider;
  agentReplyPayload?(
    markdown: string,
    context: {
      readonly input: BotInboundMessageInput;
      readonly message: BotInboundMessage;
    },
  ): unknown;
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
  inspectMessage?(
    input: BotInboundMessageInput,
    context: {
      readonly providerAccountId: string;
    },
  ): BotInboundMessage | undefined;
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
  readonly routeInboxOnce?: typeof routeGatewayInboxOnce;
  readonly dispatchProviderOnce?: typeof dispatchGatewayProviderOnce;
  readonly ingressPolicy?: GatewayIngressPolicy;
  readonly agentRoute?: BotAgentRoutePort;
  readonly recoverMailbox?: GatewayMailboxRecovery;
  readonly waitBeforeRetry?: (
    signal: AbortSignal,
  ) => Promise<void>;
  readonly onSnapshot?: (snapshot: BotHubSnapshot) => void;
  readonly now?: () => number;
  readonly createPairingCode?: () => string;
  readonly createPairingRequestId?: () => string;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const BOT_PAIRING_TTL_MS = 60 * 60 * 1_000;
const BOT_AGENT_LEASE_MS = 5 * 60 * 1_000;
const BOT_DELIVERY_LEASE_MS = 30_000;
const BOT_AGENT_REPLY_CODE_POINTS = 3_900;
const BOT_MAX_PENDING_INBOX_PER_ACCOUNT = 128;
const BOT_CONSUMED_INBOX_RETENTION_MS =
  7 * 24 * 60 * 60 * 1_000;
const BOT_PAIRING_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AGENT_PREVIEW_PATH_PATTERN =
  /^\/minke-preview\/[A-Za-z0-9_-]{16,128}\/$/u;

interface PendingBotPairing {
  readonly code: string;
  readonly conversationId: string;
  readonly expiresAt: number;
  readonly nativeId: string;
  readonly peerId: string;
  readonly requestId: string;
  readonly senderId: string;
  readonly senderLabel: string;
}

interface BotRuntimeIssues {
  agent: boolean;
  delivery: boolean;
  receive: boolean;
}

function createPairingCode(): string {
  const bytes = randomBytes(8);
  return [...bytes]
    .map((value) =>
      BOT_PAIRING_ALPHABET[value & 31])
    .join("");
}

function botAgentSessionId(
  provider: BotCredentialProvider,
  accountKeyValue: string,
  conversationId: string,
): string {
  return `minke-im-${provider}-${createHash("sha256")
    .update(accountKeyValue)
    .update("\0")
    .update(conversationId)
    .digest("hex")
    .slice(0, 32)}`;
}

function boundedReplyText(value: string): string {
  const text = value.trim();
  const codePoints = [...text];
  if (codePoints.length <= BOT_AGENT_REPLY_CODE_POINTS) {
    return text;
  }
  return `${codePoints
    .slice(0, BOT_AGENT_REPLY_CODE_POINTS - 1)
    .join("")}…`;
}

function botAgentReplyText(
  text: string,
  previews: readonly BotAgentTurnPreview[] | undefined,
): string {
  if (previews === undefined || previews.length === 0) {
    return boundedReplyText(text);
  }
  let suffix = "\n\nHTML 预览：";
  let links = 0;
  for (const preview of previews) {
    let url: URL;
    try {
      url = new URL(preview.url);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !AGENT_PREVIEW_PATH_PATTERN.test(url.pathname)
    ) {
      continue;
    }
    const line = `\n${preview.title}\n${url.href}`;
    if (
      [...`${suffix}${line}`].length >
      BOT_AGENT_REPLY_CODE_POINTS - 2
    ) {
      break;
    }
    suffix += line;
    links += 1;
  }
  if (links === 0) return boundedReplyText(text);
  const body = [...text.trim()];
  const remaining =
    BOT_AGENT_REPLY_CODE_POINTS - [...suffix].length;
  const boundedBody = body.length <= remaining
    ? body.join("")
    : `${body
        .slice(0, Math.max(0, remaining - 1))
        .join("")}…`;
  return `${boundedBody}${suffix}`;
}

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
  const sameAccount = previous?.accountId === input.accountId;
  const previousGeneration = sameAccount
    ? previous.generation
    : 0;
  return {
    ...input,
    ...(sameAccount &&
    previous.authorizedUserId !== undefined
      ? { authorizedUserId: previous.authorizedUserId }
      : {}),
    generation:
      Math.max(previousGeneration, durableGeneration ?? 0) + 1,
  };
}

interface ActiveBotProvider {
  readonly controller: AbortController;
  readonly dispatchTask: Promise<void>;
  readonly mailbox: BotMailbox;
  readonly provider: GatewayProviderSession;
  readonly receiveTask: Promise<void>;
  readonly routeTask: Promise<void>;
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
  readonly #routeInboxOnce: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["routeInboxOnce"]
  >;
  readonly #dispatchProviderOnce: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["dispatchProviderOnce"]
  >;
  readonly #configuredIngressPolicy:
    | GatewayIngressPolicy
    | undefined;
  readonly #agentRoute: BotAgentRoutePort | undefined;
  readonly #recoverMailbox: GatewayMailboxRecovery;
  readonly #waitBeforeRetry: NonNullable<
    BotCapabilityRuntimeOptions<Identity>["waitBeforeRetry"]
  >;
  readonly #onSnapshot:
    | ((snapshot: BotHubSnapshot) => void)
    | undefined;
  readonly #now: () => number;
  readonly #createPairingCode: () => string;
  readonly #createPairingRequestId: () => string;
  #snapshot: BotHubSnapshot = Object.freeze({
    state: "loading",
  });
  #provider: GatewayProviderSession | undefined;
  #mailbox: BotMailbox | undefined;
  #credential: StoredBotCredential | undefined;
  #providerController: AbortController | undefined;
  #operationController: AbortController | undefined;
  #receiveTask: Promise<void> = Promise.resolve();
  #routeTask: Promise<void> = Promise.resolve();
  #dispatchTask: Promise<void> = Promise.resolve();
  #providerDrainTail: Promise<void> = Promise.resolve();
  #vaultMutationTail: Promise<void> = Promise.resolve();
  #pairing: PendingBotPairing | undefined;
  readonly #runtimeIssues: BotRuntimeIssues = {
    agent: false,
    delivery: false,
    receive: false,
  };
  #hasStoredCredential = false;
  #disposed = false;

  constructor(options: BotCapabilityRuntimeOptions<Identity>) {
    this.#driver = options.driver;
    this.#mailboxPath = options.mailboxPath;
    this.#vault = options.vault;
    this.#createMailbox =
      options.createMailbox ??
      ((input) =>
        createSqliteGatewayMailbox({
          ...input,
          consumedInboxRetentionMs:
            BOT_CONSUMED_INBOX_RETENTION_MS,
          maxPendingInboxPerAccount:
            BOT_MAX_PENDING_INBOX_PER_ACCOUNT,
        }));
    this.#pollProviderOnce =
      options.pollProviderOnce ?? pollGatewayProviderOnce;
    this.#routeInboxOnce =
      options.routeInboxOnce ?? routeGatewayInboxOnce;
    this.#dispatchProviderOnce =
      options.dispatchProviderOnce ??
      dispatchGatewayProviderOnce;
    this.#configuredIngressPolicy =
      options.ingressPolicy;
    this.#agentRoute = options.agentRoute;
    this.#recoverMailbox =
      options.recoverMailbox ??
      createGatewayMailboxRecovery();
    this.#waitBeforeRetry =
      options.waitBeforeRetry ?? waitBeforeRetry;
    this.#onSnapshot = options.onSnapshot;
    this.#now = options.now ?? Date.now;
    this.#createPairingCode =
      options.createPairingCode ?? createPairingCode;
    this.#createPairingRequestId =
      options.createPairingRequestId ?? randomUUID;
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
    this.#hasStoredCredential = stored !== undefined;
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
    this.#hasStoredCredential = previous !== undefined;

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
      this.#runProviderLoops(
        candidate.provider,
        this.#mailbox!,
        candidate.controller,
        stored.accountLabel,
      );
    }
    if (this.#ownsOperation(controller)) {
      this.#publishRuntimeState(stored.accountLabel);
    }
  }

  async approvePairing(requestId: string): Promise<void> {
    this.#assertActive();
    const pairing = this.#activePairing();
    if (
      pairing === undefined ||
      pairing.requestId !== requestId
    ) {
      throw new TypeError(
        `${this.#providerLabel()} pairing request is no longer active`,
      );
    }
    const operation = this.#operationController;
    const credential = this.#credential;
    const provider = this.#provider;
    if (
      operation === undefined ||
      credential === undefined ||
      provider === undefined ||
      !this.#ownsOperation(operation)
    ) {
      throw new Error(
        `${this.#providerLabel()} provider is not active`,
      );
    }
    const next: StoredBotCredential = {
      ...credential,
      authorizedUserId: pairing.senderId,
    };
    const result = await this.#serializeVaultOperation(
      operation,
      async () => {
        await this.#vault.writeBot(
          this.#driver.provider,
          next,
        );
        return next;
      },
    );
    if (
      result.status === "stale" ||
      !this.#ownsOperation(operation) ||
      this.#provider !== provider
    ) {
      return;
    }
    this.#credential = next;
    this.#pairing = undefined;
    this.#publishRuntimeState(next.accountLabel);
  }

  async dismissPairing(requestId: string): Promise<void> {
    this.#assertActive();
    const pairing = this.#activePairing();
    if (
      pairing === undefined ||
      pairing.requestId !== requestId
    ) {
      throw new TypeError(
        `${this.#providerLabel()} pairing request is no longer active`,
      );
    }
    this.#pairing = undefined;
    const accountLabel = this.#credential?.accountLabel;
    if (accountLabel !== undefined) {
      this.#publishRuntimeState(accountLabel);
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
      this.#hasStoredCredential = true;
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
    this.#credential = input.stored;
    this.#providerController = input.candidate.controller;
    this.#pairing = undefined;
    this.#resetRuntimeIssues();
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
            this.#hasStoredCredential = false;
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
            this.#hasStoredCredential = false;
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
      this.#hasStoredCredential = previous !== undefined;
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
      !this.#ownsOperation(operation) ||
      this.#provider !== undefined
    ) {
      return;
    }
    this.#hasStoredCredential =
      storedResult.value !== undefined;
    if (storedResult.value === undefined) return;
    await this.#connectStored(storedResult.value, operation);
  }

  async #connectStored(
    stored: StoredBotCredential,
    operation: AbortController,
    validatedIdentity?: Identity,
  ): Promise<void> {
    if (!this.#ownsOperation(operation)) return;
    this.#hasStoredCredential = true;
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
    this.#credential = stored;
    this.#providerController = candidate.controller;
    this.#pairing = undefined;
    this.#resetRuntimeIssues();
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
      this.#runProviderLoops(
        candidate.provider,
        mailbox,
        candidate.controller,
        stored.accountLabel,
      );
    }
    if (this.#ownsOperation(operation)) {
      this.#publishRuntimeState(stored.accountLabel);
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
        const admission = await this.#pollProviderOnce({
          ingressPolicy: this.#ingressPolicyFor(accountLabel),
          mailbox,
          provider,
          signal: controller.signal,
        });
        const droppedNativeIds =
          admission.droppedNativeIds ?? [];
        const pairing = this.#pairing;
        if (
          pairing !== undefined &&
          droppedNativeIds.includes(pairing.nativeId)
        ) {
          this.#pairing = undefined;
        }
        this.#setRuntimeIssue(
          "receive",
          droppedNativeIds.length > 0,
          accountLabel,
        );
      } catch (error) {
        if (this.#driver.isAborted(error, controller.signal)) {
          return;
        }
        const issue = this.#driver.issue(error, "receive");
        if (isTerminalReceiveIssue(issue)) {
          const active =
            this.#provider === provider
              ? this.#detachActiveProvider()
              : undefined;
          await this.#closeAfterTerminalReceive(active);
          this.#publish({
            state: "error",
            issue,
          });
          return;
        }
        this.#setRuntimeIssue(
          "receive",
          true,
          accountLabel,
        );
        try {
          await this.#waitBeforeRetry(controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  async #routeLoop(
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
        const result = await this.#routeInboxOnce({
          account: provider.account,
          handler: async (input) =>
            await this.#routeInboxMessage(input),
          leaseMs: BOT_AGENT_LEASE_MS,
          mailbox,
          signal: controller.signal,
          workerId:
            `${this.#driver.provider}-agent:`
            + provider.account.accountKey,
        });
        this.#setRuntimeIssue(
          "agent",
          false,
          accountLabel,
        );
        if (result.status === "idle") {
          await this.#waitBeforeRetry(controller.signal);
        }
      } catch (error) {
        if (this.#driver.isAborted(error, controller.signal)) {
          return;
        }
        this.#setRuntimeIssue(
          "agent",
          true,
          accountLabel,
        );
        try {
          await this.#waitBeforeRetry(controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  async #dispatchLoop(
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
        const result = await this.#dispatchProviderOnce({
          leaseMs: BOT_DELIVERY_LEASE_MS,
          mailbox,
          provider,
          signal: controller.signal,
          workerId:
            `${this.#driver.provider}-delivery:`
            + provider.account.accountKey,
        });
        const health = mailbox.inspectOutboxHealth({
          accountKey: provider.account.accountKey,
          generation: provider.account.generation,
        });
        this.#setRuntimeIssue(
          "delivery",
          health.awaitingDeliveryContext > 0 ||
            health.terminalFailures > 0 ||
            health.uncertain > 0,
          accountLabel,
        );
        if (result.status === "idle") {
          await this.#waitBeforeRetry(controller.signal);
        }
      } catch (error) {
        if (this.#driver.isAborted(error, controller.signal)) {
          return;
        }
        this.#setRuntimeIssue(
          "delivery",
          true,
          accountLabel,
        );
        try {
          await this.#waitBeforeRetry(controller.signal);
        } catch {
          return;
        }
      }
    }
  }

  async #routeInboxMessage(input: {
    readonly account: {
      readonly providerAccountId: string;
    };
    readonly lease: BotInboundMessageInput;
    readonly operationId: string;
    readonly signal: AbortSignal;
  }): Promise<
    | { readonly status: "ack" }
    | {
        readonly status: "reply";
        readonly payload: unknown;
      }
  > {
    const message =
      this.#driver.inspectMessage?.(input.lease, {
        providerAccountId: input.account.providerAccountId,
      });
    if (message === undefined) {
      return { status: "ack" };
    }
    const credential = this.#credential;
    if (
      credential?.authorizedUserId ===
      input.lease.senderId
    ) {
      const sourceText = message.text?.trim() ?? "";
      if (sourceText.length === 0) {
        return {
          status: "reply",
          payload: this.#agentReplyPayload(
            "Minke 当前需要文本内容。",
            input.lease,
            message,
          ),
        };
      }
      const route = this.#agentRoute;
      if (route === undefined) {
        throw new Error("Minke Agent route is unavailable");
      }
      const accountKeyValue = input.lease.accountKey;
      if (accountKeyValue === undefined) {
        throw new Error(
          "Gateway inbox lease omitted its account key",
        );
      }
      const result = await route.runAgentTurn(
        {
          operationId: input.operationId,
          sessionId: botAgentSessionId(
            this.#driver.provider,
            accountKeyValue,
            input.lease.conversationId,
          ),
          text: sourceText,
        },
        { signal: input.signal },
      );
      if (
        result.outcome !== "completed" ||
        result.text.trim().length === 0
      ) {
        return {
          status: "reply",
          payload: this.#agentReplyPayload(
            "Minke 未能生成回复，请稍后再试。",
            input.lease,
            message,
          ),
        };
      }
      const reply = botAgentReplyText(
        result.text,
        result.previews,
      );
      return {
        status: "reply",
        payload: this.#agentReplyPayload(
          reply,
          input.lease,
          message,
        ),
      };
    }
    const pairing = this.#activePairing();
    if (
      pairing === undefined ||
      pairing.senderId !== input.lease.senderId ||
      pairing.nativeId !== input.lease.nativeId
    ) {
      return { status: "ack" };
    }
    return {
      status: "reply",
      payload: {
        kind: "text",
        text:
          `Minke 收到了你的 ${this.#providerLabel()} 私聊配对请求。\n`
          + `配对码：${pairing.code}\n`
          + `请在 Minke 的「远端 → ${this.#providerLabel()}」中确认。`
          + "这条消息尚未交给 Agent。",
      },
    };
  }

  #agentReplyPayload(
    text: string,
    input: BotInboundMessageInput,
    message: BotInboundMessage,
  ): unknown {
    return this.#driver.agentReplyPayload?.(text, {
      input,
      message,
    }) ?? {
      kind: "text",
      text,
    };
  }

  #ingressPolicyFor(
    accountLabel: string,
  ): GatewayIngressPolicy {
    if (this.#configuredIngressPolicy !== undefined) {
      return this.#configuredIngressPolicy;
    }
    return (input) => {
      if (botEchoOnlyGatewayIngress(input)) return true;
      const message =
        this.#driver.inspectMessage?.(input.event, {
          providerAccountId:
            input.account.providerAccountId,
        });
      if (message === undefined) return false;
      const authorizedUserId =
        this.#credential?.authorizedUserId;
      if (authorizedUserId !== undefined) {
        return (
          this.#agentRoute !== undefined &&
          input.event.senderId === authorizedUserId
        );
      }
      if (this.#activePairing() !== undefined) {
        return false;
      }
      if (message.conversationKind !== "direct") {
        return false;
      }
      const code = this.#createPairingCode();
      const requestId = this.#createPairingRequestId();
      if (
        !/^[A-HJ-NP-Z2-9]{8}$/u.test(code) ||
        requestId.length === 0 ||
        requestId.length > 128
      ) {
        throw new TypeError(
          `${this.#providerLabel()} pairing generator returned invalid data`,
        );
      }
      this.#pairing = {
        code,
        conversationId: input.event.conversationId,
        expiresAt: this.#now() + BOT_PAIRING_TTL_MS,
        nativeId: input.event.nativeId,
        peerId: input.event.peerId,
        requestId,
        senderId: input.event.senderId,
        senderLabel: message.senderLabel,
      };
      this.#publishRuntimeState(accountLabel);
      return true;
    };
  }

  #activePairing(): PendingBotPairing | undefined {
    const pairing = this.#pairing;
    if (
      pairing !== undefined &&
      pairing.expiresAt <= this.#now()
    ) {
      this.#pairing = undefined;
      return undefined;
    }
    return pairing;
  }

  #resetRuntimeIssues(): void {
    this.#runtimeIssues.agent = false;
    this.#runtimeIssues.delivery = false;
    this.#runtimeIssues.receive = false;
  }

  #setRuntimeIssue(
    issue: keyof BotRuntimeIssues,
    active: boolean,
    accountLabel: string,
  ): void {
    if (this.#runtimeIssues[issue] === active) return;
    this.#runtimeIssues[issue] = active;
    this.#publishRuntimeState(accountLabel);
  }

  #publishRuntimeState(accountLabel: string): void {
    if (this.#runtimeIssues.receive) {
      this.#publish({
        state: "degraded",
        accountLabel,
        issue: "receive",
      });
      return;
    }
    if (this.#runtimeIssues.agent) {
      this.#publish({
        state: "degraded",
        accountLabel,
        issue: "agent",
      });
      return;
    }
    if (this.#runtimeIssues.delivery) {
      this.#publish({
        state: "degraded",
        accountLabel,
        issue: "delivery",
      });
      return;
    }
    if (this.#driver.inspectMessage === undefined) {
      this.#publish({
        state: "degraded",
        accountLabel,
        issue: "agent-route-pending",
      });
      return;
    }
    if (this.#credential?.authorizedUserId === undefined) {
      const pairing = this.#activePairing();
      this.#publish({
        state: "pairing",
        accountLabel,
        ...(pairing === undefined
          ? {}
          : {
              request: {
                code: pairing.code,
                expiresAt: pairing.expiresAt,
                requestId: pairing.requestId,
                senderLabel: pairing.senderLabel,
              },
            }),
      });
      return;
    }
    if (this.#agentRoute === undefined) {
      this.#publish({
        state: "degraded",
        accountLabel,
        issue: "agent-route-pending",
      });
      return;
    }
    this.#publish({
      state: "connected",
      accountLabel,
    });
  }

  #beginOperation(): AbortController {
    this.#operationController?.abort();
    const controller = new AbortController();
    this.#operationController = controller;
    return controller;
  }

  #providerLabel(): "Discord" | "Telegram" {
    return this.#driver.provider === "telegram"
      ? "Telegram"
      : "Discord";
  }

  #ownsOperation(controller: AbortController): boolean {
    return (
      !this.#disposed &&
      this.#operationController === controller &&
      !controller.signal.aborted
    );
  }

  #runProviderLoops(
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
    if (this.#driver.inspectMessage === undefined) {
      return;
    }
    const routeTask = this.#routeLoop(
      provider,
      mailbox,
      controller,
      accountLabel,
    ).catch(() => {});
    this.#routeTask = routeTask;
    void routeTask.then(() => {
      if (this.#routeTask === routeTask) {
        this.#routeTask = Promise.resolve();
      }
    });
    const dispatchTask = this.#dispatchLoop(
      provider,
      mailbox,
      controller,
      accountLabel,
    ).catch(() => {});
    this.#dispatchTask = dispatchTask;
    void dispatchTask.then(() => {
      if (this.#dispatchTask === dispatchTask) {
        this.#dispatchTask = Promise.resolve();
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
      dispatchTask: this.#dispatchTask,
      mailbox,
      provider,
      receiveTask: this.#receiveTask,
      routeTask: this.#routeTask,
    };
    this.#provider = undefined;
    this.#mailbox = undefined;
    this.#credential = undefined;
    this.#providerController = undefined;
    this.#pairing = undefined;
    this.#receiveTask = Promise.resolve();
    this.#routeTask = Promise.resolve();
    this.#dispatchTask = Promise.resolve();
    this.#resetRuntimeIssues();
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
      await Promise.allSettled([
        active.receiveTask,
        active.routeTask,
        active.dispatchTask,
      ]);
      try {
        active.mailbox.close();
      } catch {
        // Closing an already-detached mailbox must not replace channel state.
      }
    });
    this.#providerDrainTail = drain.catch(() => {});
    await drain;
  }

  async #closeAfterTerminalReceive(
    active: ActiveBotProvider | undefined,
  ): Promise<void> {
    const drain = this.#providerDrainTail.then(async () => {
      if (active === undefined) return;
      active.controller.abort();
      await active.provider.close().catch(() => {});
      // This method runs inside active.receiveTask. Waiting for that task
      // would deadlock, so only sibling loops are drained here.
      await Promise.allSettled([
        active.routeTask,
        active.dispatchTask,
      ]);
      try {
        active.mailbox.close();
      } catch {
        // Preserve the terminal provider issue as the actionable state.
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

  #publish(snapshot: BotHubSnapshotInput): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze(
      snapshot.state === "error"
        ? {
            ...snapshot,
            hasStoredCredential:
              this.#hasStoredCredential,
          }
        : snapshot,
    );
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
