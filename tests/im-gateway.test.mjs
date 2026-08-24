import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as gatewayCore from "@lencx/minke-im-gateway";
import {
  botEchoOnlyGatewayIngress,
  dispatchGatewayProviderOnce,
  GatewayAccountConflictError,
  GatewayCheckpointConflictError,
  GatewayGenerationConflictError,
  GatewayLeaseConflictError,
  GatewayOutboxConflictError,
  pollGatewayProviderOnce,
  routeGatewayInboxOnce,
} from "@lencx/minke-im-gateway";
import {
  createSqliteGatewayMailbox,
} from "@lencx/minke-im-gateway/sqlite";
import {
  adaptWeixinInboundBatch,
  deliverWeixinAttempt,
  prepareWeixinDelivery,
} from "@lencx/minke-im-gateway/weixin";
import {
  WEIXIN_PREPARED_DELIVERY_ENCODING,
  WeixinTransportError,
} from "@lencx/minke-im-weixin";

const account = Object.freeze({
  accountKey: "wx:local",
  generation: 1,
  provider: "weixin",
  providerAccountId: "remote-bot",
  requiresDeliveryContext: true,
});

const identityCipher = Object.freeze({
  open(bytes) {
    return new Uint8Array(bytes);
  },
  seal(bytes) {
    return new Uint8Array(bytes);
  },
});

test("Gateway core does not export a storage engine", () => {
  assert.equal(
    Object.hasOwn(
      gatewayCore,
      "createSqliteGatewayMailbox",
    ),
    false,
  );
  assert.equal(
    typeof createSqliteGatewayMailbox,
    "function",
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "minke-im-gateway-"));
  const path = join(directory, "mailbox.sqlite");
  const mailbox = createSqliteGatewayMailbox({
    cipher: identityCipher,
    path,
  });
  mailbox.registerAccount(account);
  return {
    mailbox,
    path,
    close() {
      mailbox.close();
    },
  };
}

function userEvent(overrides = {}) {
  return {
    conversationId: "conversation-1",
    deliveryContext: "context-1",
    kind: "user-message",
    nativeId: "message-1",
    payload: { text: "hello" },
    peerId: "user-1",
    senderId: "user-1",
    ...overrides,
  };
}

function persistPreparation(
  mailbox,
  lease,
  now,
  preparedPayload = {
    kind: "test-prepared",
    operationId: lease.operationId,
  },
) {
  assert.equal(
    mailbox.settlePreparation({
      leaseToken: lease.leaseToken,
      now,
      outcome: {
        preparedPayload,
        status: "ready",
      },
      outboxId: lease.outboxId,
    }),
    true,
  );
  return preparedPayload;
}

test("mailbox exposes the durable account generation without credential state", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);

  assert.equal(
    mailbox.getAccountGeneration(account.accountKey),
    1,
  );
  assert.equal(
    mailbox.getAccountGeneration("wx:missing"),
    undefined,
  );
  mailbox.registerAccount({ ...account, generation: 2 });
  assert.equal(
    mailbox.getAccountGeneration(account.accountKey),
    2,
  );
});

test("provider-scoped reset preserves accounts and inbox data from other adapters", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  const telegram = {
    accountKey: "tg:local",
    generation: 1,
    provider: "telegram",
    providerAccountId: "telegram-bot",
    requiresDeliveryContext: false,
  };
  mailbox.registerAccount(telegram);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "weixin-checkpoint",
  });
  mailbox.admitBatch({
    accountKey: telegram.accountKey,
    events: [
      userEvent({
        deliveryContext: undefined,
        nativeId: "telegram-message",
      }),
    ],
    fromCheckpoint: null,
    generation: telegram.generation,
    nextCheckpoint: "telegram-checkpoint",
  });

  assert.equal(mailbox.removeProviderAccounts("weixin"), 1);
  assert.equal(
    mailbox.getAccountGeneration(account.accountKey),
    undefined,
  );
  assert.equal(
    mailbox.getAccountGeneration(telegram.accountKey),
    telegram.generation,
  );
  assert.equal(
    mailbox.getCheckpoint(telegram.accountKey),
    "telegram-checkpoint",
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: telegram.accountKey,
      leaseMs: 1_000,
      now: 100,
      workerId: "telegram-worker",
    })?.nativeId,
    "telegram-message",
  );
});

test("batch admission atomically advances the checkpoint and deduplicates by native id", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);

  const admitted = mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [
      userEvent(),
      userEvent({
        deliveryContext: "context-2",
        nativeId: "message-2",
      }),
    ],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  assert.deepEqual(admitted.admittedNativeIds, [
    "message-1",
    "message-2",
  ]);
  assert.equal(
    mailbox.getCheckpoint(account.accountKey),
    "checkpoint-1",
  );

  await assert.rejects(
    async () =>
      mailbox.admitBatch({
        accountKey: account.accountKey,
        events: [
          userEvent({
            nativeId: "message-must-not-commit",
          }),
        ],
        fromCheckpoint: null,
        generation: account.generation,
        nextCheckpoint: "stale-checkpoint",
      }),
    GatewayCheckpointConflictError,
  );
  assert.equal(
    mailbox.getCheckpoint(account.accountKey),
    "checkpoint-1",
  );

  const first = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 1_000,
    now: 100,
    workerId: "agent-worker",
  });
  const second = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 1_000,
    now: 100,
    workerId: "agent-worker",
  });
  assert.equal(first?.nativeId, "message-1");
  assert.equal(second?.nativeId, "message-2");
  assert.equal(first?.kind, "user-message");
  assert.equal(second?.kind, "user-message");
  assert.deepEqual(first?.payload, { text: "hello" });
  assert.deepEqual(second?.payload, { text: "hello" });
  assert.equal(
    mailbox.ackInbox({
      inboxId: first.inboxId,
      leaseToken: first.leaseToken,
      now: 101,
    }),
    true,
  );
  assert.equal(
    mailbox.ackInbox({
      inboxId: second.inboxId,
      leaseToken: second.leaseToken,
      now: 101,
    }),
    true,
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 102,
      workerId: "agent-worker",
    }),
    null,
  );
});

