import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  RemoteError,
} from "@deepseek-ai/dsh-typert-protocol";
import {
  apply as applyMinkeHost,
} from "@minke/harness-overlay/index.ts";
import {
  MINKE_HOST_PROTOCOL_VERSION,
  MINKE_HOST_RPC_CHANNEL,
  minkeHostEndpoint,
  parseMinkeHostCapabilities,
} from "@minke/harness-overlay/minke-host-contract.ts";
import {
  MINKE_PWA_ROUTES,
} from "@minke/harness-overlay/pwa-contract.ts";
import {
  browserFilesPort,
  browserTabsPort,
} from "@minke/harness-overlay/client/host/workspace.ts";
import {
  installTrustedHostControl,
} from "@minke/harness-overlay/host/trusted-host-control.ts";
import {
  createReplaceTrustedHostsRequest,
} from "@minke/harness-overlay/trusted-host-control-contract.ts";
import {
  createAgentTurnCancelRequest,
  createAgentTurnRunRequest,
  parseAgentTurnProcessResponse,
} from "@minke/harness-overlay/agent-turn-contract.ts";
import {
  installAgentTurnControl,
  runAgentTurnInHarness,
} from "@minke/harness-overlay/host/agent-turn-control.ts";
import {
  MINKE_REMOTE_PREVIEW_ROUTE,
  RemotePreviewRuntime,
} from "@minke/harness-overlay/host/remote-preview.ts";

// Exercise the released Gateway and shared Connection without Minke bundle patches.
import { Context } from "../vendor/deepseek-harness/vendor/cordis/lib/index.js";
import { TypertRegistry } from "../vendor/deepseek-harness/packages/typert/registry/lib/index.js";
import { TypertGatewayService } from "../vendor/deepseek-harness/packages/api/gateway/lib/index.js";
import { RemoteAccessService } from "../vendor/deepseek-harness/packages/api/remote-access/lib/index.js";
import * as Connection from "../vendor/deepseek-harness/packages/client/connection/lib/index.js";

async function workspaceApi(t) {
  const root = new Context();
  const fibers = [];
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  const mount = (plugin, config) => {
    const fiber = root.plugin(plugin, config);
    fibers.push(fiber);
    return fiber;
  };
  await mount(TypertRegistry);
  await mount(Connection);
  await mount(RemoteAccessService);
  await mount(TypertGatewayService, {});
  const transport = root.connection.createSharedFetchHandler("/api");
  const createPeer = (principal) => {
    const peer = root.connection.createPeer({ principal });
    t.after(() => peer.dispose());
    return peer;
  };
  const owner = createPeer({ kind: "owner" });
  const call = async (endpoint, payload = {}, signal, peer = owner) => {
    const method = minkeHostEndpoint(endpoint);
    const response = await transport.fetch(new Request(`http://localhost/api/${method}`, {
      method: "POST", signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: "workspace-test", method,
        payload: { args: endpoint === "capabilities" ? payload : { request: payload } } }),
    }), peer);
    if (response.status === 404) return { status: 404 };
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.type, "server-response");
    assert.equal(envelope.rpcId, "workspace-test");
    return envelope.result;
  };
  return { mount, call, createPeer };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function hostCapabilities(root = "/host/home") {
  return {
    protocolVersion: MINKE_HOST_PROTOCOL_VERSION,
    files: {
      available: true,
      root,
      watch: false,
      write: true,
    },
    tabs: {
      available: true,
      embeddedWeb: false,
      state: "client",
    },
  };
}

test("Files capability protocol 5 drops native opening and rejects older handshakes", () => {
  const capabilities = hostCapabilities();
  assert.equal(capabilities.protocolVersion, 5);
  assert.deepEqual(parseMinkeHostCapabilities(capabilities), capabilities);
  const legacy = { ...capabilities, protocolVersion: 4,
    files: { ...capabilities.files, nativeOpen: false } };
  assert.throws(() => parseMinkeHostCapabilities(legacy), /capabilities are incompatible/u);
  assert.deepEqual(Object.keys(capabilities.files).sort(), ["available", "root", "watch", "write"]);
});

test("Minke Host applies trusted-host replacements over its private process channel", () => {
  const port = new EventEmitter();
  const responses = [];
  const replacements = [];
  let dispose;
  port.send = (message, callback) => {
    responses.push(message);
    callback?.(null);
    return true;
  };
  installTrustedHostControl(
    {
      effect(callback) {
        dispose = callback();
      },
      connection: {
        replaceTrustedHosts(trustedHosts) {
          replacements.push([...trustedHosts]);
        },
      },
    },
    port,
  );

  port.emit(
    "message",
    createReplaceTrustedHostsRequest(
      7,
      ["minke.example-tailnet.ts.net"],
    ),
  );

  assert.deepEqual(replacements, [
    ["minke.example-tailnet.ts.net"],
  ]);
  assert.deepEqual(responses, [{
    channel: "minke:harness-control",
    protocolVersion: 1,
    requestId: 7,
    type: "trusted-hosts/replaced",
  }]);
  dispose();
  assert.equal(port.listenerCount("message"), 0);
});

function agentTurnHistory(operationId, {
  answer = "Minke answer",
  endReason = { kind: "completed" },
  turn = 2,
  userText = "incoming",
} = {}) {
  return [
    {
      event: {
        type: "turn/start",
        seq: 10,
        time: 10,
        data: { turn },
      },
    },
    {
      event: {
        type: "step/start",
        seq: 11,
        time: 11,
        data: { turn, step: 1 },
      },
    },
    {
      event: {
        type: "user/message",
        seq: 12,
        time: 12,
        data: {
          role: "user",
          content: [{ type: "text", text: userText }],
          source: { kind: "user", rpcId: operationId },
        },
      },
    },
    {
      event: {
        type: "assistant/message",
        seq: 13,
        time: 13,
        data: {
          turn,
          step: 1,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "stale answer" },
            ],
          },
        },
      },
    },
    {
      event: {
        type: "assistant/message",
        seq: 14,
        time: 14,
        data: {
          turn,
          step: 2,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: answer.slice(0, 3) },
              { type: "tool-call", id: "ignored" },
              { type: "text", text: answer.slice(3) },
            ],
          },
        },
      },
    },
    {
      event: {
        type: "turn/end",
        seq: 15,
        time: 15,
        data: { turn, reason: endReason },
      },
    },
  ];
}

