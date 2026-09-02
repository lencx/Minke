import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  AGENT_BROWSER_NAVIGATION_CHANNEL,
  AGENT_BROWSER_PROCESS_CHANNEL,
  AGENT_BROWSER_PROTOCOL_VERSION,
  AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
  AGENT_BROWSER_SESSIONS_READ_CHANNEL,
  createAgentBrowserCancelRequest,
  createAgentBrowserClaimControlRequest,
  createAgentBrowserReleaseOwnerRequest,
  createAgentBrowserRequest,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
  AGENT_BROWSER_HISTORY_READ_CHANNEL,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import {
  AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
  AGENT_BROWSER_ANNOTATION_START_CHANNEL,
  AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  AgentBrowserProcessChannel,
  AgentBrowserRuntime,
} from "@minke/desktop/main/agent-browser/index.ts";

async function settleAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

class FakeDebugger extends EventEmitter {
  attached = false;
  autoNavigation = true;
  commands = [];
  failures = new Map();
  blocks = new Map();
  effects = new Map();
  navigationSequence = 0;
  interactionTarget = {
    connected: true,
    directlyInteractive: true,
    nestedInteractive: false,
    disabled: false,
  };
  fillTarget = {
    editable: true,
    disabled: false,
    readOnly: false,
  };
  hitTarget = {
    targetOrDescendant: true,
    tag: "button",
    name: "Continue",
  };
  lastBoxBackendNodeId = 7;
  hitBackendNodeId = undefined;
  generatedLocatorSummary = {
    count: 1,
    truncated: false,
    samples: [{
      tag: "button",
      role: "button",
      name: "Continue",
      text: "Continue",
      href: "",
    }],
  };
  generatedLocatorBackendNodeId = 7;
  axNodes = [
    {
      backendDOMNodeId: 7,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      description: { value: "Continue checkout" },
    },
    {
      backendDOMNodeId: 8,
      ignored: true,
      role: { value: "generic" },
      name: { value: "Ignored" },
    },
  ];
  domSnapshot = {
    documents: [],
    strings: [],
  };
  boxModel = {
    content: [0, 0, 40, 0, 40, 20, 0, 20],
  };
  layoutMetrics = {
    cssVisualViewport: {
      offsetX: 0,
      offsetY: 0,
      clientWidth: 860,
      clientHeight: 863,
    },
  };

  attach(protocolVersion) {
    assert.equal(protocolVersion, "1.3");
    this.attached = true;
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.emit("detach", {}, "target closed");
  }

  isAttached() {
    return this.attached;
  }

  failNext(method, error = new Error(`${method} failed`)) {
    const queued = this.failures.get(method) ?? [];
    queued.push(error);
    this.failures.set(method, queued);
  }

  blockNext(method) {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    const queued = this.blocks.get(method) ?? [];
    queued.push(promise);
    this.blocks.set(method, queued);
    return () => release();
  }

  afterNext(method, effect) {
    const queued = this.effects.get(method) ?? [];
    queued.push(effect);
    this.effects.set(method, queued);
  }

  async sendCommand(method, params = {}) {
    this.commands.push({ method, params });
    const blocks = this.blocks.get(method);
    const block = blocks?.shift();
    if (block !== undefined) await block;
    const failures = this.failures.get(method);
    const failure = failures?.shift();
    if (failure !== undefined) throw failure;
    const effects = this.effects.get(method);
    const effect = effects?.shift();
    if (effect !== undefined) await effect(params);
    switch (method) {
      case "Page.navigate": {
        this.navigationSequence += 1;
        const result = {
          frameId: "main-frame",
          loaderId: `loader-${String(this.navigationSequence)}`,
        };
        if (this.autoNavigation) {
          queueMicrotask(() => {
            this.emit(
              "message",
              {},
              "Page.lifecycleEvent",
              {
                ...result,
                name: "load",
              },
            );
          });
        }
        return result;
      }
      case "Accessibility.getFullAXTree":
        return { nodes: this.axNodes };
      case "DOMSnapshot.captureSnapshot":
        return this.domSnapshot;
      case "Accessibility.getPartialAXTree":
        return {
          nodes: [{
            backendDOMNodeId: params.backendNodeId,
            ignored: false,
            role: { value: "heading" },
            name: { value: "Search result" },
          }],
        };
      case "DOM.describeNode":
        if (params.objectId === "generated-locator-element") {
          return {
            node: {
              backendNodeId: this.generatedLocatorBackendNodeId,
              localName: "button",
              nodeName: "BUTTON",
              attributes: [],
            },
          };
        }
        return {
          node: {
            backendNodeId: params.backendNodeId,
            localName: "h3",
            nodeName: "H3",
            attributes: ["role", "heading"],
          },
        };
      case "DOM.getContentQuads":
        return {
          quads: [[20, 30, 220, 30, 220, 70, 20, 70]],
        };
      case "DOM.getBoxModel":
        this.lastBoxBackendNodeId = params.backendNodeId;
        return {
          model: this.boxModel,
        };
      case "DOM.getNodeForLocation":
        return {
          backendNodeId:
            this.hitBackendNodeId ?? this.lastBoxBackendNodeId,
        };
      case "DOM.resolveNode":
        return { object: { objectId: "element-1" } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 17 };
      case "Page.getFrameTree":
        return {
          frameTree: {
            frame: { id: "main-frame" },
          },
        };
      case "Page.getLayoutMetrics":
        return this.layoutMetrics;
      case "Runtime.evaluate":
        return { result: { objectId: "document-1" } };
      case "Runtime.callFunctionOn":
        if (
          String(params.functionDeclaration).includes(
            "minkeResolveGeneratedLocator",
          )
        ) {
          return {
            result: {
              objectId: "generated-locator-binding",
            },
          };
        }
        if (
          String(params.functionDeclaration).includes(
            "minkeInteractionTarget",
          )
        ) {
          return { result: { value: this.interactionTarget } };
        }
        if (
          String(params.functionDeclaration).includes(
            "minkePrepareFill",
          )
        ) {
          return { result: { value: this.fillTarget } };
        }
        if (
          String(params.functionDeclaration).includes(
            "minkeHitTarget",
          )
        ) {
          return { result: { value: this.hitTarget } };
        }
        if (
          String(params.functionDeclaration).includes(
            "selectorParts",
          )
        ) {
          return {
            result: {
              value: {
                topDocument: true,
                tag: "h3",
                text: "Search result",
                ariaLabel: "",
                role: "heading",
                selector: "main > h3",
                path: "html > body > main > h3",
                viewportWidth: 860,
                viewportHeight: 863,
              },
            },
          };
        }
        return {
          result: {
            value: String(params.functionDeclaration).includes(
              "content.includes",
            ),
          },
        };
      case "Runtime.getProperties":
        if (params.objectId === "generated-locator-binding") {
          return {
            result: [
              {
                name: "count",
                value: {
                  type: "number",
                  value: this.generatedLocatorSummary.count,
                },
              },
              {
                name: "truncated",
                value: {
                  type: "boolean",
                  value: this.generatedLocatorSummary.truncated,
                },
              },
              {
                name: "samplesText",
                value: {
                  type: "string",
                  value: JSON.stringify(
                    this.generatedLocatorSummary.samples,
                  ),
                },
              },
              {
                name: "element",
                value:
                  this.generatedLocatorSummary.count === 1 &&
                    this.generatedLocatorSummary.truncated !== true
                    ? {
                        type: "object",
                        subtype: "node",
                        objectId: "generated-locator-element",
                      }
                    : {
                        type: "object",
                        subtype: "null",
                        value: null,
                      },
              },
            ],
          };
        }
        return { result: [] };
      case "Page.captureScreenshot":
        return { data: "aGVsbG8=" };
      default:
        return {};
    }
  }
}

class FakeSession extends EventEmitter {
  permissionCheckHandler;
  permissionRequestHandler;
  spellCheckerEnabled = true;
  closeConnectionsCalls = 0;
  clearStorageCalls = 0;

  constructor({ persistent = false } = {}) {
    super();
    this.persistent = persistent;
  }

  isPersistent() {
    return this.persistent;
  }

  getStoragePath() {
    return this.persistent ? "/tmp/persistent-agent-browser" : null;
  }

  setPermissionCheckHandler(handler) {
    this.permissionCheckHandler = handler;
  }

  setPermissionRequestHandler(handler) {
    this.permissionRequestHandler = handler;
  }

  setSpellCheckerEnabled(enabled) {
    this.spellCheckerEnabled = enabled;
  }

  async closeAllConnections() {
    this.closeConnectionsCalls += 1;
  }

  async clearStorageData() {
    this.clearStorageCalls += 1;
  }
}

class FakeEmbedder extends EventEmitter {
  destroyed = false;
  messages = [];

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, value) {
    this.messages.push({ channel, value });
  }
}

class FakeGuest extends EventEmitter {
  debugger = new FakeDebugger();
  destroyed = false;
  closed = false;
  url = "about:blank";
  windowOpenHandler;
  navigationCalls = [];
  navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: () => {
      this.navigationCalls.push("back");
    },
    goForward: () => {
      this.navigationCalls.push("forward");
    },
  };

  constructor(session, hostWebContents) {
    super();
    this.session = session;
    this.hostWebContents = hostWebContents;
  }

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return this.destroyed;
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  reload() {
    this.navigationCalls.push("reload");
  }

  stop() {
    this.navigationCalls.push("stop");
  }

  close(options) {
    assert.deepEqual(options, { waitForBeforeUnload: false });
    this.closed = true;
    this.destroyed = true;
  }
}

class FakeIpc extends EventEmitter {
  handlers = new Map();

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(channel, event, ...args) {
    const handler = this.handlers.get(channel);
    assert.notEqual(handler, undefined);
    return await handler(event, ...args);
  }
}

function runtimeFixture(options = {}) {
  let nextToken = 0;
  const sessions = new Map();
  const sessionOptions = new Map();
  const runtime = new AgentBrowserRuntime({
    sessionFromPartition(partition, fromPartitionOptions) {
      const browserSession =
        options.sessionFactory?.(partition) ?? new FakeSession();
      sessions.set(partition, browserSession);
      sessionOptions.set(partition, fromPartitionOptions);
      return browserSession;
    },
    createToken() {
      nextToken += 1;
      return `token${nextToken}`;
    },
    guestAttachTimeoutMs: 250,
    cdpCommandTimeoutMs: options.cdpCommandTimeoutMs ?? 250,
    history: options.history,
  });
  const ipc = new FakeIpc();
  const embedder = new FakeEmbedder();
  const binding = runtime.bindWindowProjection(
    ipc,
    embedder,
    options.authorize ?? (() => true),
  );
  return {
    binding,
    embedder,
    ipc,
    runtime,
    sessionOptions,
    sessions,
  };
}

test("Agent Browser runtime records trusted Web Tab visits as human", () => {
  const visits = [];
  let closed = false;
  const target = runtimeFixture({
    history: {
      recordVisit(visit) {
        visits.push(visit);
      },
      read() {
        throw new Error("not used");
      },
      clear() {
        throw new Error("not used");
      },
      close() {
        closed = true;
      },
    },
  });

  target.runtime.recordHumanNavigation(
    "web:42",
    "https://example.com/recent",
    "document",
  );
  assert.equal(visits.length, 1);
  assert.deepEqual(
    {
      ...visits[0],
      visitedAt: 0,
    },
    {
      sessionId: "web:42",
      url: "https://example.com/recent",
      actor: "human",
      navigationKind: "document",
      visitedAt: 0,
    },
  );
  assert.ok(
    Number.isSafeInteger(visits[0].visitedAt) &&
      visits[0].visitedAt > 0,
  );

  target.binding.dispose();
  target.runtime.dispose();
  assert.equal(closed, true);
});

