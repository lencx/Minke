import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { HarnessError, ToolCallId } from "@deepseek-ai/dsh-llm";
import SystemPrompt from "@vendor/deepseek-harness/packages/core/system-prompt/lib/index.js";
import ToolRuntime from "@vendor/deepseek-harness/packages/core/tools/lib/index.js";
import {
  AGENT_BROWSER_PROCESS_CHANNEL,
  AGENT_BROWSER_PROTOCOL_VERSION,
  MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH,
  agentBrowserClaimControlSuccessResponse,
  agentBrowserErrorResponse,
  agentBrowserSuccessResponse,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AGENT_BROWSER_UNKNOWN_OUTCOME_CODE,
  AgentBrowserProcessClient,
  AgentBrowserProcessError,
  installAgentBrowserParentLifetime,
} from "@minke/harness-overlay/host/agent-browser-process.ts";
import {
  AGENT_BROWSER_INTENT_PROMPT,
  apply as applyAgentBrowserTools,
} from "@minke/harness-overlay/host/agent-browser-tools.ts";

class FakeProcessPort extends EventEmitter {
  connected = true;
  sent = [];

  send(message, callback) {
    this.sent.push(message);
    queueMicrotask(() => callback?.(null));
    return true;
  }
}

test("desktop parent disconnect requests one graceful Harness exit", () => {
  const port = new FakeProcessPort();
  const exits = [];
  let cleanup;
  installAgentBrowserParentLifetime(
    {
      effect(callback) {
        cleanup = callback();
      },
    },
    (code) => exits.push(code),
    port,
  );

  port.emit("disconnect");
  port.emit("disconnect");
  assert.deepEqual(exits, [1]);

  cleanup();
  port.emit("disconnect");
  assert.deepEqual(exits, [1]);
});

test("desktop parent lifetime rejects an absent IPC channel", () => {
  const port = new FakeProcessPort();
  port.connected = false;
  assert.throws(
    () =>
      installAgentBrowserParentLifetime(
        { effect() {} },
        () => {},
        port,
      ),
    /connected parent IPC channel/u,
  );
});

test("portable Harness does not advertise desktop-only browser tools", () => {
  const port = new FakeProcessPort();
  port.connected = false;
  const definitions = [];
  const installed = applyAgentBrowserTools(
    {
      effect() {},
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  assert.equal(installed, false);
  assert.deepEqual(definitions, []);
});

function sessionResult(overrides = {}) {
  return {
    sessionId: "browser-1",
    generation: 1,
    owner: "agent",
    status: "ready",
    snapshotRequired: false,
    url: "https://example.com/",
    ...overrides,
  };
}

function assertNoProgress(result, code, messagePattern) {
  assert.deepEqual(
    {
      outcome: result.outcome,
      code: result.code,
      resumeAfter: result.resumeAfter,
    },
    {
      outcome: "no_progress",
      code,
      resumeAfter: "new_turn",
    },
  );
  assert.match(result.message, messagePattern);
}

test("process client correlates responses and validates their operation shape", async () => {
  const port = new FakeProcessPort();
  const client = new AgentBrowserProcessClient(port);
  const pending = client.request(
    "conversation-1",
    "open",
    { url: "https://example.com" },
    new AbortController().signal,
  );

  const request = port.sent[0];
  assert.equal(request.type, "request");
  assert.equal(request.operation, "open");
  assert.equal(request.ownerSessionId, "conversation-1");
  assert.equal(request.payload.url, "https://example.com/");

  port.emit("message", {
    channel: "some:other:channel",
    requestId: request.requestId,
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      request.requestId,
      "open",
      sessionResult(),
    ),
  );
  assert.deepEqual(await pending, sessionResult());
  client.dispose();
});

test("abort sends cancel and waits for Electron's terminal response", async () => {
  const port = new FakeProcessPort();
  const client = new AgentBrowserProcessClient(port);
  const controller = new AbortController();
  const reason = new Error("tool deadline");
  let settled = false;
  const pending = client.request(
    "conversation-2",
    "click",
    {
      sessionId: "browser-1",
      target: { ref: "s1:e4" },
    },
    controller.signal,
  ).finally(() => {
    settled = true;
  });
  const request = port.sent[0];

  controller.abort(reason);
  assert.deepEqual(port.sent[1], {
    channel: "minke:agent-browser:process",
    protocolVersion: 1,
    requestId: request.requestId,
    type: "cancel",
  });
  await Promise.resolve();
  assert.equal(
    settled,
    false,
    "the client must not abandon remote work on abort",
  );

  port.emit(
    "message",
    agentBrowserSuccessResponse(
      request.requestId,
      "click",
      sessionResult(),
    ),
  );
  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.message, "tool deadline");
    assert.equal(error.cause, reason);
    return true;
  });
  client.dispose();
});

test("IPC disconnect rejects pending work and makes later calls unavailable", async () => {
  const port = new FakeProcessPort();
  const client = new AgentBrowserProcessClient(port);
  const pending = client.request(
    "conversation-disconnect",
    "open",
    { url: "https://example.com" },
    new AbortController().signal,
  );

  port.connected = false;
  port.emit("disconnect");
  await assert.rejects(pending, (error) => {
    assert.equal(error instanceof AgentBrowserProcessError, true);
    assert.equal(error.code, AGENT_BROWSER_UNKNOWN_OUTCOME_CODE);
    assert.equal(error.remoteCode, "agent_browser_ipc_disconnected");
    assert.equal(error.outcome, "unknown");
    return true;
  });
  await assert.rejects(
    client.request(
      "conversation-disconnect",
      "open",
      { url: "https://example.com" },
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error instanceof AgentBrowserProcessError, true);
      assert.equal(error.remoteCode, "agent_browser_unavailable");
      assert.equal(error.outcome, "known");
      return true;
    },
  );
  client.dispose();
});

test("unknown remote outcomes remain machine-readable and warn before retry", async () => {
  const port = new FakeProcessPort();
  const client = new AgentBrowserProcessClient(port);
  const pending = client.request(
    "conversation-3",
    "press",
    { sessionId: "browser-1", key: "Enter" },
    new AbortController().signal,
  );
  const request = port.sent[0];

  port.emit(
    "message",
    agentBrowserErrorResponse(
      request.requestId,
      new Error("guest process disappeared"),
      { code: "guest_crashed", outcome: "unknown" },
    ),
  );
  await assert.rejects(pending, (error) => {
    assert.equal(error instanceof AgentBrowserProcessError, true);
    assert.equal(error instanceof HarnessError, true);
    assert.equal(error.code, "AGENT_BROWSER_OUTCOME_UNKNOWN");
    assert.equal(error.remoteCode, "guest_crashed");
    assert.equal(error.outcome, "unknown");
    assert.match(error.message, /inspect the browser tab/u);
    return true;
  });
  client.dispose();
});

test("known targeting failures include first-error recovery guidance", () => {
  assert.match(
    new AgentBrowserProcessError(
      "stale_ref",
      "stale",
      "known",
    ).message,
    /Do not retry the same ref/u,
  );
  assert.match(
    new AgentBrowserProcessError(
      "ambiguous_target",
      "ambiguous",
      "known",
    ).message,
    /more exact semantic constraint/u,
  );
  assert.match(
    new AgentBrowserProcessError(
      "ambiguous_target",
      "ambiguous",
      "known",
    ).message,
    /use ordinal.*action-control match set/iu,
  );
  assert.match(
    new AgentBrowserProcessError(
      "element_covered",
      "covered",
      "known",
    ).message,
    /covering element/u,
  );
  assert.match(
    new AgentBrowserProcessError(
      "element_not_found",
      "missing",
      "known",
    ).message,
    /revise its scope or semantic constraints/u,
  );
  assert.match(
    new AgentBrowserProcessError(
      "navigation_unavailable",
      "no history",
      "known",
    ).message,
    /Do not repeat the unavailable history action/u,
  );
  const truncatedIndex = new AgentBrowserProcessError(
    "index_truncated",
    "truncated",
    "known",
  ).message;
  assert.match(
    truncatedIndex,
    /unique item without ordinal.*browser_locate/iu,
  );
  assert.match(
    truncatedIndex,
    /Do not.*retry browser_find ordinal/iu,
  );
});

test("fixed tool schemas infer only the current agent's focused browser session", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const byName = (name) =>
    definitions.find((definition) => definition.name === name);
  const navigateTool = byName("browser_navigate");
  const snapshotTool = byName("browser_snapshot");
  const findTool = byName("browser_find");
  const locateTool = byName("browser_locate");
  const clickTool = byName("browser_click");

  for (const definition of definitions.slice(1)) {
    assert.equal(
      Object.hasOwn(
        definition.parameters.properties,
        "session_id",
      ),
      true,
    );
    assert.equal(
      definition.parameters.required?.includes("session_id") ??
        false,
      false,
    );
  }
  assert.deepEqual(navigateTool.parameters.required, ["url"]);
  assert.equal(
    Object.hasOwn(snapshotTool.parameters, "required"),
    false,
  );
  assert.deepEqual(findTool.parameters.oneOf[0].required, ["query"]);
  assert.deepEqual(
    findTool.parameters.oneOf[1].required,
    ["next_cursor"],
  );
  assert.deepEqual(
    locateTool.parameters.properties.code,
    {
      type: "string",
      minLength: 1,
      maxLength: MAX_AGENT_BROWSER_LOCATOR_CODE_LENGTH,
      pattern: "\\S",
      description:
        'One page locator expression with literal arguments, for example page.locator("[data-row]").nth(2).getByRole("button", {name:"Details"}).',
    },
  );
  assert.deepEqual(
    locateTool.output.schema.oneOf[0].properties.node.required,
    [
      "ref",
      "role",
      "name",
      "actionable",
      "disabled",
      "match",
    ],
  );
  assert.equal(
    locateTool.output.schema.oneOf[0].properties.node.properties.actionable.const,
    true,
  );
  assert.equal(
    locateTool.output.schema.oneOf[0].properties.node.properties.disabled.const,
    false,
  );
  assert.equal(
    locateTool.output.schema.oneOf[0].properties.node.properties.match.const,
    true,
  );
  assert.equal(
    locateTool.output.schema.oneOf[1].properties.outcome.const,
    "no_progress",
  );
  assert.deepEqual(clickTool.parameters.required, ["target"]);
  assert.match(
    snapshotTool.parameters.properties.session_id.description,
    /optional.*focused/iu,
  );

  const agent = {
    status: "running",
    session: { id: "conversation-focused-session" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const exec = {
    signal: new AbortController().signal,
    agent,
  };

  assert.throws(
    () => snapshotTool.execute({}, exec),
    /session_id.*no focused Agent Browser session/iu,
  );
  assert.equal(port.sent.length, 0);

  const openTool = byName("browser_open");
  const open = openTool.execute(
    { url: "https://example.com/" },
    exec,
  );
  const openRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      openRequest.requestId,
      "open",
      sessionResult(),
    ),
  );
  await open;

  const inferred = snapshotTool.execute({}, exec);
  const inferredRequest = port.sent.at(-1);
  assert.deepEqual(inferredRequest.payload, {
    sessionId: "browser-1",
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      inferredRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await inferred;

  const explicit = snapshotTool.execute(
    { session_id: "browser-2" },
    exec,
  );
  const explicitRequest = port.sent.at(-1);
  assert.deepEqual(explicitRequest.payload, {
    sessionId: "browser-2",
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      explicitRequest.requestId,
      "snapshot",
      {
        ...sessionResult({ sessionId: "browser-2" }),
        snapshotId: "s2",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await explicit;

  listeners.get("agent/status")({ agent, status: "idle" });
  const nextTurn = snapshotTool.execute({}, exec);
  const nextTurnRequest = port.sent.at(-1);
  assert.deepEqual(nextTurnRequest.payload, {
    sessionId: "browser-2",
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      nextTurnRequest.requestId,
      "snapshot",
      {
        ...sessionResult({ sessionId: "browser-2" }),
        snapshotId: "s3",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await nextTurn;

  for (const cleanup of cleanups) cleanup();
});

test("a failed element mutation blocks an unchanged retry on the current observation", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "recovery-turn-1",
    agent: { session: { id: "conversation-recovery" } },
  };
  const args = {
    session_id: "browser-1",
    target: {
      role: "link",
      name: "Result title",
    },
  };

  try {
    const first = clickTool.execute(args, exec);
    const firstRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        firstRequest.requestId,
        new Error("no matching action"),
        { code: "element_not_found", outcome: "known" },
      ),
    );
    await assert.rejects(first, (error) => {
      assert.equal(error.remoteCode, "element_not_found");
      return true;
    });

    const forwardedBeforeRetry = port.sent.length;
    const repeated = clickTool.execute(args, exec);
    await Promise.resolve();
    const repeatedRequest =
      port.sent.length > forwardedBeforeRetry
        ? port.sent.at(-1)
        : undefined;
    if (repeatedRequest !== undefined) {
      port.emit(
        "message",
        agentBrowserErrorResponse(
          repeatedRequest.requestId,
          new Error("no matching action"),
          { code: "element_not_found", outcome: "known" },
        ),
      );
    }
    assertNoProgress(
      await repeated,
      "repeated_operation",
      /same non-progressing result/iu,
    );
    assert.equal(
      port.sent.length,
      forwardedBeforeRetry,
      "the repeated mutation must be stopped before Electron IPC",
    );

    exec.rootCallId = "recovery-turn-2";
    const snapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const snapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        snapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s2",
          nodes: [],
        },
      ),
    );
    await snapshot;

    const forwardedBeforeUnchangedRetry = port.sent.length;
    const unchanged = clickTool.execute(args, exec);
    await Promise.resolve();
    const unchangedRequest =
      port.sent.length > forwardedBeforeUnchangedRetry
        ? port.sent.at(-1)
        : undefined;
    if (unchangedRequest !== undefined) {
      port.emit(
        "message",
        agentBrowserErrorResponse(
          unchangedRequest.requestId,
          new Error("no matching action"),
          { code: "element_not_found", outcome: "known" },
        ),
      );
    }
    await assert.rejects(
      unchanged,
      /snapshot.*unchanged.*browser_find/iu,
    );
    assert.equal(
      port.sent.length,
      forwardedBeforeUnchangedRetry,
      "an unchanged failed target must stay blocked on a stable snapshot",
    );

    const revised = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "link",
          name: "Requested action",
        },
      },
      exec,
    );
    const revisedRequest = port.sent.at(-1);
    assert.equal(revisedRequest.operation, "click");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        revisedRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await revised;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("a known pre-dispatch target failure permits a revised mutation without recovery", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { id: "conversation-revised-target" } },
  };

  try {
    const first = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "link",
          name: "Structural target",
        },
      },
      exec,
    );
    const firstRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        firstRequest.requestId,
        new Error("structural target"),
        { code: "element_not_actionable", outcome: "known" },
      ),
    );
    await assert.rejects(first, /structural target/u);

    const revised = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "link",
          name: "comments",
        },
      },
      exec,
    );
    const revisedRequest = port.sent.at(-1);
    assert.equal(revisedRequest.operation, "click");
    assert.deepEqual(revisedRequest.payload.target, {
      role: "link",
      name: "comments",
      exact: false,
    });
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        revisedRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await revised;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("zero-match find loops are bounded within one agent turn", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  let concludedTurns = 0;
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-1",
    agent: { session: { id: "conversation-find-loop" } },
    concludeTurn() {
      concludedTurns += 1;
    },
  };
  const runEmpty = async (text) => {
    const pending = findTool.execute(
      {
        session_id: "browser-1",
        query: { text },
      },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "find",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [],
          view: "context",
          totalNodes: 100,
          actionableNodes: 10,
          totalMatches: 0,
          offset: 0,
          indexTruncated: false,
        },
      ),
    );
    return await pending;
  };

  try {
    await runEmpty("missing one");
    const beforeRepeat = port.sent.length;
    const repeated = await findTool.execute(
      {
        session_id: "browser-1",
        query: { text: "missing one" },
      },
      exec,
    );
    assertNoProgress(
      repeated,
      "find_repeated",
      /already succeeded.*unchanged page/iu,
    );
    assert.equal(concludedTurns, 1);
    assert.equal(port.sent.length, beforeRepeat);

    exec.rootCallId = "turn-2";
    await runEmpty("missing two");
    await runEmpty("missing three");
    const budgeted = await runEmpty("missing four");
    assertNoProgress(
      budgeted,
      "find_exhausted",
      /three distinct searches/iu,
    );
    assert.equal(concludedTurns, 2);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("native top-level call ids do not reset the active turn's zero-match budget", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-native-find-loop" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const signal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  let concludedTurns = 0;
  const runEmpty = async (index) => {
    const pending = findTool.execute(
      {
        session_id: "browser-1",
        query: { text: `missing ${String(index)}` },
      },
      {
        signal,
        rootCallId: `native-call-${String(index)}`,
        agent,
        concludeTurn() {
          concludedTurns += 1;
        },
      },
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "find",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [],
          view: "context",
          totalNodes: 100,
          actionableNodes: 10,
          totalMatches: 0,
          offset: 0,
          indexTruncated: false,
        },
      ),
    );
    return await pending;
  };

  await runEmpty(1);
  await runEmpty(2);
  const budgeted = await runEmpty(3);
  assertNoProgress(
    budgeted,
    "find_exhausted",
    /three distinct searches/iu,
  );
  assert.equal(concludedTurns, 1);
  const sentBeforeBudget = port.sent.length;

  await listeners.get("agent/pre-step")(
    { agent, turn: 2, step: 2, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  await runEmpty(5);
  assert.equal(port.sent.length, sentBeforeBudget + 1);
});