test("a duplicate event in a later batch refreshes delivery context without scheduling another turn", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);

  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  const replay = mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [
      userEvent({
        deliveryContext: "context-newer",
      }),
    ],
    fromCheckpoint: "checkpoint-1",
    generation: account.generation,
    nextCheckpoint: "checkpoint-2",
  });

  assert.deepEqual(replay.admittedNativeIds, []);
  assert.equal(
    mailbox.getDeliveryContext(account.accountKey, "user-1"),
    "context-newer",
  );
  const only = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 1_000,
    now: 100,
    workerId: "agent-worker",
  });
  assert.equal(only?.nativeId, "message-1");
  assert.equal(
    mailbox.ackInbox({
      inboxId: only.inboxId,
      leaseToken: only.leaseToken,
      now: 101,
    }),
    true,
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 102,
      workerId: "agent-worker",
    }),
    null,
  );
});

test("the provider runner owns poll admission and the full delivery state transition", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  const delivered = [];
  const provider = {
    account,
    async close() {},
    async deliver(attempt) {
      assert.equal(
        mailbox.inspectOutbox(attempt.operationId).state,
        "attempting",
      );
      delivered.push(attempt);
      return { status: "accepted" };
    },
    async prepare(delivery) {
      const snapshot = mailbox.inspectOutbox(
        delivery.operationId,
      );
      assert.equal(snapshot.state, "leased");
      assert.equal(snapshot.attempts, 0);
      mailbox.admitBatch({
        accountKey: account.accountKey,
        events: [
          userEvent({
            deliveryContext: "context-during-preparation",
            nativeId: "message-during-preparation",
          }),
        ],
        fromCheckpoint: "checkpoint-1",
        generation: account.generation,
        nextCheckpoint: "checkpoint-2",
      });
      return {
        preparedPayload: {
          original: delivery.payload,
          provider: "test",
        },
        status: "ready",
      };
    },
    async receive(checkpoint) {
      assert.equal(checkpoint, null);
      return {
        accountKey: account.accountKey,
        events: [userEvent()],
        fromCheckpoint: checkpoint,
        generation: account.generation,
        nextCheckpoint: "checkpoint-1",
      };
    },
    async start() {},
  };

  assert.deepEqual(
    await pollGatewayProviderOnce({ mailbox, provider }),
    {
      admittedNativeIds: ["message-1"],
      confirmedOperationIds: [],
      nextCheckpoint: "checkpoint-1",
    },
  );
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  let now = 100;
  const result = await dispatchGatewayProviderOnce({
    leaseMs: 1_000,
    mailbox,
    now: () => {
      now += 1;
      return now;
    },
    provider,
    workerId: "provider-runner",
  });
  assert.equal(result.status, "settled");
  assert.equal(delivered[0].operationId, "operation-1");
  assert.deepEqual(delivered[0].preparedPayload, {
    original: { kind: "text", text: "reply" },
    provider: "test",
  });
  assert.equal(
    delivered[0].deliveryContext,
    "context-during-preparation",
  );
  assert.equal(delivered[0].deliveryContextRevision, 2);
  assert.equal(
    mailbox.inspectOutbox("operation-1").state,
    "accepted",
  );

  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-2",
    payload: { kind: "text", text: "later" },
    recipientId: "user-1",
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    (
      await dispatchGatewayProviderOnce({
        leaseMs: 1_000,
        mailbox,
        now: () => {
          now += 1;
          return now;
        },
        provider,
        signal: controller.signal,
        workerId: "provider-runner",
      })
    ).outcome,
    {
      reasonCode: "aborted",
      status: "deferred",
    },
  );
  assert.equal(delivered.length, 1);
  assert.equal(
    mailbox.inspectOutbox("operation-2").attempts,
    0,
  );
});

test("a fail-closed ingress policy advances checkpoints without persisting external messages", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  const observedKinds = [];
  const provider = {
    account,
    async close() {},
    async deliver() {
      throw new Error("not exercised");
    },
    async prepare() {
      throw new Error("not exercised");
    },
    async receive(checkpoint) {
      return {
        accountKey: account.accountKey,
        events: [
          userEvent(),
          userEvent({
            kind: "system",
            nativeId: "system-1",
          }),
          userEvent({
            correlationId: "unknown-operation",
            deliveryContext: undefined,
            kind: "bot-echo",
            nativeId: "echo-1",
          }),
        ],
        fromCheckpoint: checkpoint,
        generation: account.generation,
        nextCheckpoint: "checkpoint-after-denied-ingress",
      };
    },
    async start() {},
  };

  const admission = await pollGatewayProviderOnce({
    ingressPolicy(input) {
      observedKinds.push(input.event.kind);
      return botEchoOnlyGatewayIngress(input);
    },
    mailbox,
    provider,
  });

  assert.deepEqual(observedKinds, [
    "user-message",
    "system",
    "bot-echo",
  ]);
  assert.deepEqual(admission, {
    admittedNativeIds: [],
    confirmedOperationIds: [],
    nextCheckpoint: "checkpoint-after-denied-ingress",
  });
  assert.equal(
    mailbox.getCheckpoint(account.accountKey),
    "checkpoint-after-denied-ingress",
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 100,
      workerId: "agent-worker",
    }),
    null,
  );
});

test("the provider runner renews its lease throughout a long preparation", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-long-prepare",
    payload: { kind: "image", bytes: new Uint8Array([1]) },
    recipientId: "user-1",
  });
  let releasePreparation;
  const preparationGate = new Promise((resolve) => {
    releasePreparation = resolve;
  });
  t.after(() => releasePreparation());
  let preparationStarted;
  const started = new Promise((resolve) => {
    preparationStarted = resolve;
  });
  let heartbeatObserved;
  const heartbeat = new Promise((resolve) => {
    heartbeatObserved = resolve;
  });
  const renew = mailbox.renewOutboxLease.bind(mailbox);
  mailbox.renewOutboxLease = (input) => {
    const renewed = renew(input);
    heartbeatObserved(renewed);
    return renewed;
  };
  let deliveries = 0;
  const provider = {
    account,
    async close() {},
    async deliver() {
      deliveries += 1;
      return { status: "accepted" };
    },
    async prepare(delivery) {
      preparationStarted();
      await preparationGate;
      return {
        preparedPayload: delivery.payload,
        status: "ready",
      };
    },
    async receive() {
      throw new Error("receive is not used by this test");
    },
    async start() {},
  };
  let now = 100;
  const dispatched = dispatchGatewayProviderOnce({
    leaseMs: 100,
    mailbox,
    now: () => now,
    provider,
    workerId: "long-prepare-worker",
  });
  await started;
  now = 150;
  assert.equal(
    await Promise.race([
      heartbeat,
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("lease heartbeat was not observed")),
          500,
        ).unref();
      }),
    ]),
    true,
  );

  now = 201;
  assert.equal(
    mailbox.claimOutbox({
      account,
      leaseMs: 100,
      now,
      workerId: "competing-worker",
    }),
    null,
  );
  now = 202;
  releasePreparation();
  assert.equal((await dispatched).status, "settled");
  assert.equal(deliveries, 1);
});