async function openAgentBrowser(target, requestId = 1) {
  const openPromise = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId,
      "conversation-1",
      "open",
      { url: "https://example.com/start" },
    ),
    new AbortController().signal,
  );
  const projection = target.runtime.projections().at(-1);
  assert.notEqual(projection, undefined);
  const session = target.sessions.get(projection.partition);
  assert.notEqual(session, undefined);
  assert.notEqual(session, undefined);
  const webPreferences = {
    preload: "/tmp/hostile-preload.cjs",
    nodeIntegration: true,
  };
  const params = {
    partition: projection.partition,
    src: "about:blank",
    allowpopups: "yes",
    preload: "/tmp/hostile-preload.cjs",
    webpreferences: "nodeIntegration=yes",
  };
  assert.equal(
    target.runtime.secureWebview(webPreferences, params),
    "secured",
  );
  const guest = new FakeGuest(session, target.embedder);
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );
  const result = await openPromise;
  return {
    guest,
    params,
    projection,
    result,
    session,
    webPreferences,
  };
}

test("runtime admits only its exact temporary blank partition", async () => {
  const target = runtimeFixture();
  const openPromise = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      1,
      "conversation-1",
      "open",
      { url: "https://example.com/" },
    ),
    new AbortController().signal,
  );
  const projection = target.runtime.projections()[0];

  assert.match(projection.partition, /^minke-agent-token1$/u);
  assert.equal(projection.partition.startsWith("persist:"), false);
  assert.deepEqual(
    target.sessionOptions.get(projection.partition),
    { cache: false },
  );

  // Negative control: an Agent Browser-looking prefix is not authority.
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: "minke-agent-forged",
        src: "about:blank",
      },
    ),
    "rejected",
  );
  assert.equal(
    target.runtime.secureWebview(
      {},
      { partition: "persist:ordinary", src: "about:blank" },
    ),
    "unmatched",
  );

  const webPreferences = {
    preload: "/tmp/hostile-preload.cjs",
    nodeIntegration: true,
  };
  const params = {
    partition: projection.partition,
    src: "about:blank",
    allowpopups: "yes",
    preload: "/tmp/hostile-preload.cjs",
    webpreferences: "nodeIntegration=yes",
  };
  assert.equal(
    target.runtime.secureWebview(webPreferences, params),
    "secured",
  );
  assert.equal(params.allowpopups, undefined);
  assert.equal(params.preload, undefined);
  assert.equal(params.webpreferences, undefined);
  assert.equal(webPreferences.preload, undefined);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.webSecurity, true);
  assert.equal(webPreferences.devTools, false);

  // Negative control: the one-time partition claim cannot be replayed.
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "rejected",
  );

  const session = target.sessions.get(projection.partition);
  assert.equal(
    session.permissionCheckHandler(
      null,
      "geolocation",
      "https://example.com",
      {},
    ),
    false,
  );
  let permissionGranted;
  session.permissionRequestHandler(
    null,
    "media",
    (granted) => {
      permissionGranted = granted;
    },
    {},
  );
  assert.equal(permissionGranted, false);
  assert.equal(session.spellCheckerEnabled, false);
  let downloadPrevented = false;
  session.emit("will-download", {
    preventDefault() {
      downloadPrevented = true;
    },
  });
  assert.equal(downloadPrevented, true);

  const guest = new FakeGuest(session, target.embedder);
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );
  const result = await openPromise;
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://example.com/");
  assert.deepEqual(guest.windowOpenHandler({}), {
    action: "deny",
  });

  await target.runtime.closeSession(result.sessionId);
  assert.equal(guest.closed, true);
  assert.equal(session.permissionCheckHandler, null);
  assert.equal(session.permissionRequestHandler, null);
  assert.equal(session.closeConnectionsCalls, 1);
  assert.equal(session.clearStorageCalls, 1);
  const lateGuest = new FakeGuest(session, target.embedder);
  assert.equal(
    target.runtime.attachGuest(target.embedder, lateGuest),
    true,
  );
  assert.equal(lateGuest.closed, true);
  target.binding.dispose();
  target.runtime.dispose();
});