test("successful find refinements cannot repeat or grow without bound on one page", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-successful-find-loop" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const signal = new AbortController().signal;
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  let concludedTurns = 0;
  const exec = {
    signal,
    agent,
    concludeTurn() {
      concludedTurns += 1;
    },
  };
  const runMatch = async (text, index) => {
    const pending = findTool.execute(
      {
        session_id: "browser-1",
        query: { text },
      },
      {
        ...exec,
        rootCallId: `native-match-${String(index)}`,
      },
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "find",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: `s1:e${String(index)}`,
            role: "link",
            name: text,
            actionable: true,
            match: true,
          }],
          view: "context",
          totalNodes: 100,
          actionableNodes: 10,
          totalMatches: 1,
          offset: 0,
          indexTruncated: false,
        },
      ),
    );
    await pending;
  };

  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  await runMatch("requested action", 1);
  const beforeRepeat = port.sent.length;
  const repeated = await findTool.execute(
    {
      session_id: "browser-1",
      query: { text: "requested action" },
    },
    exec,
  );
  assertNoProgress(
    repeated,
    "find_repeated",
    /already succeeded.*unchanged page/iu,
  );
  assert.equal(port.sent.length, beforeRepeat);
  assert.equal(concludedTurns, 1);

  await listeners.get("agent/pre-step")(
    { agent, turn: 2, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  for (let index = 1; index <= 5; index += 1) {
    await runMatch(`refinement ${String(index)}`, index);
  }
  const beforeBudget = port.sent.length;
  const exhausted = await findTool.execute(
    {
      session_id: "browser-1",
      query: { text: "refinement 6" },
    },
    exec,
  );
  assertNoProgress(
    exhausted,
    "find_exhausted",
    /shared target-resolution budget/iu,
  );
  assert.equal(port.sent.length, beforeBudget);
  assert.equal(concludedTurns, 2);
});

test("invalidated evidence does not deduplicate a query against the prior page", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  let cleanup;
  applyAgentBrowserTools(
    {
      effect(callback) {
        cleanup = callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const navigateTool = definitions.find(
    (definition) => definition.name === "browser_navigate",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-find-after-navigation",
    agent: {
      session: { id: "conversation-find-after-navigation" },
    },
  };
  const findArgs = {
    session_id: "browser-1",
    query: { text: "Settings" },
  };
  const findResult = (snapshotId, ref, url) => ({
    ...sessionResult({
      generation: Number(snapshotId.slice(1)),
      url,
    }),
    snapshotId,
    nodes: [{
      ref,
      role: "link",
      name: "Settings",
      actionable: true,
      match: true,
    }],
    view: "matches",
    totalNodes: 10,
    actionableNodes: 3,
    totalMatches: 1,
    offset: 0,
    indexTruncated: false,
  });

  try {
    const firstFind = findTool.execute(findArgs, exec);
    const firstFindRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        firstFindRequest.requestId,
        "find",
        findResult(
          "s1",
          "s1:e1",
          "https://example.com/first",
        ),
      ),
    );
    await firstFind;

    const navigated = navigateTool.execute(
      {
        session_id: "browser-1",
        url: "https://example.com/second",
      },
      exec,
    );
    const navigateRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        navigateRequest.requestId,
        "navigate",
        sessionResult({
          generation: 2,
          snapshotRequired: true,
          url: "https://example.com/second",
        }),
      ),
    );
    await navigated;

    const sentBeforeSecondFind = port.sent.length;
    const secondFind = findTool.execute(findArgs, exec);
    assert.equal(port.sent.length, sentBeforeSecondFind + 1);
    const secondFindRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        secondFindRequest.requestId,
        "find",
        findResult(
          "s2",
          "s2:e1",
          "https://example.com/second",
        ),
      ),
    );
    const result = await secondFind;
    assert.equal(result.snapshotId, "s2");
  } finally {
    cleanup?.();
  }
});

test("browser no-progress guards conclude through the real ToolRuntime", async () => {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const port = new FakeProcessPort();
  applyAgentBrowserTools(ctx, {}, port);
  const signal = new AbortController().signal;
  const agent = {
    session: { id: "conversation-runtime-circuit" },
  };
  const args = {
    session_id: "browser-1",
    query: { text: "requested action" },
  };
  const rootCallId = ToolCallId("browser-root-call");

  try {
    const first = ctx.tools.execute({
      callId: ToolCallId("browser-find-1"),
      rootCallId,
      name: "browser_find",
      arguments: args,
      signal,
      agent,
    });
    await Promise.resolve();
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "find",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: "s1:e1",
            role: "link",
            name: "requested action",
            actionable: true,
            disabled: false,
            match: true,
          }],
          view: "context",
          totalNodes: 1,
          actionableNodes: 1,
          totalMatches: 1,
          offset: 0,
          indexTruncated: false,
        },
      ),
    );
    const firstResult = await first;
    assert.equal(firstResult.isError, false);

    const sentBeforeRepeat = port.sent.length;
    const repeated = await ctx.tools.execute({
      callId: ToolCallId("browser-find-2"),
      rootCallId,
      name: "browser_find",
      arguments: args,
      signal,
      agent,
    });
    assert.equal(port.sent.length, sentBeforeRepeat);
    assert.equal(repeated.isError, false);
    assert.equal(repeated.concludesTurn, true);
    assert.equal(repeated.value.outcome, "no_progress");
    assert.equal(repeated.value.code, "find_repeated");
    assert.match(
      repeated.content[0].text,
      /no further browser operation.*current turn/iu,
    );
  } finally {
    await ctx.fiber.dispose();
  }
});

test("real ToolRuntime terminates cross-operation browser ping-pong", async () => {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const port = new FakeProcessPort();
  applyAgentBrowserTools(ctx, {}, port);
  const signal = new AbortController().signal;
  const agent = {
    session: { id: "conversation-runtime-ping-pong" },
  };
  const rootCallId = ToolCallId("browser-ping-pong-root");
  let callIndex = 0;
  const runFailure = async (url) => {
    callIndex += 1;
    const pending = ctx.tools.execute({
      callId: ToolCallId(
        `browser-navigate-${String(callIndex)}`,
      ),
      rootCallId,
      name: "browser_navigate",
      arguments: {
        session_id: "browser-1",
        url,
      },
      signal,
      agent,
    });
    await Promise.resolve();
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        request.requestId,
        new Error("navigation outcome remained unknown"),
        { code: "navigation_failed", outcome: "unknown" },
      ),
    );
    return await pending;
  };

  try {
    const first = await runFailure("https://example.com/a");
    const second = await runFailure("https://example.com/b");
    const third = await runFailure("https://example.com/a");
    const fourth = await runFailure("https://example.com/b");

    for (const result of [first, second, third]) {
      assert.equal(result.isError, true);
      assert.equal(result.concludesTurn, undefined);
    }
    assert.equal(fourth.isError, false);
    assert.equal(fourth.concludesTurn, true);
    assertNoProgress(
      fourth.value,
      "ping_pong_loop",
      /browser-state cycle/iu,
    );

    const sentBeforeHaltedCall = port.sent.length;
    const halted = await ctx.tools.execute({
      callId: ToolCallId("browser-navigate-after-stop"),
      rootCallId,
      name: "browser_navigate",
      arguments: {
        session_id: "browser-1",
        url: "https://example.com/c",
      },
      signal,
      agent,
    });
    assert.equal(port.sent.length, sentBeforeHaltedCall);
    assert.equal(halted.isError, false);
    assert.equal(halted.concludesTurn, true);
    assert.equal(halted.value.code, "ping_pong_loop");
  } finally {
    await ctx.fiber.dispose();
  }
});