test("inbox leases can be renewed and explicitly released", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  const lease = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 100,
    now: 100,
    workerId: "agent-worker",
  });

  assert.equal(
    mailbox.renewInboxLease({
      inboxId: lease.inboxId,
      leaseMs: 100,
      leaseToken: lease.leaseToken,
      now: 150,
    }),
    true,
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 100,
      now: 201,
      workerId: "competing-worker",
    }),
    null,
  );
  assert.equal(
    mailbox.releaseInboxLease({
      inboxId: lease.inboxId,
      leaseToken: lease.leaseToken,
    }),
    true,
  );
  const reclaimed = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 100,
    now: 202,
    workerId: "competing-worker",
  });
  assert.equal(reclaimed?.nativeId, lease.nativeId);
  assert.notEqual(reclaimed?.leaseToken, lease.leaseToken);
  assert.equal(
    mailbox.releaseInboxLease({
      inboxId: lease.inboxId,
      leaseToken: lease.leaseToken,
    }),
    false,
  );
});

test("the Agent route durably enqueues a provider reply before acknowledging inbox", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  const calls = [];
  const operationIds = [];
  const enqueue = mailbox.enqueue.bind(mailbox);
  mailbox.enqueue = (intent) => {
    calls.push("enqueue");
    assert.deepEqual(intent.payload, {
      kind: "text",
      text: "Agent reply",
    });
    return enqueue(intent);
  };
  const ackInbox = mailbox.ackInbox.bind(mailbox);
  mailbox.ackInbox = (input) => {
    calls.push("ack");
    return ackInbox(input);
  };

  const routed = await routeGatewayInboxOnce({
    account,
    async handler(input) {
      calls.push("handler");
      operationIds.push(input.operationId);
      assert.equal(input.lease.nativeId, "message-1");
      assert.equal(input.signal.aborted, false);
      return {
        payload: {
          kind: "text",
          text: "Agent reply",
        },
        status: "reply",
      };
    },
    leaseMs: 1_000,
    mailbox,
    now: () => 100,
    workerId: "agent-worker",
  });

  assert.deepEqual(calls, ["handler", "enqueue", "ack"]);
  assert.equal(routed.status, "replied");
  assert.equal(routed.created, true);
  assert.equal(routed.operationId, operationIds[0]);
  assert.match(routed.operationId, /^minke-im-agent-reply:/u);
  assert.equal(
    mailbox.inspectOutbox(routed.operationId).state,
    "pending",
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 101,
      workerId: "competing-worker",
    }),
    null,
  );
});

test("the Agent route reuses its durable outbox after an ack fence", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  const operationIds = [];
  let replyText = "first reply";
  const ackInbox = mailbox.ackInbox.bind(mailbox);
  mailbox.ackInbox = () => false;
  const route = () =>
    routeGatewayInboxOnce({
      account,
      async handler(input) {
        operationIds.push(input.operationId);
        return {
          payload: {
            kind: "text",
            text: replyText,
          },
          status: "reply",
        };
      },
      leaseMs: 1_000,
      mailbox,
      now: () => 100,
      workerId: "agent-worker",
    });

  await assert.rejects(route(), GatewayLeaseConflictError);
  assert.equal(
    mailbox.inspectOutbox(operationIds[0]).state,
    "pending",
  );
  replyText = "must not replace the durable reply";
  mailbox.ackInbox = ackInbox;
  const retried = await route();

  assert.equal(retried.status, "replied");
  assert.equal(retried.created, false);
  assert.deepEqual(operationIds, [operationIds[0]]);
});

test("the Agent route releases its inbox lease when the handler throws", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });

  await assert.rejects(
    routeGatewayInboxOnce({
      account,
      async handler({ signal }) {
        assert.equal(signal.aborted, false);
        throw new Error("Agent route failed");
      },
      leaseMs: 1_000,
      mailbox,
      now: () => 100,
      workerId: "agent-worker",
    }),
    /Agent route failed/u,
  );
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 100,
      workerId: "competing-worker",
    })?.nativeId,
    "message-1",
  );
});

test("the Agent route renews its inbox lease throughout a long handler", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  let releaseHandler;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  t.after(() => releaseHandler());
  let handlerStarted;
  const started = new Promise((resolve) => {
    handlerStarted = resolve;
  });
  let heartbeatObserved;
  const heartbeat = new Promise((resolve) => {
    heartbeatObserved = resolve;
  });
  const renew = mailbox.renewInboxLease.bind(mailbox);
  mailbox.renewInboxLease = (input) => {
    const renewed = renew(input);
    heartbeatObserved(renewed);
    return renewed;
  };
  let now = 100;
  const routed = routeGatewayInboxOnce({
    account,
    async handler() {
      handlerStarted();
      await handlerGate;
      return { status: "ack" };
    },
    leaseMs: 100,
    mailbox,
    now: () => now,
    workerId: "agent-worker",
  });
  await started;
  now = 150;
  assert.equal(
    await Promise.race([
      heartbeat,
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("inbox lease heartbeat was not observed")),
          500,
        ).unref();
      }),
    ]),
    true,
  );

  now = 201;
  assert.equal(
    mailbox.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 100,
      now,
      workerId: "competing-worker",
    }),
    null,
  );
  now = 202;
  releaseHandler();
  assert.equal((await routed).status, "acked");
});

