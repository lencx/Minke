import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  AGENT_BROWSER_PROCESS_CHANNEL,
  AGENT_BROWSER_PROTOCOL_VERSION,
  createAgentBrowserReleaseOwnerRequest,
  createAgentBrowserRequest,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AgentBrowserProcessChannel,
} from "@minke/desktop/main/agent-browser/index.ts";

async function settleAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

class FakeChild extends EventEmitter {
  connected = true;
  sent = [];

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
    return true;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("duplicate and malformed active request ids preserve one authoritative terminal response", async () => {
  const child = new FakeChild();
  const operation = deferred();
  let activeSignal;
  const handler = {
    async handleProcessRequest(_request, signal) {
      activeSignal = signal;
      await operation.promise;
      return {
        sessionId: "agent-result",
        generation: 1,
        owner: "agent",
        status: "ready",
        url: "https://example.com/",
      };
    },
    closeOwner() {},
  };
  const channel = new AgentBrowserProcessChannel(child, handler);
  const request = createAgentBrowserRequest(
    7,
    "conversation-1",
    "open",
    { url: "https://example.com/" },
  );

  child.emit("message", request);
  await settleAsyncWork();
  child.emit("message", request);
  child.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: 7,
    type: "request",
    operation: "raw-cdp",
    ownerSessionId: "conversation-1",
    payload: {},
  });
  await settleAsyncWork();

  assert.equal(activeSignal.aborted, false);
  assert.deepEqual(child.sent, []);

  operation.resolve();
  await settleAsyncWork();
  assert.equal(child.sent.length, 1);
  assert.equal(child.sent[0].requestId, 7);
  assert.equal(child.sent[0].type, "response");

  channel.dispose();
});

test("release-owner aborts owned work and reaps the owner exactly once", async () => {
  const child = new FakeChild();
  const closedOwners = [];
  let activeSignal;
  const handler = {
    async handleProcessRequest(_request, signal) {
      activeSignal = signal;
      return await new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      });
    },
    closeOwner(ownerSessionId) {
      closedOwners.push(ownerSessionId);
    },
  };
  const channel = new AgentBrowserProcessChannel(child, handler);
  child.emit(
    "message",
    createAgentBrowserRequest(
      8,
      "conversation-release",
      "wait",
      {
        sessionId: "agent-result",
        text: "ready",
        timeoutMs: 1_000,
      },
    ),
  );
  await settleAsyncWork();

  child.emit(
    "message",
    createAgentBrowserReleaseOwnerRequest(
      "conversation-release",
    ),
  );
  await settleAsyncWork();

  assert.equal(activeSignal.aborted, true);
  assert.deepEqual(closedOwners, ["conversation-release"]);
  assert.equal(child.sent.length, 1);
  assert.equal(child.sent[0].requestId, 8);
  assert.equal(child.sent[0].type, "error");

  channel.dispose();
  assert.deepEqual(closedOwners, ["conversation-release"]);
});

test("failed owner release stays in the ledger for channel teardown retry", async () => {
  const child = new FakeChild();
  const closedOwners = [];
  let attempt = 0;
  const handler = {
    async handleProcessRequest() {
      return {
        sessionId: "agent-result",
        generation: 1,
        owner: "agent",
        status: "ready",
      };
    },
    async closeOwner(ownerSessionId) {
      closedOwners.push(ownerSessionId);
      attempt += 1;
      if (attempt === 1) {
        throw new Error("transient cleanup failure");
      }
    },
  };
  const channel = new AgentBrowserProcessChannel(child, handler);
  child.emit(
    "message",
    createAgentBrowserRequest(
      9,
      "conversation-retry",
      "open",
      { url: "https://example.com/" },
    ),
  );
  await settleAsyncWork();

  child.emit(
    "message",
    createAgentBrowserReleaseOwnerRequest(
      "conversation-retry",
    ),
  );
  await settleAsyncWork();
  assert.deepEqual(closedOwners, ["conversation-retry"]);

  channel.dispose();
  await settleAsyncWork();
  assert.deepEqual(closedOwners, [
    "conversation-retry",
    "conversation-retry",
  ]);
});