function inspectedAgentTurn(history) {
  return {
    events: history.map(({ event }) => event),
  };
}

function agentTurnHistoryWithProducedFiles(operationId) {
  const turn = 3;
  const resultMessage = (callId, isError = false) => ({
    role: "tool",
    source: { callId },
    content: [{
      type: "tool-result",
      toolCallId: callId,
      content: [{ type: "text", text: "settled" }],
      isError,
    }],
  });
  return [
    {
      event: {
        type: "turn/start",
        seq: 20,
        time: 20,
        data: { turn },
      },
    },
    {
      event: {
        type: "user/message",
        seq: 21,
        time: 21,
        data: {
          role: "user",
          content: [{ type: "text", text: "build it" }],
          source: { kind: "user", rpcId: operationId },
        },
      },
    },
    {
      event: {
        type: "tool/call",
        seq: 22,
        time: 22,
        data: {
          turn,
          step: 1,
          callId: "write-ok",
          name: "write",
          arguments: JSON.stringify({
            file_path: "demo.html",
            content: "<h1>Minke</h1>",
          }),
        },
      },
      view: {
        for: "call",
        view: {
          card: "diff",
          locations: [
            { path: "demo.html" },
            { path: "notes.txt" },
          ],
        },
      },
    },
    {
      event: {
        type: "tool/result",
        seq: 23,
        time: 23,
        data: {
          turn,
          step: 1,
          message: resultMessage("write-ok"),
          meta: { path: join(tmpdir(), "demo.html") },
        },
      },
    },
    {
      event: {
        type: "tool/call",
        seq: 24,
        time: 24,
        data: {
          turn,
          step: 2,
          callId: "read-only",
          name: "read",
          arguments: JSON.stringify({
            file_path: "not-produced.html",
          }),
        },
      },
      view: {
        for: "call",
        view: {
          card: "generic",
          kind: "read",
          locations: [{ path: "not-produced.html" }],
        },
      },
    },
    {
      event: {
        type: "tool/result",
        seq: 25,
        time: 25,
        data: {
          turn,
          step: 2,
          message: resultMessage("read-only"),
        },
      },
    },
    {
      event: {
        type: "tool/call",
        seq: 26,
        time: 26,
        data: {
          turn,
          step: 3,
          callId: "edit-ok",
          name: "str_replace_editor",
          arguments: JSON.stringify({
            command: "insert",
            path: join(tmpdir(), "notes.txt"),
            insert_line: 0,
            new_str: "Minke",
          }),
        },
      },
    },
    {
      event: {
        type: "tool/result",
        seq: 27,
        time: 27,
        data: {
          turn,
          step: 3,
          message: resultMessage("edit-ok"),
        },
      },
    },
    {
      event: {
        type: "tool/call",
        seq: 28,
        time: 28,
        data: {
          turn,
          step: 4,
          callId: "write-failed",
          name: "write",
          arguments: JSON.stringify({
            file_path: "failed.html",
            content: "failed",
          }),
        },
      },
      view: {
        for: "call",
        view: {
          card: "generic",
          kind: "edit",
          locations: [{ path: "failed.html" }],
        },
      },
    },
    {
      event: {
        type: "tool/result",
        seq: 29,
        time: 29,
        data: {
          turn,
          step: 4,
          message: resultMessage("write-failed", true),
        },
      },
    },
    {
      event: {
        type: "assistant/message",
        seq: 30,
        time: 30,
        data: {
          turn,
          step: 5,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Built the page." }],
          },
        },
      },
    },
    {
      event: {
        type: "tool/call",
        seq: 31,
        time: 31,
        data: {
          turn,
          step: 6,
          callId: "after-closing",
          name: "write",
          arguments: JSON.stringify({
            file_path: "after-closing.html",
            content: "late",
          }),
        },
      },
      view: {
        for: "call",
        view: {
          card: "diff",
          locations: [{ path: "after-closing.html" }],
        },
      },
    },
    {
      event: {
        type: "tool/result",
        seq: 32,
        time: 32,
        data: {
          turn,
          step: 6,
          message: resultMessage("after-closing"),
        },
      },
    },
    {
      event: {
        type: "turn/end",
        seq: 33,
        time: 33,
        data: { turn, reason: { kind: "completed" } },
      },
    },
  ];
}

async function nextAgentTurnResponse(responses) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (responses.length > 0) return responses.shift();
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Agent turn control did not respond");
}

async function agentTurnResponseFor(responses, requestId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const index = responses.findIndex(
      (response) => response.requestId === requestId,
    );
    if (index >= 0) return responses.splice(index, 1)[0];
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `Agent turn control did not respond to ${String(requestId)}`,
  );
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition did not become true");
}