test("successful browser navigation oscillation concludes on the repeated state cycle", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const navigateTool = definitions.find(
    (definition) => definition.name === "browser_navigate",
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  let concludedTurns = 0;
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-navigation-cycle",
    concludeTurn() {
      concludedTurns += 1;
    },
    agent: {
      session: { id: "conversation-navigation-cycle" },
    },
  };
  const urls = [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/a",
    "https://example.com/b",
  ];

  try {
    let terminal;
    for (const [index, url] of urls.entries()) {
      const pending = navigateTool.execute(
        { session_id: "browser-1", url },
        exec,
      );
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "navigate",
          sessionResult({
            generation: index + 2,
            snapshotRequired: true,
            url,
          }),
        ),
      );
      const result = await pending;
      if (index < 3) {
        assert.equal(result.url, url);
        const snapshot = snapshotTool.execute(
          { session_id: "browser-1" },
          exec,
        );
        const snapshotRequest = port.sent.at(-1);
        port.emit(
          "message",
          agentBrowserSuccessResponse(
            snapshotRequest.requestId,
            "snapshot",
            {
              ...sessionResult({
                generation: index + 2,
                snapshotRequired: false,
                url,
              }),
              snapshotId: `s${String(index + 2)}`,
              nodes: [],
              totalNodes: 0,
              actionableNodes: 0,
              indexTruncated: false,
            },
          ),
        );
        await snapshot;
      } else {
        terminal = result;
      }
    }
    assertNoProgress(
      terminal,
      "ping_pong_loop",
      /browser-state cycle/iu,
    );
    assert.equal(concludedTurns, 1);

    const sentBeforeStoppedCall = port.sent.length;
    assertNoProgress(
      await navigateTool.execute(
        {
          session_id: "browser-1",
          url: "https://example.com/c",
        },
        exec,
      ),
      "ping_pong_loop",
      /browser-state cycle/iu,
    );
    assert.equal(port.sent.length, sentBeforeStoppedCall);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("an unchanged redundant snapshot concludes without replaying page content", async () => {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const port = new FakeProcessPort();
  applyAgentBrowserTools(ctx, {}, port);
  const signal = new AbortController().signal;
  const agent = {
    session: { id: "conversation-runtime-snapshot-loop" },
  };
  const args = { session_id: "browser-1" };
  const rootCallId = ToolCallId("browser-snapshot-root");
  const snapshot = {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: [{
      ref: "s1:e1",
      role: "link",
      name: "Target",
      actionable: true,
      disabled: false,
    }],
    view: "outline",
    totalNodes: 1,
    actionableNodes: 1,
    indexTruncated: false,
  };
  const executeSnapshot = async (callId) => {
    const pending = ctx.tools.execute({
      callId: ToolCallId(callId),
      rootCallId,
      name: "browser_snapshot",
      arguments: args,
      signal,
      agent,
    });
    await Promise.resolve();
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "snapshot",
        snapshot,
      ),
    );
    return await pending;
  };

  try {
    const first = await executeSnapshot("browser-snapshot-1");
    assert.equal(first.isError, false);
    assert.equal(first.concludesTurn, undefined);
    assert.match(first.content[0].text, /\[s1:e1\]/u);

    const repeated = await executeSnapshot("browser-snapshot-2");
    assert.equal(repeated.isError, false);
    assert.equal(repeated.concludesTurn, true);
    assertNoProgress(
      repeated.value,
      "snapshot_repeated",
      /unchanged snapshot s1/iu,
    );
    assert.doesNotMatch(repeated.content[0].text, /\[s1:e1\]/u);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("one agent turn hard-stops duplicate opens and a repeated known remote failure", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-browser-circuit" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const signal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  const openTool = definitions.find(
    (definition) => definition.name === "browser_open",
  );
  const navigateTool = definitions.find(
    (definition) => definition.name === "browser_navigate",
  );
  let concludedTurns = 0;
  const exec = {
    signal,
    agent,
    concludeTurn() {
      concludedTurns += 1;
    },
  };

  const opened = openTool.execute(
    { url: "https://example.com/" },
    exec,
  );
  const openRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      openRequest.requestId,
      "open",
      sessionResult(),
    ),
  );
  await opened;

  const sentBeforeDuplicate = port.sent.length;
  const duplicate = openTool.execute(
    { url: "https://example.com/" },
    exec,
  );
  if (port.sent.length > sentBeforeDuplicate) {
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "open",
        sessionResult({ sessionId: "browser-2" }),
      ),
    );
  }
  assertNoProgress(
    await duplicate,
    "repeated_open",
    /already opened/iu,
  );
  assert.equal(port.sent.length, sentBeforeDuplicate);
  assert.equal(concludedTurns, 1);

  await listeners.get("agent/pre-step")(
    { agent, turn: 2, step: 2, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  const navigateArgs = {
    session_id: "browser-1",
    url: "https://example.com/failing",
  };
  const pending = navigateTool.execute(navigateArgs, exec);
  const request = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserErrorResponse(
      request.requestId,
      new Error("navigation failure"),
      { code: "navigation_failed", outcome: "known" },
    ),
  );
  await assert.rejects(
    pending,
    (error) => error.remoteCode === "navigation_failed",
  );
  const sentBeforeCircuit = port.sent.length;
  const circuit = navigateTool.execute(navigateArgs, exec);
  if (port.sent.length > sentBeforeCircuit) {
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        request.requestId,
        new Error("repeated navigation failure"),
        { code: "navigation_failed", outcome: "known" },
      ),
    );
  }
  assertNoProgress(
    await circuit,
    "repeated_operation",
    /same non-progressing result/iu,
  );
  assert.equal(port.sent.length, sentBeforeCircuit);
  assert.equal(concludedTurns, 2);
});

test("live URL traces follow tab close and navigation", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  let cleanup;
  applyAgentBrowserTools(
    {
      effect(callback) {
        cleanup = callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const openTool = definitions.find(
    (definition) => definition.name === "browser_open",
  );
  const closeTool = definitions.find(
    (definition) => definition.name === "browser_close",
  );
  const navigateTool = definitions.find(
    (definition) => definition.name === "browser_navigate",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-reopen-closed-tab",
    agent: {
      session: { id: "conversation-reopen-closed-tab" },
    },
  };
  const url = "https://example.com/reopen";

  try {
    const opened = openTool.execute({ url }, exec);
    const firstOpenRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        firstOpenRequest.requestId,
        "open",
        sessionResult({
          sessionId: "browser-reopen",
          url,
        }),
      ),
    );
    await opened;

    const closed = closeTool.execute(
      { session_id: "browser-reopen" },
      exec,
    );
    const closeRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        closeRequest.requestId,
        "close",
        {
          sessionId: "browser-reopen",
          closed: true,
        },
      ),
    );
    await closed;

    const sentBeforeReopen = port.sent.length;
    const reopened = openTool.execute({ url }, exec);
    assert.equal(port.sent.length, sentBeforeReopen + 1);
    const secondOpenRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        secondOpenRequest.requestId,
        "open",
        sessionResult({
          sessionId: "browser-reopened",
          url,
        }),
      ),
    );
    const result = await reopened;
    assert.equal(result.sessionId, "browser-reopened");

    const navigated = navigateTool.execute(
      {
        session_id: "browser-reopened",
        url: "https://example.com/elsewhere",
      },
      exec,
    );
    const navigateRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        navigateRequest.requestId,
        "navigate",
        sessionResult({
          sessionId: "browser-reopened",
          snapshotRequired: true,
          url: "https://example.com/elsewhere",
        }),
      ),
    );
    await navigated;

    const sentBeforeOpenAfterNavigation = port.sent.length;
    const openedAfterNavigation = openTool.execute({ url }, exec);
    assert.equal(
      port.sent.length,
      sentBeforeOpenAfterNavigation + 1,
    );
    const thirdOpenRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        thirdOpenRequest.requestId,
        "open",
        sessionResult({
          sessionId: "browser-after-navigation",
          url,
        }),
      ),
    );
    const thirdResult = await openedAfterNavigation;
    assert.equal(
      thirdResult.sessionId,
      "browser-after-navigation",
    );
  } finally {
    cleanup?.();
  }
});

test("fresh snapshot action refs authorize only their listed mutations", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const fillTool = definitions.find(
    (definition) => definition.name === "browser_fill",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-ref-authority",
    agent: { session: { id: "conversation-ref-authority" } },
  };

  try {
    const beforeRejectedClick = port.sent.length;
    await assert.rejects(
      clickTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e9" },
        },
        exec,
      ),
      /not an action ref authorized.*scope-only/iu,
    );
    assert.equal(port.sent.length, beforeRejectedClick);

    const snapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const snapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        snapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [
            {
              ref: "s1:e1",
              role: "listitem",
              name: "Requested item",
              actionable: false,
            },
            {
              ref: "s1:e9",
              parentRef: "s1:e1",
              role: "link",
              name: "Requested action",
              actionable: true,
              disabled: false,
              actions: ["click", "press"],
            },
          ],
          view: "outline",
          totalNodes: 100,
          actionableNodes: 10,
          indexTruncated: false,
        },
      ),
    );
    await snapshot;

    const beforeStructuralClick = port.sent.length;
    await assert.rejects(
      clickTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e1" },
        },
        exec,
      ),
      /structural.*scope-only/iu,
    );
    assert.equal(port.sent.length, beforeStructuralClick);

    const beforeCapabilityMismatch = port.sent.length;
    await assert.rejects(
      fillTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e9" },
          value: "not allowed",
        },
        exec,
      ),
      (error) =>
        error.remoteCode === "capability_mismatch" &&
        /does not expose fill.*click, press/iu.test(error.message),
    );
    assert.equal(port.sent.length, beforeCapabilityMismatch);

    const click = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e9" },
      },
      exec,
    );
    const clickRequest = port.sent.at(-1);
    assert.equal(clickRequest.operation, "click");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        clickRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await click;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("browser_find binds a constrained one-based ordinal before authorizing a scoped action", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const querySchema =
    findTool.parameters.properties.query;
  assert.equal(
    Object.hasOwn(querySchema.properties, "ordinal"),
    false,
  );
  assert.equal(
    Object.hasOwn(findTool.parameters.properties, "ordinal"),
    true,
  );
  assert.equal(
    Object.hasOwn(querySchema.properties, "index"),
    false,
  );

  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-find-ordinal",
    agent: { session: { id: "conversation-find-ordinal" } },
  };
  const ordinalFind = findTool.execute(
    {
      session_id: "browser-1",
      query: {
        role: "listitem",
        name: "Result",
      },
      ordinal: 8,
      view: "subtree",
      depth: 2,
    },
    exec,
  );
  const ordinalRequest = port.sent.at(-1);
  assert.equal(ordinalRequest.operation, "find");
  assert.deepEqual(ordinalRequest.payload, {
    sessionId: "browser-1",
    query: {
      role: "listitem",
      name: "Result",
      exact: false,
      index: 7,
    },
    view: "subtree",
    depth: 2,
    limit: 5,
  });
  const ordinalResult = {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: [
      {
        ref: "s1:e8",
        role: "listitem",
        name: "Result 8",
        actionable: false,
        match: true,
      },
      {
        ref: "s1:e9",
        role: "link",
        name: "Open details",
        depth: 1,
        parentRef: "s1:e8",
        actionable: true,
        disabled: false,
        actions: ["click", "press"],
      },
    ],
    view: "subtree",
    totalNodes: 100,
    actionableNodes: 10,
    totalMatches: 10,
    offset: 7,
    indexTruncated: false,
  };
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      ordinalRequest.requestId,
      "find",
      ordinalResult,
    ),
  );
  await ordinalFind;

  const ordinalOutput =
    findTool.output.render({}, ordinalResult)[0].text;
  assert.match(
    ordinalOutput,
    /Direct match position: #8 of 10 constrained matches/u,
  );
  assert.match(
    ordinalOutput,
    /structural item directly matched.*query\.within_ref="s1:e8"/isu,
  );

  const sentBeforeContextClick = port.sent.length;
  await assert.rejects(
    clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e9" },
      },
      exec,
    ),
    /query-context refs are scope-only/iu,
  );
  assert.equal(port.sent.length, sentBeforeContextClick);

  const scopedFind = findTool.execute(
    {
      session_id: "browser-1",
      query: {
        within_ref: "s1:e8",
        role: "link",
        name: "Open details",
        exact: true,
      },
      view: "matches",
    },
    exec,
  );
  const scopedRequest = port.sent.at(-1);
  assert.deepEqual(scopedRequest.payload, {
    sessionId: "browser-1",
    query: {
      withinRef: "s1:e8",
      role: "link",
      name: "Open details",
      exact: true,
    },
    view: "matches",
    depth: 0,
    limit: 5,
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      scopedRequest.requestId,
      "find",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [{
          ref: "s1:e9",
          role: "link",
          name: "Open details",
          actionable: true,
          disabled: false,
          actions: ["click", "press"],
          match: true,
        }],
        view: "matches",
        totalNodes: 100,
        actionableNodes: 10,
        totalMatches: 1,
        offset: 0,
        indexTruncated: false,
      },
    ),
  );
  await scopedFind;

  const click = clickTool.execute(
    {
      session_id: "browser-1",
      target: { ref: "s1:e9" },
    },
    exec,
  );
  const clickRequest = port.sent.at(-1);
  assert.equal(clickRequest.operation, "click");
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      clickRequest.requestId,
      "click",
      sessionResult({ snapshotRequired: true }),
    ),
  );
  await click;

  const outOfRangeOutput = findTool.output.render({}, {
    ...ordinalResult,
    nodes: [],
    offset: 10,
  })[0].text;
  assert.match(
    outOfRangeOutput,
    /Requested match position #11 does not exist.*10 items.*Do not substitute/isu,
  );
  assert.doesNotMatch(
    outOfRangeOutput,
    /Resolution complete/iu,
  );
});