test("CDP refs are generation-scoped and mutation ambiguity is explicit", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.equal(snapshot.nodes.length, 1);
  assert.match(snapshot.nodes[0].ref, /^s\d+:e1$/u);
  assert.equal(snapshot.nodes[0].name, "Continue");
  assert.deepEqual(snapshot.nodes[0].actions, ["click", "press"]);
  const repeatedSnapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      20,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.equal(repeatedSnapshot.snapshotId, snapshot.snapshotId);
  assert.equal(repeatedSnapshot.generation, snapshot.generation);
  assert.deepEqual(repeatedSnapshot.nodes, snapshot.nodes);

  const clickStartedAt = Date.now();
  let clickingPublishedAt;
  const sendProjection = target.embedder.send.bind(
    target.embedder,
  );
  target.embedder.send = (channel, value) => {
    if (
      clickingPublishedAt === undefined &&
      channel === AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL &&
      value.some(
        (projection) =>
          projection.sessionId === opened.result.sessionId &&
          projection.cursor?.phase === "clicking",
      )
    ) {
      clickingPublishedAt = Date.now();
    }
    sendProjection(channel, value);
  };
  opened.guest.debugger.afterNext(
    "Input.dispatchMouseEvent",
    ({ type, x, y }) => {
      assert.equal(type, "mouseMoved");
      assert.equal(x, 20);
      assert.equal(y, 10);
      assert.ok(Date.now() - clickStartedAt >= 150);
      assert.equal(
        target.runtime.projections()[0].cursor?.phase,
        "moving",
      );
    },
  );
  opened.guest.debugger.afterNext(
    "Input.dispatchMouseEvent",
    ({ type }) => {
      assert.equal(type, "mousePressed");
      assert.equal(
        target.runtime.projections()[0].cursor?.phase,
        "clicking",
      );
      assert.notEqual(clickingPublishedAt, undefined);
      assert.ok(Date.now() - clickingPublishedAt >= 45);
    },
  );
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: snapshot.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ).length,
    3,
  );
  assert.deepEqual(target.runtime.projections()[0].cursor, {
    sequence: 2,
    phase: "clicking",
    point: { x: 20, y: 10 },
    viewport: { width: 860, height: 863 },
    durationMs: 180,
  });
  const clickingSequences = target.embedder.messages
    .filter(
      ({ channel }) =>
        channel === AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
    )
    .flatMap(({ value }) => value)
    .filter(
      (projection) =>
        projection.sessionId === opened.result.sessionId &&
        projection.cursor?.phase === "clicking",
    )
    .map((projection) => projection.cursor.sequence);
  assert.deepEqual(clickingSequences, [2]);

  // Negative control: a mutation requires re-observation before another
  // element action, even when the semantic page remains unchanged.
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        4,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: snapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "snapshot_required");
      assert.equal(error.outcome, "known");
      return true;
    },
  );

  const freshSnapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      5,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.equal(freshSnapshot.snapshotId, snapshot.snapshotId);
  assert.equal(freshSnapshot.generation, snapshot.generation);
  assert.deepEqual(freshSnapshot.nodes, snapshot.nodes);
  assert.equal(
    target.runtime.projections()[0].cursor?.phase,
    "clicking",
  );
  opened.guest.debugger.failNext(
    "Input.dispatchMouseEvent",
    new Error("target acknowledgement lost"),
  );
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        6,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: freshSnapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );

  opened.guest.debugger.failNext(
    "Accessibility.getFullAXTree",
    new Error("snapshot unavailable"),
  );
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        7,
        "conversation-1",
        "snapshot",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.outcome, "known");
      return true;
    },
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("CDP rejects a ref invalidated during click preparation before input dispatch", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  opened.guest.debugger.afterNext(
    "DOM.getBoxModel",
    () => {
      opened.guest.debugger.emit(
        "message",
        {},
        "DOM.documentUpdated",
        {},
      );
    },
  );

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: snapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "snapshot_required");
      assert.equal(error.outcome, "known");
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ).length,
    0,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("click rejects a structural container that would hit an interactive descendant", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    backendDOMNodeId: 21,
    ignored: false,
    role: { value: "cell" },
    name: { value: "31 comments" },
  }];
  opened.guest.debugger.interactionTarget = {
    connected: true,
    directlyInteractive: false,
    nestedInteractive: true,
    nestedRole: "link",
    nestedName: "31 comments",
    disabled: false,
  };
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: snapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "element_not_actionable");
      assert.match(error.message, /link "31 comments"/u);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ),
    false,
  );
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        4,
        "conversation-1",
        "press",
        {
          sessionId: opened.result.sessionId,
          key: "Enter",
          target: { ref: snapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "element_not_actionable");
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchKeyEvent",
    ),
    false,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("snapshot removes structural wrappers that duplicate an actionable descendant", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      nodeId: "cell",
      backendDOMNodeId: 21,
      ignored: false,
      role: { value: "LayoutTableCell" },
      name: { value: "Example story [video]" },
    },
    {
      nodeId: "link",
      parentId: "cell",
      backendDOMNodeId: 22,
      ignored: false,
      role: { value: "link" },
      name: { value: "Example story [video]" },
      properties: [{
        name: "url",
        value: { value: "https://video.example/story" },
      }],
    },
    {
      nodeId: "text",
      parentId: "link",
      backendDOMNodeId: 23,
      ignored: false,
      role: { value: "StaticText" },
      name: { value: "Example story [video]" },
    },
  ];

  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(
    snapshot.nodes.map(({ role, name, actionable, url }) => ({
      role,
      name,
      actionable,
      url,
    })),
    [{
      role: "link",
      name: "Example story [video]",
      actionable: true,
      url: "https://video.example/story",
    }],
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("snapshot retains actionable controls after the structural-node budget is exhausted", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    ...Array.from({ length: 300 }, (_, index) => ({
      nodeId: `structural-${String(index + 1)}`,
      backendDOMNodeId: 1_000 + index,
      ignored: false,
      role: { value: "StaticText" },
      name: { value: `Reading content ${String(index + 1)}` },
    })),
    {
      nodeId: "late-comments-link",
      backendDOMNodeId: 2_000,
      ignored: false,
      role: { value: "link" },
      name: { value: "49 comments" },
      properties: [{
        name: "url",
        value: { value: "https://example.com/item?id=9" },
      }],
    },
  ];

  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );

  assert.equal(snapshot.nodes.length, 300);
  assert.deepEqual(
    snapshot.nodes.find((node) => node.name === "49 comments"),
    {
      ref: "s2:e301",
      role: "link",
      name: "49 comments",
      depth: 0,
      actionable: true,
      disabled: false,
      actions: ["click", "press"],
      url: "https://example.com/item?id=9",
    },
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("find magnifies the complete page index with local context and pagination", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      nodeId: "root",
      backendDOMNodeId: 3_000,
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Large page" },
    },
    ...Array.from({ length: 305 }, (_, index) => ({
      nodeId: `reading-${String(index + 1)}`,
      parentId: "root",
      backendDOMNodeId: 3_001 + index,
      ignored: false,
      role: { value: "StaticText" },
      name: { value: `Reading content ${String(index + 1)}` },
    })),
    {
      nodeId: "item",
      parentId: "root",
      backendDOMNodeId: 4_000,
      ignored: false,
      role: { value: "listitem" },
      name: { value: "Target item" },
    },
    {
      nodeId: "title",
      parentId: "item",
      backendDOMNodeId: 4_001,
      ignored: false,
      role: { value: "link" },
      name: { value: "Needle title" },
      properties: [{
        name: "url",
        value: { value: "https://example.com/article" },
      }],
    },
    {
      nodeId: "metadata",
      parentId: "item",
      backendDOMNodeId: 4_002,
      ignored: false,
      role: { value: "StaticText" },
      name: { value: "42 points" },
    },
    {
      nodeId: "secondary-action",
      parentId: "item",
      backendDOMNodeId: 4_003,
      ignored: false,
      role: { value: "link" },
      name: { value: "49 responses" },
      properties: [{
        name: "url",
        value: { value: "https://example.com/item?id=9" },
      }],
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      nodeId: `open-${String(index + 1)}`,
      parentId: "root",
      backendDOMNodeId: 4_010 + index,
      ignored: false,
      role: { value: "link" },
      name: { value: "Open" },
    })),
  ];

  const find = async (requestId, payload) =>
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId,
        "conversation-1",
        "find",
        {
          sessionId: opened.result.sessionId,
          ...payload,
        },
      ),
      new AbortController().signal,
    );

  const local = await find(2, {
    query: {
      text: "Needle title",
      exact: false,
    },
    view: "context",
    depth: 1,
    limit: 20,
  });
  assert.equal(local.totalNodes, 313);
  assert.equal(local.totalMatches, 1);
  const localNames = local.nodes.map((node) => node.name);
  for (const expected of [
    "Target item",
    "Needle title",
    "42 points",
    "49 responses",
  ]) {
    assert.equal(localNames.includes(expected), true);
  }
  assert.equal(
    local.nodes.find((node) => node.name === "49 responses")
      ?.actionable,
    true,
  );
  assert.equal(
    local.nodes.find((node) => node.name === "Needle title")
      ?.match,
    true,
  );
  assert.equal(
    local.nodes.find((node) => node.name === "49 responses")
      ?.match,
    undefined,
  );

  const absent = await find(3, {
    query: {
      text: "Does not exist",
      exact: false,
    },
    view: "context",
    depth: 2,
    limit: 20,
  });
  assert.equal(absent.totalMatches, 0);
  assert.deepEqual(absent.nodes, []);

  const firstPage = await find(4, {
    query: {
      role: "link",
      name: "Open",
      exact: true,
    },
    view: "matches",
    depth: 0,
    limit: 2,
  });
  assert.equal(firstPage.totalMatches, 3);
  assert.equal(firstPage.nodes.length, 2);
  assert.equal(
    firstPage.nodes.every((node) => node.match === true),
    true,
  );
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondPage = await find(5, {
    cursor: firstPage.nextCursor,
  });
  assert.equal(secondPage.offset, 2);
  assert.equal(secondPage.nodes.length, 1);
  assert.equal(secondPage.nextCursor, undefined);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("find selects one repeated item by ordinal before resolving its nested action", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const repeatedItems = Array.from(
    { length: 10 },
    (_, index) => {
      const ordinal = index + 1;
      const itemBackendNodeId = 5_000 + index * 10;
      return [
        {
          nodeId: `item-${String(ordinal)}`,
          parentId: "results",
          backendDOMNodeId: itemBackendNodeId,
          ignored: false,
          role: { value: "listitem" },
          name: { value: `Item ${String(ordinal)}` },
        },
        {
          nodeId: `title-${String(ordinal)}`,
          parentId: `item-${String(ordinal)}`,
          backendDOMNodeId: itemBackendNodeId + 1,
          ignored: false,
          role: { value: "link" },
          name: { value: `Item ${String(ordinal)} title` },
          properties: [{
            name: "url",
            value: {
              value: `https://example.com/items/${
                String(ordinal)
              }`,
            },
          }],
        },
        ...(ordinal === 3
          ? []
          : [{
              nodeId: `details-${String(ordinal)}`,
              parentId: `item-${String(ordinal)}`,
              backendDOMNodeId: itemBackendNodeId + 2,
              ignored: false,
              role: { value: "link" },
              name: { value: "Inspect details" },
              properties: [{
                name: "url",
                value: {
                  value: `https://example.com/items/${
                    String(ordinal)
                  }/details`,
                },
              }],
            }]),
      ];
    },
  ).flat();
  opened.guest.debugger.axNodes = [
    {
      nodeId: "root",
      backendDOMNodeId: 4_000,
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Repeated results" },
    },
    {
      nodeId: "decoy-before",
      parentId: "root",
      backendDOMNodeId: 4_001,
      ignored: false,
      role: { value: "link" },
      name: { value: "Inspect details" },
    },
    {
      nodeId: "results",
      parentId: "root",
      backendDOMNodeId: 4_010,
      ignored: false,
      role: { value: "list" },
      name: { value: "Results" },
    },
    ...repeatedItems,
    {
      nodeId: "decoy-after",
      parentId: "root",
      backendDOMNodeId: 4_002,
      ignored: false,
      role: { value: "link" },
      name: { value: "Inspect details" },
    },
  ];

  const find = async (requestId, payload) =>
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId,
        "conversation-1",
        "find",
        {
          sessionId: opened.result.sessionId,
          ...payload,
        },
      ),
      new AbortController().signal,
    );

  const eighth = await find(2, {
    query: {
      role: "listitem",
      exact: true,
      index: 7,
    },
    view: "subtree",
    depth: 1,
    limit: 20,
  });
  assert.equal(eighth.totalMatches, 10);
  assert.equal(eighth.offset, 7);
  assert.equal(eighth.nextCursor, undefined);
  assert.deepEqual(
    eighth.nodes.map((node) => ({
      name: node.name,
      match: node.match,
    })),
    [
      { name: "Item 8", match: true },
      { name: "Item 8 title", match: undefined },
      { name: "Inspect details", match: undefined },
    ],
  );
  const eighthItem = eighth.nodes.find(
    (node) => node.match === true,
  );
  assert.notEqual(eighthItem, undefined);
  assert.equal(eighthItem.actionable, false);

  const details = await find(3, {
    query: {
      withinRef: eighthItem.ref,
      role: "link",
      name: "Inspect details",
      exact: true,
    },
    view: "matches",
    depth: 0,
    limit: 20,
  });
  assert.equal(details.totalMatches, 1);
  assert.equal(details.nodes.length, 1);
  assert.equal(details.nodes[0].match, true);

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      4,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: details.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.lastBoxBackendNodeId,
    5_072,
  );

  const outOfRange = await find(5, {
    query: {
      role: "listitem",
      exact: true,
      index: 10,
    },
    view: "subtree",
    depth: 1,
    limit: 20,
  });
  assert.deepEqual(outOfRange.nodes, []);
  assert.equal(outOfRange.totalMatches, 10);
  assert.equal(outOfRange.offset, 10);
  assert.equal(outOfRange.nextCursor, undefined);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("find ordinal fails closed when the complete page index is truncated", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      nodeId: "root",
      backendDOMNodeId: 60_000,
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Oversized page" },
    },
    ...Array.from({ length: 50_000 }, (_, index) => ({
      nodeId: `reading-${String(index + 1)}`,
      parentId: "root",
      backendDOMNodeId: 60_001 + index,
      ignored: false,
      role: { value: "StaticText" },
      name: { value: `Reading ${String(index + 1)}` },
    })),
  ];

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        2,
        "conversation-1",
        "find",
        {
          sessionId: opened.result.sessionId,
          query: {
            role: "StaticText",
            exact: true,
            index: 7,
          },
          view: "matches",
          depth: 0,
          limit: 20,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "index_truncated");
      assert.match(error.message, /truncated.*page index/iu);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ),
    false,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("DOM evidence upgrades a nonstandard interactive element without bypassing click verification", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    nodeId: "custom-save",
    backendDOMNodeId: 901,
    ignored: false,
    role: { value: "generic" },
    name: { value: "Save custom" },
  }];
  opened.guest.debugger.domSnapshot = {
    strings: [
      "#document",
      "",
      "DIV",
      "#text",
      "onclick",
      "save()",
      "Save custom",
    ],
    documents: [{
      nodes: {
        parentIndex: [-1, 0, 1],
        nodeType: [9, 1, 3],
        nodeName: [0, 2, 3],
        nodeValue: [1, 1, 6],
        backendNodeId: [900, 901, 902],
        attributes: [[], [4, 5], []],
      },
    }],
  };

  const found = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "find",
      {
        sessionId: opened.result.sessionId,
        query: {
          name: "Save custom",
          actionable: true,
          exact: true,
        },
        view: "matches",
        depth: 0,
        limit: 20,
      },
    ),
    new AbortController().signal,
  );
  assert.equal(found.totalMatches, 1);
  assert.deepEqual(
    {
      role: found.nodes[0].role,
      actionable: found.nodes[0].actionable,
      source: found.nodes[0].source,
      confidence: found.nodes[0].confidence,
    },
    {
      role: "button",
      actionable: true,
      source: "accessibility+dom",
      confidence: "medium",
    },
  );

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: found.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(opened.guest.debugger.lastBoxBackendNodeId, 901);
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "DOM.getNodeForLocation",
    ).length,
    1,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("find ordinal uses document order after AX and DOM evidence are fused", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      nodeId: "root",
      backendDOMNodeId: 100,
      ignored: false,
      role: { value: "RootWebArea" },
      name: { value: "Mixed evidence" },
    },
    {
      nodeId: "first",
      parentId: "root",
      backendDOMNodeId: 101,
      ignored: false,
      role: { value: "button" },
      name: { value: "First" },
    },
    {
      nodeId: "third",
      parentId: "root",
      backendDOMNodeId: 103,
      ignored: false,
      role: { value: "button" },
      name: { value: "Third" },
    },
  ];
  opened.guest.debugger.domSnapshot = {
    strings: [
      "#document",
      "",
      "DIV",
      "BUTTON",
      "aria-label",
      "First",
      "Second",
      "Third",
    ],
    documents: [{
      nodes: {
        parentIndex: [-1, 0, 1, 1, 1],
        nodeType: [9, 1, 1, 1, 1],
        nodeName: [0, 2, 3, 3, 3],
        nodeValue: [1, 1, 1, 1, 1],
        backendNodeId: [900, 100, 101, 102, 103],
        attributes: [
          [],
          [],
          [4, 5],
          [4, 6],
          [4, 7],
        ],
      },
    }],
  };

  const second = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "find",
      {
        sessionId: opened.result.sessionId,
        query: {
          role: "button",
          exact: true,
          index: 1,
        },
        view: "matches",
        depth: 0,
        limit: 20,
      },
    ),
    new AbortController().signal,
  );
  assert.equal(second.totalMatches, 3);
  assert.equal(second.offset, 1);
  assert.equal(second.nextCursor, undefined);
  assert.equal(second.nodes.length, 1);
  assert.equal(second.nodes[0].name, "Second");
  assert.equal(second.nodes[0].source, "dom");
  assert.equal(second.nodes[0].match, true);

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: second.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(opened.guest.debugger.lastBoxBackendNodeId, 102);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("click rejects a target covered at its visible center", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.hitTarget = {
    targetOrDescendant: false,
    tag: "div",
    name: "Cookie consent",
  };
  opened.guest.debugger.hitBackendNodeId = 99;
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: snapshot.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "element_covered");
      assert.match(error.message, /Cookie consent/u);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ),
    false,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("scoped semantic click selects the requested nested action", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = Array.from(
    { length: 5 },
    (_, index) => [
      {
        nodeId: `item-${String(index + 1)}`,
        backendDOMNodeId: 100 + index * 3,
        ignored: false,
        role: { value: "listitem" },
        name: { value: `Result item ${String(index + 1)}` },
      },
      {
        nodeId: `primary-${String(index + 1)}`,
        parentId: `item-${String(index + 1)}`,
        backendDOMNodeId: 101 + index * 3,
        ignored: false,
        role: { value: "link" },
        name: { value: `Primary result ${String(index + 1)}` },
        properties: [{
          name: "url",
          value: {
            value: `https://example.com/primary/${String(index + 1)}`,
          },
        }],
      },
      {
        nodeId: `details-${String(index + 1)}`,
        parentId: `item-${String(index + 1)}`,
        backendDOMNodeId: 102 + index * 3,
        ignored: false,
        role: { value: "link" },
        name: { value: "Open details" },
        properties: [{
          name: "url",
          value: {
            value: `https://example.com/items/${String(index + 1)}`,
          },
        }],
      },
    ],
  ).flat();
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  const fifthItem = snapshot.nodes.find(
    (node) =>
      node.role === "listitem" &&
      node.name === "Result item 5",
  );
  assert.notEqual(fifthItem, undefined);

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: {
            role: "link",
            name: "Open details",
            exact: true,
          },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "ambiguous_target");
      assert.match(error.message, /matched 5 elements/u);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ),
    false,
  );
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      4,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: {
          withinRef: fifthItem.ref,
          role: "link",
          name: "Open details",
          url: "https://example.com/items/5",
          exact: true,
        },
      },
    ),
    new AbortController().signal,
  );

  const resolvedTargets = opened.guest.debugger.commands
    .filter(({ method }) => method === "DOM.resolveNode")
    .map(({ params }) => params.backendNodeId);
  assert.equal(resolvedTargets.includes(114), true);
  assert.equal(resolvedTargets.includes(113), false);
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ),
    true,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("generated locator code resolves a sibling action without evaluating model source", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      nodeId: "story-12",
      backendDOMNodeId: 400,
      ignored: false,
      role: { value: "row" },
      name: { value: "12. RotaryCell" },
    },
    {
      nodeId: "metadata-12",
      backendDOMNodeId: 401,
      ignored: false,
      role: { value: "row" },
      name: { value: "100 points 18 comments" },
    },
    {
      nodeId: "comments-12",
      parentId: "metadata-12",
      backendDOMNodeId: 402,
      ignored: false,
      role: { value: "link" },
      name: { value: "18 comments" },
      properties: [{
        name: "url",
        value: {
          value: "https://news.ycombinator.com/item?id=49517297",
        },
      }],
    },
  ];
  opened.guest.debugger.generatedLocatorBackendNodeId = 402;
  const code =
    'page.locator("tr.athing").nth(11).next("tr").getByRole("link", {name:/comments?|discuss/i})';

  const callsBeforeInvalid =
    opened.guest.debugger.commands.length;
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        2,
        "conversation-1",
        "locate",
        {
          sessionId: opened.result.sessionId,
          code: `${code}; location.href = "/wrong"`,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "invalid_locator_code");
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.length,
    callsBeforeInvalid,
  );

  opened.guest.debugger.generatedLocatorSummary = {
    count: 0,
    truncated: false,
    samples: [],
  };
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "locate",
        {
          sessionId: opened.result.sessionId,
          code,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "element_not_found");
      return true;
    },
  );

  opened.guest.debugger.generatedLocatorSummary = {
    count: 1,
    truncated: true,
    samples: [{
      tag: "a",
      role: "link",
      name: "18 comments",
      text: "18 comments",
      href: "https://news.ycombinator.com/item?id=49517297",
    }],
  };
  const descriptionsBeforeTruncation =
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "DOM.describeNode",
    ).length;
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        4,
        "conversation-1",
        "locate",
        {
          sessionId: opened.result.sessionId,
          code,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "locator_code_failed");
      assert.match(error.message, /candidate budget|truncated/iu);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "DOM.describeNode",
    ).length,
    descriptionsBeforeTruncation,
  );

  opened.guest.debugger.generatedLocatorSummary = {
    count: 1,
    truncated: false,
    samples: [{
      tag: "a",
      role: "link",
      name: "18 comments",
      text: "18 comments",
      href: "https://news.ycombinator.com/item?id=49517297",
    }],
  };
  opened.guest.debugger.afterNext(
    "DOM.describeNode",
    () => {
      opened.guest.debugger.emit(
        "message",
        {},
        "Page.frameNavigated",
        {
          frame: { id: "main-frame" },
        },
      );
    },
  );
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        5,
        "conversation-1",
        "locate",
        {
          sessionId: opened.result.sessionId,
          code,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "snapshot_required");
      return true;
    },
  );

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      6,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  const resolverCallsBeforeSuccess =
    opened.guest.debugger.commands.filter(
      ({ method, params }) =>
        method === "Runtime.callFunctionOn" &&
        String(params.functionDeclaration).includes(
          "minkeResolveGeneratedLocator",
        ),
    ).length;
  const located = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      7,
      "conversation-1",
      "locate",
      {
        sessionId: opened.result.sessionId,
        code,
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method, params }) =>
        method === "Runtime.callFunctionOn" &&
        String(params.functionDeclaration).includes(
          "minkeResolveGeneratedLocator",
        ),
    ).length,
    resolverCallsBeforeSuccess + 1,
    "one resolver call must both count and bind the returned element",
  );
  assert.match(located.snapshotId, /^s\d+$/u);
  assert.deepEqual(located.node, {
    ref: `${located.snapshotId}:e3`,
    role: "link",
    name: "18 comments",
    depth: 1,
    parentRef: `${located.snapshotId}:e2`,
    actionable: true,
    disabled: false,
    actions: ["click", "press"],
    url: "https://news.ycombinator.com/item?id=49517297",
    match: true,
  });

  const resolverCalls = opened.guest.debugger.commands.filter(
    ({ method, params }) =>
      method === "Runtime.callFunctionOn" &&
      String(params.functionDeclaration).includes(
        "minkeResolveGeneratedLocator",
      ),
  );
  assert.equal(resolverCalls.length, 4);
  const isolatedWorldCalls =
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Page.createIsolatedWorld",
    );
  assert.equal(isolatedWorldCalls.length, resolverCalls.length);
  assert.equal(
    isolatedWorldCalls.every(({ params }) =>
      params.frameId === "main-frame" &&
      params.worldName ===
        "minke-agent-browser-generated-locator"
    ),
    true,
  );
  const generatedDocumentEvaluations =
    opened.guest.debugger.commands.filter(
      ({ method, params }) =>
        method === "Runtime.evaluate" &&
        params.expression === "document" &&
        String(params.objectGroup).startsWith(
          "minke-agent-browser-generated-locator-",
        ),
    );
  assert.equal(
    generatedDocumentEvaluations.length,
    resolverCalls.length,
  );
  assert.equal(
    generatedDocumentEvaluations.every(
      ({ params }) => params.contextId === 17,
    ),
    true,
  );
  assert.equal(
    resolverCalls.some(({ params }) =>
      String(params.functionDeclaration).includes(code)
    ),
    false,
  );
  assert.deepEqual(
    resolverCalls.at(-1).params.arguments[0].value,
    [
      { kind: "locator", selector: "tr.athing" },
      { kind: "nth", index: 11 },
      { kind: "next", selector: "tr" },
      {
        kind: "getByRole",
        role: "link",
        name: {
          kind: "regex",
          value: "comments?|discuss",
          flags: "i",
        },
        exact: false,
      },
    ],
  );

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      8,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: located.node.ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method, params }) =>
        method === "DOM.resolveNode" &&
        params.backendNodeId === 402,
    ),
    true,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("generated locator cleanup failure cannot return success after fail-closed detach", async () => {
  const target = runtimeFixture({ cdpCommandTimeoutMs: 20 });
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.blockNext("Runtime.releaseObjectGroup");

  try {
    await assert.rejects(
      target.runtime.handleProcessRequest(
        createAgentBrowserRequest(
          2,
          "conversation-1",
          "locate",
          {
            sessionId: opened.result.sessionId,
            code:
              'page.getByRole("button", {name:"Continue", exact:true})',
          },
        ),
        new AbortController().signal,
      ),
      (error) => {
        assert.equal(error.code, "timed_out");
        assert.match(error.message, /releaseObjectGroup/iu);
        return true;
      },
    );
    assert.equal(opened.guest.debugger.attached, false);
    assert.equal(opened.guest.closed, true);
    assert.equal(
      target.runtime.projections().find(
        (projection) =>
          projection.sessionId === opened.result.sessionId,
      )?.status,
      "crashed",
    );
  } finally {
    await target.runtime.closeOwner("conversation-1");
    target.binding.dispose();
    target.runtime.dispose();
  }
});

