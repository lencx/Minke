import { createHash } from "node:crypto";
import {
  GatewayLeaseConflictError,
  GatewayOutboxConflictError,
  type GatewayAccount,
  type GatewayInboxLease,
  type GatewayOutboxIntent,
  type GatewayOutboxSnapshot,
} from "./contract.ts";

export interface GatewayAgentMailboxPort {
  ackInbox(input: {
    readonly inboxId: number;
    readonly leaseToken: string;
    readonly now?: number;
  }): boolean;
  claimInbox(input: {
    readonly accountKey: string;
    readonly leaseMs: number;
    readonly now?: number;
    readonly workerId: string;
  }): GatewayInboxLease | null;
  enqueue(input: GatewayOutboxIntent): {
    readonly created: boolean;
    readonly operationId: string;
    readonly outboxId: number;
  };
  findOutbox(
    operationId: string,
  ): GatewayOutboxSnapshot | undefined;
  releaseInboxLease(input: {
    readonly inboxId: number;
    readonly leaseToken: string;
  }): boolean;
  renewInboxLease(input: {
    readonly inboxId: number;
    readonly leaseMs: number;
    readonly leaseToken: string;
    readonly now?: number;
  }): boolean;
}

export type GatewayAgentRouteOutcome =
  | {
      readonly status: "ack";
    }
  | {
      readonly conversationId?: string;
      readonly maxAttempts?: number;
      readonly payload: unknown;
      readonly recipientId?: string;
      readonly status: "reply";
    };

export interface GatewayAgentRouteRequest {
  readonly account: GatewayAccount;
  readonly lease: GatewayInboxLease;
  readonly operationId: string;
  readonly signal: AbortSignal;
}

export type GatewayAgentRouteHandler = (
  input: GatewayAgentRouteRequest,
) => Promise<GatewayAgentRouteOutcome>;

export type GatewayAgentRouteResult =
  | {
      readonly status: "idle";
    }
  | {
      readonly inboxId: number;
      readonly nativeId: string;
      readonly status: "acked";
    }
  | {
      readonly created: boolean;
      readonly inboxId: number;
      readonly nativeId: string;
      readonly operationId: string;
      readonly outboxId: number;
      readonly status: "replied";
    };

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonempty(value: string, label: string): string {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return value;
}