test("browser_find rejects invalid or unconstrained ordinals before IPC", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "invalid-ordinal-0",
    agent: { session: { id: "conversation-invalid-ordinal" } },
  };

  for (const [index, ordinal] of [0, 1.5].entries()) {
    exec.rootCallId = `invalid-ordinal-${String(index + 1)}`;
    const sentBefore = port.sent.length;
    assert.throws(
      () =>
        findTool.execute(
          {
            session_id: "browser-1",
            query: {
              role: "listitem",
            },
            ordinal,
          },
          exec,
        ),
      /browser_find ordinal must be a positive integer/iu,
    );
    assert.equal(port.sent.length, sentBefore);
  }

  exec.rootCallId = "invalid-ordinal-only";
  const sentBeforeOrdinalOnly = port.sent.length;
  assert.throws(
    () =>
      findTool.execute(
        {
          session_id: "browser-1",
          query: {},
          ordinal: 8,
        },
        exec,
      ),
    /requires a scope or semantic constraint/iu,
  );
  assert.equal(port.sent.length, sentBeforeOrdinalOnly);
});

test("repeated malformed browser arguments terminate the current turn", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  let concludedTurns = 0;
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "malformed-find-turn",
    agent: {
      session: { id: "conversation-malformed-find" },
    },
    concludeTurn() {
      concludedTurns += 1;
    },
  };
  const invalidArgs = {
    session_id: "browser-1",
    query: { role: "link", text: "comments" },
    index: 16,
  };

  assert.throws(
    () => findTool.execute(invalidArgs, exec),
    /unexpected fields: index.*Allowed fields:.*ordinal/iu,
  );
  const repeated = await findTool.execute(invalidArgs, exec);
  assertNoProgress(
    repeated,
    "repeated_operation",
    /same non-progressing result/iu,
  );
  assert.equal(concludedTurns, 1);
  assert.equal(port.sent.length, 0);
});