test("ordinal semantic click counts only controls matching the requested action", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = Array.from(
    { length: 5 },
    (_, index) => [
      {
        nodeId: `story-${String(index + 1)}`,
        backendDOMNodeId: 201 + index * 2,
        ignored: false,
        role: { value: "link" },
        name: { value: `Story ${String(index + 1)}` },
        properties: [{
          name: "url",
          value: {
            value: `https://example.com/story/${String(index + 1)}`,
          },
        }],
      },
      {
        nodeId: `comments-${String(index + 1)}`,
        backendDOMNodeId: 202 + index * 2,
        ignored: false,
        role: { value: "link" },
        name: { value: `${String(20 + index)} comments` },
        properties: [{
          name: "url",
          value: {
            value: `https://example.com/item?id=${String(index + 1)}`,
          },
        }],
      },
    ],
  ).flat();

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: {
          role: "link",
          name: "comments",
          exact: false,
          index: 4,
        },
      },
    ),
    new AbortController().signal,
  );

  const resolvedTargets = opened.guest.debugger.commands
    .filter(({ method }) => method === "DOM.resolveNode")
    .map(({ params }) => params.backendNodeId);
  assert.equal(resolvedTargets.includes(210), true);
  assert.equal(
    resolvedTargets.some((backendNodeId) =>
      [201, 203, 205, 207, 209].includes(backendNodeId)
    ),
    false,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("fill focuses, selects, clears, and types through Chromium input events", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    backendDOMNodeId: 31,
    ignored: false,
    role: { value: "textbox" },
    name: { value: "Search" },
    value: { value: "old query" },
    properties: [{
      name: "focusable",
      value: { value: true },
    }],
  }];
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(
    snapshot.nodes[0].actions,
    ["click", "fill", "press"],
  );

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "fill",
      {
        sessionId: opened.result.sessionId,
        target: { ref: snapshot.nodes[0].ref },
        value: "new query",
      },
    ),
    new AbortController().signal,
  );

  assert.deepEqual(
    opened.guest.debugger.commands
      .filter(({ method }) =>
        method === "Input.dispatchKeyEvent" ||
        method === "Input.insertText"
      )
      .map(({ method, params }) => [
        method,
        params.type ?? params.text,
      ]),
    [
      ["Input.dispatchKeyEvent", "keyDown"],
      ["Input.dispatchKeyEvent", "keyUp"],
      ["Input.insertText", "new query"],
    ],
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "DOM.focus",
    ),
    true,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("fill rejects a non-editable action ref before issuing DOM input commands", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    backendDOMNodeId: 31,
    ignored: false,
    role: { value: "button" },
    name: { value: "Continue" },
    properties: [{
      name: "focusable",
      value: { value: true },
    }],
  }];
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(snapshot.nodes[0].actions, ["click", "press"]);
  const commandCount = opened.guest.debugger.commands.length;

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "fill",
        {
          sessionId: opened.result.sessionId,
          target: { ref: snapshot.nodes[0].ref },
          value: "must not be typed",
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "capability_mismatch");
      assert.match(error.message, /does not support fill/iu);
      return true;
    },
  );
  assert.deepEqual(
    opened.guest.debugger.commands
      .slice(commandCount)
      .filter(({ method }) =>
        method === "DOM.focus" ||
        method === "Input.insertText" ||
        method === "Input.dispatchKeyEvent"
      ),
    [],
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("semantic fill uses placeholder metadata, not the accessible label", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    backendDOMNodeId: 31,
    ignored: false,
    role: { value: "textbox" },
    name: {
      value: "Search documentation",
      sources: [{
        attribute: "placeholder",
        attributeValue: { value: "Filter issues" },
        superseded: true,
      }],
    },
    properties: [{
      name: "focusable",
      value: { value: true },
    }],
  }];

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "fill",
      {
        sessionId: opened.result.sessionId,
        target: {
          placeholder: "Filter issues",
          exact: true,
        },
        value: "stale ref",
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.commands.find(
      ({ method }) => method === "Input.insertText",
    )?.params.text,
    "stale ref",
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("soft frame changes preserve an unchanged semantic snapshot", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [
    {
      backendDOMNodeId: 7,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      description: { value: "Continue checkout" },
    },
    {
      backendDOMNodeId: 9,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      description: { value: "Continue checkout" },
    },
  ];
  const capture = async (requestId) =>
    await target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId,
        "conversation-1",
        "snapshot",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    );
  const initial = await capture(2);

  opened.guest.debugger.emit(
    "message",
    {},
    "Accessibility.nodesUpdated",
    { nodes: [] },
  );
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        20,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: initial.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "snapshot_required");
      return true;
    },
  );
  const afterAccessibilityUpdate = await capture(21);
  assert.equal(
    afterAccessibilityUpdate.snapshotId,
    initial.snapshotId,
  );
  assert.deepEqual(afterAccessibilityUpdate.nodes, initial.nodes);

  opened.guest.debugger.emit(
    "message",
    {},
    "Page.frameNavigated",
    {
      frame: {
        id: "child-frame",
        parentId: "main-frame",
        url: "https://example.com/embed",
      },
    },
  );
  opened.guest.debugger.emit(
    "message",
    {},
    "DOM.documentUpdated",
    {},
  );
  opened.guest.debugger.axNodes = [
    {
      backendDOMNodeId: 17,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      description: { value: "Continue checkout" },
    },
    {
      backendDOMNodeId: 19,
      ignored: false,
      role: { value: "button" },
      name: { value: "Continue" },
      description: { value: "Continue checkout" },
    },
  ];
  const afterChildUpdate = await capture(3);
  assert.equal(afterChildUpdate.snapshotId, initial.snapshotId);
  assert.deepEqual(afterChildUpdate.nodes, initial.nodes);
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      30,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: afterChildUpdate.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    opened.guest.debugger.commands
      .filter(({ method }) =>
        method === "DOM.scrollIntoViewIfNeeded"
      )
      .at(-1).params.backendNodeId,
    17,
  );

  opened.guest.debugger.emit(
    "message",
    {},
    "Page.frameNavigated",
    {
      frame: {
        id: "replacement-main-frame",
        url: "https://example.com/replaced",
      },
    },
  );
  const afterMainNavigation = await capture(4);
  assert.notEqual(afterMainNavigation.snapshotId, initial.snapshotId);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("pointer targets use the visible box intersection in CDP viewport coordinates", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.layoutMetrics = {
    cssVisualViewport: {
      offsetX: 37,
      offsetY: 41,
      pageX: 237,
      pageY: 341,
      clientWidth: 100,
      clientHeight: 80,
    },
  };
  let requestId = 2;
  const snapshot = async () =>
    await target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId++,
        "conversation-1",
        "snapshot",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    );
  const click = async (ref) =>
    await target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId++,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref },
        },
      ),
      new AbortController().signal,
    );
  const dispatchedPoints = () =>
    opened.guest.debugger.commands
      .filter(
        ({ method }) => method === "Input.dispatchMouseEvent",
      )
      .map(({ params }) => ({
        type: params.type,
        x: params.x,
        y: params.y,
      }));

  opened.guest.debugger.boxModel = {
    content: [-20, 10, 60, 10, 60, 50, -20, 50],
  };
  const partial = await snapshot();
  await click(partial.nodes[0].ref);
  assert.deepEqual(dispatchedPoints().slice(-3), [
    { type: "mouseMoved", x: 30, y: 30 },
    { type: "mousePressed", x: 30, y: 30 },
    { type: "mouseReleased", x: 30, y: 30 },
  ]);
  assert.deepEqual(target.runtime.projections()[0].cursor, {
    sequence: 2,
    phase: "clicking",
    point: { x: 30, y: 30 },
    viewport: { width: 100, height: 80 },
    durationMs: 180,
  });

  opened.guest.debugger.boxModel = {
    content: [
      -1_000,
      -1_000,
      1_000,
      -1_000,
      1_000,
      1_000,
      -1_000,
      1_000,
    ],
  };
  const oversized = await snapshot();
  await click(oversized.nodes[0].ref);
  assert.deepEqual(dispatchedPoints().slice(-3), [
    { type: "mouseMoved", x: 50, y: 40 },
    { type: "mousePressed", x: 50, y: 40 },
    { type: "mouseReleased", x: 50, y: 40 },
  ]);
  assert.deepEqual(
    target.runtime.projections()[0].cursor?.point,
    { x: 50, y: 40 },
  );

  const dispatchedBeforeInvisible = dispatchedPoints().length;
  opened.guest.debugger.boxModel = {
    content: [110, 10, 140, 10, 140, 30, 110, 30],
  };
  const invisible = await snapshot();
  await assert.rejects(
    click(invisible.nodes[0].ref),
    (error) => {
      assert.equal(error.code, "element_not_interactable");
      assert.equal(error.outcome, "known");
      return true;
    },
  );
  assert.equal(
    dispatchedPoints().length,
    dispatchedBeforeInvisible,
  );

  opened.guest.debugger.boxModel = {
    content: [
      99.95,
      10,
      100.05,
      10,
      100.05,
      20,
      99.95,
      20,
    ],
  };
  const sliver = await snapshot();
  await assert.rejects(
    click(sliver.nodes[0].ref),
    (error) => {
      assert.equal(error.code, "element_not_interactable");
      assert.equal(error.outcome, "known");
      return true;
    },
  );
  assert.equal(
    dispatchedPoints().length,
    dispatchedBeforeInvisible,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("virtual cursor travel and press feedback holds remain cancellable", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  const controller = new AbortController();
  const click = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: snapshot.nodes[0].ref },
      },
    ),
    controller.signal,
  );
  await settleAsyncWork();
  assert.equal(
    target.runtime.projections()[0].cursor?.phase,
    "moving",
  );
  controller.abort();
  await assert.rejects(click, (error) => {
    assert.equal(error.code, "agent_browser_cancelled");
    assert.equal(error.outcome, "known");
    return true;
  });
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ).length,
    0,
  );

  let resolveClicking;
  const clickingPublished = new Promise((resolve) => {
    resolveClicking = resolve;
  });
  const sendProjection = target.embedder.send.bind(
    target.embedder,
  );
  target.embedder.send = (channel, value) => {
    sendProjection(channel, value);
    if (
      channel === AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL &&
      value.some(
        (projection) =>
          projection.sessionId === opened.result.sessionId &&
          projection.cursor?.phase === "clicking",
      )
    ) {
      resolveClicking();
    }
  };
  const pressController = new AbortController();
  const heldClick = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      4,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: snapshot.nodes[0].ref },
      },
    ),
    pressController.signal,
  );
  await clickingPublished;
  pressController.abort();
  await assert.rejects(heldClick, (error) => {
    assert.equal(error.code, "agent_browser_cancelled");
    assert.equal(error.outcome, "unknown");
    return true;
  });
  assert.deepEqual(
    opened.guest.debugger.commands
      .filter(
        ({ method }) => method === "Input.dispatchMouseEvent",
      )
      .map(({ params }) => params.type),
    ["mouseMoved"],
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("virtual cursor types at refs and clears across navigation, takeover, and crash", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.axNodes = [{
    backendDOMNodeId: 7,
    ignored: false,
    role: { value: "textbox" },
    name: { value: "Search" },
    properties: [{
      name: "focusable",
      value: { value: true },
    }],
  }];
  let requestId = 2;
  const snapshot = async () =>
    await target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        requestId++,
        "conversation-1",
        "snapshot",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    );

  const fillSnapshot = await snapshot();
  const fillStartedAt = Date.now();
  opened.guest.debugger.afterNext(
    "Runtime.callFunctionOn",
    () => {
      assert.ok(Date.now() - fillStartedAt >= 150);
      assert.equal(
        target.runtime.projections()[0].cursor?.phase,
        "typing",
      );
    },
  );
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId++,
      "conversation-1",
      "fill",
      {
        sessionId: opened.result.sessionId,
        target: { ref: fillSnapshot.nodes[0].ref },
        value: "hello",
      },
    ),
    new AbortController().signal,
  );
  const afterFill = target.runtime.projections()[0].cursor;
  assert.equal(afterFill?.phase, "typing");
  assert.deepEqual(afterFill?.point, { x: 20, y: 10 });

  const pressSnapshot = await snapshot();
  assert.equal(
    target.runtime.projections()[0].cursor?.sequence,
    afterFill.sequence,
  );
  const pressStartedAt = Date.now();
  opened.guest.debugger.afterNext(
    "Input.dispatchKeyEvent",
    ({ type }) => {
      assert.equal(type, "keyDown");
      assert.ok(Date.now() - pressStartedAt >= 150);
      assert.equal(
        target.runtime.projections()[0].cursor?.phase,
        "typing",
      );
    },
  );
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId++,
      "conversation-1",
      "press",
      {
        sessionId: opened.result.sessionId,
        key: "Enter",
        target: { ref: pressSnapshot.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  const afterPress = target.runtime.projections()[0].cursor;
  assert.equal(afterPress?.phase, "typing");
  assert.ok(afterPress.sequence > afterFill.sequence);

  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId++,
      "conversation-1",
      "navigate",
      {
        sessionId: opened.result.sessionId,
        url: "https://example.com/next",
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    target.runtime.projections()[0].cursor,
    undefined,
  );

  const clickSnapshot = await snapshot();
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId++,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: clickSnapshot.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  assert.equal(
    target.runtime.projections()[0].cursor?.phase,
    "clicking",
  );

  const human = await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  assert.equal(human.cursor, undefined);
  await target.runtime.setControl(
    opened.result.sessionId,
    "agent",
  );

  const crashSnapshot = await snapshot();
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      requestId++,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: crashSnapshot.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );
  opened.guest.emit(
    "render-process-gone",
    {},
    { reason: "crashed" },
  );
  assert.equal(
    target.runtime.projections()[0].cursor,
    undefined,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("open remains loading until the matching CDP navigation lifecycle completes", async () => {
  const target = runtimeFixture();
  let settled = false;
  const openPromise = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      1,
      "conversation-1",
      "open",
      { url: "https://example.com/start" },
    ),
    new AbortController().signal,
  ).finally(() => {
    settled = true;
  });
  const projection = target.runtime.projections()[0];
  const session = target.sessions.get(projection.partition);
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "secured",
  );
  const guest = new FakeGuest(session, target.embedder);
  guest.debugger.autoNavigation = false;
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );

  await settleAsyncWork();
  assert.equal(settled, false);
  assert.equal(
    target.runtime.projections()[0].status,
    "loading",
  );

  guest.debugger.emit(
    "message",
    {},
    "Page.lifecycleEvent",
    {
      frameId: "main-frame",
      loaderId: "wrong-loader",
      name: "load",
    },
  );
  await settleAsyncWork();
  assert.equal(settled, false);

  guest.debugger.emit(
    "message",
    {},
    "Page.lifecycleEvent",
    {
      frameId: "main-frame",
      loaderId: "loader-1",
      name: "load",
    },
  );
  const result = await openPromise;
  assert.equal(result.status, "ready");

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("human takeover preserves a tab whose initial navigation is pending", async () => {
  const target = runtimeFixture({ cdpCommandTimeoutMs: 25 });
  const opening = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      1,
      "conversation-1",
      "open",
      { url: "https://example.com/slow" },
    ),
    new AbortController().signal,
  ).then(
    (result) => ({ status: "fulfilled", result }),
    (error) => ({ status: "rejected", error }),
  );
  const projection = target.runtime.projections()[0];
  const session = target.sessions.get(projection.partition);
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "secured",
  );
  const guest = new FakeGuest(session, target.embedder);
  guest.debugger.autoNavigation = false;
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );

  await settleAsyncWork();
  assert.equal(
    target.runtime.projections()[0].status,
    "loading",
  );

  const takeover = target.runtime.setControl(
    projection.sessionId,
    "human",
  ).then(
    (result) => ({ status: "fulfilled", result }),
    (error) => ({ status: "rejected", error }),
  );
  const [openOutcome, takeoverOutcome] = await Promise.all([
    opening,
    takeover,
  ]);

  assert.equal(openOutcome.status, "rejected");
  assert.equal(openOutcome.error.code, "session_paused");
  assert.equal(openOutcome.error.outcome, "unknown");
  assert.equal(takeoverOutcome.status, "fulfilled");
  assert.equal(takeoverOutcome.result.owner, "human");
  assert.equal(takeoverOutcome.result.status, "paused");
  assert.equal(takeoverOutcome.result.error, undefined);
  assert.equal(guest.debugger.isAttached(), true);
  assert.equal(guest.closed, false);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("failed navigation leaves an attached session inspectable", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.failNext(
    "Page.navigate",
    new Error("navigation refused"),
  );

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        2,
        "conversation-1",
        "navigate",
        {
          sessionId: opened.result.sessionId,
          url: "https://example.com/refused",
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "cdp_command_failed");
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(target.runtime.projections()[0].status, "ready");
  assert.equal(
    target.runtime.projections()[0].error,
    "navigation refused",
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("CDP cancellation waits for the dispatched command to quiesce", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const releaseScreenshot =
    opened.guest.debugger.blockNext("Page.captureScreenshot");
  const controller = new AbortController();
  let settled = false;
  const pending = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "screenshot",
      { sessionId: opened.result.sessionId },
    ),
    controller.signal,
  ).finally(() => {
    settled = true;
  });
  await settleAsyncWork();
  controller.abort(new Error("caller cancelled"));
  await settleAsyncWork();
  assert.equal(
    settled,
    false,
    "Electron must not acknowledge cancellation while CDP still owns work",
  );

  releaseScreenshot();
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "agent_browser_cancelled");
    assert.equal(error.outcome, "known");
    return true;
  });
  assert.equal(
    target.runtime.projections()[0].status,
    "ready",
  );
  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("CDP fail-closed timeout terminates a permanently hung command", async () => {
  const target = runtimeFixture({ cdpCommandTimeoutMs: 20 });
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.blockNext("Page.captureScreenshot");
  const pending = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "screenshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  ).then(
    () => ({ type: "success" }),
    (error) => ({ type: "error", error }),
  );
  let watchdog;
  const deadline = new Promise((resolve) => {
    watchdog = setTimeout(
      () => resolve({ type: "watchdog" }),
      200,
    );
  });

  const outcome = await Promise.race([pending, deadline]);
  clearTimeout(watchdog);
  assert.equal(
    outcome.type,
    "error",
    "fail-closed must not await an unsettled debugger promise forever",
  );
  assert.equal(outcome.error.code, "timed_out");
  assert.equal(outcome.error.outcome, "known");
  assert.equal(opened.guest.closed, true);
  assert.equal(
    target.runtime.projections()[0].status,
    "crashed",
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("human takeover pauses every process-side operation and is projected", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const before = target.runtime.projections()[0];
  const releaseScreenshot =
    opened.guest.debugger.blockNext("Page.captureScreenshot");
  const inFlightScreenshot =
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        2,
        "conversation-1",
        "screenshot",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    );
  await settleAsyncWork();
  let takeoverSettled = false;
  const takeover = target.runtime.setControl(
    opened.result.sessionId,
    "human",
  ).finally(() => {
    takeoverSettled = true;
  });
  await settleAsyncWork();
  assert.equal(takeoverSettled, false);

  // The admission gate closes before the in-flight action drains.
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "close",
        { sessionId: opened.result.sessionId },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "session_paused");
      return true;
    },
  );
  releaseScreenshot();
  await inFlightScreenshot;
  const human = await takeover;
  assert.equal(human.owner, "human");
  assert.equal(human.status, "paused");
  assert.ok(human.generation > before.generation);

  for (const [requestId, operation, payload] of [
    [
      4,
      "screenshot",
      { sessionId: opened.result.sessionId },
    ],
    [5, "close", { sessionId: opened.result.sessionId }],
  ]) {
    await assert.rejects(
      target.runtime.handleProcessRequest(
        createAgentBrowserRequest(
          requestId,
          "conversation-1",
          operation,
          payload,
        ),
        new AbortController().signal,
      ),
      (error) => {
        assert.equal(error.code, "session_paused");
        return true;
      },
    );
  }

  assert.equal(
    target.embedder.messages.some(
      ({ channel, value }) =>
        channel === AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL &&
        value.some(
          (projection) =>
            projection.sessionId === opened.result.sessionId &&
            projection.owner === "human",
        ),
    ),
    true,
  );
  assert.deepEqual(
    await target.ipc.invoke(
      AGENT_BROWSER_SESSIONS_READ_CHANNEL,
      {},
    ),
    target.runtime.projections(),
  );

  const resumed = await target.runtime.setControl(
    opened.result.sessionId,
    "agent",
  );
  assert.equal(resumed.owner, "agent");
  assert.equal(resumed.status, "ready");
  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("returning control requires a fresh observation before element actions", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const beforeTakeover = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );

  await target.runtime.setControl(opened.result.sessionId, "human");
  const resumed = await target.runtime.setControl(
    opened.result.sessionId,
    "agent",
  );
  assert.equal(resumed.owner, "agent");

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        3,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          target: { ref: beforeTakeover.nodes[0].ref },
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "snapshot_required");
      assert.match(error.message, /browser_snapshot/u);
      return true;
    },
  );
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Input.dispatchMouseEvent",
    ).length,
    0,
  );

  const afterTakeover = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      4,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );
  assert.notEqual(afterTakeover.snapshotId, beforeTakeover.snapshotId);
  await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      5,
      "conversation-1",
      "click",
      {
        sessionId: opened.result.sessionId,
        target: { ref: afterTakeover.nodes[0].ref },
      },
    ),
    new AbortController().signal,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("agent history actions invalidate refs and expose navigation availability", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const snapshot = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "snapshot",
      { sessionId: opened.result.sessionId },
    ),
    new AbortController().signal,
  );

  const back = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      3,
      "conversation-1",
      "history",
      {
        sessionId: opened.result.sessionId,
        command: "back",
      },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(opened.guest.navigationCalls, ["back"]);
  assert.equal(back.status, "loading");
  assert.equal(back.snapshotRequired, true);
  assert.ok(back.generation > snapshot.generation);

  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        4,
        "conversation-1",
        "history",
        {
          sessionId: opened.result.sessionId,
          command: "forward",
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "navigation_unavailable");
      assert.equal(error.outcome, "known");
      return true;
    },
  );
  assert.deepEqual(opened.guest.navigationCalls, ["back"]);

  const reloaded = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      5,
      "conversation-1",
      "history",
      {
        sessionId: opened.result.sessionId,
        command: "reload",
      },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(opened.guest.navigationCalls, [
    "back",
    "reload",
  ]);
  assert.equal(reloaded.status, "loading");
  assert.equal(reloaded.snapshotRequired, true);

  const stopped = await target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      6,
      "conversation-1",
      "history",
      {
        sessionId: opened.result.sessionId,
        command: "stop",
      },
    ),
    new AbortController().signal,
  );
  assert.deepEqual(opened.guest.navigationCalls, [
    "back",
    "reload",
    "stop",
  ]);
  assert.equal(stopped.status, "ready");
  assert.equal(stopped.snapshotRequired, true);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("committed visits retain the owner captured when navigation started", async () => {
  const visits = [];
  let closed = false;
  const history = {
    recordVisit(visit) {
      visits.push(visit);
    },
    read() {
      throw new Error("history read was not expected");
    },
    clear() {
      throw new Error("history clear was not expected");
    },
    close() {
      closed = true;
    },
  };
  const target = runtimeFixture({ history });
  const opened = await openAgentBrowser(target);
  const firstUrl = "https://example.com/items/42?owner=agent";
  opened.guest.emit(
    "did-start-navigation",
    {
      url: firstUrl,
      isMainFrame: true,
      isSameDocument: false,
    },
  );
  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  opened.guest.emit("did-navigate", {}, firstUrl);

  const secondUrl =
    "https://example.com/items/42?owner=human#comments";
  opened.guest.emit(
    "did-start-navigation",
    {
      url: secondUrl,
      isMainFrame: true,
      isSameDocument: true,
    },
  );
  await target.runtime.setControl(
    opened.result.sessionId,
    "agent",
  );
  opened.guest.emit(
    "did-navigate-in-page",
    {},
    secondUrl,
    true,
  );

  assert.deepEqual(
    visits.map((visit) => ({
      actor: visit.actor,
      navigationKind: visit.navigationKind,
      sessionId: visit.sessionId,
      url: visit.url,
    })),
    [
      {
        actor: "agent",
        navigationKind: "document",
        sessionId: opened.result.sessionId,
        url: firstUrl,
      },
      {
        actor: "human",
        navigationKind: "same-document",
        sessionId: opened.result.sessionId,
        url: secondUrl,
      },
    ],
  );
  assert.equal(
    visits.every(
      (visit) =>
        Number.isSafeInteger(visit.visitedAt) &&
        visit.visitedAt > 0,
    ),
    true,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
  assert.equal(closed, true);
});

test("browsing-footprint IPC is authorized, validated, and clear-confirmed", async () => {
  const reads = [];
  let clearCalls = 0;
  let closed = false;
  const snapshot = {
    totalVisits: 1,
    retainedVisits: 1,
    uniquePaths: 1,
    agentVisits: 1,
    humanVisits: 0,
    visits: [
      {
        visitId: 1,
        visitedAt: 1_800,
        actor: "agent",
        navigationKind: "document",
        url: "https://example.com/docs?from=agent",
        origin: "https://example.com",
        pathname: "/docs",
        pathKey: "https://example.com/docs",
        pathVisitCount: 1,
        pathAgentVisits: 1,
        pathHumanVisits: 0,
      },
    ],
  };
  const history = {
    recordVisit() {},
    read(request) {
      reads.push(request);
      return snapshot;
    },
    clear() {
      clearCalls += 1;
    },
    close() {
      closed = true;
    },
  };
  const target = runtimeFixture({ history });

  assert.deepEqual(
    await target.ipc.invoke(
      AGENT_BROWSER_HISTORY_READ_CHANNEL,
      {},
      { limit: 25, actor: "agent" },
    ),
    snapshot,
  );
  assert.deepEqual(reads, [{ limit: 25, actor: "agent" }]);
  await assert.rejects(
    target.ipc.invoke(
      AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
      {},
      { confirm: false },
    ),
    /clear request/u,
  );
  assert.equal(clearCalls, 0);
  assert.deepEqual(
    await target.ipc.invoke(
      AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
      {},
      { confirm: true },
    ),
    {
      totalVisits: 0,
      retainedVisits: 0,
      uniquePaths: 0,
      agentVisits: 0,
      humanVisits: 0,
      visits: [],
    },
  );
  assert.equal(clearCalls, 1);

  target.binding.dispose();
  target.runtime.dispose();
  assert.equal(closed, true);

  const rejected = runtimeFixture({
    history: {
      ...history,
      close() {},
    },
    authorize: () => false,
  });
  await assert.rejects(
    rejected.ipc.invoke(
      AGENT_BROWSER_HISTORY_READ_CHANNEL,
      {},
      { limit: 25 },
    ),
    /unauthorized Agent Browser request/u,
  );
  rejected.binding.dispose();
  rejected.runtime.dispose();

  const unavailable = runtimeFixture();
  await assert.rejects(
    unavailable.ipc.invoke(
      AGENT_BROWSER_HISTORY_READ_CHANNEL,
      {},
      { limit: 25 },
    ),
    /browsing footprint is unavailable/u,
  );
  unavailable.binding.dispose();
  unavailable.runtime.dispose();
});

test("human navigation commands stay main-owned and project history state", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  const request = {
    sessionId: opened.result.sessionId,
    command: "back",
  };

  await assert.rejects(
    target.ipc.invoke(
      AGENT_BROWSER_NAVIGATION_CHANNEL,
      {},
      request,
    ),
    (error) => {
      assert.equal(error.code, "navigation_requires_human_control");
      return true;
    },
  );

  await target.runtime.setControl(opened.result.sessionId, "human");
  const navigated = await target.ipc.invoke(
    AGENT_BROWSER_NAVIGATION_CHANNEL,
    {},
    request,
  );
  assert.deepEqual(opened.guest.navigationCalls, ["back"]);
  assert.deepEqual(navigated.navigation, {
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });

  opened.guest.emit("did-start-loading");
  assert.equal(
    target.runtime.projections()[0].navigation.loading,
    true,
  );
  await target.ipc.invoke(
    AGENT_BROWSER_NAVIGATION_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      command: "stop",
    },
  );
  assert.deepEqual(opened.guest.navigationCalls, ["back", "stop"]);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("unauthorized renderer navigation never reaches the guest", async () => {
  const target = runtimeFixture({ authorize: () => false });
  const opened = await openAgentBrowser(target);
  await target.runtime.setControl(opened.result.sessionId, "human");

  await assert.rejects(
    target.ipc.invoke(
      AGENT_BROWSER_NAVIGATION_CHANNEL,
      {},
      {
        sessionId: opened.result.sessionId,
        command: "reload",
      },
    ),
    /unauthorized Agent Browser request/u,
  );
  assert.deepEqual(opened.guest.navigationCalls, []);

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("human takeover interrupts a pending navigation without crashing the guest", async () => {
  const target = runtimeFixture({ cdpCommandTimeoutMs: 25 });
  const opened = await openAgentBrowser(target);
  opened.guest.debugger.autoNavigation = false;
  const navigation = target.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "navigate",
      {
        sessionId: opened.result.sessionId,
        url: "https://example.com/slow",
      },
    ),
    new AbortController().signal,
  ).then(
    (result) => ({ status: "fulfilled", result }),
    (error) => ({ status: "rejected", error }),
  );

  await settleAsyncWork();
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "Page.navigate",
    ).length,
    2,
  );

  const human = await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  const navigationOutcome = await navigation;

  assert.notEqual(human.status, "crashed", human.error);
  assert.equal(human.owner, "human");
  assert.equal(human.status, "paused");
  assert.equal(human.error, undefined);
  assert.equal(navigationOutcome.status, "rejected");
  assert.equal(navigationOutcome.error.code, "session_paused");
  assert.equal(navigationOutcome.error.outcome, "unknown");
  assert.equal(opened.guest.debugger.isAttached(), true);
  assert.equal(opened.guest.closed, false);

  const resumed = await target.runtime.setControl(
    opened.result.sessionId,
    "agent",
  );
  assert.equal(resumed.owner, "agent");
  assert.equal(resumed.status, "ready");

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("authorized DOM annotation commits one generation-scoped screenshot", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );

  const annotation = await target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_START_CHANNEL,
    {},
    { sessionId: opened.result.sessionId },
  );
  assert.equal(annotation.sessionId, opened.result.sessionId);
  assert.match(
    annotation.annotationSessionId,
    /^annotation-[a-zA-Z0-9]+$/u,
  );
  assert.deepEqual(annotation.page.viewport, {
    width: 860,
    height: 863,
  });
  opened.guest.debugger.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 71 },
  );
  await settleAsyncWork();
  await settleAsyncWork();

  const selected = target.embedder.messages
    .filter(
      ({ channel, value }) =>
        channel === AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL &&
        value.type === "selected",
    )
    .at(-1)?.value;
  assert.notEqual(selected, undefined);
  assert.equal(selected.target.tag, "h3");
  assert.equal(selected.target.text, "Search result");
  assert.equal("backendNodeId" in selected.target, false);

  const committed = await target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      annotationSessionId: annotation.annotationSessionId,
      targetIds: [selected.target.targetId],
    },
  );
  assert.equal(committed.data, "aGVsbG8=");
  assert.equal(committed.mimeType, "image/png");
  assert.deepEqual(
    committed.targets.map(({ targetId }) => targetId),
    [selected.target.targetId],
  );
  const captureIndex = opened.guest.debugger.commands.findIndex(
    ({ method }) => method === "Page.captureScreenshot",
  );
  const pausedIndex = opened.guest.debugger.commands.findIndex(
    ({ method, params }) =>
      method === "Overlay.setInspectMode" &&
      params.mode === "none",
  );
  assert.ok(pausedIndex >= 0 && pausedIndex < captureIndex);

  await target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      annotationSessionId: annotation.annotationSessionId,
    },
  );
  assert.equal(
    target.embedder.messages.some(
      ({ channel, value }) =>
        channel === AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL &&
        value.type === "ended" &&
        value.reason === "cancelled",
    ),
    true,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("annotation operations serialize and stop waits for CDP quiescence", async () => {
  const target = runtimeFixture();
  const opened = await openAgentBrowser(target);
  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );

  const annotation = await target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_START_CHANNEL,
    {},
    { sessionId: opened.result.sessionId },
  );
  opened.guest.debugger.emit(
    "message",
    {},
    "Overlay.inspectNodeRequested",
    { backendNodeId: 71 },
  );
  await settleAsyncWork();
  await settleAsyncWork();
  const selected = target.embedder.messages
    .filter(
      ({ channel, value }) =>
        channel === AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL &&
        value.type === "selected",
    )
    .at(-1)?.value;
  assert.notEqual(selected, undefined);

  const describeCountBefore =
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "DOM.describeNode",
    ).length;
  const releaseRefresh =
    opened.guest.debugger.blockNext("DOM.describeNode");
  let refreshSettled = false;
  const refreshOutcome = target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      annotationSessionId: annotation.annotationSessionId,
      targetIds: [selected.target.targetId],
    },
  ).then(
    (value) => {
      refreshSettled = true;
      return { value };
    },
    (error) => {
      refreshSettled = true;
      return { error };
    },
  );
  await settleAsyncWork();
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method }) => method === "DOM.describeNode",
    ).length,
    describeCountBefore + 1,
  );
  assert.equal(refreshSettled, false);

  let commitSettled = false;
  const commitOutcome = target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      annotationSessionId: annotation.annotationSessionId,
      targetIds: [selected.target.targetId],
    },
  ).then(
    (value) => {
      commitSettled = true;
      return { value };
    },
    (error) => {
      commitSettled = true;
      return { error };
    },
  );
  await settleAsyncWork();
  assert.equal(commitSettled, false);
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method, params }) =>
        method === "Overlay.setInspectMode" &&
        params.mode === "none",
    ),
    false,
    "commit must not enter CDP while refresh owns the annotation queue",
  );

  let stopSettled = false;
  const stopPromise = target.ipc.invoke(
    AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
    {},
    {
      sessionId: opened.result.sessionId,
      annotationSessionId: annotation.annotationSessionId,
    },
  ).then(() => {
    stopSettled = true;
  });
  await settleAsyncWork();
  assert.equal(stopSettled, false);
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method, params }) =>
        method === "Overlay.setInspectMode" &&
        params.mode === "none",
    ),
    false,
    "stop must wait for admitted CDP work before disabling the picker",
  );

  await assert.rejects(
    target.ipc.invoke(
      AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
      {},
      {
        sessionId: opened.result.sessionId,
        annotationSessionId: annotation.annotationSessionId,
        targetIds: [selected.target.targetId],
      },
    ),
    (error) => {
      assert.equal(error.code, "annotation_not_found");
      return true;
    },
  );

  releaseRefresh();
  const [refreshResult, commitResult] = await Promise.all([
    refreshOutcome,
    commitOutcome,
  ]);
  assert.equal(refreshResult.error?.code, "annotation_stale");
  assert.equal(commitResult.error?.code, "annotation_stale");
  await stopPromise;
  assert.equal(stopSettled, true);
  assert.equal(
    opened.guest.debugger.commands.filter(
      ({ method, params }) =>
        method === "Overlay.setInspectMode" &&
        params.mode === "none",
    ).length,
    1,
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Page.captureScreenshot",
    ),
    false,
    "queued commit must not capture after stop revoked authority",
  );
  assert.equal(
    target.embedder.messages.filter(
      ({ channel, value }) =>
        channel === AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL &&
        value.type === "ended" &&
        value.annotationSessionId ===
          annotation.annotationSessionId,
    ).length,
    1,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

test("unauthorized annotation IPC cannot enable the CDP picker", async () => {
  const target = runtimeFixture({ authorize: () => false });
  const opened = await openAgentBrowser(target);
  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );

  await assert.rejects(
    target.ipc.invoke(
      AGENT_BROWSER_ANNOTATION_START_CHANNEL,
      {},
      { sessionId: opened.result.sessionId },
    ),
    /unauthorized/u,
  );
  assert.equal(
    opened.guest.debugger.commands.some(
      ({ method }) => method === "Overlay.enable",
    ),
    false,
  );

  await target.runtime.closeOwner("conversation-1");
  target.binding.dispose();
  target.runtime.dispose();
});