test("a failed Agent route heartbeat aborts without enqueuing a reply", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.renewInboxLease = () => false;
  let operationId;
  let abortReason;

  await assert.rejects(
    routeGatewayInboxOnce({
      account,
      async handler(input) {
        operationId = input.operationId;
        await new Promise((resolve) => {
          input.signal.addEventListener("abort", resolve, {
            once: true,
          });
        });
        abortReason = input.signal.reason;
        return {
          payload: {
            kind: "text",
            text: "must not be enqueued",
          },
          status: "reply",
        };
      },
      leaseMs: 3,
      mailbox,
      now: () => 100,
      workerId: "agent-worker",
    }),
    GatewayLeaseConflictError,
  );
  assert.ok(abortReason instanceof GatewayLeaseConflictError);
  assert.throws(
    () => mailbox.inspectOutbox(operationId),
    /Unknown Gateway operation/u,
  );
});

test("a failed preparation heartbeat aborts before delivery begins", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-lost-lease",
    payload: { kind: "image", bytes: new Uint8Array([1]) },
    recipientId: "user-1",
  });
  mailbox.renewOutboxLease = () => false;
  let deliveries = 0;
  await assert.rejects(
    dispatchGatewayProviderOnce({
      leaseMs: 3,
      mailbox,
      now: () => 100,
      provider: {
        account,
        async close() {},
        async deliver() {
          deliveries += 1;
          return { status: "accepted" };
        },
        async prepare(_delivery, options) {
          await new Promise((resolve) => {
            options.signal.addEventListener("abort", resolve, {
              once: true,
            });
          });
          throw new Error("preparation aborted");
        },
        async receive() {
          throw new Error("receive is not used by this test");
        },
        async start() {},
      },
      workerId: "lost-lease-worker",
    }),
    GatewayLeaseConflictError,
  );
  assert.equal(deliveries, 0);
  const outbox = mailbox.inspectOutbox("operation-lost-lease");
  assert.equal(outbox.attempts, 0);
  assert.equal(outbox.state, "leased");
});

test("a stale or misbound provider cannot claim the current account generation", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  const currentAccount = {
    ...account,
    generation: 2,
  };
  mailbox.registerAccount(currentAccount);
  mailbox.admitBatch({
    accountKey: currentAccount.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: currentAccount.generation,
    nextCheckpoint: "checkpoint-generation-2",
  });
  mailbox.enqueue({
    accountKey: currentAccount.accountKey,
    generation: currentAccount.generation,
    operationId: "operation-generation-2",
    payload: { kind: "text", text: "current reply" },
    recipientId: "user-1",
  });
  let providerNetworkCalls = 0;
  const providerFor = (providerAccount) => ({
    account: providerAccount,
    async close() {},
    async deliver() {
      providerNetworkCalls += 1;
      return { status: "accepted" };
    },
    async prepare(delivery) {
      providerNetworkCalls += 1;
      return {
        preparedPayload: delivery.payload,
        status: "ready",
      };
    },
    async receive() {
      throw new Error("receive is not used by this test");
    },
    async start() {},
  });
  const dispatch = (provider) =>
    dispatchGatewayProviderOnce({
      leaseMs: 1_000,
      mailbox,
      now: () => 100,
      provider,
      workerId: "generation-worker",
    });

  await assert.rejects(
    dispatch(providerFor(account)),
    GatewayGenerationConflictError,
  );
  await assert.rejects(
    dispatch(
      providerFor({
        ...currentAccount,
        providerAccountId: "wrong-remote-bot",
      }),
    ),
    GatewayAccountConflictError,
  );
  assert.equal(providerNetworkCalls, 0);
  const untouched = mailbox.inspectOutbox(
    "operation-generation-2",
  );
  assert.equal(untouched.attempts, 0);
  assert.equal(untouched.generation, currentAccount.generation);
  assert.equal(untouched.state, "pending");

  const result = await dispatch(
    providerFor(currentAccount),
  );
  assert.equal(result.status, "settled");
  assert.equal(providerNetworkCalls, 2);
  assert.equal(
    mailbox.inspectOutbox("operation-generation-2").state,
    "accepted",
  );
});

test("outbox enqueue is idempotent but rejects operation id reuse with different content", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  const intent = {
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  };

  assert.equal(mailbox.enqueue(intent).created, true);
  assert.equal(mailbox.enqueue(intent).created, false);
  assert.throws(
    () =>
      mailbox.enqueue({
        ...intent,
        payload: { kind: "text", text: "different" },
      }),
    GatewayOutboxConflictError,
  );
});

test("delivery context is a dispatch precondition and does not consume attempts while missing", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-without-context",
  });

  assert.equal(
    mailbox.claimOutbox({
      account,
      leaseMs: 1_000,
      now: 100,
      workerId: "delivery-worker",
    }),
    null,
  );
  const outbox = mailbox.inspectOutbox("operation-1");
  assert.equal(outbox.attempts, 0);
  assert.equal(outbox.state, "pending");
  assert.deepEqual(
    mailbox.inspectOutboxHealth({
      accountKey: account.accountKey,
      generation: account.generation,
    }),
    {
      accountKey: account.accountKey,
      awaitingDeliveryContext: 1,
      generation: account.generation,
      terminalFailures: 0,
      uncertain: 0,
    },
  );
});