test("restricted generated locator requires macro evidence and authorizes one exact action ref", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const locateTool = definitions.find(
    (definition) => definition.name === "browser_locate",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-generated-locator",
    agent: {
      session: {
        id: "conversation-generated-locator",
      },
    },
  };
  const code =
    'page.locator("tr.athing").nth(11).next().getByRole("link", {name:/comments?/i})';

  try {
    await assert.rejects(
      locateTool.execute(
        {
          session_id: "browser-1",
          code,
        },
        exec,
      ),
      /requires a current macro observation.*browser_snapshot/iu,
    );
    assert.equal(port.sent.length, 0);

    const snapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const snapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        snapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: "s1:e1",
            role: "table",
            name: "Stories",
            actionable: false,
          }],
          totalNodes: 100,
          actionableNodes: 20,
        },
      ),
    );
    await snapshot;

    const locate = locateTool.execute(
      {
        session_id: "browser-1",
        code,
      },
      exec,
    );
    const locateRequest = port.sent.at(-1);
    assert.equal(locateRequest.operation, "locate");
    assert.deepEqual(locateRequest.payload, {
      sessionId: "browser-1",
      code,
    });
    const locateResult = {
      ...sessionResult(),
      snapshotId: "s1",
      node: {
        ref: "s1:e12",
        role: "link",
        name: "18 comments",
        actionable: true,
        disabled: false,
        url: "https://example.com/item?id=12",
        match: true,
      },
    };
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        locateRequest.requestId,
        "locate",
        locateResult,
      ),
    );
    await locate;
    assert.match(
      locateTool.output.render({}, locateResult)[0].text,
      /allowlisted plan.*not evaluated as arbitrary JavaScript/isu,
    );

    const click = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e12" },
      },
      exec,
    );
    const clickRequest = port.sent.at(-1);
    assert.equal(clickRequest.operation, "click");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        clickRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await click;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("a locate rejected before dispatch does not poison recovered snapshot actions", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const locateTool = definitions.find(
    (definition) => definition.name === "browser_locate",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-locate-preflight",
    agent: {
      session: {
        id: "conversation-locate-preflight",
      },
    },
  };
  const snapshotResult = {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: [
      {
        ref: "s1:e1",
        role: "button",
        name: "Stale action",
        actionable: true,
        disabled: false,
      },
      {
        ref: "s1:e2",
        role: "button",
        name: "Recovered action",
        actionable: true,
        disabled: false,
      },
    ],
    totalNodes: 2,
    actionableNodes: 2,
  };

  const emitSnapshot = async () => {
    const pending = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "snapshot",
        snapshotResult,
      ),
    );
    await pending;
  };

  try {
    await emitSnapshot();

    const staleClick = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e1" },
      },
      exec,
    );
    const staleRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        staleRequest.requestId,
        new Error("stale ref"),
        { code: "stale_ref", outcome: "known" },
      ),
    );
    await assert.rejects(
      staleClick,
      (error) => error.remoteCode === "stale_ref",
    );

    const sentBeforeLocate = port.sent.length;
    await assert.rejects(
      locateTool.execute(
        {
          session_id: "browser-1",
          code:
            'page.getByRole("button", {name:"Recovered action", exact:true})',
        },
        exec,
      ),
      /requires a current macro observation/iu,
    );
    assert.equal(port.sent.length, sentBeforeLocate);

    await emitSnapshot();

    const recoveredClick = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e2" },
      },
      exec,
    );
    const recoveredRequest = port.sent.at(-1);
    if (recoveredRequest.operation !== "click") {
      await recoveredClick;
    }
    assert.equal(recoveredRequest.operation, "click");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        recoveredRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await recoveredClick;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("generated locator failures revoke action evidence and successful refs replace older grants", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-locator-revocation" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const signal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const locateTool = definitions.find(
    (definition) => definition.name === "browser_locate",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const exec = { signal, agent };
  const snapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    exec,
  );
  const snapshotRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      snapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [{
          ref: "s1:e1",
          role: "button",
          name: "Snapshot action",
          actionable: true,
          disabled: false,
        }],
        totalNodes: 3,
        actionableNodes: 3,
      },
    ),
  );
  await snapshot;

  const runSuccessfulLocate = async (name, ref) => {
    const pending = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          `page.getByRole("button", {name:${JSON.stringify(name)}, exact:true})`,
      },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "locate",
        {
          ...sessionResult(),
          snapshotId: "s1",
          node: {
            ref,
            role: "button",
            name,
            actionable: true,
            disabled: false,
            match: true,
          },
        },
      ),
    );
    await pending;
  };

  try {
    await listeners.get("agent/pre-step")(
      { agent, turn: 1, step: 2, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await runSuccessfulLocate("First action", "s1:e2");
    await listeners.get("agent/pre-step")(
      { agent, turn: 1, step: 3, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await runSuccessfulLocate("Second action", "s1:e3");
    await listeners.get("agent/pre-step")(
      { agent, turn: 1, step: 4, signal },
      async () => ({ kind: "enter", messages: [] }),
    );

    const sentBeforeOldRef = port.sent.length;
    const oldRefMutation = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e2" },
      },
      exec,
    );
    if (port.sent.length > sentBeforeOldRef) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "click",
          sessionResult(),
        ),
      );
    }
    await assert.rejects(
      oldRefMutation,
      /not an action ref authorized.*scope-only/iu,
    );
    assert.equal(port.sent.length, sentBeforeOldRef);

    const failedLocate = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          'page.getByRole("button", {name:"Missing action", exact:true})',
      },
      exec,
    );
    const failedRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        failedRequest.requestId,
        new Error("generated locator remained ambiguous"),
        { code: "ambiguous_target", outcome: "known" },
      ),
    );
    await assert.rejects(
      failedLocate,
      (error) => error.remoteCode === "ambiguous_target",
    );

    listeners.get("agent/status")({
      agent,
      status: "idle",
    });
    await listeners.get("agent/pre-step")(
      { agent, turn: 2, step: 1, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    const refreshedSnapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const refreshedSnapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        refreshedSnapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: "s1:e1",
            role: "button",
            name: "Snapshot action",
            actionable: true,
            disabled: false,
          }],
          totalNodes: 3,
          actionableNodes: 3,
        },
      ),
    );
    const refreshedObservation = await refreshedSnapshot;
    assert.equal(
      refreshedObservation.actionAuthorization,
      "refinement-required",
    );
    const refreshedOutput = snapshotTool.output.render(
      {},
      refreshedObservation,
    )[0].text;
    assert.match(
      refreshedOutput,
      /no mutation ref is authorized.*browser_find/iu,
    );
    assert.match(
      refreshedOutput,
      /\[s1:e1\].*\[scope-only\]/u,
    );
    assert.doesNotMatch(refreshedOutput, /\[actions=/u);
    await listeners.get("agent/pre-step")(
      { agent, turn: 2, step: 2, signal },
      async () => ({ kind: "enter", messages: [] }),
    );

    const sentBeforeSemanticMutation = port.sent.length;
    const semanticMutation = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "button",
          name: "Snapshot action",
        },
      },
      exec,
    );
    if (port.sent.length > sentBeforeSemanticMutation) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "click",
          sessionResult(),
        ),
      );
    }
    await assert.rejects(
      semanticMutation,
      /No direct enabled actionable evidence/iu,
    );
    assert.equal(port.sent.length, sentBeforeSemanticMutation);

    await listeners.get("agent/pre-step")(
      { agent, turn: 3, step: 1, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await runSuccessfulLocate("Resolved action", "s1:e4");

    const sentBeforeSibling = port.sent.length;
    const hiddenSibling = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "button",
          name: "Snapshot action",
        },
      },
      exec,
    );
    if (port.sent.length > sentBeforeSibling) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "click",
          sessionResult(),
        ),
      );
    }
    await assert.rejects(hiddenSibling, /next model step/iu);
    assert.equal(port.sent.length, sentBeforeSibling);

    await listeners.get("agent/pre-step")(
      { agent, turn: 2, step: 2, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    const sentBeforeSemanticSubstitute = port.sent.length;
    const semanticSubstitute = clickTool.execute(
      {
        session_id: "browser-1",
        target: {
          role: "button",
          name: "Snapshot action",
        },
      },
      exec,
    );
    if (port.sent.length > sentBeforeSemanticSubstitute) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "click",
          sessionResult(),
        ),
      );
    }
    await assert.rejects(
      semanticSubstitute,
      /exact ref.*browser_locate/iu,
    );
    assert.equal(port.sent.length, sentBeforeSemanticSubstitute);

    const exactMutation = clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e4" },
      },
      exec,
    );
    const exactMutationRequest = port.sent.at(-1);
    assert.equal(exactMutationRequest.operation, "click");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        exactMutationRequest.requestId,
        "click",
        sessionResult({ snapshotRequired: true }),
      ),
    );
    await exactMutation;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("generated locator attempts are bounded per owner session snapshot and turn", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-locator-budget" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const signal = new AbortController().signal;
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const locateTool = definitions.find(
    (definition) => definition.name === "browser_locate",
  );
  let concludedTurns = 0;
  const exec = {
    signal,
    agent,
    concludeTurn() {
      concludedTurns += 1;
    },
  };
  const observe = async (generation) => {
    const pending = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "snapshot",
        {
          ...sessionResult({ generation }),
          snapshotId: `s${String(generation)}`,
          nodes: [],
          totalNodes: 10,
          actionableNodes: 0,
        },
      ),
    );
    await pending;
  };
  const failedLocate = async (name) => {
    const pending = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          `page.getByRole("button", {name:${JSON.stringify(name)}, exact:true})`,
      },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        request.requestId,
        new Error(`missing ${name}`),
        { code: "element_not_found", outcome: "known" },
      ),
    );
    await assert.rejects(
      pending,
      (error) => error.remoteCode === "element_not_found",
    );
  };
  const successfulLocate = async (name, ref, generation) => {
    const pending = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          `page.getByRole("button", {name:${JSON.stringify(name)}, exact:true})`,
      },
      exec,
    );
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "locate",
        {
          ...sessionResult({ generation }),
          snapshotId: `s${String(generation)}`,
          node: {
            ref,
            role: "button",
            name,
            actionable: true,
            disabled: false,
            match: true,
          },
        },
      ),
    );
    await pending;
  };

  try {
    await listeners.get("agent/pre-step")(
      { agent, turn: 1, step: 1, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await observe(1);
    await failedLocate("Attempt 1");
    await failedLocate("Attempt 2");
    await failedLocate("Attempt 3");

    const sentBeforeBudget = port.sent.length;
    const exhausted = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          'page.getByRole("button", {name:"Attempt 4", exact:true})',
      },
      exec,
    );
    if (port.sent.length > sentBeforeBudget) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserErrorResponse(
          request.requestId,
          new Error("unexpected fourth locator request"),
          { code: "element_not_found", outcome: "known" },
        ),
      );
    }
    assertNoProgress(
      await exhausted,
      "locate_exhausted",
      /shared target-resolution budget/iu,
    );
    assert.equal(port.sent.length, sentBeforeBudget);
    assert.equal(concludedTurns, 1);

    await listeners.get("agent/pre-step")(
      { agent, turn: 2, step: 1, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await successfulLocate("Resolved action", "s1:e2", 1);
    const sentBeforeRepeat = port.sent.length;
    const repeated = locateTool.execute(
      {
        session_id: "browser-1",
        code:
          'page.getByRole("button", {name:"Resolved action", exact:true})',
      },
      exec,
    );
    if (port.sent.length > sentBeforeRepeat) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          request.requestId,
          "locate",
          {
            ...sessionResult(),
            snapshotId: "s1",
            node: {
              ref: "s1:e2",
              role: "button",
              name: "Resolved action",
              actionable: true,
              disabled: false,
              match: true,
            },
          },
        ),
      );
    }
    assertNoProgress(
      await repeated,
      "locate_repeated",
      /already succeeded.*unchanged snapshot/iu,
    );
    assert.equal(port.sent.length, sentBeforeRepeat);
    assert.equal(concludedTurns, 2);

    await listeners.get("agent/pre-step")(
      { agent, turn: 3, step: 1, signal },
      async () => ({ kind: "enter", messages: [] }),
    );
    await observe(2);
    await successfulLocate("Resolved action", "s2:e2", 2);
    assert.equal(port.sent.length, sentBeforeRepeat + 2);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("plugin registers thirteen exclusive tools and forwards owner-scoped semantic, scroll, and wait calls", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const promptSections = [];
  const cleanups = [];
  const ctx = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
    systemPrompt: {
      section(section) {
        promptSections.push(section);
      },
    },
  };
  applyAgentBrowserTools(
    ctx,
    { timeoutMs: 45_000, waitTimeoutMs: 1_234 },
    port,
  );

  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [
      "browser_open",
      "browser_navigate",
      "browser_history",
      "browser_snapshot",
      "browser_find",
      "browser_locate",
      "browser_click",
      "browser_fill",
      "browser_press",
      "browser_scroll",
      "browser_wait",
      "browser_screenshot",
      "browser_close",
    ],
  );
  assert.equal(promptSections.length, 1);
  assert.equal(promptSections[0].name, "tool:agent-browser");
  assert.equal(promptSections[0].order, 75);
  assert.equal(typeof promptSections[0].text, "function");
  assert.match(
    promptSections[0].text({}),
    /capabilities are staged.*browser_snapshot.*browser_find.*browser_locate/isu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /OBSERVE → RESOLVE → ACT → VERIFY/u,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /within_ref/u,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /Bind an ordinal to the collection it describes/u,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /pass ordinal beside query.*after those constraints/isu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /matched structural ref as within_ref/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /primary label identifies the item.*target control.*requested action/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /Exact refs from browser_snapshot, browser_find, or browser_locate may mutate only through their exposed actions.*Never invent an accessible name/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /exactly one direct enabled actionable match.*act on that match.*do not re-search/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /prefer the exact grounded ref.*requested action.*omitted.*browser_find.*ambiguous/isu,
  );
  assert.doesNotMatch(
    AGENT_BROWSER_INTENT_PROMPT,
    /nested.*MUST precede any mutation/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /human-control handoff ends the current browser turn/iu,
  );
  assert.match(
    AGENT_BROWSER_INTENT_PROMPT,
    /browser_scroll.*lazy|lazy.*browser_scroll/iu,
  );
  assert.doesNotMatch(
    AGENT_BROWSER_INTENT_PROMPT,
    /comments|replies|story/iu,
  );
  assert.doesNotMatch(
    definitions.map((definition) => definition.description).join("\n") +
      JSON.stringify(
        definitions.map((definition) => definition.parameters),
      ),
    /ycombinator|tr\.athing|comments\?|discuss/iu,
  );
  assert.equal(
    definitions.every(
      (definition) =>
        definition.timeoutMs === 45_000 &&
        definition.isConcurrencySafe === undefined,
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(
      definitions.map(({ parameters, output }) => ({
        parameters,
        output: output.schema,
      })),
    ),
    /"(?:minimum|maximum|uniqueItems|maxItems|minItems)"/u,
  );

  const waitTool = definitions.find(
    (definition) => definition.name === "browser_wait",
  );
  const pending = waitTool.execute(
    { session_id: "browser-1", text: "Finished" },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const request = port.sent[0];
  assert.equal(request.ownerSessionId, "conversation-4");
  assert.deepEqual(request.payload, {
    sessionId: "browser-1",
    text: "Finished",
    timeoutMs: 1_234,
  });

  port.emit(
    "message",
    agentBrowserSuccessResponse(
      request.requestId,
      "wait",
      sessionResult(),
    ),
  );
  assert.equal((await pending).sessionId, "browser-1");
  assert.match(
    waitTool.output.render({}, sessionResult())[0].text,
    /Observed requested text/u,
  );
  const scrollTool = definitions.find(
    (definition) => definition.name === "browser_scroll",
  );
  const scrollPending = scrollTool.execute(
    {
      session_id: "browser-1",
      direction: "down",
    },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const scrollRequest = port.sent.at(-1);
  assert.equal(scrollRequest.operation, "scroll");
  assert.deepEqual(scrollRequest.payload, {
    sessionId: "browser-1",
    direction: "down",
    amount: 600,
  });
  const scrollResult = {
    ...sessionResult({ snapshotRequired: true }),
    scope: "page",
    beforeX: 0,
    beforeY: 20,
    afterX: 0,
    afterY: 620,
    maxX: 0,
    maxY: 2_000,
    moved: true,
  };
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      scrollRequest.requestId,
      "scroll",
      scrollResult,
    ),
  );
  assert.deepEqual(await scrollPending, scrollResult);
  const renderedScroll =
    scrollTool.output.render({}, scrollResult)[0].text;
  assert.match(renderedScroll, /y 620\/2000 from 20/iu);
  assert.match(renderedScroll, /browser_snapshot/iu);
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const findPending = findTool.execute(
    {
      session_id: "browser-1",
      query: {
        text: "Requested action",
        actionable: true,
      },
    },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const findRequest = port.sent.at(-1);
  assert.equal(findRequest.operation, "find");
  assert.deepEqual(findRequest.payload, {
    sessionId: "browser-1",
    query: {
      text: "Requested action",
      actionable: true,
      exact: false,
    },
    view: "matches",
    depth: 0,
    limit: 5,
  });
  const findResult = {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: [],
    view: "matches",
    totalNodes: 10_000,
    actionableNodes: 500,
    totalMatches: 0,
    offset: 0,
    indexTruncated: false,
  };
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      findRequest.requestId,
      "find",
      findResult,
    ),
  );
  await findPending;
  assert.match(
    findTool.output.render({}, findResult)[0].text,
    /valid absence result.*do not substitute/iu,
  );
  const differentiatedFindOutput = findTool.output.render({}, {
    ...findResult,
    nodes: [
      {
        ref: "s1:e8",
        role: "link",
        name: "Primary label",
        actionable: true,
      },
      {
        ref: "s1:e9",
        role: "link",
        name: "Requested action",
        actionable: true,
        match: true,
      },
    ],
    totalMatches: 1,
  })[0].text;
  assert.match(
    differentiatedFindOutput,
    /Direct actionable query matches[\s\S]*\[s1:e9\][\s\S]*Nearby actionable context[\s\S]*\[s1:e8\]/u,
  );
  assert.match(
    differentiatedFindOutput,
    /does not satisfy the query; do not treat as a match/iu,
  );
  const nearbyActionLine = differentiatedFindOutput
    .split("\n")
    .find((line) => line.includes("[s1:e8]"));
  assert.match(nearbyActionLine, /\[scope-only\]/u);
  assert.doesNotMatch(nearbyActionLine, /\[actions=/u);
  assert.match(
    differentiatedFindOutput,
    /Resolution complete.*browser_click.*s1:e9.*do not issue another browser_find/iu,
  );
  const actionableWithStructuralEcho =
    findTool.output.render({}, {
      ...findResult,
      nodes: [
        {
          ref: "s1:e8",
          role: "row",
          name: "Requested action",
          actionable: false,
          match: true,
        },
        {
          ref: "s1:e9",
          role: "link",
          name: "Requested action",
          actionable: true,
          disabled: false,
          actions: ["click", "press"],
          match: true,
        },
      ],
      totalMatches: 2,
    })[0].text;
  assert.match(
    actionableWithStructuralEcho,
    /Resolution complete.*target\.ref="s1:e9"/iu,
  );
  assert.doesNotMatch(
    actionableWithStructuralEcho,
    /One structural item directly matched/iu,
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  assert.equal(
    clickTool.parameters.properties.target.oneOf.length,
    2,
  );
  assert.match(
    clickTool.description,
    /within_ref/u,
  );
  assert.match(
    clickTool.description,
    /target control's own.*requested action/iu,
  );
  assert.equal(
    Object.hasOwn(
      clickTool.parameters.properties.target.properties,
      "ordinal",
    ),
    true,
  );
  assert.equal(
    Object.hasOwn(
      clickTool.parameters.properties.target.properties,
      "index",
    ),
    false,
  );
  const clickPending = clickTool.execute(
    {
      session_id: "browser-1",
      target: {
        within_ref: "s1:e5",
        role: "link",
        name: "Open details",
        url: "/items/5",
        exact: true,
      },
    },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const clickRequest = port.sent.at(-1);
  assert.equal(clickRequest.operation, "click");
  assert.deepEqual(clickRequest.payload, {
    sessionId: "browser-1",
    target: {
      withinRef: "s1:e5",
      role: "link",
      name: "Open details",
      url: "/items/5",
      exact: true,
    },
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      clickRequest.requestId,
      "click",
      sessionResult({ snapshotRequired: true }),
    ),
  );
  await clickPending;
  assert.match(
    clickTool.output.render(
      {},
      sessionResult({ snapshotRequired: true }),
    )[0].text,
    /prior refs are invalid.*browser_snapshot is required/u,
  );
  assert.doesNotMatch(
    clickTool.output.render({}, sessionResult())[0].text,
    /Next:/u,
  );

  const ordinalClickPending = clickTool.execute(
    {
      session_id: "browser-2",
      target: {
        role: "link",
        name: "comments",
        exact: false,
        ordinal: 5,
      },
    },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const ordinalClickRequest = port.sent.at(-1);
  assert.deepEqual(ordinalClickRequest.payload, {
    sessionId: "browser-2",
    target: {
      role: "link",
      name: "comments",
      exact: false,
      index: 4,
    },
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      ordinalClickRequest.requestId,
      "click",
      sessionResult({ sessionId: "browser-2" }),
    ),
  );
  await ordinalClickPending;

  const historyTool = definitions.find(
    (definition) => definition.name === "browser_history",
  );
  const historyPending = historyTool.execute(
    {
      session_id: "browser-1",
      action: "back",
    },
    {
      signal: new AbortController().signal,
      agent: { session: { id: "conversation-4" } },
    },
  );
  const historyRequest = port.sent.at(-1);
  assert.equal(historyRequest.operation, "history");
  assert.deepEqual(historyRequest.payload, {
    sessionId: "browser-1",
    command: "back",
  });
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      historyRequest.requestId,
      "history",
      sessionResult({ snapshotRequired: true }),
    ),
  );
  await historyPending;

  for (const cleanup of cleanups) cleanup();
});