test("Minke Host recovers a completed Agent turn before prompting again", async () => {
  const operationId = "weixin:account-1:message-7";
  const calls = [];
  const port = new EventEmitter();
  port.connected = true;
  const responses = [];
  port.send = (message, callback) => {
    responses.push(message);
    callback?.(null);
    return true;
  };
  let dispose;
  const context = {
    agents: {
      get() {
        return undefined;
      },
    },
    effect(callback) {
      dispose = callback();
    },
    sessionController: {
      create(request) {
        calls.push(["create", request]);
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect(sessionId, signal) {
        calls.push(["inspect", { sessionId, signal }]);
        return Promise.resolve(inspectedAgentTurn(
          agentTurnHistory(operationId),
        ));
      },
      prompt(request, signal) {
        calls.push(["prompt", { request, signal }]);
        return Promise.resolve({ accepted: true });
      },
    },
  };
  assert.equal(
    installAgentTurnControl(context, port, {
      pollIntervalMs: 0,
    }),
    true,
  );

  port.emit("message", createAgentTurnRunRequest(9, {
    operationId,
    sessionId: "session-im-account-1-peer-2",
    text: "incoming",
  }));
  const response = parseAgentTurnProcessResponse(
    await nextAgentTurnResponse(responses),
  );
  port.emit("message", createAgentTurnRunRequest(10, {
    operationId,
    sessionId: "session-im-account-1-peer-2",
    text: "incoming",
  }));
  const retried = parseAgentTurnProcessResponse(
    await nextAgentTurnResponse(responses),
  );
  port.emit("message", createAgentTurnRunRequest(11, {
    operationId,
    sessionId: "session-im-account-1-peer-2",
    text: "different input",
  }));
  const conflict = parseAgentTurnProcessResponse(
    await nextAgentTurnResponse(responses),
  );

  assert.deepEqual(response.result, {
    outcome: "completed",
    sessionId: "session-im-account-1-peer-2",
    text: "Minke answer",
    turn: 2,
    endReason: "completed",
  });
  assert.deepEqual(retried.result, response.result);
  assert.equal(conflict.type, "agent-turn/error");
  assert.equal(conflict.code, "operation-conflict");
  assert.deepEqual(
    calls.map(([method]) => method),
    [
      "create",
      "inspect",
      "create",
      "inspect",
    ],
  );
  assert.equal(
    calls[0][1].sessionId,
    "session-im-account-1-peer-2",
  );
  assert.deepEqual(calls[2][1], calls[0][1]);
  dispose();
});

test("Minke Host skips alpha.2 ignorable external Session events with non-object data", async () => {
  const operationId = "weixin:account-1:message-ignorable";
  const base = agentTurnHistory(operationId, {
    answer: "compatible reply",
    userText: "hello",
  }).map(({ event }) => event);
  const events = [
    ...base.slice(0, 2),
    {
      type: "plugin/diagnostic-null",
      time: 12,
      data: null,
      ignorable: true,
    },
    {
      type: "plugin/diagnostic-number",
      time: 13,
      data: 7,
      ignorable: true,
    },
    {
      type: "plugin/diagnostic-string",
      time: 14,
      data: "informational",
      ignorable: true,
    },
    ...base.slice(2),
  ].map((event, seq) => ({ ...event, seq }));

  const result = await runAgentTurnInHarness(
    {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        return Promise.resolve({ events });
      },
      prompt() {
        throw new Error("prompt must not run");
      },
    },
    {
      operationId,
      sessionId: "session-im-account-1-peer-ignorable",
      text: "hello",
    },
    new AbortController().signal,
    { pollIntervalMs: 0 },
  );

  assert.deepEqual(result, {
    outcome: "completed",
    sessionId: "session-im-account-1-peer-ignorable",
    text: "compatible reply",
    turn: 2,
    endReason: "completed",
  });
});

test("Minke Host ignores unconsumed events validated by SessionController", async () => {
  const operationId = "weixin:account-1:message-required";
  const base = agentTurnHistory(operationId, {
    answer: "forward-compatible reply",
    userText: "hello",
  }).map(({ event }) => event);
  const events = [
    ...base.slice(0, 3),
    {
      type: "plugin/required-state",
      time: 13,
      data: { changesReconstruction: true },
    },
    ...base.slice(3),
  ].map((event, seq) => ({ ...event, seq }));

  const result = await runAgentTurnInHarness(
    {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        return Promise.resolve({ events });
      },
      prompt() {
        throw new Error("prompt must not run");
      },
    },
    {
      operationId,
      sessionId: "session-im-account-1-peer-required",
      text: "hello",
    },
    new AbortController().signal,
    { pollIntervalMs: 0 },
  );

  assert.deepEqual(result, {
    outcome: "completed",
    sessionId: "session-im-account-1-peer-required",
    text: "forward-compatible reply",
    turn: 2,
    endReason: "completed",
  });
});

test("Minke Host reuses an IM reply after the released v2 history migrates to v3", async () => {
  const { SessionFormatEventCollector } = await import(
    "@vendor/deepseek-harness/packages/session/session-format/lib/index.js"
  );
  const {
    restoreReleasedV3Artifact,
    sessionFormatV2ToV3,
  } = await import(
    "@vendor/deepseek-harness/packages/session/session-format-v2-to-v3/lib/index.js"
  );
  const input = {
    operationId: "weixin:account-1:message-before-upgrade",
    sessionId: "minke-im-before-upgrade",
    text: "Keep the reply across upgrades",
  };
  const sourceHeader = {
    version: 2,
    id: input.sessionId,
    createdAt: 1,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "code",
  };
  const sourceEvents = [
    { type: "turn/start", data: { turn: 1 } },
    { type: "step/start", data: { turn: 1, step: 1 } },
    {
      type: "user/message",
      data: {
        id: "user-before-upgrade",
        role: "user",
        content: [{ type: "text", text: input.text }],
        source: { kind: "user", rpcId: input.operationId },
      },
      surfaceOp: "append",
    },
    {
      type: "request/header",
      data: {
        header: {
          config: { provider: "mock", model: "mock" },
          system: "You are Minke.",
        },
        reason: "initial",
      },
    },
    {
      type: "assistant/message",
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "assistant-before-upgrade",
          role: "assistant",
          content: [{ type: "text", text: "Preserved reply" }],
          source: { kind: "model", provider: "mock", model: "mock" },
        },
        stream: [],
      },
      surfaceOp: "append",
    },
    { type: "step/end", data: { turn: 1, step: 1 } },
    { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } },
  ].map((event, seq) => ({ ...event, seq, time: seq + 1 }));
  const beforeMigration = JSON.stringify({ sourceHeader, sourceEvents });
  const targetHeader = sessionFormatV2ToV3.migrateHeader(sourceHeader);
  const stage = sessionFormatV2ToV3.createStage({
    sourceHeader,
    targetHeader,
    sourceInheritedEventCount: 0,
    sourceKind: "decoded",
  });
  const collector = new SessionFormatEventCollector();
  for (const event of sourceEvents) stage.transformEvent(event, collector);
  const migrated = restoreReleasedV3Artifact({
    header: targetHeader,
    events: collector.values,
    inheritedEventCount: stage.finish(collector),
  }, new Set());
  assert.equal(
    JSON.stringify({ sourceHeader, sourceEvents }),
    beforeMigration,
    "migration must preserve its predecessor history",
  );
  assert.equal(migrated.header.version, 3);
  assert.equal(migrated.header.agentPreset, "ptc");
  const systemEvents = migrated.events.filter(
    (event) => event.type === "system/message",
  );
  assert.equal(systemEvents.length, 2);
  assert.deepEqual(systemEvents[1].surfaceOp, {
    op: "replace",
    startSeq: systemEvents[0].seq,
    endSeq: systemEvents[0].seq,
  });
  assert.deepEqual(systemEvents[1].data.message.content, [
    { type: "text", text: "You are Minke." },
  ]);
  const controller = {
    async create(request) { return { sessionId: request.sessionId }; },
    async inspect() { return { events: migrated.events }; },
    async prompt() { throw new Error("migrated operations must not be queued twice"); },
  };
  assert.deepEqual(
    await runAgentTurnInHarness(controller, input, new AbortController().signal),
    {
      outcome: "completed",
      sessionId: input.sessionId,
      text: "Preserved reply",
      turn: 1,
      endReason: "completed",
    },
  );
  await assert.rejects(
    runAgentTurnInHarness(
      controller,
      { ...input, text: "A different message with the same operation id" },
      new AbortController().signal,
    ),
    { code: "operation-conflict" },
    "the migrated reply must remain bound to its original IM input",
  );
});