test("a prepared delivery survives restart before the provider-visible attempt begins", async (t) => {
  const { mailbox, path, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-media",
    payload: {
      bytes: new TextEncoder().encode("original-media"),
      kind: "image",
    },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "delivery-worker",
  });
  const preparation = mailbox.readPreparation({
    leaseToken: lease.leaseToken,
    now: 101,
    outboxId: lease.outboxId,
  });
  assert.equal(preparation.prepared, undefined);
  assert.deepEqual(preparation.payload, {
    bytes: new TextEncoder().encode("original-media"),
    kind: "image",
  });
  assert.throws(
    () =>
      mailbox.beginAttempt({
        leaseToken: lease.leaseToken,
        now: 101,
        outboxId: lease.outboxId,
      }),
    GatewayLeaseConflictError,
  );
  const preparedPayload = {
    bytes: new TextEncoder().encode("PRIVATE-UPLOAD-RESULT"),
    encoding: "test/prepared;v=1",
  };
  persistPreparation(
    mailbox,
    lease,
    102,
    preparedPayload,
  );
  mailbox.close();

  const reopened = createSqliteGatewayMailbox({
    cipher: identityCipher,
    path,
  });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.recover({ now: 103 }), {
    inboxLeasesReleased: 0,
    outboxLeasesReleased: 1,
    outboxMarkedUncertain: 0,
  });
  assert.equal(
    reopened.inspectOutbox("operation-media").state,
    "pending",
  );
  const resumedLease = reopened.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 104,
    workerId: "resumed-delivery-worker",
  });
  const resumed = reopened.readPreparation({
    leaseToken: resumedLease.leaseToken,
    now: 105,
    outboxId: resumedLease.outboxId,
  });
  assert.deepEqual(resumed.prepared?.payload, preparedPayload);
  persistPreparation(
    reopened,
    resumedLease,
    105,
    resumed.prepared.payload,
  );
  const attempt = reopened.beginAttempt({
    leaseToken: resumedLease.leaseToken,
    now: 106,
    outboxId: resumedLease.outboxId,
  });
  assert.deepEqual(attempt.preparedPayload, preparedPayload);
  assert.equal(
    reopened.inspectOutbox("operation-media").state,
    "attempting",
  );
});

test("a crash after dispatch begins becomes uncertain and is never silently replayed", async (t) => {
  const { mailbox, path, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "delivery-worker",
  });
  const preparedPayload = persistPreparation(
    mailbox,
    lease,
    101,
  );
  const attempt = mailbox.beginAttempt({
    leaseToken: lease.leaseToken,
    now: 102,
    outboxId: lease.outboxId,
  });
  assert.equal(attempt.operationId, "operation-1");
  assert.equal(attempt.deliveryContext, "context-1");
  assert.deepEqual(attempt.preparedPayload, preparedPayload);
  assert.equal(Object.hasOwn(attempt, "payload"), false);

  mailbox.close();
  const reopened = createSqliteGatewayMailbox({
    cipher: identityCipher,
    path,
  });
  t.after(() => reopened.close());
  reopened.registerAccount(account);
  assert.equal(
    reopened.getCheckpoint(account.accountKey),
    "checkpoint-1",
  );
  assert.deepEqual(reopened.recover({ now: 103 }), {
    inboxLeasesReleased: 0,
    outboxLeasesReleased: 0,
    outboxMarkedUncertain: 1,
  });
  assert.equal(
    reopened.inspectOutbox("operation-1").state,
    "uncertain",
  );
  assert.deepEqual(
    reopened.inspectOutboxHealth({
      accountKey: account.accountKey,
      generation: account.generation,
    }),
    {
      accountKey: account.accountKey,
      awaitingDeliveryContext: 0,
      generation: account.generation,
      terminalFailures: 0,
      uncertain: 1,
    },
  );
  assert.equal(
    reopened.claimOutbox({
      account,
      leaseMs: 1_000,
      now: 10_000,
      workerId: "delivery-worker",
    }),
    null,
  );
  assert.deepEqual(
    reopened.listUncertain({
      accountKey: account.accountKey,
    }).map(({ operationId }) => operationId),
    ["operation-1"],
  );
  assert.equal(
    reopened.resolveUncertain({
      now: 10_001,
      operationId: "operation-1",
      resolution: "retry-with-warning",
      retryAfterMs: 50,
    }),
    true,
  );
  assert.equal(
    reopened.claimOutbox({
      account,
      leaseMs: 1_000,
      now: 10_051,
      workerId: "delivery-worker",
    })?.operationId,
    "operation-1",
  );
});

test("manual retry at the attempt limit abandons and clears prepared media", async (t) => {
  const { mailbox, path, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    maxAttempts: 1,
    operationId: "operation-at-limit",
    payload: { kind: "image", bytes: new Uint8Array([1]) },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "delivery-worker",
  });
  persistPreparation(mailbox, lease, 101, {
    bytes: new Uint8Array([2]),
    encoding: "test/prepared;v=1",
  });
  const attempt = mailbox.beginAttempt({
    leaseToken: lease.leaseToken,
    now: 102,
    outboxId: lease.outboxId,
  });
  mailbox.settleAttempt({
    attemptToken: attempt.attemptToken,
    now: 103,
    outcome: {
      errorCode: "ambiguous",
      status: "uncertain",
    },
    outboxId: attempt.outboxId,
  });
  assert.equal(
    mailbox.resolveUncertain({
      now: 104,
      operationId: "operation-at-limit",
      resolution: "retry-with-warning",
    }),
    true,
  );
  assert.equal(
    mailbox.inspectOutbox("operation-at-limit").state,
    "abandoned",
  );
  assert.equal(
    mailbox.inspectOutboxHealth({
      accountKey: account.accountKey,
      generation: account.generation,
    }).terminalFailures,
    1,
  );
  mailbox.close();

  const database = new DatabaseSync(path, { readOnly: true });
  t.after(() => database.close());
  const stored = database
    .prepare(`
      SELECT prepared_cipher, prepared_at
      FROM outbox
      WHERE operation_id = ?
    `)
    .get("operation-at-limit");
  assert.equal(stored.prepared_cipher, null);
  assert.equal(stored.prepared_at, null);
});

test("an uncertain delivery from an old generation cannot reenter the retry queue", async (t) => {
  const { mailbox, path, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-old-generation",
    payload: { kind: "text", text: "old reply" },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "old-generation-worker",
  });
  persistPreparation(mailbox, lease, 101);
  const attempt = mailbox.beginAttempt({
    leaseToken: lease.leaseToken,
    now: 102,
    outboxId: lease.outboxId,
  });
  mailbox.settleAttempt({
    attemptToken: attempt.attemptToken,
    now: 103,
    outcome: {
      errorCode: "ambiguous",
      status: "uncertain",
    },
    outboxId: attempt.outboxId,
  });
  mailbox.registerAccount({
    ...account,
    generation: 2,
  });

  assert.throws(
    () =>
      mailbox.resolveUncertain({
        now: 104,
        operationId: "operation-old-generation",
        resolution: "retry-with-warning",
      }),
    GatewayGenerationConflictError,
  );
  assert.equal(
    mailbox.inspectOutbox("operation-old-generation").state,
    "uncertain",
  );
  assert.equal(
    mailbox.resolveUncertain({
      now: 105,
      operationId: "operation-old-generation",
      resolution: "abandon",
    }),
    true,
  );
  assert.equal(
    mailbox.inspectOutbox("operation-old-generation").state,
    "abandoned",
  );
  mailbox.close();

  const database = new DatabaseSync(path, { readOnly: true });
  t.after(() => database.close());
  const stored = database
    .prepare(`
      SELECT prepared_cipher, prepared_at
      FROM outbox
      WHERE operation_id = ?
    `)
    .get("operation-old-generation");
  assert.equal(stored.prepared_cipher, null);
  assert.equal(stored.prepared_at, null);
});