test("browser_scroll treats a stable boundary as evidence and stops an unchanged retry", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const scrollTool = definitions.find(
    (definition) => definition.name === "browser_scroll",
  );
  let concludedTurns = 0;
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-scroll-boundary",
    concludeTurn() {
      concludedTurns += 1;
    },
    agent: {
      session: { id: "conversation-scroll-boundary" },
    },
  };
  const args = {
    session_id: "browser-1",
    direction: "bottom",
  };
  const boundaryResult = {
    ...sessionResult(),
    scope: "page",
    beforeX: 0,
    beforeY: 2_000,
    afterX: 0,
    afterY: 2_000,
    maxX: 0,
    maxY: 2_000,
    moved: false,
  };

  try {
    const first = scrollTool.execute(args, exec);
    const firstRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        firstRequest.requestId,
        "scroll",
        boundaryResult,
      ),
    );
    assert.deepEqual(await first, boundaryResult);

    const sentBeforeRepeat = port.sent.length;
    const repeated = scrollTool.execute(args, exec);
    await Promise.resolve();
    if (port.sent.length > sentBeforeRepeat) {
      const repeatedRequest = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserSuccessResponse(
          repeatedRequest.requestId,
          "scroll",
          boundaryResult,
        ),
      );
    }
    assertNoProgress(
      await repeated,
      "repeated_operation",
      /same non-progressing result/iu,
    );
    assert.equal(port.sent.length, sentBeforeRepeat);
    assert.equal(concludedTurns, 1);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("browser_scroll accepts structural container refs only from current observation evidence", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const scrollTool = definitions.find(
    (definition) => definition.name === "browser_scroll",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-scroll-container-evidence",
    agent: {
      session: { id: "conversation-scroll-container" },
    },
  };
  const args = {
    session_id: "browser-1",
    direction: "down",
    within_ref: "s1:e1",
  };

  try {
    const sentBeforeUngrounded = port.sent.length;
    const ungrounded = scrollTool.execute(args, exec);
    await Promise.resolve();
    if (port.sent.length > sentBeforeUngrounded) {
      const request = port.sent.at(-1);
      port.emit(
        "message",
        agentBrowserErrorResponse(
          request.requestId,
          new Error("remote ref lookup should not run"),
          { code: "stale_ref", outcome: "known" },
        ),
      );
    }
    await assert.rejects(
      ungrounded,
      /current observation.*browser_snapshot/iu,
    );
    assert.equal(port.sent.length, sentBeforeUngrounded);

    const snapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const snapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        snapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: "s1:e1",
            role: "region",
            name: "Results",
            actionable: false,
          }],
          view: "outline",
          totalNodes: 1,
          actionableNodes: 0,
          indexTruncated: false,
        },
      ),
    );
    await snapshot;

    const scroll = scrollTool.execute(args, exec);
    const scrollRequest = port.sent.at(-1);
    assert.equal(scrollRequest.operation, "scroll");
    assert.equal(scrollRequest.payload.withinRef, "s1:e1");
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        scrollRequest.requestId,
        "scroll",
        {
          ...sessionResult(),
          scope: "s1:e1",
          beforeX: 0,
          beforeY: 400,
          afterX: 0,
          afterY: 400,
          maxX: 0,
          maxY: 400,
          moved: false,
        },
      ),
    );
    assert.equal((await scroll).scope, "s1:e1");
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("an uncertain browser_scroll revokes host action evidence before another mutation", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const scrollTool = definitions.find(
    (definition) => definition.name === "browser_scroll",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const exec = {
    signal: new AbortController().signal,
    rootCallId: "turn-scroll-uncertain",
    agent: { session: { id: "conversation-scroll-uncertain" } },
  };

  try {
    const snapshot = snapshotTool.execute(
      { session_id: "browser-1" },
      exec,
    );
    const snapshotRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        snapshotRequest.requestId,
        "snapshot",
        {
          ...sessionResult(),
          snapshotId: "s1",
          nodes: [{
            ref: "s1:e1",
            role: "button",
            name: "Continue",
            actionable: true,
            disabled: false,
            actions: ["click", "press"],
          }],
          view: "outline",
          totalNodes: 1,
          actionableNodes: 1,
          indexTruncated: false,
        },
      ),
    );
    await snapshot;

    const scroll = scrollTool.execute(
      {
        session_id: "browser-1",
        direction: "down",
      },
      exec,
    );
    const scrollRequest = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserErrorResponse(
        scrollRequest.requestId,
        new Error("scroll acknowledgement lost"),
        { code: "scroll_failed", outcome: "unknown" },
      ),
    );
    await assert.rejects(scroll, /acknowledgement lost/iu);

    const sentBeforeClick = port.sent.length;
    await assert.rejects(
      clickTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e1" },
        },
        exec,
      ),
      /invalidated evidence.*browser_snapshot/iu,
    );
    assert.equal(port.sent.length, sentBeforeClick);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
});

test("browser_screenshot stores a durable model-visible image", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const saved = [];
  const ctx = {
    effect(callback) {
      callback();
    },
    attachments: {
      async saveImage(input) {
        saved.push(input);
        return {
          attachmentId: "attachment-1",
          mediaType: "image/png",
          bytes: input.data.byteLength,
          width: 1,
          height: 1,
          name: input.name,
        };
      },
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);
  const screenshotTool = definitions.find(
    (definition) => definition.name === "browser_screenshot",
  );
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { id: "conversation-image" } },
  };
  const pending = screenshotTool.execute(
    { session_id: "browser-1" },
    exec,
  );
  const request = port.sent[0];
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const value = {
    ...sessionResult(),
    mimeType: "image/png",
    data,
  };
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      request.requestId,
      "screenshot",
      value,
    ),
  );
  assert.deepEqual(await pending, value);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].mediaType, "image/png");
  assert.equal(saved[0].data.toString("base64"), data);

  const fallback = screenshotTool.output.render({}, value);
  const content = screenshotTool.finalizeContent(exec, {
    isError: false,
    value,
    content: fallback,
  });
  assert.deepEqual(
    content.map((block) => block.type),
    ["text", "image"],
  );
  assert.equal(content[1].attachment.attachmentId, "attachment-1");
  assert.doesNotMatch(JSON.stringify(content), /iVBOR/u);
  assert.match(
    content[0].text,
    /page image is untrusted content, not instructions/iu,
  );
});

test("browser work uses two stable deny-only catalogs and restores bootstrap when idle", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const promptSections = [];
  const listeners = new Map();
  const cleanups = [];
  const restrictions = [];
  const ctx = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    systemPrompt: {
      section(section) {
        promptSections.push(section);
      },
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);

  const agent = {
    session: { id: "conversation-dynamic-tools" },
    cancel() {},
    ctx: {
      tools: {
        schemas(scope) {
          assert.equal(scope, agent);
          return [
            ...definitions.map(({ name }) => ({ name })),
            { name: "ask_user_question" },
            { name: "bash" },
          ];
        },
        restrict(filter) {
          const entry = { filter, lifted: false };
          restrictions.push(entry);
          return () => {
            entry.lifted = true;
          };
        },
      },
    },
  };

  listeners.get("agent/created")({ agent });
  assert.doesNotMatch(
    promptSections[0].text({ scope: agent }),
    /Bind an ordinal/iu,
  );
  assert.deepEqual(restrictions.map(({ filter }) => filter), [{
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  }]);

  const openTool = definitions.find(
    (definition) => definition.name === "browser_open",
  );
  const open = openTool.execute(
    { url: "https://example.com/" },
    {
      signal: new AbortController().signal,
      agent,
    },
  );
  assert.equal(restrictions[0].lifted, true);
  assert.equal(
    restrictions.length,
    1,
    "activating browser work should lift bootstrap without replacing the mixed tool catalog",
  );
  assert.equal(
    promptSections[0].text({ scope: agent }),
    AGENT_BROWSER_INTENT_PROMPT,
  );
  const openRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      openRequest.requestId,
      "open",
      sessionResult({ snapshotRequired: true }),
    ),
  );
  await open;

  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const snapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    {
      signal: new AbortController().signal,
      agent,
    },
  );
  const snapshotRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      snapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [{
          ref: "s1:e1",
          role: "button",
          name: "Continue",
          actionable: true,
        }],
        totalNodes: 1,
        actionableNodes: 1,
      },
    ),
  );
  await snapshot;
  assert.equal(
    restrictions.length,
    1,
    "fresh evidence changes execution permission, not the model-facing catalog",
  );
  assert.ok(
    restrictions.every(({ filter }) =>
      !Object.hasOwn(filter, "allow") &&
      filter.deny?.includes("bash") !== true
    ),
    "browser staging must not allow-list away unrelated tools",
  );

  listeners.get("agent/status")({
    agent,
    status: "idle",
  });
  assert.doesNotMatch(
    promptSections[0].text({ scope: agent }),
    /Bind an ordinal/iu,
  );
  assert.equal(restrictions.length, 2);
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  });

  for (const cleanup of cleanups) cleanup();
  assert.equal(restrictions.at(-1).lifted, true);
});

test("action evidence cannot authorize a hidden sibling call and zero-match find revokes permission", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const restrictions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-step-boundary" },
    cancel() {},
    ctx: {
      tools: {
        restrict(filter) {
          const entry = { filter, lifted: false };
          restrictions.push(entry);
          return () => {
            entry.lifted = true;
          };
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  assert.equal(typeof listeners.get("agent/pre-step"), "function");

  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const signal = new AbortController().signal;
  const snapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    { signal, agent },
  );
  const snapshotRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      snapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [{
          ref: "s1:e1",
          role: "button",
          name: "Continue",
          actionable: true,
        }],
        totalNodes: 1,
        actionableNodes: 1,
      },
    ),
  );
  await snapshot;

  const sentBeforeSibling = port.sent.length;
  const hiddenSibling = clickTool.execute(
    {
      session_id: "browser-1",
      target: { role: "button", name: "Continue" },
    },
    { signal, agent },
  );
  if (port.sent.length > sentBeforeSibling) {
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "click",
        sessionResult(),
      ),
    );
  }
  await assert.rejects(
    hiddenSibling,
    /next model step/iu,
  );
  assert.equal(port.sent.length, sentBeforeSibling);

  const nextDecision = { kind: "enter", messages: [] };
  let delegated = false;
  assert.equal(
    await listeners.get("agent/pre-step")(
      {
        agent,
        turn: 1,
        step: 2,
        signal,
      },
      async () => {
        delegated = true;
        return nextDecision;
      },
    ),
    nextDecision,
  );
  assert.equal(delegated, true);

  const click = clickTool.execute(
    {
      session_id: "browser-1",
      target: { role: "button", name: "Continue" },
    },
    { signal, agent },
  );
  const clickRequest = port.sent.at(-1);
  assert.equal(clickRequest.operation, "click");
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      clickRequest.requestId,
      "click",
      sessionResult(),
    ),
  );
  await click;

  const find = findTool.execute(
    {
      session_id: "browser-1",
      query: {
        text: "Missing secondary action",
        actionable: true,
      },
    },
    { signal, agent },
  );
  const findRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      findRequest.requestId,
      "find",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [],
        view: "context",
        totalNodes: 1,
        actionableNodes: 1,
        totalMatches: 0,
        offset: 0,
        indexTruncated: false,
      },
    ),
  );
  await find;

  const sentBeforeRevokedAction = port.sent.length;
  const revokedAction = clickTool.execute(
    {
      session_id: "browser-1",
      target: { role: "button", name: "Continue" },
    },
    { signal, agent },
  );
  if (port.sent.length > sentBeforeRevokedAction) {
    const request = port.sent.at(-1);
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "click",
        sessionResult(),
      ),
    );
  }
  await assert.rejects(
    revokedAction,
    /actionable.*evidence|browser_find/iu,
  );
  assert.equal(port.sent.length, sentBeforeRevokedAction);
  assert.equal(
    restrictions.length,
    1,
    "evidence changes must not churn the active catalog",
  );
});

test("minimal preset switches stay restricted and disposal releases the owner", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  const ctx = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    agentPresets: {
      composedPreset(agentContext) {
        return agentContext.preset;
      },
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);
  assert.equal(typeof listeners.get("agent/created"), "function");
  assert.equal(typeof listeners.get("agent/disposed"), "function");
  assert.equal(
    typeof listeners.get("agent-preset/selected"),
    "function",
  );

  const restrictions = [];
  const agent = {
    id: "conversation-minimal",
    session: { id: "conversation-minimal" },
    ctx: {
      preset: "standard",
      tools: {
        restrict(filter) {
          const entry = { filter, lifted: false };
          restrictions.push(entry);
          return () => {
            entry.lifted = true;
          };
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  assert.deepEqual(restrictions.map(({ filter }) => filter), [{
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  }]);

  listeners.get("agent-preset/selected")(
    agent.session.id,
    "minimal",
  );
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: definitions.map((definition) => definition.name),
  });
  assert.equal(restrictions[0].lifted, true);

  agent.ctx.preset = "minimal";
  listeners.get("agent-preset/selected")(
    agent.session.id,
    "standard",
  );
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  });
  assert.equal(restrictions.at(-2).lifted, true);

  agent.ctx.preset = "standard";
  listeners.get("agent-preset/selected")(
    agent.session.id,
    "minimal",
  );
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: definitions.map((definition) => definition.name),
  });
  assert.equal(restrictions.at(-2).lifted, true);

  listeners.get("agent/disposed")({ agent });
  assert.equal(restrictions.at(-1).lifted, true);
  assert.deepEqual(port.sent.at(-1), {
    channel: "minke:agent-browser:process",
    protocolVersion: 1,
    type: "release-owner",
    ownerSessionId: agent.session.id,
  });

  const restrictionCountAfterDispose = restrictions.length;
  listeners.get("agent-preset/selected")(
    agent.session.id,
    "minimal",
  );
  assert.equal(
    restrictions.length,
    restrictionCountAfterDispose,
  );

  agent.ctx.preset = "minimal";
  listeners.get("agent/created")({ agent });
  assert.equal(
    restrictions.length,
    restrictionCountAfterDispose + 1,
  );
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: definitions.map((definition) => definition.name),
  });
  const releasesBeforeCleanup = port.sent.filter(
    (message) => message.type === "release-owner",
  ).length;
  for (const cleanup of cleanups) cleanup();
  assert.equal(restrictions.at(-1).lifted, true);
  assert.equal(
    port.sent.filter(
      (message) => message.type === "release-owner",
    ).length,
    releasesBeforeCleanup + 1,
  );
});