test("Minke Host scans a long Session once and follows its event tail without polling", async () => {
  const operationId = "weixin:account-1:message-long-history";
  const prefixLength = 2_048;
  const events = Array.from(
    { length: prefixLength },
    (_, seq) => ({
      type: "step/start",
      seq,
      time: seq,
      data: { turn: 0, step: seq },
    }),
  );
  events.push(
    {
      type: "turn/start",
      seq: events.length,
      time: events.length,
      data: { turn: 9 },
    },
    {
      type: "user/message",
      seq: events.length + 1,
      time: events.length + 1,
      data: {
        role: "user",
        content: [{ type: "text", text: "long history" }],
        source: { kind: "user", rpcId: operationId },
      },
    },
  );
  let numericIndexReads = 0;
  const observedEvents = new Proxy(events, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        /^(?:0|[1-9][0-9]*)$/u.test(property)
      ) {
        numericIndexReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  let inspections = 0;
  let follows = 0;

  const result = await runAgentTurnInHarness(
    {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        inspections += 1;
        return Promise.resolve({ events: observedEvents });
      },
      follow(request) {
        follows += 1;
        assert.deepEqual(request, {
          address: {
            kind: "session",
            sessionId:
              "session-im-account-1-peer-long-history",
          },
        });
        return (async function* () {
          yield {
            type: "snapshot",
            cursor: events.at(-1).seq,
            records: [],
          };
          events.push(
            {
              type: "assistant/message",
              seq: events.length,
              time: events.length,
              data: {
                turn: 9,
                step: 1,
                message: {
                  role: "assistant",
                  content: [{
                    type: "text",
                    text: "incremental reply",
                  }],
                },
              },
            },
            {
              type: "turn/end",
              seq: events.length + 1,
              time: events.length + 1,
              data: {
                turn: 9,
                reason: { kind: "completed" },
              },
            },
          );
          yield { type: "event", event: events.at(-2) };
          yield { type: "event", event: events.at(-1) };
        })();
      },
      prompt() {
        throw new Error("prompt must not run");
      },
    },
    {
      operationId,
      sessionId: "session-im-account-1-peer-long-history",
      text: "long history",
    },
    new AbortController().signal,
    { pollIntervalMs: 0 },
  );

  assert.equal(inspections, 1);
  assert.equal(follows, 1);
  assert.equal(result.outcome, "completed");
  assert.equal(result.text, "incremental reply");
  assert.ok(
    numericIndexReads < events.length * 2,
    `expected one full scan, observed ${numericIndexReads} indexed reads`,
  );
});

test("Minke Host reconciles a truncated follow opening before deciding to prompt", async () => {
  const operationId = "weixin:account-1:message-follow-gap";
  const input = {
    operationId,
    sessionId: "session-im-account-1-peer-follow-gap",
    text: "already admitted",
  };
  const reconciledEvents = [
    {
      type: "turn/start",
      seq: 0,
      time: 0,
      data: { turn: 12 },
    },
    {
      type: "user/message",
      seq: 1,
      time: 1,
      data: {
        role: "user",
        content: [{ type: "text", text: input.text }],
        source: { kind: "user", rpcId: operationId },
      },
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      type: "step/start",
      seq: index + 2,
      time: index + 2,
      data: { turn: 12, step: index + 1 },
    })),
    {
      type: "assistant/message",
      seq: 6,
      time: 6,
      data: {
        turn: 12,
        step: 4,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "race-safe reply" }],
        },
      },
    },
  ];
  const turnEnd = {
    type: "turn/end",
    seq: 7,
    time: 7,
    data: {
      turn: 12,
      reason: { kind: "completed" },
    },
  };
  let inspections = 0;
  let promptCalls = 0;

  const result = await runAgentTurnInHarness(
    {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        inspections += 1;
        return Promise.resolve({
          events: inspections === 1 ? [] : reconciledEvents,
        });
      },
      follow() {
        return (async function* () {
          yield {
            type: "snapshot",
            cursor: 5,
            // The default message window cut omitted turn/start and the
            // operation's user/message even though its cursor advanced.
            records: [{
              type: "event",
              event: reconciledEvents[5],
            }],
          };
          // The slow-path inspect raced one event beyond the opening cursor;
          // follow remains gap-free and therefore repeats it before turn/end.
          yield {
            type: "event",
            event: reconciledEvents[6],
          };
          yield { type: "event", event: turnEnd };
        })();
      },
      prompt() {
        promptCalls += 1;
        return Promise.resolve({ accepted: true });
      },
    },
    input,
    new AbortController().signal,
    { pollIntervalMs: 0 },
  );

  assert.equal(inspections, 2);
  assert.equal(promptCalls, 0);
  assert.deepEqual(result, {
    outcome: "completed",
    sessionId: input.sessionId,
    text: "race-safe reply",
    turn: 12,
    endReason: "completed",
  });
});