test("safe retry persists its schedule and reuses the same operation id", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  const firstLease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "delivery-worker",
  });
  const preparedPayload = persistPreparation(
    mailbox,
    firstLease,
    101,
  );
  const firstAttempt = mailbox.beginAttempt({
    leaseToken: firstLease.leaseToken,
    now: 102,
    outboxId: firstLease.outboxId,
  });
  assert.equal(
    mailbox.settleAttempt({
      attemptToken: firstAttempt.attemptToken,
      now: 103,
      outcome: {
        errorCode: "network",
        retryAfterMs: 500,
        status: "retry",
      },
      outboxId: firstAttempt.outboxId,
    }),
    true,
  );
  const scheduled = mailbox.inspectOutbox("operation-1");
  assert.equal(scheduled.attempts, 1);
  assert.equal(scheduled.nextAttemptAt, 603);
  assert.equal(scheduled.operationId, "operation-1");
  assert.equal(scheduled.state, "retry-wait");
  assert.equal(
    mailbox.claimOutbox({
      account,
      leaseMs: 1_000,
      now: 602,
      workerId: "delivery-worker",
    }),
    null,
  );
  const retryLease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 603,
    workerId: "delivery-worker",
  });
  const retryAttempt = mailbox.beginAttempt({
    leaseToken: retryLease.leaseToken,
    now: 604,
    outboxId: retryLease.outboxId,
  });
  assert.equal(retryAttempt.operationId, "operation-1");
  assert.equal(retryAttempt.attemptNumber, 2);
  assert.deepEqual(
    retryAttempt.preparedPayload,
    preparedPayload,
  );
  assert.equal(
    mailbox.settleAttempt({
      attemptToken: retryAttempt.attemptToken,
      now: 605,
      outcome: {
        reasonCode: "shutdown",
        status: "deferred",
      },
      outboxId: retryAttempt.outboxId,
    }),
    true,
  );
  const deferred = mailbox.inspectOutbox("operation-1");
  assert.equal(deferred.attempts, 1);
  assert.equal(deferred.state, "pending");
});

test("an expired inbox lease cannot be acknowledged before another worker reclaims it", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  const expiredLease = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 10,
    now: 100,
    workerId: "old-agent-worker",
  });

  assert.equal(
    mailbox.ackInbox({
      inboxId: expiredLease.inboxId,
      leaseToken: expiredLease.leaseToken,
      now: 110,
    }),
    false,
  );

  const currentLease = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 10,
    now: 110,
    workerId: "new-agent-worker",
  });
  assert.equal(currentLease?.nativeId, "message-1");
  assert.notEqual(
    currentLease?.leaseToken,
    expiredLease.leaseToken,
  );
});

test("an expired outbox lease cannot begin an attempt before another worker reclaims it", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  const expiredLease = mailbox.claimOutbox({
    account,
    leaseMs: 10,
    now: 100,
    workerId: "old-delivery-worker",
  });

  assert.equal(
    mailbox.settlePreparation({
      leaseToken: expiredLease.leaseToken,
      now: 110,
      outcome: {
        preparedPayload: { kind: "must-not-save" },
        status: "ready",
      },
      outboxId: expiredLease.outboxId,
    }),
    false,
  );
  assert.throws(
    () =>
      mailbox.beginAttempt({
        leaseToken: expiredLease.leaseToken,
        now: 110,
        outboxId: expiredLease.outboxId,
      }),
    GatewayLeaseConflictError,
  );

  const currentLease = mailbox.claimOutbox({
    account,
    leaseMs: 10,
    now: 110,
    workerId: "new-delivery-worker",
  });
  assert.equal(currentLease?.operationId, "operation-1");
  assert.notEqual(
    currentLease?.leaseToken,
    expiredLease.leaseToken,
  );
});

test("expired leases are fenced so an old worker cannot begin or settle a newer attempt", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  const staleLease = mailbox.claimOutbox({
    account,
    leaseMs: 10,
    now: 100,
    workerId: "old-worker",
  });
  persistPreparation(mailbox, staleLease, 101);
  const currentLease = mailbox.claimOutbox({
    account,
    leaseMs: 10,
    now: 110,
    workerId: "new-worker",
  });

  assert.notEqual(staleLease.leaseToken, currentLease.leaseToken);
  assert.throws(
    () =>
      mailbox.beginAttempt({
        leaseToken: staleLease.leaseToken,
        now: 111,
        outboxId: staleLease.outboxId,
      }),
    GatewayLeaseConflictError,
  );
  const attempt = mailbox.beginAttempt({
    leaseToken: currentLease.leaseToken,
    now: 111,
    outboxId: currentLease.outboxId,
  });
  assert.equal(
    mailbox.settleAttempt({
      attemptToken: "stale-attempt-token",
      now: 112,
      outcome: { status: "accepted" },
      outboxId: attempt.outboxId,
    }),
    false,
  );
  assert.equal(
    mailbox.inspectOutbox("operation-1").state,
    "attempting",
  );
  assert.equal(
    mailbox.settleAttempt({
      attemptToken: attempt.attemptToken,
      now: 113,
      outcome: { status: "accepted" },
      outboxId: attempt.outboxId,
    }),
    true,
  );
  assert.equal(
    mailbox.inspectOutbox("operation-1").state,
    "accepted",
  );
});