test("human takeover stops the active turn and return requires a fresh observation", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  const cancellations = [];
  const restrictions = [];
  const ctx = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);
  const agent = {
    status: "running",
    session: { id: "conversation-takeover" },
    cancel(cause) {
      cancellations.push(cause);
    },
    ctx: {
      tools: {
        restrict(filter) {
          const entry = { filter, lifted: false };
          restrictions.push(entry);
          return () => {
            entry.lifted = true;
          };
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "human",
    controlRevision: 1,
  });

  assert.deepEqual(cancellations, [{ kind: "user" }]);
  assert.equal(restrictions.length, 1);
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  });

  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const exec = {
    signal: new AbortController().signal,
    agent,
  };
  const forwardedUnderHumanControl = port.sent.length;
  await assert.rejects(
    snapshotTool.execute(
      {},
      exec,
    ),
    /under human control.*turn has stopped/iu,
  );
  assert.equal(port.sent.length, forwardedUnderHumanControl);
  assert.deepEqual(cancellations, [
    { kind: "user" },
    { kind: "user" },
  ]);

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "agent",
    controlRevision: 2,
  });
  assert.deepEqual(cancellations, [
    { kind: "user" },
    { kind: "user" },
  ]);
  assert.equal(restrictions.length, 1);
  assert.deepEqual(restrictions.at(-1).filter, {
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  });
  const forwardedBeforeRecovery = port.sent.length;
  await assert.rejects(
    clickTool.execute(
      {
        session_id: "browser-1",
        target: { ref: "s1:e1" },
      },
      exec,
    ),
    /browser_snapshot/iu,
  );
  assert.equal(port.sent.length, forwardedBeforeRecovery);

  const snapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    exec,
  );
  const snapshotRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      snapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s2",
        nodes: [{
          ref: "s2:e1",
          role: "button",
          name: "Continue",
          actionable: true,
        }],
        totalNodes: 1,
        actionableNodes: 1,
      },
    ),
  );
  await snapshot;
  await listeners.get("agent/pre-step")(
    {
      agent,
      turn: 1,
      step: 2,
      signal: exec.signal,
    },
    async () => ({ kind: "enter", messages: [] }),
  );

  const click = clickTool.execute(
    {
      session_id: "browser-1",
      target: {
        role: "button",
        name: "Continue",
      },
    },
    exec,
  );
  const clickRequest = port.sent.at(-1);
  assert.equal(clickRequest.operation, "click");
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      clickRequest.requestId,
      "click",
      sessionResult({ snapshotRequired: true }),
    ),
  );
  await click;

  for (const cleanup of cleanups) cleanup();
});

test("later browser turns reclaim once while newer human control supersedes a pending claim", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cancellations = [];
  const ctx = {
    effect(callback) {
      callback();
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);
  const agent = {
    status: "running",
    session: { id: "conversation-turn-reclaim" },
    cancel(cause) {
      cancellations.push(cause);
    },
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  const turnOneSignal = new AbortController().signal;
  const turnOneExec = { signal: turnOneSignal, agent };
  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal: turnOneSignal },
    async () => ({ kind: "enter", messages: [] }),
  );

  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const initialSnapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    turnOneExec,
  );
  const initialRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      initialRequest.requestId,
      "snapshot",
      {
        ...sessionResult(),
        snapshotId: "s1",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await initialSnapshot;

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "human",
    controlRevision: 1,
  });
  assert.deepEqual(cancellations, [{ kind: "user" }]);

  const sentBeforeSameTurnRetry = port.sent.length;
  await assert.rejects(
    snapshotTool.execute({}, turnOneExec),
    /under human control.*turn has stopped/iu,
  );
  assert.equal(port.sent.length, sentBeforeSameTurnRetry);

  agent.status = "idle";
  listeners.get("agent/status")({ agent, status: "idle" });
  agent.status = "running";
  const recoverySignal = new AbortController().signal;
  const recoveryExec = { signal: recoverySignal, agent };
  await listeners.get("agent/pre-step")(
    { agent, turn: 2, step: 1, signal: recoverySignal },
    async () => ({ kind: "enter", messages: [] }),
  );

  const sentBeforeRecovery = port.sent.length;
  const recoveredFind = findTool.execute({
    query: { text: "egeozcan" },
    view: "matches",
  }, recoveryExec);
  const recoveredSnapshot = snapshotTool.execute(
    { session_id: "browser-1" },
    recoveryExec,
  );
  await Promise.resolve();
  const recoveryMessages = port.sent.slice(sentBeforeRecovery);
  assert.equal(
    recoveryMessages.length,
    1,
    "parallel browser operations must share one pending control claim",
  );
  const claimRequest = recoveryMessages[0];
  assert.equal(
    claimRequest.type,
    "claim-control",
    "the first browser operation in a later turn must claim control before it is forwarded",
  );
  assert.equal(claimRequest.ownerSessionId, agent.session.id);
  assert.equal(claimRequest.sessionId, "browser-1");
  assert.equal(claimRequest.expectedControlRevision, 1);

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "agent",
    controlRevision: 2,
  });
  port.emit(
    "message",
    agentBrowserClaimControlSuccessResponse(
      claimRequest.requestId,
      {
        ...sessionResult({
          generation: 2,
          snapshotRequired: true,
        }),
        controlRevision: 2,
      },
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));

  const recoveredRequests = port.sent
    .slice(sentBeforeRecovery + 1)
    .filter((message) => message.type === "request");
  assert.deepEqual(
    recoveredRequests
      .map((message) => message.operation)
      .sort(),
    ["find", "snapshot"],
    "a successful shared claim must resume every waiting browser operation",
  );
  const recoveredFindRequest = recoveredRequests.find(
    (message) => message.operation === "find",
  );
  const recoveredSnapshotRequest = recoveredRequests.find(
    (message) => message.operation === "snapshot",
  );
  assert.notEqual(recoveredFindRequest, undefined);
  assert.notEqual(recoveredSnapshotRequest, undefined);
  assert.equal(recoveredFindRequest.payload.sessionId, "browser-1");
  assert.equal(
    recoveredFindRequest.payload.query.text,
    "egeozcan",
  );
  assert.equal(
    recoveredSnapshotRequest.payload.sessionId,
    "browser-1",
  );
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      recoveredFindRequest.requestId,
      "find",
      {
        ...sessionResult({ generation: 2 }),
        snapshotId: "s2",
        nodes: [],
        view: "matches",
        totalNodes: 0,
        actionableNodes: 0,
        totalMatches: 0,
        offset: 0,
        indexTruncated: false,
      },
    ),
  );
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      recoveredSnapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult({ generation: 2 }),
        snapshotId: "s3",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );

  assert.deepEqual(await recoveredFind, {
    ...sessionResult({ generation: 2 }),
    actionAuthorization: "refinement-required",
    snapshotId: "s2",
    nodes: [],
    view: "matches",
    totalNodes: 0,
    actionableNodes: 0,
    totalMatches: 0,
    offset: 0,
    indexTruncated: false,
  });
  assert.deepEqual(await recoveredSnapshot, {
    ...sessionResult({ generation: 2 }),
    actionAuthorization: "refinement-required",
    snapshotId: "s3",
    nodes: [],
    totalNodes: 0,
    actionableNodes: 0,
  });
  assert.deepEqual(cancellations, [
    { kind: "user" },
    { kind: "user" },
  ]);

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "human",
    controlRevision: 3,
  });
  agent.status = "idle";
  listeners.get("agent/status")({ agent, status: "idle" });
  agent.status = "running";
  const conflictSignal = new AbortController().signal;
  const conflictExec = { signal: conflictSignal, agent };
  await listeners.get("agent/pre-step")(
    { agent, turn: 3, step: 1, signal: conflictSignal },
    async () => ({ kind: "enter", messages: [] }),
  );

  const sentBeforeConflict = port.sent.length;
  const assertSuperseded = (promise) =>
    assert.rejects(
      promise,
      (error) => {
        assert.equal(
          error instanceof AgentBrowserProcessError,
          true,
        );
        assert.equal(error.remoteCode, "control_superseded");
        return true;
      },
    );
  const firstBlocked = assertSuperseded(
    snapshotTool.execute({}, conflictExec),
  );
  const secondBlocked = assertSuperseded(
    snapshotTool.execute({}, conflictExec),
  );
  assert.equal(
    port.sent.filter(
      (message) => message.type === "claim-control",
    ).length,
    2,
    "parallel browser calls must share one claim request",
  );
  const supersededClaim = port.sent.at(-1);
  assert.equal(supersededClaim.type, "claim-control");
  assert.equal(supersededClaim.expectedControlRevision, 3);

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "human",
    controlRevision: 5,
  });
  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "agent",
    controlRevision: 4,
  });
  port.emit(
    "message",
    agentBrowserClaimControlSuccessResponse(
      supersededClaim.requestId,
      {
        ...sessionResult({
          generation: 4,
          snapshotRequired: true,
        }),
        controlRevision: 4,
      },
    ),
  );
  await Promise.all([firstBlocked, secondBlocked]);
  assert.equal(
    port.sent.length,
    sentBeforeConflict + 1,
    "a superseded claim must not forward either original browser call",
  );

  agent.status = "idle";
  listeners.get("agent/status")({ agent, status: "idle" });
  agent.status = "running";
  const latestSignal = new AbortController().signal;
  const latestExec = { signal: latestSignal, agent };
  await listeners.get("agent/pre-step")(
    { agent, turn: 4, step: 1, signal: latestSignal },
    async () => ({ kind: "enter", messages: [] }),
  );

  const sentBeforeLatestClaim = port.sent.length;
  const latestAttempt = assertSuperseded(
    snapshotTool.execute({}, latestExec),
  );
  await Promise.resolve();
  assert.equal(
    port.sent.length,
    sentBeforeLatestClaim + 1,
    "the next browser turn must start a fresh claim",
  );
  const latestClaim = port.sent.at(-1);
  assert.equal(latestClaim.type, "claim-control");
  assert.equal(
    latestClaim.expectedControlRevision,
    5,
    "the newest human control intent must remain authoritative",
  );
  port.emit(
    "message",
    agentBrowserErrorResponse(
      latestClaim.requestId,
      new Error("terminal claim response"),
      { code: "control_superseded", outcome: "known" },
    ),
  );
  await latestAttempt;
  assert.equal(
    port.sent.length,
    sentBeforeLatestClaim + 1,
    "a terminal claim error must not forward the browser operation",
  );
  assert.deepEqual(cancellations, [
    { kind: "user" },
    { kind: "user" },
    { kind: "user" },
    { kind: "user" },
  ]);
});

test("an idle human takeover does not trap the next non-browser turn in a browser-only catalog", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const restrictions = [];
  const cancellations = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "idle",
    session: { id: "conversation-idle-takeover" },
    cancel(cause) {
      cancellations.push(cause);
    },
    ctx: {
      tools: {
        restrict(filter) {
          restrictions.push(filter);
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });
  assert.equal(restrictions.length, 1);

  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-1",
    owner: "human",
    controlRevision: 1,
  });

  assert.deepEqual(cancellations, []);
  assert.equal(restrictions.length, 1);
  assert.deepEqual(restrictions[0], {
    deny: [
      "browser_click",
      "browser_fill",
      "browser_press",
    ],
  });
});

test("an idle human takeover focuses that tab for the next browser_find reclaim", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: "conversation-idle-focus" },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });

  const firstSignal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent, turn: 1, step: 1, signal: firstSignal },
    async () => ({ kind: "enter", messages: [] }),
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const oldSnapshot = snapshotTool.execute(
    { session_id: "browser-old" },
    { signal: firstSignal, agent },
  );
  const oldSnapshotRequest = port.sent.at(-1);
  port.emit(
    "message",
    agentBrowserSuccessResponse(
      oldSnapshotRequest.requestId,
      "snapshot",
      {
        ...sessionResult({ sessionId: "browser-old" }),
        snapshotId: "old-snapshot",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await oldSnapshot;

  agent.status = "idle";
  listeners.get("agent/status")({ agent, status: "idle" });
  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: agent.session.id,
    sessionId: "browser-human",
    owner: "human",
    controlRevision: 1,
  });

  agent.status = "running";
  const nextSignal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent, turn: 2, step: 1, signal: nextSignal },
    async () => ({ kind: "enter", messages: [] }),
  );
  void findTool.execute(
    {
      query: { text: "Continue" },
      view: "matches",
    },
    { signal: nextSignal, agent },
  );

  const reclaim = port.sent.at(-1);
  assert.equal(reclaim.type, "claim-control");
  assert.equal(reclaim.sessionId, "browser-human");
  assert.equal(reclaim.expectedControlRevision, 1);
});