function replyOperationId(
  account: GatewayAccount,
  lease: GatewayInboxLease,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "minke-im-agent-reply",
        1,
        account.accountKey,
        account.generation,
        lease.nativeId,
      ]),
    )
    .digest("base64url");
  return `minke-im-agent-reply:${digest}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason ?? new Error("Gateway Agent route aborted");
}

export async function routeGatewayInboxOnce(input: {
  readonly account: GatewayAccount;
  readonly handler: GatewayAgentRouteHandler;
  readonly leaseMs: number;
  readonly mailbox: GatewayAgentMailboxPort;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  readonly workerId: string;
}): Promise<GatewayAgentRouteResult> {
  const leaseMs = positiveDuration(input.leaseMs, "leaseMs");
  const workerId = nonempty(input.workerId, "workerId");
  const accountKey = nonempty(input.account.accountKey, "account.accountKey");
  const time = input.now ?? Date.now;
  throwIfAborted(input.signal);
  const lease = input.mailbox.claimInbox({
    accountKey,
    leaseMs,
    now: time(),
    workerId,
  });
  if (lease === null) return { status: "idle" };
  if (lease.accountKey !== accountKey) {
    input.mailbox.releaseInboxLease({
      inboxId: lease.inboxId,
      leaseToken: lease.leaseToken,
    });
    throw new GatewayLeaseConflictError(
      "Agent worker received an inbox lease for another account",
    );
  }

  const operationId = replyOperationId(input.account, lease);
  const handlerController = new AbortController();
  const abortHandler = () => handlerController.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortHandler, {
    once: true,
  });
  if (input.signal?.aborted === true) abortHandler();
  let leaseFailure: GatewayLeaseConflictError | undefined;
  const renewLease = (phase: string): void => {
    if (leaseFailure !== undefined) throw leaseFailure;
    try {
      if (
        !input.mailbox.renewInboxLease({
          inboxId: lease.inboxId,
          leaseMs,
          leaseToken: lease.leaseToken,
          now: time(),
        })
      ) {
        leaseFailure = new GatewayLeaseConflictError(
          `Inbox lease was fenced ${phase}`,
        );
      }
    } catch {
      leaseFailure = new GatewayLeaseConflictError(
        `Inbox lease renewal failed ${phase}`,
      );
    }
    if (leaseFailure !== undefined) {
      handlerController.abort(leaseFailure);
      throw leaseFailure;
    }
  };
  const heartbeat = setInterval(
    () => {
      if (leaseFailure !== undefined) return;
      try {
        renewLease("during Agent routing");
      } catch {
        // renewLease records and signals the fenced lease. The awaited
        // handler below observes the same failure after it yields.
      }
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref();

  let completed = false;
  try {
    const existing = input.mailbox.findOutbox(operationId);
    if (existing !== undefined) {
      if (
        existing.accountKey !== accountKey ||
        existing.generation !== input.account.generation
      ) {
        throw new GatewayOutboxConflictError(operationId);
      }
      renewLease("before durable reply recovery could settle");
      if (
        !input.mailbox.ackInbox({
          inboxId: lease.inboxId,
          leaseToken: lease.leaseToken,
          now: time(),
        })
      ) {
        throw new GatewayLeaseConflictError(
          "Inbox lease was fenced while recovering its durable Agent reply",
        );
      }
      completed = true;
      return {
        created: false,
        inboxId: lease.inboxId,
        nativeId: lease.nativeId,
        operationId,
        outboxId: existing.outboxId,
        status: "replied",
      };
    }
    let outcome: GatewayAgentRouteOutcome;
    try {
      outcome = await input.handler({
        account: input.account,
        lease,
        operationId,
        signal: handlerController.signal,
      });
    } catch (error) {
      if (leaseFailure !== undefined) throw leaseFailure;
      throw error;
    }
    if (leaseFailure !== undefined) throw leaseFailure;
    throwIfAborted(input.signal);
    renewLease("before Agent routing could settle");

    if (outcome.status === "ack") {
      if (
        !input.mailbox.ackInbox({
          inboxId: lease.inboxId,
          leaseToken: lease.leaseToken,
          now: time(),
        })
      ) {
        throw new GatewayLeaseConflictError(
          "Inbox lease was fenced before Agent routing could acknowledge it",
        );
      }
      completed = true;
      return {
        inboxId: lease.inboxId,
        nativeId: lease.nativeId,
        status: "acked",
      };
    }
    if (outcome.status !== "reply") {
      throw new TypeError("Agent route returned an invalid outcome");
    }
    const enqueued = input.mailbox.enqueue({
      accountKey,
      conversationId: outcome.conversationId ?? lease.conversationId,
      generation: input.account.generation,
      maxAttempts: outcome.maxAttempts,
      now: time(),
      operationId,
      payload: outcome.payload,
      recipientId: outcome.recipientId ?? lease.peerId,
    });
    if (
      !input.mailbox.ackInbox({
        inboxId: lease.inboxId,
        leaseToken: lease.leaseToken,
        now: time(),
      })
    ) {
      throw new GatewayLeaseConflictError(
        "Inbox lease was fenced after its Agent reply was enqueued",
      );
    }
    completed = true;
    return {
      created: enqueued.created,
      inboxId: lease.inboxId,
      nativeId: lease.nativeId,
      operationId: enqueued.operationId,
      outboxId: enqueued.outboxId,
      status: "replied",
    };
  } finally {
    clearInterval(heartbeat);
    input.signal?.removeEventListener("abort", abortHandler);
    if (!completed) {
      try {
        input.mailbox.releaseInboxLease({
          inboxId: lease.inboxId,
          leaseToken: lease.leaseToken,
        });
      } catch {
        // Preserve the routing error. A competing worker can reclaim the
        // lease after its deadline if explicit release itself fails.
      }
    }
  }
}
