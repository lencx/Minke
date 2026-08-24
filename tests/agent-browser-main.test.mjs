import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  AGENT_BROWSER_PROCESS_CHANNEL,
  AGENT_BROWSER_PROTOCOL_VERSION,
  AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
  AGENT_BROWSER_SESSIONS_READ_CHANNEL,
  createAgentBrowserCancelRequest,
  createAgentBrowserRequest,
} from "@minke/harness-overlay/agent-browser-contract.ts";
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
        return {
          nodes: [
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
          ],
        };
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
        return {
          model: this.boxModel,
        };
      case "DOM.resolveNode":
        return { object: { objectId: "element-1" } };
      case "Page.getLayoutMetrics":
        return this.layoutMetrics;
      case "Runtime.evaluate":
        return { result: { objectId: "document-1" } };
      case "Runtime.callFunctionOn":
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
        ref: snapshot.nodes[0].ref,
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
  assert.deepEqual(clickingSequences, [2, 2]);

  // Negative control: an action invalidates the snapshot generation.
  await assert.rejects(
    target.runtime.handleProcessRequest(
      createAgentBrowserRequest(
        4,
        "conversation-1",
        "click",
        {
          sessionId: opened.result.sessionId,
          ref: snapshot.nodes[0].ref,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "stale_ref");
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
          ref: freshSnapshot.nodes[0].ref,
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
          ref: snapshot.nodes[0].ref,
        },
      ),
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "stale_ref");
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
          ref,
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
        ref: snapshot.nodes[0].ref,
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
        ref: snapshot.nodes[0].ref,
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
        ref: fillSnapshot.nodes[0].ref,
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
        ref: pressSnapshot.nodes[0].ref,
        key: "Enter",
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
        ref: clickSnapshot.nodes[0].ref,
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
        ref: crashSnapshot.nodes[0].ref,
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