test("startup recovery immediately releases every pre-crash lease", async (t) => {
  const { mailbox, path, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 86_400_000,
    now: 100,
    workerId: "old-agent-worker",
  });
  mailbox.claimOutbox({
    account,
    leaseMs: 86_400_000,
    now: 100,
    workerId: "old-delivery-worker",
  });
  mailbox.close();

  const reopened = createSqliteGatewayMailbox({
    cipher: identityCipher,
    path,
  });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.recover({ now: 101 }), {
    inboxLeasesReleased: 1,
    outboxLeasesReleased: 1,
    outboxMarkedUncertain: 0,
  });
  assert.equal(
    reopened.claimInbox({
      accountKey: account.accountKey,
      leaseMs: 1_000,
      now: 102,
      workerId: "new-agent-worker",
    })?.nativeId,
    "message-1",
  );
  assert.equal(
    reopened.claimOutbox({
      account,
      leaseMs: 1_000,
      now: 102,
      workerId: "new-delivery-worker",
    })?.operationId,
    "operation-1",
  );
});

test("BOT echo reconciles an uncertain operation without entering the Agent inbox", async (t) => {
  const { mailbox, close } = await fixture();
  t.after(close);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent()],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    payload: { kind: "text", text: "reply" },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "delivery-worker",
  });
  persistPreparation(mailbox, lease, 101);
  mailbox.beginAttempt({
    leaseToken: lease.leaseToken,
    now: 102,
    outboxId: lease.outboxId,
  });
  mailbox.recover({ now: 102 });

  const admitted = mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [
      userEvent({
        correlationId: "operation-1",
        kind: "bot-echo",
        nativeId: "bot-echo-1",
      }),
    ],
    fromCheckpoint: "checkpoint-1",
    generation: account.generation,
    nextCheckpoint: "checkpoint-2",
  });
  assert.deepEqual(admitted.admittedNativeIds, []);
  assert.deepEqual(admitted.confirmedOperationIds, [
    "operation-1",
  ]);
  assert.equal(
    mailbox.inspectOutbox("operation-1").state,
    "confirmed",
  );
});

test("the Weixin preparation adapter never classifies upload work as an ambiguous send", async () => {
  const delivery = {
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-1",
    outboxId: 1,
    payload: { kind: "image", bytes: new Uint8Array([1]) },
    recipientId: "user-1",
  };
  const prepared = {
    bytes: new Uint8Array([2]),
    encoding: WEIXIN_PREPARED_DELIVERY_ENCODING,
  };
  const drafts = [];
  const transport = {
    async prepareDelivery(draft) {
      drafts.push(draft);
      return prepared;
    },
  };
  assert.deepEqual(
    await prepareWeixinDelivery(transport, delivery),
    {
      preparedPayload: prepared,
      status: "ready",
    },
  );
  assert.equal(drafts[0].operationId, "operation-1");

  transport.prepareDelivery = async () => {
    throw new WeixinTransportError("network", "redacted", {
      effect: "partial",
      retryAfterMs: 250,
      retryable: true,
    });
  };
  assert.deepEqual(
    await prepareWeixinDelivery(transport, delivery),
    {
      errorCode: "network",
      retryAfterMs: 250,
      status: "retry",
    },
  );

  transport.prepareDelivery = async () => {
    throw new WeixinTransportError("aborted", "redacted");
  };
  assert.deepEqual(
    await prepareWeixinDelivery(transport, delivery),
    {
      reasonCode: "aborted",
      status: "deferred",
    },
  );
});

test("the Weixin delivery adapter retries only known no-effect failures", async () => {
  const attempt = {
    accountKey: account.accountKey,
    attemptNumber: 1,
    attemptToken: "attempt-1",
    deliveryContext: "opaque-context",
    operationId: "operation-1",
    outboxId: 1,
    preparedPayload: {
      bytes: new Uint8Array([1]),
      encoding: WEIXIN_PREPARED_DELIVERY_ENCODING,
    },
    recipientId: "user-1",
  };
  const calls = [];
  const transport = {
    async deliverPrepared(intent) {
      calls.push(intent);
      throw new WeixinTransportError("network", "redacted", {
        effect: "none",
        retryAfterMs: 250,
        retryable: true,
      });
    },
  };
  assert.deepEqual(
    await deliverWeixinAttempt(transport, attempt),
    {
      errorCode: "network",
      retryAfterMs: 250,
      status: "retry",
    },
  );
  assert.equal(calls[0].operationId, "operation-1");
  assert.equal(calls[0].contextToken, "opaque-context");

  transport.deliverPrepared = async () => {
    throw new WeixinTransportError("timeout", "redacted", {
      effect: "unknown",
      retryable: true,
    });
  };
  assert.deepEqual(
    await deliverWeixinAttempt(transport, attempt),
    {
      errorCode: "timeout",
      status: "uncertain",
    },
  );

  transport.deliverPrepared = async () => {
    throw new WeixinTransportError(
      "session-stale",
      "redacted",
      { effect: "none" },
    );
  };
  assert.deepEqual(
    await deliverWeixinAttempt(transport, attempt),
    {
      errorCode: "session-stale",
      status: "rejected",
      terminal: "session-stale",
    },
  );

  transport.deliverPrepared = async () => {
    throw new WeixinTransportError("aborted", "redacted", {
      effect: "none",
    });
  };
  assert.deepEqual(
    await deliverWeixinAttempt(transport, attempt),
    {
      reasonCode: "aborted",
      status: "deferred",
    },
  );

  let invalidCalls = 0;
  assert.deepEqual(
    await deliverWeixinAttempt(
      {
        async deliverPrepared() {
          invalidCalls += 1;
        },
      },
      {
        ...attempt,
        deliveryContext: undefined,
      },
    ),
    {
      errorCode: "invalid-intent",
      status: "rejected",
    },
  );
  assert.equal(invalidCalls, 0);
});

