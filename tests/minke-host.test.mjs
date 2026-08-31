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
} from "@minke/harness-overlay/minke-host-contract.ts";
import {
  MINKE_PWA_ROUTES,
} from "@minke/harness-overlay/pwa-contract.ts";
import {
  browserFilesPort,
  browserTerminalPort,
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
      nativeOpen: false,
      root,
      watch: false,
      write: true,
    },
    tabs: {
      available: true,
      embeddedWeb: false,
      state: "client",
    },
    terminal: {
      available: true,
      resize: true,
      transport: "long-poll",
    },
  };
}

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
            path: "notes.txt",
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
    paths: ["demo.html", "notes.txt"],
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
      rpc: {
        handle() {
          return async () => {};
        },
      },
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
  const first = await firstRuntime.publish({
    cwd: root,
    operationId: "minke-im-agent-reply:operation-1",
    paths: ["demo.html"],
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
    cwd: root,
    operationId: "minke-im-agent-reply:operation-1",
    paths: ["demo.html"],
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
    cwd: root,
    operationId: "minke-im-agent-reply:escaped-operation",
    paths: ["escaped.html"],
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
    cwd: root,
    operationId: "minke-im-agent-reply:escaped-operation",
    paths: ["escaped.html"],
  });
  secondRuntime.dispose();

  assert.deepEqual(recovered, first);
  assert.equal(routes.length, 2);
});

test("Minke Host mounts Files RPC on the trusted DSH connection", async (t) => {
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

  let registration;
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
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options };
          return async () => {};
        },
      },
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
  assert.equal(registration.channel, MINKE_HOST_RPC_CHANNEL);
  assert.deepEqual(registration.options, {
    authority: "trusted-host",
  });
  const call = (endpoint, payload) =>
    registration.handler(
      endpoint,
      payload,
      new AbortController().signal,
    );

  const capabilities = await call("capabilities", {});
  assert.equal(capabilities.ok, true);
  assert.deepEqual(capabilities.value, hostCapabilities(root));

  const listing = await call("files.list", {});
  assert.equal(listing.ok, true);
  assert.equal(listing.value.path, await realpath(root));
  assert.equal(listing.value.parent, undefined);
  assert.deepEqual(
    listing.value.entries.map((entry) => entry.name),
    ["notes.txt"],
  );

  const preview = await call("files.preview", {
    path: notesPath,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.value.kind, "text");
  assert.equal(preview.value.content, "before\n");

  const written = await call("files.write", {
    path: notesPath,
    content: "after\n",
    expectedVersion: preview.value.version,
  });
  assert.equal(written.ok, true);
  assert.equal(await readFile(notesPath, "utf8"), "after\n");

  const escaped = await call("files.preview", {
    path: outsidePath,
  });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.error.code, "bad-request");
  assert.match(escaped.error.message, /outside its root/u);

  const unknown = await call("files.watch", {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "bad-request");
  assert.match(unknown.error.message, /unknown Minke Host endpoint/u);
});

test("browser workspace adapters project Host Files without Electron", async () => {
  const calls = [];
  const connection = {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload]);
        if (endpoint === "capabilities") {
          return { ok: true, value: hostCapabilities() };
        }
        if (endpoint === "files.list") {
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
  assert.equal(files.nativeOpenAvailable, false);
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
    calls.map(([, endpoint]) => endpoint),
    ["capabilities", "files.list"],
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
        assert.equal(endpoint, "capabilities");
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

test("browser Terminal port long-polls Host output and closes settled sessions", async () => {
  const calls = [];
  const closed = Promise.withResolvers();
  const connection = {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload]);
        if (endpoint === "capabilities") {
          return { ok: true, value: hostCapabilities() };
        }
        if (endpoint === "terminal.create") {
          return {
            ok: true,
            value: { sessionId: "host-terminal-1" },
          };
        }
        if (endpoint === "terminal.read") {
          return {
            ok: true,
            value: {
              cursor: 2,
              done: true,
              truncated: false,
              events: [
                {
                  type: "data",
                  sessionId: "host-terminal-1",
                  data: "$ ",
                },
                {
                  type: "exit",
                  sessionId: "host-terminal-1",
                  exitCode: 0,
                },
              ],
            },
          };
        }
        if (
          endpoint === "terminal.close" ||
          endpoint === "terminal.resize" ||
          endpoint === "terminal.write"
        ) {
          if (endpoint === "terminal.close") closed.resolve();
          return { ok: true, value: null };
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      },
    },
  };
  const terminal = browserTerminalPort(connection);
  const events = [];
  const settled = Promise.withResolvers();
  const unsubscribe = terminal.subscribe((event) => {
    events.push(event);
    if (event.type === "exit") settled.resolve();
  });

  assert.deepEqual(
    await terminal.create({ cols: 80, rows: 24 }),
    { sessionId: "host-terminal-1" },
  );
  await settled.promise;
  await closed.promise;
  assert.deepEqual(events, [
    {
      type: "data",
      sessionId: "host-terminal-1",
      data: "$ ",
    },
    {
      type: "exit",
      sessionId: "host-terminal-1",
      exitCode: 0,
    },
  ]);
  assert.deepEqual(
    calls.map(([, endpoint]) => endpoint),
    [
      "capabilities",
      "terminal.create",
      "terminal.read",
      "terminal.close",
    ],
  );
  unsubscribe();
});