test("Minke Host writes operationId to prompt requestId without exposing slash commands", async () => {
  const operationId = "telegram:account-1:update-9";
  const calls = [];
  let inspectionReads = 0;
  const port = new EventEmitter();
  port.connected = true;
  const responses = [];
  port.send = (message, callback) => {
    responses.push(message);
    callback?.(null);
    return true;
  };
  let dispose;
  const context = {
    effect(callback) {
      dispose = callback();
    },
    sessionController: {
      create(request) {
        calls.push(["create", request]);
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect(sessionId, signal) {
        calls.push(["inspect", { sessionId, signal }]);
        inspectionReads += 1;
        return Promise.resolve({ events: [] });
      },
      follow(request, signal) {
        calls.push(["follow", { request, signal }]);
        return (async function* () {
          yield {
            type: "snapshot",
            cursor: 3,
            records: [
              {
                type: "chunks",
                event: {
                  type: "chunkrow/text-chunks",
                  seq: 0,
                  time: 0,
                  data: {
                    turn: 0,
                    step: 0,
                    index: 0,
                    dt: [0, 0],
                    texts: ["a", "b", "c"],
                  },
                },
              },
              {
                type: "event",
                event: {
                  type: "step/end",
                  seq: 3,
                  time: 3,
                  data: { turn: 0, step: 0 },
                },
              },
            ],
          };
          for (
            const { event } of agentTurnHistory(operationId, {
              answer: "Telegram reply",
              turn: 0,
              userText: "/status",
            })
          ) {
            yield { type: "event", event };
          }
        })();
      },
      prompt(request, signal) {
        calls.push(["prompt", { request, signal }]);
        return Promise.resolve({ accepted: true });
      },
    },
  };
  installAgentTurnControl(context, port, {
    pollIntervalMs: 0,
  });

  port.emit("message", createAgentTurnRunRequest(3, {
    operationId,
    sessionId: "session-im-account-1-peer-9",
    text: "/status",
  }));
  const response = parseAgentTurnProcessResponse(
    await nextAgentTurnResponse(responses),
  );
  const prompt = calls.find(([method]) => method === "prompt")[1]
    .request;

  assert.deepEqual(prompt, {
    requestId: operationId,
    sessionId: "session-im-account-1-peer-9",
    mode: "queue",
    content: [
      { type: "text", text: "/" },
      { type: "text", text: "status" },
    ],
  });
  assert.equal(
    prompt.content.map(({ text }) => text).join(""),
    "/status",
  );
  assert.equal(inspectionReads, 1);
  assert.deepEqual(response.result, {
    outcome: "completed",
    sessionId: "session-im-account-1-peer-9",
    text: "Telegram reply",
    turn: 0,
    endReason: "completed",
  });
  dispose();
});

test("Minke Host publishes previews only for successful produced files", async () => {
  const operationId = "weixin:account-1:message-preview";
  const published = [];
  const result = await runAgentTurnInHarness(
    {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        return Promise.resolve(inspectedAgentTurn(
          agentTurnHistoryWithProducedFiles(operationId),
        ));
      },
      prompt() {
        throw new Error("prompt must not run");
      },
    },
    {
      operationId,
      sessionId: "minke-im-weixin-preview-session",
      text: "build it",
    },
    new AbortController().signal,
    {
      pollIntervalMs: 0,
      previewPublisher: {
        publish(input) {
          published.push(input);
          return Promise.resolve([{
            title: "demo.html",
            route: "/minke-preview/abcdefghijklmnopqrstuv/",
          }]);
        },
      },
    },
  );

  assert.deepEqual(published, [{
    operationId,
    paths: [join(tmpdir(), "demo.html"), join(tmpdir(), "notes.txt")],
    sessionId: "minke-im-weixin-preview-session",
    turn: 3,
  }]);
  assert.deepEqual(result, {
    outcome: "completed",
    sessionId: "minke-im-weixin-preview-session",
    text: "Built the page.",
    turn: 3,
    endReason: "completed",
    previews: [{
      title: "demo.html",
      route: "/minke-preview/abcdefghijklmnopqrstuv/",
    }],
  });
});

test("produced previews use canonical write results across working-directory changes", async () => {
  const operationId = "weixin:directory-changes";
  const history = agentTurnHistoryWithProducedFiles(operationId);
  const paths = {
    "write-ok": join(tmpdir(), "checkout-one", "demo.html"),
    "edit-ok": join(tmpdir(), "checkout-two", "notes.txt"),
    "read-only": join(tmpdir(), "checkout-two", "not-produced.html"),
    "write-failed": join(tmpdir(), "checkout-two", "failed.html"),
  };
  for (const { event } of history) {
    if (event.type === "tool/call" && event.data.callId === "edit-ok") {
      event.data.name = "edit";
      event.data.arguments = JSON.stringify({ file_path: "notes.txt" });
    }
    if (event.type === "tool/result") event.data.meta = { path: paths[event.data.message.source.callId] };
  }
  let published;
  const execute = () => runAgentTurnInHarness({
    create: async request => request,
    inspect: async () => inspectedAgentTurn(history),
    prompt: async () => { throw new Error("must reuse the committed operation"); },
  }, { operationId, sessionId: "minke-im-paths", text: "build it" }, new AbortController().signal, {
    previewPublisher: { async publish(input) { published = input.paths; return []; } },
  });
  await execute();
  assert.deepEqual(published, [paths["write-ok"], paths["edit-ok"]]);
  published = undefined;
  for (const { event } of history) delete event.data.meta;
  await execute();
  assert.equal(published, undefined, "relative legacy arguments cannot select a file in the wrong directory");
});