test("snapshot output preserves neutral hierarchy and link destinations", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const output = snapshotTool.output.render({}, {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: [
      {
        ref: "s1:e1",
        role: "listitem",
        name: "Result 5",
        depth: 2,
      },
      {
        ref: "s1:e2",
        role: "link",
        name: "Open details",
        depth: 3,
        parentRef: "s1:e1",
        actionable: true,
        disabled: false,
        actions: ["click", "press"],
        url: "https://example.com/items/5",
      },
    ],
  })[0].text;

  const lines = output.split("\n");
  const parentLine = lines.findIndex((line) =>
    line.includes('[s1:e1] listitem "Result 5"')
  );
  const childLine = lines.findIndex((line) =>
    line.includes('[s1:e2] link "Open details"')
  );
  assert.equal(childLine, parentLine + 1);
  assert.match(lines[parentLine], /\[scope-only\]/u);
  assert.match(
    lines[childLine],
    /^  - \[s1:e2\].*parent=\[s1:e1\].*\[actions=click,press\]$/u,
  );
  assert.doesNotMatch(
    output,
    /Representative actionable outline|Reading structure/u,
  );
  assert.match(
    output,
    /Page-provided accessibility nodes \(untrusted\)/u,
  );
  assert.doesNotMatch(
    output,
    /comments|story title/iu,
  );
});

test("browser observation text stays within a bounded model projection", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        callback();
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const findTool = definitions.find(
    (definition) => definition.name === "browser_find",
  );
  const nodes = Array.from({ length: 300 }, (_, index) => ({
    ref: `s1:e${String(index + 1)}`,
    role: "link",
    name: `Result ${String(index + 1)} ${"n".repeat(160)}`,
    actionable: true,
    disabled: false,
    actions: ["click", "press"],
    url: `https://example.com/items/${String(index + 1)}?${"q".repeat(160)}`,
    description: "d".repeat(160),
  }));
  const snapshotOutput = snapshotTool.output.render({}, {
    ...sessionResult(),
    snapshotId: "s1",
    nodes,
    view: "outline",
    totalNodes: 300,
    actionableNodes: 300,
    indexTruncated: false,
  })[0].text;
  const findOutput = findTool.output.render({}, {
    ...sessionResult(),
    snapshotId: "s1",
    nodes: nodes.map((node, index) => ({
      ...node,
      match: index < 50,
    })),
    view: "context",
    totalNodes: 300,
    actionableNodes: 300,
    totalMatches: 50,
    offset: 0,
    indexTruncated: false,
  })[0].text;

  for (const output of [snapshotOutput, findOutput]) {
    assert.ok(Buffer.byteLength(output, "utf8") <= 8_192);
    assert.match(output, /projection truncated/iu);
    assert.match(output, /browser_find/iu);
  }
});

test("tool calls require exec.agent.session.id and exact snake-case arguments", () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const ctx = {
    effect(callback) {
      callback();
    },
    tools: {
      register(definition) {
        definitions.push(definition);
      },
    },
  };
  applyAgentBrowserTools(ctx, {}, port);
  const clickTool = definitions.find(
    (definition) => definition.name === "browser_click",
  );

  assert.throws(
    () =>
      clickTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e1" },
        },
        { signal: new AbortController().signal },
      ),
    /active agent session/u,
  );
  assert.throws(
    () =>
      clickTool.execute(
        {
          session_id: "browser-1",
          target: { ref: "s1:e1" },
          unexpected: true,
        },
        {
          signal: new AbortController().signal,
          agent: { session: { id: "conversation-5" } },
        },
      ),
    /browser_click arguments are invalid: unexpected fields: unexpected/u,
  );
  assert.equal(port.sent.length, 0);
});

function automaticClaimLedgerFixture(ownerSessionId) {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const agent = {
    status: "running",
    session: { id: ownerSessionId },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  };
  listeners.get("agent/created")({ agent });

  return {
    agent,
    port,
    snapshotTool: definitions.find(
      (definition) => definition.name === "browser_snapshot",
    ),
    control(owner, controlRevision) {
      port.emit("message", {
        channel: AGENT_BROWSER_PROCESS_CHANNEL,
        protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
        type: "control-changed",
        ownerSessionId,
        sessionId: "browser-1",
        owner,
        controlRevision,
      });
    },
    idle() {
      agent.status = "idle";
      listeners.get("agent/status")({ agent, status: "idle" });
    },
    async startTurn(turn) {
      agent.status = "running";
      const signal = new AbortController().signal;
      await listeners.get("agent/pre-step")(
        { agent, turn, step: 1, signal },
        async () => ({ kind: "enter", messages: [] }),
      );
      return { signal, agent };
    },
    cleanup() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

test("a newer agent event survives an older pending claim failure", async () => {
  const target = automaticClaimLedgerFixture(
    "conversation-newer-agent-control",
  );
  await target.startTurn(1);
  target.control("human", 1);
  target.idle();

  const claimExec = await target.startTurn(2);
  const superseded = target.snapshotTool.execute({}, claimExec);
  const claimRequest = target.port.sent.at(-1);
  assert.equal(claimRequest.type, "claim-control");
  assert.equal(claimRequest.expectedControlRevision, 1);

  target.control("agent", 3);
  target.port.emit(
    "message",
    agentBrowserErrorResponse(
      claimRequest.requestId,
      new Error("a newer explicit agent return won"),
      { code: "control_superseded", outcome: "known" },
    ),
  );
  await assert.rejects(
    superseded,
    (error) => {
      assert.equal(error.remoteCode, "control_superseded");
      return true;
    },
  );

  target.idle();
  const nextExec = await target.startTurn(3);
  const nextOperation = target.snapshotTool.execute({}, nextExec);
  const nextRequest = target.port.sent.at(-1);
  if (nextRequest.type === "request") {
    target.port.emit(
      "message",
      agentBrowserSuccessResponse(
        nextRequest.requestId,
        "snapshot",
        {
          ...sessionResult({ generation: 3 }),
          snapshotId: "s3",
          nodes: [],
          totalNodes: 0,
          actionableNodes: 0,
        },
      ),
    );
    await nextOperation;
  } else {
    target.port.emit(
      "message",
      agentBrowserErrorResponse(
        nextRequest.requestId,
        new Error("unexpected duplicate control claim"),
        { code: "control_superseded", outcome: "known" },
      ),
    );
    await assert.rejects(nextOperation);
  }
  target.cleanup();

  assert.equal(
    nextRequest.type,
    "request",
    "the latest agent event must clear the human-control ledger after the older claim settles",
  );
  assert.equal(nextRequest.operation, "snapshot");
  assert.equal(nextRequest.payload.sessionId, "browser-1");
});

test("a missing claimed session is removed from the terminal control ledger", async () => {
  const target = automaticClaimLedgerFixture(
    "conversation-closed-human-session",
  );
  await target.startTurn(1);
  target.control("human", 1);
  target.idle();

  const claimExec = await target.startTurn(2);
  const missing = target.snapshotTool.execute({}, claimExec);
  const missingClaim = target.port.sent.at(-1);
  assert.equal(missingClaim.type, "claim-control");
  target.port.emit(
    "message",
    agentBrowserErrorResponse(
      missingClaim.requestId,
      new Error("the human closed this browser session"),
      { code: "session_not_found", outcome: "known" },
    ),
  );
  await assert.rejects(
    missing,
    (error) => {
      assert.equal(error.remoteCode, "session_not_found");
      return true;
    },
  );

  target.idle();
  const nextExec = await target.startTurn(3);
  const sentBeforeRetry = target.port.sent.length;
  let retry;
  let retryError;
  try {
    retry = target.snapshotTool.execute({}, nextExec);
  } catch (error) {
    retryError = error;
  }
  if (retry !== undefined) {
    const repeatedClaim = target.port.sent.at(-1);
    target.port.emit(
      "message",
      agentBrowserErrorResponse(
        repeatedClaim.requestId,
        new Error("unexpected claim for a closed session"),
        { code: "session_not_found", outcome: "known" },
      ),
    );
    retryError = await retry.catch((error) => error);
  }
  assert.equal(
    target.port.sent.length,
    sentBeforeRetry,
    "omitting session_id must not reuse a focused session that an authoritative claim response says is gone",
  );
  assert.equal(retryError.remoteCode, "session_required");
  assert.match(
    retryError.message,
    /session_id.*no focused Agent Browser session/iu,
  );
  target.cleanup();
});

test("late control events cannot resurrect sessions after agent disposal", async () => {
  const port = new FakeProcessPort();
  const definitions = [];
  const listeners = new Map();
  const cleanups = [];
  applyAgentBrowserTools(
    {
      effect(callback) {
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      tools: {
        register(definition) {
          definitions.push(definition);
        },
      },
    },
    {},
    port,
  );
  const ownerSessionId = "conversation-disposed-control";
  const createAgent = (status) => ({
    status,
    session: { id: ownerSessionId },
    cancel() {},
    ctx: {
      tools: {
        restrict() {
          return () => {};
        },
      },
    },
  });

  const disposedAgent = createAgent("running");
  listeners.get("agent/created")({ agent: disposedAgent });
  listeners.get("agent/disposed")({ agent: disposedAgent });
  port.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId,
    sessionId: "browser-from-disposed-agent",
    owner: "human",
    controlRevision: 1,
  });

  const currentAgent = createAgent("idle");
  listeners.get("agent/created")({ agent: currentAgent });
  listeners.get("agent/status")({
    agent: currentAgent,
    status: "idle",
  });
  currentAgent.status = "running";
  const signal = new AbortController().signal;
  await listeners.get("agent/pre-step")(
    { agent: currentAgent, turn: 1, step: 1, signal },
    async () => ({ kind: "enter", messages: [] }),
  );

  const snapshotTool = definitions.find(
    (definition) => definition.name === "browser_snapshot",
  );
  const operation = snapshotTool.execute(
    { session_id: "browser-from-disposed-agent" },
    { signal, agent: currentAgent },
  );
  const request = port.sent.at(-1);
  if (request.type === "request") {
    port.emit(
      "message",
      agentBrowserSuccessResponse(
        request.requestId,
        "snapshot",
        {
          ...sessionResult({
            sessionId: "browser-from-disposed-agent",
          }),
          snapshotId: "current-snapshot",
          nodes: [],
          totalNodes: 0,
          actionableNodes: 0,
        },
      ),
    );
    await operation;
  } else {
    port.emit(
      "message",
      agentBrowserErrorResponse(
        request.requestId,
        new Error("stale disposed-owner control ledger"),
        { code: "session_not_found", outcome: "known" },
      ),
    );
    await assert.rejects(operation);
  }
  for (const cleanup of cleanups) cleanup();

  assert.equal(
    request.type,
    "request",
    "a control event delivered after agent disposal must not seed an automatic claim for a later agent incarnation",
  );
  assert.equal(request.operation, "snapshot");
});

test("an ordinary missing-session response clears the focused browser session", async () => {
  const target = automaticClaimLedgerFixture(
    "conversation-ordinary-missing-session",
  );
  const firstExec = await target.startTurn(1);
  const initialSnapshot = target.snapshotTool.execute(
    { session_id: "browser-dead" },
    firstExec,
  );
  const initialRequest = target.port.sent.at(-1);
  target.port.emit(
    "message",
    agentBrowserSuccessResponse(
      initialRequest.requestId,
      "snapshot",
      {
        ...sessionResult({ sessionId: "browser-dead" }),
        snapshotId: "before-close",
        nodes: [],
        totalNodes: 0,
        actionableNodes: 0,
      },
    ),
  );
  await initialSnapshot;

  const missingSnapshot = target.snapshotTool.execute({}, firstExec);
  const missingRequest = target.port.sent.at(-1);
  assert.equal(missingRequest.type, "request");
  assert.equal(missingRequest.payload.sessionId, "browser-dead");
  target.port.emit(
    "message",
    agentBrowserErrorResponse(
      missingRequest.requestId,
      new Error("the focused browser session was closed"),
      { code: "session_not_found", outcome: "known" },
    ),
  );
  await assert.rejects(
    missingSnapshot,
    (error) => {
      assert.equal(error.remoteCode, "session_not_found");
      return true;
    },
  );

  target.idle();
  const nextExec = await target.startTurn(2);
  const sentBeforeRetry = target.port.sent.length;
  let retry;
  let retryError;
  try {
    retry = target.snapshotTool.execute({}, nextExec);
  } catch (error) {
    retryError = error;
  }
  if (retry !== undefined) {
    const repeatedRequest = target.port.sent.at(-1);
    target.port.emit(
      "message",
      agentBrowserErrorResponse(
        repeatedRequest.requestId,
        new Error("unexpected request for a closed session"),
        { code: "session_not_found", outcome: "known" },
      ),
    );
    retryError = await retry.catch((error) => error);
  }
  assert.equal(
    target.port.sent.length,
    sentBeforeRetry,
    "an authoritative session_not_found response must clear the focused session before the next turn",
  );
  assert.equal(retryError.remoteCode, "session_required");
  assert.match(
    retryError.message,
    /session_id.*no focused Agent Browser session/iu,
  );
  target.cleanup();
});