class FakeChild extends EventEmitter {
  connected = true;
  sent = [];

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
    return true;
  }
}

test("runtime correlates automatic claims and the latest human control intent wins", async () => {
  const target = runtimeFixture();
  const child = new FakeChild();
  target.runtime.bindChild(child);
  child.emit(
    "message",
    createAgentBrowserRequest(
      1,
      "conversation-takeover",
      "open",
      { url: "https://example.com/start" },
    ),
  );
  const projection = target.runtime.projections().at(-1);
  assert.notEqual(projection, undefined);
  const session = target.sessions.get(projection.partition);
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "secured",
  );
  const guest = new FakeGuest(session, target.embedder);
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );
  await settleAsyncWork();
  const opened = child.sent.find(
    (message) =>
      message.type === "response" &&
      message.requestId === 1,
  );
  assert.notEqual(opened, undefined);

  const releaseWait = guest.debugger.blockNext(
    "Runtime.callFunctionOn",
  );
  child.emit(
    "message",
    createAgentBrowserRequest(
      2,
      "conversation-takeover",
      "wait",
      {
        sessionId: opened.result.sessionId,
        text: "Never",
        timeoutMs: 10_000,
      },
    ),
  );
  await settleAsyncWork();
  const controlTransition = target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  await settleAsyncWork();
  assert.deepEqual(
    child.sent.find(
      (message) =>
        message.type === "control-changed" &&
        message.owner === "human",
    ),
    {
      channel: AGENT_BROWSER_PROCESS_CHANNEL,
      protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
      type: "control-changed",
      ownerSessionId: "conversation-takeover",
      sessionId: opened.result.sessionId,
      owner: "human",
      controlRevision: 1,
    },
  );
  assert.equal(
    target.runtime.projections().at(-1).owner,
    "agent",
  );
  child.emit(
    "message",
    createAgentBrowserCancelRequest(2),
  );
  releaseWait();
  await controlTransition;
  assert.equal(
    target.runtime.projections().at(-1).owner,
    "human",
  );

  child.emit(
    "message",
    createAgentBrowserClaimControlRequest(
      3,
      "conversation-takeover",
      opened.result.sessionId,
      1,
    ),
  );
  await settleAsyncWork();
  assert.deepEqual(
    child.sent.find(
      (message) =>
        message.type === "control-changed" &&
        message.owner === "agent",
    ),
    {
      channel: AGENT_BROWSER_PROCESS_CHANNEL,
      protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
      type: "control-changed",
      ownerSessionId: "conversation-takeover",
      sessionId: opened.result.sessionId,
      owner: "agent",
      controlRevision: 2,
    },
  );
  const claimResponse = child.sent.find(
    (message) =>
      message.type === "response" &&
      message.requestId === 3,
  );
  const agentControlIndex = child.sent.findIndex(
    (message) =>
      message.type === "control-changed" &&
      message.owner === "agent" &&
      message.controlRevision === 2,
  );
  const claimResponseIndex = child.sent.findIndex(
    (message) =>
      message.type === "response" &&
      message.requestId === 3,
  );
  assert.ok(agentControlIndex >= 0);
  assert.ok(claimResponseIndex > agentControlIndex);
  assert.deepEqual(claimResponse.result, {
    sessionId: opened.result.sessionId,
    generation: 4,
    owner: "agent",
    status: "ready",
    snapshotRequired: true,
    controlRevision: 2,
    url: "https://example.com/start",
  });

  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  await target.runtime.startAnnotation(
    opened.result.sessionId,
  );
  const stopPickerCommands = guest.debugger.commands.filter(
    ({ method }) => method === "Overlay.setInspectMode",
  ).length;
  const releaseStopPicker = guest.debugger.blockNext(
    "Overlay.setInspectMode",
  );
  const staleClaim = target.runtime.claimControl(
    "conversation-takeover",
    opened.result.sessionId,
    3,
    new AbortController().signal,
  );
  await settleAsyncWork();
  assert.equal(
    guest.debugger.commands.filter(
      ({ method }) => method === "Overlay.setInspectMode",
    ).length,
    stopPickerCommands + 1,
  );
  const latestHumanIntent = target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  releaseStopPicker();
  await assert.rejects(
    staleClaim,
    (error) => {
      assert.equal(error.code, "control_superseded");
      return true;
    },
  );
  await latestHumanIntent;
  assert.equal(
    child.sent.some(
      (message) =>
        message.type === "control-changed" &&
        message.owner === "agent" &&
        message.controlRevision === 4,
    ),
    false,
  );
  assert.deepEqual(
    child.sent.filter(
      (message) =>
        message.type === "control-changed" &&
        message.owner === "human",
    ).map((message) => message.controlRevision),
    [1, 3, 5],
  );
  assert.equal(
    target.runtime.projections().at(-1).owner,
    "human",
  );

  await target.runtime.startAnnotation(
    opened.result.sessionId,
  );
  const releaseCancelledStopPicker = guest.debugger.blockNext(
    "Overlay.setInspectMode",
  );
  const cancelledController = new AbortController();
  const agentControlEventsBeforeCancel = child.sent.filter(
    (message) =>
      message.type === "control-changed" &&
      message.owner === "agent",
  ).length;
  const cancelledClaim = target.runtime.claimControl(
    "conversation-takeover",
    opened.result.sessionId,
    5,
    cancelledController.signal,
  );
  await settleAsyncWork();
  cancelledController.abort(new Error("agent turn stopped"));
  releaseCancelledStopPicker();
  const cancelledOutcome = await cancelledClaim.then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  const ownerAfterCancelledClaim =
    target.runtime.projections().at(-1).owner;
  const agentControlEventsAfterCancel = child.sent.filter(
    (message) =>
      message.type === "control-changed" &&
      message.owner === "agent",
  ).length;

  await target.runtime.closeOwner("conversation-takeover");
  target.binding.dispose();
  target.runtime.dispose();
  assert.equal(
    cancelledOutcome.error?.code,
    "agent_browser_cancelled",
  );
  assert.equal(ownerAfterCancelledClaim, "human");
  assert.equal(
    agentControlEventsAfterCancel,
    agentControlEventsBeforeCancel,
  );
});