test("Minke Host cancellation detaches while an operation remains single-flight", async () => {
  const operationId = "discord:account-1:event-1";
  const delayedInspection = Promise.withResolvers();
  let inspectionReads = 0;
  let promptCalls = 0;
  const port = new EventEmitter();
  port.connected = true;
  const responses = [];
  port.send = (message, callback) => {
    responses.push(message);
    callback?.(null);
    return true;
  };
  let dispose;
  const context = {
    effect(callback) {
      dispose = callback();
    },
    sessionController: {
      create(request) {
        return Promise.resolve({
          sessionId: request.sessionId,
        });
      },
      inspect() {
        inspectionReads += 1;
        if (inspectionReads === 2) {
          return delayedInspection.promise;
        }
        return Promise.resolve(
          inspectionReads >= 4
            ? inspectedAgentTurn(agentTurnHistory(operationId, {
                answer: "one reply",
                userText: "cancel me",
              }))
            : { events: [] },
        );
      },
      prompt() {
        promptCalls += 1;
        return Promise.resolve({ accepted: true });
      },
    },
  };
  installAgentTurnControl(context, port, {
    pollIntervalMs: 0,
  });
  port.emit("message", createAgentTurnRunRequest(5, {
    operationId,
    sessionId: "session-im-account-1-peer-1",
    text: "cancel me",
  }));
  await waitUntil(
    () => promptCalls === 1 && inspectionReads === 2,
  );
  port.emit("message", createAgentTurnCancelRequest(5));
  port.emit("message", createAgentTurnRunRequest(7, {
    operationId,
    sessionId: "session-im-account-1-peer-1",
    text: "different input",
  }));
  const conflict = parseAgentTurnProcessResponse(
    await agentTurnResponseFor(responses, 7),
  );
  assert.equal(conflict.type, "agent-turn/error");
  assert.equal(conflict.code, "operation-conflict");

  port.emit("message", createAgentTurnRunRequest(6, {
    operationId,
    sessionId: "session-im-account-1-peer-1",
    text: "cancel me",
  }));
  delayedInspection.resolve(
    inspectedAgentTurn(agentTurnHistory(operationId, {
        answer: "one reply",
        userText: "cancel me",
      })),
  );
  const response = parseAgentTurnProcessResponse(
    await agentTurnResponseFor(responses, 6),
  );
  assert.equal(response.type, "agent-turn/result");
  assert.equal(response.result.outcome, "completed");
  assert.equal(response.result.text, "one reply");
  assert.equal(promptCalls, 1);
  assert.equal(
    responses.some((candidate) => candidate.requestId === 5),
    false,
  );
  dispose();
});

test("Agent turn control-plane failures reject instead of becoming terminal results", async () => {
  const input = {
    operationId: "weixin:account-2:message-4",
    sessionId: "session-im-account-2-peer-4",
    text: "hello",
  };
  const create = (request) => Promise.resolve({
    sessionId: request.sessionId,
  });
  const emptyInspection = () =>
    Promise.resolve({ events: [] });

  await assert.rejects(
    runAgentTurnInHarness(
      {
        create,
        inspect: emptyInspection,
        prompt() {
          throw new RemoteError(
            "agent-busy",
            "provider is restarting",
            {},
          );
        },
      },
      input,
      new AbortController().signal,
      { pollIntervalMs: 0 },
    ),
    /session\.prompt failed.*provider is restarting/u,
  );

  await assert.rejects(
    runAgentTurnInHarness(
      {
        create,
        inspect() {
          throw new Error("inspection store is temporarily busy");
        },
        prompt() {
          throw new Error("prompt must not run");
        },
      },
      input,
      new AbortController().signal,
      { pollIntervalMs: 0 },
    ),
    /inspection store is temporarily busy/u,
  );

  await assert.rejects(
    runAgentTurnInHarness(
      {
        create,
        inspect() {
          return Promise.resolve({
            events: [{}],
          });
        },
        prompt() {
          throw new Error("prompt must not run");
        },
      },
      input,
      new AbortController().signal,
      { pollIntervalMs: 0 },
    ),
    /session\.inspect returned invalid event ordering/u,
  );

  await assert.rejects(
    runAgentTurnInHarness(
      {
        create() {
          return Promise.resolve({
            sessionId: "session-other",
          });
        },
        inspect() {
          throw new Error("inspect must not run");
        },
        prompt() {
          throw new Error("prompt must not run");
        },
      },
      input,
      new AbortController().signal,
      { pollIntervalMs: 0 },
    ),
    /session\.create returned a different session id/u,
  );

  assert.deepEqual(
    await runAgentTurnInHarness(
      {
        create,
        inspect() {
          return Promise.resolve(inspectedAgentTurn(
            agentTurnHistory(input.operationId, {
              endReason: {
                kind: "error",
                error: {
                  code: "PROVIDER_DOWN",
                  message: "provider failed terminally",
                },
              },
              userText: input.text,
            }),
          ));
        },
        prompt() {
          throw new Error("prompt must not run");
        },
      },
      input,
      new AbortController().signal,
      { pollIntervalMs: 0 },
    ),
    {
      outcome: "failed",
      sessionId: input.sessionId,
      message: "provider failed terminally",
      turn: 2,
      endReason: "error",
    },
  );
});

test("Minke Host calibrates identity only for external IM agents", async (t) => {
  const cleanups = [];
  let onAgentCreated;
  t.after(async () => {
    await Promise.allSettled(
      cleanups.reverse().map((cleanup) => Promise.resolve(cleanup())),
    );
  });
  const context = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
      return cleanup;
    },
    connection: {
      replaceTrustedHosts() {},
    },
    on(event, listener) {
      if (event === "agent/created") onAgentCreated = listener;
      return () => {};
    },
    webServer: {
      register() {
        return () => {};
      },
      tapIndex() {
        return () => {};
      },
    },
  };

  const api = await workspaceApi(t);
  context.plugin = api.mount;
  applyMinkeHost(context, { rootPath: tmpdir() });
  assert.equal(typeof onAgentCreated, "function");

  const sections = [];
  const agent = (sessionId) => ({
    id: sessionId,
    session: { id: sessionId },
    ctx: {
      systemPrompt: {
        section(value) {
          sections.push(value);
          return () => {};
        },
      },
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  });
  onAgentCreated({ agent: agent("local-session") });
  assert.deepEqual(sections, []);

  onAgentCreated({
    agent: agent("minke-im-weixin-668c2acc6e7863238fcfd3e302dc41b2"),
  });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "harness:identity");
  assert.equal(sections[0].order, -100);
  assert.match(sections[0].text, /\bMinke\b/u);
  assert.doesNotMatch(sections[0].text, /DeepSeek Harness/u);
});