test("the Weixin adapter preserves order, checkpoint CAS fields, context, and client correlation", () => {
  const adapted = adaptWeixinInboundBatch({
    accountKey: account.accountKey,
    batch: {
      fromCheckpoint: "checkpoint-1",
      messages: [
        {
          attachments: [],
          clientId: "operation-1",
          conversationId: "conversation-1",
          id: "bot-message",
          messageType: "bot",
          recipientId: "remote-bot",
          references: [],
          replyContext: {
            contextToken: "opaque-context",
            recipientId: "user-1",
          },
          senderId: "remote-bot",
          state: "finished",
          text: "reply",
          toolProgress: [],
          unsupportedItemTypes: [],
        },
        {
          attachments: [],
          conversationId: "conversation-1",
          id: "user-message",
          messageType: "user",
          recipientId: "remote-bot",
          references: [],
          senderId: "user-1",
          state: "new",
          text: "next",
          toolProgress: [],
          unsupportedItemTypes: [],
        },
      ],
      nextCheckpoint: "checkpoint-2",
    },
    generation: account.generation,
  });

  assert.equal(adapted.fromCheckpoint, "checkpoint-1");
  assert.equal(adapted.nextCheckpoint, "checkpoint-2");
  assert.deepEqual(
    adapted.events.map((event) => event.nativeId),
    ["bot-message", "user-message"],
  );
  assert.equal(adapted.events[0].kind, "bot-echo");
  assert.equal(adapted.events[0].correlationId, "operation-1");
  assert.equal(adapted.events[0].deliveryContext, "opaque-context");
  assert.equal(adapted.events[0].peerId, "user-1");
  assert.equal(
    Object.hasOwn(adapted.events[0].payload, "replyContext"),
    false,
  );
});

test("SQLite mailbox permissions are owner-only", async (t) => {
  const { path, close } = await fixture();
  t.after(close);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("SQLite tightens a pre-existing mailbox directory", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-im-gateway-permissions-"),
  );
  const path = join(directory, "mailbox.sqlite");
  await chmod(directory, 0o755);
  let mailbox;
  try {
    mailbox = createSqliteGatewayMailbox({
      cipher: identityCipher,
      path,
    });
    assert.equal(
      (await stat(directory)).mode & 0o777,
      0o700,
    );
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    mailbox?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an incompatible pre-release mailbox is rejected instead of migrated", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-im-gateway-old-schema-"),
  );
  const path = join(directory, "mailbox.sqlite");
  const oldDatabase = new DatabaseSync(path);
  oldDatabase.exec(`
    CREATE TABLE accounts (account_key TEXT PRIMARY KEY);
    PRAGMA user_version = 1;
  `);
  oldDatabase.close();

  assert.throws(
    () =>
      createSqliteGatewayMailbox({
        cipher: identityCipher,
        path,
      }),
    /incompatible pre-release schema/u,
  );
  const unchanged = new DatabaseSync(path, { readOnly: true });
  t.after(() => unchanged.close());
  assert.equal(
    unchanged.prepare("PRAGMA user_version").get().user_version,
    1,
  );
  assert.deepEqual(
    unchanged
      .prepare("PRAGMA table_info(accounts)")
      .all()
      .map(({ name }) => name),
    ["account_key"],
  );
});

test("payload and delivery context reach SQLite only through the configured cipher", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-im-gateway-cipher-"),
  );
  const path = join(directory, "mailbox.sqlite");
  const xorCipher = {
    open(bytes) {
      return Uint8Array.from(bytes, (byte) => byte ^ 0xa5);
    },
    seal(bytes) {
      return Uint8Array.from(bytes, (byte) => byte ^ 0xa5);
    },
  };
  const mailbox = createSqliteGatewayMailbox({
    cipher: xorCipher,
    path,
  });
  mailbox.registerAccount(account);
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [
      userEvent({
        deliveryContext: "SECRET-CONTEXT-6d9238",
        payload: { text: "SECRET-INBOUND-164f0c" },
      }),
    ],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "SECRET-CHECKPOINT-91a46f",
  });
  mailbox.enqueue({
    accountKey: account.accountKey,
    generation: account.generation,
    operationId: "operation-secret",
    payload: {
      kind: "text",
      text: "SECRET-OUTBOUND-c782b7",
    },
    recipientId: "user-1",
  });
  const lease = mailbox.claimOutbox({
    account,
    leaseMs: 1_000,
    now: 100,
    workerId: "cipher-worker",
  });
  persistPreparation(mailbox, lease, 101, {
    secret: "SECRET-PREPARED-a315e9",
  });
  mailbox.close();

  const bytes = await readFile(path);
  const storage = bytes.toString("latin1");
  assert.equal(storage.includes("SECRET-CONTEXT-6d9238"), false);
  assert.equal(storage.includes("SECRET-CHECKPOINT-91a46f"), false);
  assert.equal(storage.includes("SECRET-INBOUND-164f0c"), false);
  assert.equal(storage.includes("SECRET-OUTBOUND-c782b7"), false);
  assert.equal(storage.includes("SECRET-PREPARED-a315e9"), false);
});

test("cipher purposes canonically fence delimiter-shaped ids and generations", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-im-gateway-purpose-"),
  );
  const purposes = [];
  const mailbox = createSqliteGatewayMailbox({
    cipher: {
      open(bytes) {
        return new Uint8Array(bytes);
      },
      seal(bytes, purpose) {
        purposes.push(purpose);
        return new Uint8Array(bytes);
      },
    },
    path: join(directory, "mailbox.sqlite"),
  });
  const first = {
    ...account,
    accountKey: "a:b",
    providerAccountId: "remote-1",
  };
  const second = {
    ...account,
    accountKey: "a",
    providerAccountId: "remote-2",
  };
  mailbox.registerAccount(first);
  mailbox.registerAccount(second);
  mailbox.admitBatch({
    accountKey: first.accountKey,
    events: [userEvent({ nativeId: "c" })],
    fromCheckpoint: null,
    generation: first.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.admitBatch({
    accountKey: second.accountKey,
    events: [userEvent({ nativeId: "b:c" })],
    fromCheckpoint: null,
    generation: second.generation,
    nextCheckpoint: "checkpoint-1",
  });
  mailbox.close();

  const inboxPurposes = purposes
    .map((purpose) => JSON.parse(purpose))
    .filter((tuple) => tuple[2] === "inbox")
    .map((tuple) => JSON.stringify(tuple));
  assert.equal(inboxPurposes.length, 2);
  assert.equal(new Set(inboxPurposes).size, 2);
});