test("owner release cancels a blocked claim without restoring human control", async () => {
  const ownerSessionId = "conversation-release-claim";
  const target = runtimeFixture();
  const child = new FakeChild();
  target.runtime.bindChild(child);
  child.emit(
    "message",
    createAgentBrowserRequest(
      1,
      ownerSessionId,
      "open",
      { url: "https://example.com/start" },
    ),
  );
  const projection = target.runtime.projections().at(-1);
  assert.notEqual(projection, undefined);
  const session = target.sessions.get(projection.partition);
  assert.notEqual(session, undefined);
  assert.equal(
    target.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "secured",
  );
  const guest = new FakeGuest(session, target.embedder);
  assert.equal(
    target.runtime.attachGuest(target.embedder, guest),
    true,
  );
  await settleAsyncWork();
  const opened = child.sent.find(
    (message) =>
      message.type === "response" &&
      message.requestId === 1,
  );
  assert.notEqual(opened, undefined);

  await target.runtime.setControl(
    opened.result.sessionId,
    "human",
  );
  await target.runtime.startAnnotation(
    opened.result.sessionId,
  );
  const releaseStopPicker = guest.debugger.blockNext(
    "Overlay.setInspectMode",
  );
  child.emit(
    "message",
    createAgentBrowserClaimControlRequest(
      2,
      ownerSessionId,
      opened.result.sessionId,
      1,
    ),
  );
  await settleAsyncWork();
  const humanEventsBeforeRelease = child.sent.filter(
    (message) =>
      message.type === "control-changed" &&
      message.owner === "human",
  ).length;

  child.emit(
    "message",
    createAgentBrowserReleaseOwnerRequest(ownerSessionId),
  );
  releaseStopPicker();
  for (
    let attempt = 0;
    attempt < 10 &&
      !child.sent.some(({ requestId }) => requestId === 2);
    attempt += 1
  ) {
    await settleAsyncWork();
  }
  const claimOutcome = child.sent.find(
    ({ requestId }) => requestId === 2,
  );
  const humanEventsAfterRelease = child.sent.filter(
    (message) =>
      message.type === "control-changed" &&
      message.owner === "human",
  ).length;
  const remainingSessions = target.runtime.projections();

  target.binding.dispose();
  target.runtime.dispose();
  assert.equal(claimOutcome?.type, "error");
  assert.equal(claimOutcome?.code, "owner_released");
  assert.deepEqual(remainingSessions, []);
  assert.equal(
    humanEventsAfterRelease,
    humanEventsBeforeRelease,
    "owner teardown must not publish a compensating human-control event",
  );
});