test("Remote preview snapshots HTML behind a durable capability route", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "minke-preview-root-"));
  const storePath = await mkdtemp(
    join(tmpdir(), "minke-preview-store-"),
  );
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(storePath, { recursive: true, force: true }),
    ]);
  });
  await writeFile(
    join(root, "demo.html"),
    "<!doctype html><style>body{color:hotpink}</style><h1>Minke</h1>",
    "utf8",
  );

  const routes = [];
  const createRuntime = () =>
    new RemotePreviewRuntime({
      rootPath: root,
      storePath,
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    });
  const firstRuntime = createRuntime();
  assert.equal(routes[0].auth, "required");
  const first = await firstRuntime.publish({
    operationId: "minke-im-agent-reply:operation-1",
    paths: [join(root, "demo.html")],
  });
  const request = async (route, method, url) => {
    let status;
    let headers;
    let body;
    await route.handler(
      { method, url },
      {
        writeHead(nextStatus, nextHeaders) {
          status = nextStatus;
          headers = nextHeaders;
        },
        end(nextBody) {
          body = nextBody;
        },
      },
    );
    return { body, headers, status };
  };
  const served = await request(
    routes[0],
    "GET",
    first[0].route,
  );
  assert.equal(served.status, 200);
  assert.match(served.body, /<h1>Minke<\/h1>/u);
  assert.match(
    served.headers["content-security-policy"],
    /(?:^|;\s*)sandbox(?:;|$)/u,
  );
  assert.equal(
    served.headers["cache-control"],
    "private, no-store",
  );
  assert.deepEqual(
    await request(routes[0], "HEAD", first[0].route),
    {
      body: undefined,
      headers: served.headers,
      status: 200,
    },
  );
  assert.equal(
    (await request(routes[0], "POST", first[0].route)).status,
    405,
  );
  assert.equal(
    (
      await request(
        routes[0],
        "GET",
        "/minke-preview/not-a-capability/",
      )
    ).status,
    404,
  );
  firstRuntime.dispose();
  const secondRuntime = createRuntime();
  const recovered = await secondRuntime.publish({
    operationId: "minke-im-agent-reply:operation-1",
    paths: [join(root, "demo.html")],
  });
  secondRuntime.dispose();

  assert.equal(first.length, 1);
  assert.deepEqual(recovered, first);
  assert.equal(first[0].title, "demo.html");
  assert.match(
    first[0].route,
    /^\/minke-preview\/[A-Za-z0-9_-]{22}\/$/u,
  );
  assert.equal(routes[0].kind, "prefix");
  assert.equal(routes[0].path, "/minke-preview");
});

test("Remote preview recovers JSON-escaped near-limit snapshots after restart", async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), "minke-preview-escaped-root-"),
  );
  const storePath = await mkdtemp(
    join(tmpdir(), "minke-preview-escaped-store-"),
  );
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(storePath, { recursive: true, force: true }),
    ]);
  });

  const maxHtmlBytes = 8 * 1024;
  const prefix = "<!doctype html><pre>";
  const suffix = "</pre>";
  const available =
    maxHtmlBytes -
    Buffer.byteLength(prefix) -
    Buffer.byteLength(suffix);
  const escapePair = String.fromCharCode(34, 92);
  const escapeHeavy = escapePair.repeat(
    Math.floor(available / Buffer.byteLength(escapePair)),
  );
  const html =
    prefix +
    escapeHeavy +
    "x".repeat(available - Buffer.byteLength(escapeHeavy)) +
    suffix;
  assert.equal(Buffer.byteLength(html), maxHtmlBytes);

  const sourcePath = join(root, "escaped.html");
  await writeFile(sourcePath, html, "utf8");
  const routes = [];
  const createRuntime = () =>
    new RemotePreviewRuntime({
      maxHtmlBytes,
      rootPath: root,
      storePath,
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    });
  const firstRuntime = createRuntime();
  const first = await firstRuntime.publish({
    operationId: "minke-im-agent-reply:escaped-operation",
    paths: [join(root, "escaped.html")],
  });
  firstRuntime.dispose();

  assert.equal(first.length, 1);
  const token = first[0].route.split("/")[2];
  const storedBytes = await readFile(
    join(storePath, `${token}.json`),
  );
  assert.ok(storedBytes.length > maxHtmlBytes + 4 * 1024);

  await rm(sourcePath);
  const secondRuntime = createRuntime();
  const recovered = await secondRuntime.publish({
    operationId: "minke-im-agent-reply:escaped-operation",
    paths: [join(root, "escaped.html")],
  });
  secondRuntime.dispose();

  assert.deepEqual(recovered, first);
  assert.equal(routes.length, 2);
});

test("Minke Host mounts Files on the native shared Remote API and withdraws with its plugin", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "minke-host-root-"));
  const outside = await mkdtemp(join(tmpdir(), "minke-host-outside-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const notesPath = join(root, "notes.txt");
  const outsidePath = join(outside, "secret.txt");
  await Promise.all([
    writeFile(notesPath, "before\n", "utf8"),
    writeFile(outsidePath, "outside\n", "utf8"),
  ]);

  const api = await workspaceApi(t);
  let workspace;
  const pwaRoutes = [];
  const indexTaps = [];
  const context = {
    agents: {
      get() {
        return undefined;
      },
    },
    effect(callback) {
      return callback();
    },
    plugin(service, config) {
      workspace = api.mount(service, config);
      return workspace;
    },
    on() {
      return () => {};
    },
    webServer: {
      register(route) {
        pwaRoutes.push(route);
        return () => {};
      },
      tapIndex(transform) {
        indexTaps.push(transform);
        return () => {};
      },
    },
  };
  applyMinkeHost(context, { rootPath: root });
  await workspace;
  assert.equal(indexTaps.length, 1);
  assert.deepEqual(
    pwaRoutes.map(({ path }) => path),
    [
      MINKE_REMOTE_PREVIEW_ROUTE,
      MINKE_PWA_ROUTES.manifest,
      MINKE_PWA_ROUTES.bootstrap,
      MINKE_PWA_ROUTES.serviceWorker,
      MINKE_PWA_ROUTES.iconSvg,
      MINKE_PWA_ROUTES.icon192,
      MINKE_PWA_ROUTES.icon512,
      MINKE_PWA_ROUTES.maskableIcon512,
      MINKE_PWA_ROUTES.appleTouchIcon,
    ],
  );
  const call = api.call;

  const capabilities = await call("capabilities", {});
  assert.equal(capabilities.ok, true, JSON.stringify(capabilities));
  assert.deepEqual(capabilities.value, hostCapabilities(root));
  for (const endpoint of ['terminal.create', 'terminal.write', 'terminal.resize', 'terminal.read', 'terminal.close']) {
    const retired = await call(endpoint, {});
    assert.deepEqual(retired, { status: 404 }, `${endpoint} belongs to DSH, not the Minke Host`);
  }

  const listing = await call("files.list", {});
  assert.equal(listing.ok, true, JSON.stringify(listing));
  assert.equal(listing.value.path, await realpath(root));
  assert.equal(listing.value.parent, undefined);
  assert.deepEqual(
    listing.value.entries.map((entry) => entry.name),
    ["notes.txt"],
  );

  const preview = await call("files.preview", {
    path: notesPath,
  });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.value.kind, "text");
  assert.equal(preview.value.content, "before\n");

  const written = await call("files.write", {
    path: notesPath,
    content: "after\n",
    expectedVersion: preview.value.version,
  });
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(await readFile(notesPath, "utf8"), "after\n");
  const denied = await call("files.write", {
    path: notesPath, content: "not authorized", expectedVersion: written.value.version,
  }, undefined, api.createPeer({ kind: "minke-test-restricted" }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "remote-access/denied");
  assert.equal(await readFile(notesPath, "utf8"), "after\n");

  const escaped = await call("files.preview", {
    path: outsidePath,
  });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.error.code, "gateway/bad-request");
  assert.match(escaped.error.message, /outside its root/u);

  assert.deepEqual(await call("files.watch", {}), { status: 404 });
  const invalid = await call("files.preview", { path: 42 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "gateway/bad-request");
  const extraArgs = await call("capabilities", { unexpected: true });
  assert.equal(extraArgs.ok, false);
  assert.equal(extraArgs.error.code, "gateway/arguments-invalid");
  const cancelled = await call("files.write", {
    path: notesPath, content: "cancelled", expectedVersion: written.value.version,
  }, AbortSignal.abort(new Error("cancelled")));
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error.code, "gateway/cancelled");
  assert.equal(await readFile(notesPath, "utf8"), "after\n");
  await workspace.dispose();
  assert.deepEqual(await call("capabilities"), { status: 404 });

});

