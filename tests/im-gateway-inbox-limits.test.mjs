import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSqliteGatewayMailbox,
} from "../packages/im-gateway/src/sqlite.ts";

const account = Object.freeze({
  accountKey: "test:quota",
  generation: 1,
  provider: "test",
  providerAccountId: "quota-account",
  requiresDeliveryContext: false,
});

const identityCipher = Object.freeze({
  open(bytes) {
    return new Uint8Array(bytes);
  },
  seal(bytes) {
    return new Uint8Array(bytes);
  },
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-im-gateway-inbox-limits-"),
  );
  const mailbox = createSqliteGatewayMailbox({
    cipher: identityCipher,
    path: join(directory, "mailbox.sqlite"),
    ...options,
  });
  mailbox.registerAccount(account);
  t.after(() => {
    mailbox.close();
    return rm(directory, { force: true, recursive: true });
  });
  return mailbox;
}

function userEvent(nativeId) {
  return {
    conversationId: "conversation-1",
    kind: "user-message",
    nativeId,
    payload: { text: nativeId },
    peerId: "user-1",
    senderId: "user-1",
  };
}

test("the opt-in inbox cap admits available events, reports only new overflow, and advances the checkpoint", async (t) => {
  const mailbox = await fixture(t, {
    maxPendingInboxPerAccount: 2,
  });

  assert.deepEqual(
    mailbox.admitBatch({
      accountKey: account.accountKey,
      events: [userEvent("message-1")],
      fromCheckpoint: null,
      generation: account.generation,
      nextCheckpoint: "checkpoint-1",
      observedAt: 100,
    }),
    {
      admittedNativeIds: ["message-1"],
      confirmedOperationIds: [],
      nextCheckpoint: "checkpoint-1",
    },
  );

  assert.deepEqual(
    mailbox.admitBatch({
      accountKey: account.accountKey,
      events: [
        userEvent("message-1"),
        userEvent("message-2"),
        userEvent("message-3"),
      ],
      fromCheckpoint: "checkpoint-1",
      generation: account.generation,
      nextCheckpoint: "checkpoint-2",
      observedAt: 101,
    }),
    {
      admittedNativeIds: ["message-2"],
      confirmedOperationIds: [],
      droppedNativeIds: ["message-3"],
      nextCheckpoint: "checkpoint-2",
    },
  );
  assert.equal(
    mailbox.getCheckpoint(account.accountKey),
    "checkpoint-2",
  );

  const lease = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 1_000,
    now: 102,
    workerId: "worker-1",
  });
  assert.equal(lease?.nativeId, "message-1");
  assert.deepEqual(
    mailbox.admitBatch({
      accountKey: account.accountKey,
      events: [userEvent("message-4")],
      fromCheckpoint: "checkpoint-2",
      generation: account.generation,
      nextCheckpoint: "checkpoint-3",
      observedAt: 103,
    }),
    {
      admittedNativeIds: [],
      confirmedOperationIds: [],
      droppedNativeIds: ["message-4"],
      nextCheckpoint: "checkpoint-3",
    },
  );
  assert.equal(
    mailbox.getCheckpoint(account.accountKey),
    "checkpoint-3",
  );
});

test("consumed inbox retention expires rows only after the configured window", async (t) => {
  const mailbox = await fixture(t, {
    consumedInboxRetentionMs: 100,
  });
  mailbox.admitBatch({
    accountKey: account.accountKey,
    events: [userEvent("message-retained")],
    fromCheckpoint: null,
    generation: account.generation,
    nextCheckpoint: "checkpoint-1",
    observedAt: 100,
  });
  const lease = mailbox.claimInbox({
    accountKey: account.accountKey,
    leaseMs: 1_000,
    now: 101,
    workerId: "worker-1",
  });
  assert.equal(lease?.nativeId, "message-retained");
  assert.equal(
    mailbox.ackInbox({
      inboxId: lease.inboxId,
      leaseToken: lease.leaseToken,
      now: 120,
    }),
    true,
  );

  assert.deepEqual(
    mailbox.admitBatch({
      accountKey: account.accountKey,
      events: [userEvent("message-retained")],
      fromCheckpoint: "checkpoint-1",
      generation: account.generation,
      nextCheckpoint: "checkpoint-2",
      observedAt: 220,
    }),
    {
      admittedNativeIds: [],
      confirmedOperationIds: [],
      nextCheckpoint: "checkpoint-2",
    },
  );
  assert.deepEqual(
    mailbox.admitBatch({
      accountKey: account.accountKey,
      events: [userEvent("message-retained")],
      fromCheckpoint: "checkpoint-2",
      generation: account.generation,
      nextCheckpoint: "checkpoint-3",
      observedAt: 221,
    }),
    {
      admittedNativeIds: ["message-retained"],
      confirmedOperationIds: [],
      nextCheckpoint: "checkpoint-3",
    },
  );
});

test("inbox limits remain opt-in and validate their integer boundaries", async (t) => {
  const unlimited = await fixture(t);
  assert.deepEqual(
    unlimited.admitBatch({
      accountKey: account.accountKey,
      events: [
        userEvent("message-1"),
        userEvent("message-2"),
        userEvent("message-3"),
      ],
      fromCheckpoint: null,
      generation: account.generation,
      nextCheckpoint: "checkpoint-unlimited",
      observedAt: 100,
    }),
    {
      admittedNativeIds: [
        "message-1",
        "message-2",
        "message-3",
      ],
      confirmedOperationIds: [],
      nextCheckpoint: "checkpoint-unlimited",
    },
  );

  const invalidOptions = [
    [
      { maxPendingInboxPerAccount: 0 },
      /maxPendingInboxPerAccount must be a positive safe integer/u,
    ],
    [
      { maxPendingInboxPerAccount: 1.5 },
      /maxPendingInboxPerAccount must be a positive safe integer/u,
    ],
    [
      { consumedInboxRetentionMs: -1 },
      /consumedInboxRetentionMs must be a non-negative safe integer/u,
    ],
    [
      { consumedInboxRetentionMs: 1.5 },
      /consumedInboxRetentionMs must be a non-negative safe integer/u,
    ],
  ];
  for (const [options, expected] of invalidOptions) {
    const directory = await mkdtemp(
      join(tmpdir(), "minke-im-gateway-invalid-limit-"),
    );
    t.after(() => rm(directory, { force: true, recursive: true }));
    assert.throws(
      () =>
        createSqliteGatewayMailbox({
          cipher: identityCipher,
          path: join(directory, "mailbox.sqlite"),
          ...options,
        }),
      expected,
    );
  }
});