test("process channel isolates traffic and cancellation settles exactly once", async () => {
  const child = new FakeChild();
  const closedOwners = [];
  const handler = {
    async handleProcessRequest(request, signal) {
      if (request.operation === "wait") {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        });
      }
      return {
        sessionId: "agent-result",
        generation: 1,
        owner: "agent",
        status: "ready",
        snapshotRequired: false,
        url: request.payload.url,
      };
    },
    closeOwner(ownerSessionId) {
      closedOwners.push(ownerSessionId);
    },
  };
  const channel = new AgentBrowserProcessChannel(child, handler);

  child.emit("message", {
    channel: "minke:harness-control",
    requestId: 99,
  });
  assert.equal(child.sent.length, 0);

  child.emit(
    "message",
    createAgentBrowserRequest(
      1,
      "conversation-1",
      "open",
      { url: "https://example.com/" },
    ),
  );
  await settleAsyncWork();
  assert.equal(child.sent[0].type, "response");
  assert.equal(child.sent[0].requestId, 1);
  channel.publishControlChanged(
    "conversation-1",
    "agent-result",
    "human",
    1,
  );
  assert.deepEqual(child.sent[1], {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    type: "control-changed",
    ownerSessionId: "conversation-1",
    sessionId: "agent-result",
    owner: "human",
    controlRevision: 1,
  });
  const sentBeforeUnknownOwner = child.sent.length;
  channel.publishControlChanged(
    "conversation-other",
    "agent-result",
    "human",
    1,
  );
  assert.equal(child.sent.length, sentBeforeUnknownOwner);

  child.emit(
    "message",
    createAgentBrowserRequest(
      2,
      "conversation-1",
      "wait",
      {
        sessionId: "agent-result",
        text: "ready",
        timeoutMs: 1_000,
      },
    ),
  );
  child.emit(
    "message",
    createAgentBrowserCancelRequest(2),
  );
  await settleAsyncWork();
  const cancellationResponses = child.sent.filter(
    ({ requestId }) => requestId === 2,
  );
  assert.equal(cancellationResponses.length, 1);
  assert.equal(cancellationResponses[0].type, "error");
  assert.equal(
    cancellationResponses[0].code,
    "agent_browser_cancelled",
  );
  assert.equal(cancellationResponses[0].outcome, "known");

  child.emit("message", {
    channel: AGENT_BROWSER_PROCESS_CHANNEL,
    protocolVersion: AGENT_BROWSER_PROTOCOL_VERSION,
    requestId: 3,
    type: "request",
    operation: "raw-cdp",
    ownerSessionId: "conversation-1",
    payload: {},
  });
  assert.equal(
    child.sent.find(({ requestId }) => requestId === 3).code,
    "bad_request",
  );

  child.emit("exit", 1);
  assert.deepEqual(closedOwners, ["conversation-1"]);
  assert.equal(channel.disposed, true);
});