test("browser workspace adapters project Host Files without Electron", async () => {
  const calls = [];
  const connection = {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload]);
        if (endpoint === "minke/capabilities") {
          return { ok: true, value: hostCapabilities() };
        }
        if (endpoint === "minke/files.list") {
          return {
            ok: true,
            value: {
              path: "/host/home",
              entries: [
                {
                  name: "project",
                  path: "/host/home/project",
                  kind: "directory",
                },
              ],
              truncated: false,
            },
          };
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      },
    },
  };
  const storage = memoryStorage();
  const files = browserFilesPort(connection, storage);
  assert.equal(files.available, true);
  assert.equal("open" in files, false, "native opening is owned by remote.session");
  assert.equal(files.watchAvailable, false);
  assert.deepEqual(await files.list({}), {
    path: "/host/home",
    entries: [
      {
        name: "project",
        path: "/host/home/project",
        kind: "directory",
      },
    ],
    truncated: false,
  });
  assert.deepEqual(
    calls,
    [[MINKE_HOST_RPC_CHANNEL, "minke/capabilities", { args: {} }], [MINKE_HOST_RPC_CHANNEL, "minke/files.list", { args: { request: {} } }]],
  );

  await files.writeViewState({
    placement: "right",
    viewMode: "tree",
  });
  assert.deepEqual(await files.readViewState(), {
    right: { viewMode: "tree" },
  });

  const firstTabs = browserTabsPort(storage);
  assert.equal(firstTabs.available, true);
  assert.equal(firstTabs.embeddedWebAvailable, false);
  await firstTabs.writeLayoutState({
    placement: "right",
    size: 420,
  });
  await firstTabs.writeLayoutState({
    placement: "bottom",
    size: 260,
  });
  const restoredTabs = browserTabsPort(storage);
  assert.deepEqual(await restoredTabs.readLayoutState(), {
    rightWidth: 420,
    bottomHeight: 260,
  });

  const incompatibleFiles = browserFilesPort({
    rpc: {
      async call(_channel, endpoint) {
        assert.equal(endpoint, "minke/capabilities");
        return {
          ok: true,
          value: {
            ...hostCapabilities(),
            files: {
              ...hostCapabilities().files,
              watch: true,
            },
          },
        };
      },
    },
  });
  await assert.rejects(
    incompatibleFiles.list({}),
    /capabilities are incompatible/u,
  );
});

test("browser Host retries a failed handshake and shares each attempt across callers", async () => {
  const failed = Promise.withResolvers();
  const recovered = Promise.withResolvers();
  const calls = [];
  let attempts = 0;
  const files = browserFilesPort({
    rpc: {
      async call(_channel, endpoint) {
        calls.push(endpoint);
        if (endpoint === "minke/capabilities") {
          return await (++attempts === 1 ? failed.promise : recovered.promise);
        }
        return { ok: true, value: { path: "/host/home", entries: [], truncated: false } };
      },
    },
  }, memoryStorage());

  const first = [files.list({}), files.list({})];
  const failures = first.map(request => assert.rejects(request, /offline/u));
  assert.equal(attempts, 1);
  failed.reject(new Error("offline"));
  await Promise.all(failures);

  const retries = [files.list({}), files.list({})];
  // Attach rejection handlers before asserting so a broken cache has no
  // unhandled rejection and fails at the observable connection attempt.
  const outcomes = Promise.allSettled(retries);
  recovered.resolve({ ok: true, value: hostCapabilities() });
  assert.equal(attempts, 2, "recovery must issue a fresh capability handshake");
  assert.equal((await outcomes).every(result => result.status === "fulfilled"), true);
  await files.list({});
  assert.deepEqual(calls, ["minke/capabilities", "minke/capabilities", "minke/files.list", "minke/files.list", "minke/files.list"]);
});

test("browser Host never replays a failed file write after a successful handshake", async () => {
  const calls = [];
  const files = browserFilesPort({
    rpc: {
      async call(_channel, endpoint) {
        calls.push(endpoint);
        if (endpoint === "minke/capabilities") return { ok: true, value: hostCapabilities() };
        throw new Error("connection lost after write admission");
      },
    },
  }, memoryStorage());
  await assert.rejects(files.write({ path: "/host/home/notes.txt", content: "edited", expectedVersion: `sha256:${"a".repeat(64)}` }), /connection lost/u);
  assert.deepEqual(calls, ["minke/capabilities", "minke/files.write"]);
});
