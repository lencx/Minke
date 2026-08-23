import {
  GatewayLeaseConflictError,
  type GatewayAccount,
  type GatewayAttemptOutcome,
  type GatewayBatchAdmission,
  type GatewayDeliveryAttempt,
  type GatewayDeliveryPreparation,
  type GatewayInboundBatch,
  type GatewayInboundEvent,
  type GatewayOutboxLease,
  type GatewayPreparationOutcome,
} from "./contract.ts";

export interface GatewayProviderSession {
  readonly account: GatewayAccount;
  close(): Promise<void>;
  deliver(
    attempt: GatewayDeliveryAttempt,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GatewayAttemptOutcome>;
  prepare(
    delivery: GatewayDeliveryPreparation,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GatewayPreparationOutcome>;
  receive(
    checkpoint: string | null,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GatewayInboundBatch>;
  start(options?: { readonly signal?: AbortSignal }): Promise<void>;
}

export type GatewayIngressPolicy = (input: {
  readonly account: GatewayAccount;
  readonly event: GatewayInboundEvent;
}) => boolean;

/**
 * Safe preview policy used before sender and conversation authorization exist.
 * Provider echoes may still reconcile uncertain outbound work, but no external
 * message reaches the durable Agent inbox.
 */
export const botEchoOnlyGatewayIngress: GatewayIngressPolicy = ({
  event,
}) => event.kind === "bot-echo";

export interface GatewayMailboxPort {
  admitBatch(input: GatewayInboundBatch): GatewayBatchAdmission;
  beginAttempt(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): GatewayDeliveryAttempt;
  claimOutbox(input: {
    readonly account: GatewayAccount;
    readonly leaseMs: number;
    readonly now?: number;
    readonly workerId: string;
  }): GatewayOutboxLease | null;
  getCheckpoint(accountKey: string): string | null;
  readPreparation(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): GatewayDeliveryPreparation;
  renewOutboxLease(input: {
    readonly leaseMs: number;
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): boolean;
  settlePreparation(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outcome: GatewayPreparationOutcome;
    readonly outboxId: number;
  }): boolean;
  settleAttempt(input: {
    readonly attemptToken: string;
    readonly now?: number;
    readonly outcome: GatewayAttemptOutcome;
    readonly outboxId: number;
  }): boolean;
}

export async function pollGatewayProviderOnce(input: {
  readonly ingressPolicy?: GatewayIngressPolicy;
  readonly mailbox: GatewayMailboxPort;
  readonly provider: GatewayProviderSession;
  readonly signal?: AbortSignal;
}): Promise<GatewayBatchAdmission> {
  const checkpoint = input.mailbox.getCheckpoint(
    input.provider.account.accountKey,
  );
  const batch = await input.provider.receive(checkpoint, {
    signal: input.signal,
  });
  if (
    batch.accountKey !== input.provider.account.accountKey ||
    batch.generation !== input.provider.account.generation
  ) {
    throw new GatewayLeaseConflictError(
      "Provider returned a batch for another account generation",
    );
  }
  const ingressPolicy = input.ingressPolicy;
  const admittedBatch =
    ingressPolicy === undefined
      ? batch
      : {
          ...batch,
          events: batch.events.filter((event) =>
            ingressPolicy({
              account: input.provider.account,
              event,
            })
          ),
        };
  return input.mailbox.admitBatch(admittedBatch);
}

export type GatewayDispatchResult =
  | { readonly status: "idle" }
  | {
      readonly outcome: Exclude<
        GatewayPreparationOutcome,
        { readonly status: "ready" }
      >;
      readonly status: "preparation-settled";
    }
  | {
      readonly attempt: GatewayDeliveryAttempt;
      readonly outcome: GatewayAttemptOutcome;
      readonly status: "settled";
    };

export async function dispatchGatewayProviderOnce(input: {
  readonly leaseMs: number;
  readonly mailbox: GatewayMailboxPort;
  readonly now?: () => number;
  readonly provider: GatewayProviderSession;
  readonly signal?: AbortSignal;
  readonly workerId: string;
}): Promise<GatewayDispatchResult> {
  const time = input.now ?? Date.now;
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs <= 0
  ) {
    throw new TypeError("leaseMs must be a positive safe integer");
  }
  const isAborted = () => input.signal?.aborted === true;
  const lease = input.mailbox.claimOutbox({
    account: input.provider.account,
    leaseMs: input.leaseMs,
    now: time(),
    workerId: input.workerId,
  });
  if (lease === null) return { status: "idle" };
  if (
    lease.accountKey !== input.provider.account.accountKey ||
    lease.generation !== input.provider.account.generation ||
    lease.requiresDeliveryContext !==
    input.provider.account.requiresDeliveryContext
  ) {
    throw new GatewayLeaseConflictError(
      "Provider delivery-context policy differs from durable account policy",
    );
  }
  const settleBeforeAttempt = (
    outcome: Exclude<
      GatewayPreparationOutcome,
      { readonly status: "ready" }
    >,
  ): GatewayDispatchResult => {
    const settled = input.mailbox.settlePreparation({
      leaseToken: lease.leaseToken,
      now: time(),
      outcome,
      outboxId: lease.outboxId,
    });
    if (!settled) {
      throw new GatewayLeaseConflictError(
        "Outbox lease was fenced before preparation could settle",
      );
    }
    return {
      outcome,
      status: "preparation-settled",
    };
  };
  if (isAborted()) {
    return settleBeforeAttempt({
      reasonCode: "aborted",
      status: "deferred",
    });
  }
  const delivery = input.mailbox.readPreparation({
    leaseToken: lease.leaseToken,
    now: time(),
    outboxId: lease.outboxId,
  });
  if (
    delivery.accountKey !== input.provider.account.accountKey ||
    delivery.generation !== input.provider.account.generation
  ) {
    throw new GatewayLeaseConflictError(
      "Provider received an outbox lease for another account generation",
    );
  }
  let preparation: GatewayPreparationOutcome;
  const preparationController = new AbortController();
  const abortPreparation = () =>
    preparationController.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortPreparation, {
    once: true,
  });
  if (input.signal?.aborted === true) abortPreparation();
  let leaseFailure: GatewayLeaseConflictError | undefined;
  const heartbeat = setInterval(() => {
    if (leaseFailure !== undefined) return;
    try {
      if (
        !input.mailbox.renewOutboxLease({
          leaseMs: input.leaseMs,
          leaseToken: lease.leaseToken,
          now: time(),
          outboxId: lease.outboxId,
        })
      ) {
        leaseFailure = new GatewayLeaseConflictError(
          "Outbox lease was fenced during provider preparation",
        );
        preparationController.abort(leaseFailure);
      }
    } catch {
      leaseFailure = new GatewayLeaseConflictError(
        "Outbox lease renewal failed during provider preparation",
      );
      preparationController.abort(leaseFailure);
    }
  }, Math.max(1, Math.floor(input.leaseMs / 3)));
  heartbeat.unref();
  try {
    preparation = await input.provider.prepare(delivery, {
      signal: preparationController.signal,
    });
  } catch {
    preparation = {
      reasonCode: "provider-prepare-threw",
      retryAfterMs: 1_000,
      status: "deferred",
    };
  } finally {
    clearInterval(heartbeat);
    input.signal?.removeEventListener(
      "abort",
      abortPreparation,
    );
  }
  if (leaseFailure !== undefined) {
    throw leaseFailure;
  }
  const preparationSettled = input.mailbox.settlePreparation({
    leaseToken: lease.leaseToken,
    now: time(),
    outcome: preparation,
    outboxId: lease.outboxId,
  });
  if (!preparationSettled) {
    throw new GatewayLeaseConflictError(
      "Outbox lease was fenced before preparation could settle",
    );
  }
  if (preparation.status !== "ready") {
    return {
      outcome: preparation,
      status: "preparation-settled",
    };
  }
  if (isAborted()) {
    return settleBeforeAttempt({
      reasonCode: "aborted",
      status: "deferred",
    });
  }
  const attempt = input.mailbox.beginAttempt({
    leaseToken: lease.leaseToken,
    now: time(),
    outboxId: lease.outboxId,
  });
  let outcome: GatewayAttemptOutcome;
  try {
    outcome = await input.provider.deliver(attempt, {
      signal: input.signal,
    });
  } catch {
    outcome = {
      errorCode: "provider-threw",
      status: "uncertain",
    };
  }
  const settled = input.mailbox.settleAttempt({
    attemptToken: attempt.attemptToken,
    now: time(),
    outcome,
    outboxId: attempt.outboxId,
  });
  if (!settled) {
    throw new GatewayLeaseConflictError(
      "Delivery attempt was fenced before it could settle",
    );
  }
  return {
    attempt,
    outcome,
    status: "settled",
  };
}