test("persistent or wrongly hosted guests fail closed", async () => {
  const persistent = runtimeFixture({
    sessionFactory: () =>
      new FakeSession({ persistent: true }),
  });
  await assert.rejects(
    persistent.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        1,
        "conversation-1",
        "open",
        { url: "https://example.com/" },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "persistent_partition");
      return true;
    },
  );
  assert.equal(persistent.runtime.projections().length, 0);
  persistent.binding.dispose();
  persistent.runtime.dispose();

  const wrongHost = runtimeFixture();
  const openPromise = wrongHost.runtime.handleProcessRequest(
    createAgentBrowserRequest(
      1,
      "conversation-1",
      "open",
      { url: "https://example.com/" },
    ),
    new AbortController().signal,
  );
  const projection = wrongHost.runtime.projections()[0];
  assert.equal(
    wrongHost.runtime.secureWebview(
      {},
      {
        partition: projection.partition,
        src: "about:blank",
      },
    ),
    "secured",
  );
  const guest = new FakeGuest(
    wrongHost.sessions.get(projection.partition),
    new FakeEmbedder(),
  );
  assert.equal(
    wrongHost.runtime.attachGuest(wrongHost.embedder, guest),
    true,
  );
  assert.equal(guest.closed, true);
  await assert.rejects(openPromise, (error) => {
    assert.equal(error.code, "guest_rejected");
    return true;
  });
  wrongHost.binding.dispose();
  wrongHost.runtime.dispose();
});
