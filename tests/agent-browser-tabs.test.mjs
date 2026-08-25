import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MessageCirclePlus,
  MousePointerClick,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import {
  agentCursorFeedbackDelayMs,
} from "@minke/harness-overlay/client/tabs/agent-browser/AgentCursorOverlay.tsx";
import {
  annotationCommentEditorLayout,
  shouldSubmitAnnotationComment,
} from "@minke/harness-overlay/client/tabs/agent-browser/DomAnnotationOverlay.tsx";
import {
  AgentBrowserTabsController,
} from "@minke/harness-overlay/client/tabs/agent-browser/controller.ts";
import {
  createAgentBrowserTabRenderer,
} from "@minke/harness-overlay/client/tabs/agent-browser/renderer.tsx";
import {
  AGENT_BROWSER_TAB_KIND,
  isAgentBrowserTab,
} from "@minke/harness-overlay/client/tabs/agent-browser/types.ts";
import {
  configureAgentBrowserWebview,
} from "@minke/harness-overlay/client/tabs/agent-browser/webview.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  inspectCssContract,
} from "./support/css-contract.mjs";

function projection(
  sessionId,
  patch = {},
) {
  return {
    sessionId,
    partition: `minke-agent-${sessionId}`,
    generation: 1,
    owner: "agent",
    status: "ready",
    url: "https://example.com/",
    title: `Agent ${sessionId}`,
    ...patch,
  };
}

function agentCursor(patch = {}) {
  return {
    sequence: 1,
    phase: "moving",
    point: { x: 430, y: 431.5 },
    viewport: { width: 860, height: 863 },
    durationMs: 180,
    ...patch,
  };
}

test("cursor click feedback waits only for uncommitted travel", () => {
  const moving = agentCursor();
  const clicking = agentCursor({
    sequence: 2,
    phase: "clicking",
  });

  assert.equal(agentCursorFeedbackDelayMs(undefined, clicking), 0);
  assert.equal(agentCursorFeedbackDelayMs(moving, clicking), 0);
  assert.equal(
    agentCursorFeedbackDelayMs(
      agentCursor({
        point: { x: 10, y: 20 },
      }),
      clicking,
    ),
    180,
  );
  assert.equal(
    agentCursorFeedbackDelayMs(
      agentCursor({
        point: { x: 10, y: 20 },
      }),
      agentCursor({
        sequence: 3,
        point: { x: 400, y: 300 },
      }),
    ),
    0,
  );
});

function annotationTarget(patch = {}) {
  return {
    targetId: "target-t1",
    tag: "h3",
    role: "heading",
    text: "Search result",
    selector: "main > h3",
    path: "html > body > main > h3",
    position: { x: 220, y: 80 },
    rect: { x: 120, y: 60, width: 200, height: 40 },
    viewport: { width: 860, height: 863 },
    frame: "top document",
    ...patch,
  };
}

function annotationPage() {
  return {
    url: "https://example.com/",
    title: "Example",
    viewport: { width: 860, height: 863 },
  };
}

function selectedAnnotationEvent(target = annotationTarget()) {
  return {
    type: "selected",
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
    generation: 2,
    page: annotationPage(),
    target,
  };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const translations = {
  "agentBrowser.action.takeControl": "Take control",
  "agentBrowser.action.returnControl": "Return control",
  "agentBrowser.annotation.action.start": "Annotate page",
  "agentBrowser.annotation.action.cancel": "Stop annotating",
  "agentBrowser.annotation.action.send": "Send",
  "agentBrowser.annotation.action.sending": "Sending…",
  "agentBrowser.annotation.action.sendCount": "Send {count} annotations",
  "agentBrowser.annotation.action.dismiss": "Dismiss",
  "agentBrowser.annotation.action.add": "Add",
  "agentBrowser.annotation.action.save": "Save",
  "agentBrowser.annotation.action.delete": "Delete",
  "agentBrowser.annotation.action.editNumber": "Edit annotation {number}",
  "agentBrowser.annotation.comment.label": "Page element comment",
  "agentBrowser.annotation.comment.add": "Add comment",
  "agentBrowser.annotation.comment.edit": "Edit comment",
  "agentBrowser.annotation.comment.placeholder": "Add a comment…",
  "agentBrowser.annotation.comment.shortcut": "Ctrl + Enter",
  "agentBrowser.annotation.error.stale":
    "A selected page element is no longer available. Delete it or select it again before sending.",
  "agentBrowser.annotation.status.active": "Annotating",
  "agentBrowser.annotation.status.pick": "Click an element",
  "agentBrowser.annotation.status.count": "{count} added",
  "agentBrowser.state.agent": "Agent is controlling",
  "agentBrowser.state.human": "You are controlling",
  "agentBrowser.state.pending": "Switching control",
  "agentBrowser.state.crashed": "Browser crashed",
  "agentBrowser.tab.defaultTitle": "Agent Browser",
};

function translate(key) {
  return translations[key];
}

function fixture(initial = [], dependencies) {
  const controlCalls = [];
  const closeCalls = [];
  const annotationStarts = [];
  const annotationStops = [];
  const annotationCommits = [];
  const annotationRefreshes = [];
  let listener = () => {};
  let annotationListener = () => {};
  let annotationCommit = async (request) => ({
    sessionId: request.sessionId,
    annotationSessionId: request.annotationSessionId,
    generation: 2,
    page: {
      url: "https://example.com/",
      title: "Example",
      viewport: { width: 860, height: 863 },
    },
    targets: [],
    mimeType: "image/png",
    data: "aGVsbG8=",
  });
  let annotationStart = async (sessionId) => ({
    sessionId,
    annotationSessionId: "annotation-a1",
    generation: 2,
    page: {
      url: "https://example.com/",
      title: "Example",
      viewport: { width: 860, height: 863 },
    },
  });
  let annotationRefresh = async (request) => ({
    sessionId: request.sessionId,
    annotationSessionId: request.annotationSessionId,
    generation: 2,
    page: {
      url: "https://example.com/",
      title: "Example",
      viewport: { width: 860, height: 863 },
    },
    targets: [],
  });
  let control = async (sessionId, owner) =>
    projection(sessionId, {
      generation: 2,
      owner,
      status: owner === "human" ? "paused" : "ready",
    });
  const port = {
    available: true,
    async read() {
      return initial;
    },
    async setControl(sessionId, owner) {
      controlCalls.push([sessionId, owner]);
      return await control(sessionId, owner);
    },
    async startAnnotation(sessionId) {
      annotationStarts.push(sessionId);
      return await annotationStart(sessionId);
    },
    async stopAnnotation(request) {
      annotationStops.push(request);
    },
    async refreshAnnotation(request) {
      annotationRefreshes.push(request);
      return await annotationRefresh(request);
    },
    async commitAnnotation(request) {
      annotationCommits.push(request);
      return await annotationCommit(request);
    },
    close(sessionId) {
      closeCalls.push(sessionId);
    },
    subscribe(next) {
      listener = next;
      return () => {
        listener = () => {};
      };
    },
    subscribeAnnotationEvents(next) {
      annotationListener = next;
      return () => {
        annotationListener = () => {};
      };
    },
  };
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new AgentBrowserTabsController(
    tabs,
    port,
    dependencies,
  );
  return {
    tabs,
    port,
    controller,
    controlCalls,
    closeCalls,
    annotationStarts,
    annotationStops,
    annotationCommits,
    annotationRefreshes,
    publish(projections) {
      listener(projections);
    },
    setControl(run) {
      control = run;
    },
    setAnnotationCommit(run) {
      annotationCommit = run;
    },
    setAnnotationStart(run) {
      annotationStart = run;
    },
    setAnnotationRefresh(run) {
      annotationRefresh = run;
    },
    publishAnnotation(event) {
      annotationListener(event);
    },
  };
}

test("Agent Browser projections create independent agent-web tabs", async () => {
  const first = projection("session-1");
  const second = projection("session-2", {
    title: undefined,
  });
  const target = fixture([first, second]);

  await target.controller.initialize();

  const snapshot = target.tabs.getSnapshot();
  assert.equal(snapshot.tabs.length, 2);
  assert.deepEqual(
    snapshot.tabs.map(({ kind, key }) => ({ kind, key })),
    [
      {
        kind: AGENT_BROWSER_TAB_KIND,
        key: "session:session-1",
      },
      {
        kind: AGENT_BROWSER_TAB_KIND,
        key: "session:session-2",
      },
    ],
  );
  assert.equal(snapshot.tabs[1].title, "example.com");
  assert.equal(isAgentBrowserTab(snapshot.tabs[0]), true);
  assert.equal(snapshot.tabs[0].payload.controlPending, false);

  target.publish([
    projection("session-1", {
      generation: 2,
      owner: "human",
      status: "paused",
      title: "Taken over",
    }),
    second,
  ]);
  assert.equal(
    target.tabs.getSnapshot().tabs[0].payload.owner,
    "human",
  );
  assert.equal(target.tabs.getSnapshot().tabs[0].title, "Taken over");

  target.controller.dispose();
  target.tabs.dispose();
});

test("human control is authoritative and tab removal reaps once", async () => {
  const target = fixture([projection("session-1")]);
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  const pending = deferred();
  target.setControl(async () => await pending.promise);

  const takingControl = target.controller.setOwner(
    tab.id,
    "human",
  );
  assert.equal(target.tabs.tab(tab.id).payload.owner, "agent");
  assert.equal(target.tabs.tab(tab.id).payload.controlPending, true);
  pending.resolve(
    projection("session-1", {
      generation: 2,
      owner: "human",
      status: "paused",
    }),
  );
  await takingControl;

  assert.deepEqual(target.controlCalls, [["session-1", "human"]]);
  assert.equal(target.tabs.tab(tab.id).payload.owner, "human");
  assert.equal(target.tabs.tab(tab.id).payload.controlPending, false);

  assert.equal(target.controller.beforeClose(tab), true);
  target.tabs.close(tab.id);
  assert.deepEqual(target.closeCalls, ["session-1"]);

  target.publish([]);
  assert.deepEqual(target.closeCalls, ["session-1"]);
  target.controller.dispose();
  target.tabs.dispose();
});

test("remote removal does not echo close and stale generations are ignored", async () => {
  const target = fixture([
    projection("session-1", {
      generation: 3,
      title: "Current",
    }),
  ]);
  await target.controller.initialize();
  const tabId = target.tabs.getSnapshot().tabs[0].id;

  target.publish([
    projection("session-1", {
      generation: 2,
      title: "Stale",
    }),
  ]);
  assert.equal(target.tabs.tab(tabId).title, "Current");

  target.publish([]);
  assert.equal(target.tabs.tab(tabId), undefined);
  assert.deepEqual(target.closeCalls, []);

  target.controller.dispose();
  target.tabs.dispose();
});

test("programmatic tab removal and disposal close owned sessions", async () => {
  const target = fixture([
    projection("session-1"),
    projection("session-2"),
  ]);
  await target.controller.initialize();
  const [first, second] = target.tabs.getSnapshot().tabs;

  target.tabs.close(first.id);
  assert.deepEqual(target.closeCalls, ["session-1"]);

  target.controller.dispose();
  assert.deepEqual(target.closeCalls, ["session-1", "session-2"]);
  assert.equal(target.tabs.tab(second.id), undefined);
  target.tabs.dispose();
});

test("numbered DOM comments keep their Chat target and send one bundle", async () => {
  let currentChat = "chat-1";
  const sent = [];
  const targetNode = {
    targetId: "target-t1",
    tag: "h3",
    role: "heading",
    text: "Search result",
    selector: "main > h3",
    path: "html > body > main > h3",
    position: { x: 220, y: 80 },
    rect: { x: 120, y: 60, width: 200, height: 40 },
    viewport: { width: 860, height: 863 },
    frame: "top document",
  };
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget() {
          return { sessionId: currentChat };
        },
        async sendScreenshot(screenshot, chatTarget) {
          sent.push({ screenshot, chatTarget });
        },
      },
      async composeImage(screenshot, comments) {
        assert.equal(screenshot.data, "aGVsbG8=");
        assert.equal(comments.length, 1);
        return "YW5ub3RhdGVk";
      },
    },
  );
  target.setAnnotationCommit(async (request) => ({
    sessionId: request.sessionId,
    annotationSessionId: request.annotationSessionId,
    generation: 2,
    page: {
      url: "https://example.com/",
      title: "Example",
      viewport: { width: 860, height: 863 },
    },
    targets: [targetNode],
    mimeType: "image/png",
    data: "aGVsbG8=",
  }));
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];

  await target.controller.startAnnotation(tab.id);
  assert.deepEqual(target.controlCalls, [["session-1", "human"]]);
  assert.deepEqual(target.annotationStarts, ["session-1"]);
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).phase,
    "active",
  );
  const renderer = createAgentBrowserTabRenderer(
    target.controller,
    translate,
  );
  const emptyAnnotationActions = renderToStaticMarkup(
    renderer.renderTrailingActions(target.tabs.tab(tab.id)),
  );
  assert.doesNotMatch(
    emptyAnnotationActions,
    /minke-agent-browser__annotation-send-action/u,
  );

  currentChat = "chat-2";
  target.publishAnnotation({
    type: "selected",
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
    generation: 2,
    page: {
      url: "https://example.com/",
      title: "Example",
      viewport: { width: 860, height: 863 },
    },
    target: targetNode,
  });
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).draft?.targetId,
    "target-t1",
  );
  target.controller.commitAnnotation(tab.id, "这是什么");
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).count,
    1,
  );
  const enabledSendMarkup = renderToStaticMarkup(
    renderer.renderTrailingActions(target.tabs.tab(tab.id)),
  ).match(
    /<button[^>]*minke-agent-browser__annotation-send-action[\s\S]*?<\/button>/u,
  )?.[0];
  assert.ok(enabledSendMarkup);
  assert.match(enabledSendMarkup, /<svg/u);
  assert.match(
    enabledSendMarkup,
    /minke-agent-browser__annotation-send-count">1</u,
  );
  assert.match(enabledSendMarkup, /title="Send 1 annotations"/u);
  assert.doesNotMatch(
    enabledSendMarkup,
    /disabled=""|>Send(?: 1)?<|<b>/u,
  );
  const annotationStatusMarkup = renderToStaticMarkup(
    renderer.renderToolbarCenter(target.tabs.tab(tab.id)),
  );
  assert.match(
    annotationStatusMarkup,
    /data-annotation-active="true"/u,
  );
  assert.match(annotationStatusMarkup, />Annotating</u);
  assert.match(annotationStatusMarkup, /role="status"/u);
  assert.match(annotationStatusMarkup, />1 added</u);
  const annotatedViewMarkup = renderToStaticMarkup(
    renderer.renderView(target.tabs.tab(tab.id), true),
  );
  assert.doesNotMatch(
    annotatedViewMarkup,
    /minke-agent-browser__annotation-mode/u,
  );

  await target.controller.sendAnnotations(tab.id);

  assert.deepEqual(target.annotationCommits, [{
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
    targetIds: ["target-t1"],
  }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].chatTarget, { sessionId: "chat-1" });
  assert.equal(sent[0].screenshot.data, "YW5ub3RhdGVk");
  assert.match(
    sent[0].screenshot.text,
    /### User Comment 1\n这是什么/u,
  );
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).phase,
    "idle",
  );
  assert.deepEqual(target.annotationStops, [{
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
  }]);

  target.controller.dispose();
  target.tabs.dispose();
});

test("a DOM selection emitted during annotation startup is retained", async () => {
  const startGate = deferred();
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget: () => ({ sessionId: "chat-1" }),
        async sendScreenshot() {},
      },
    },
  );
  target.setAnnotationStart(
    async () => await startGate.promise,
  );
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];

  const starting = target.controller.startAnnotation(tab.id);
  await nextTurn();
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).phase,
    "starting",
  );
  target.publishAnnotation(selectedAnnotationEvent());
  startGate.resolve({
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
    generation: 2,
    page: annotationPage(),
  });
  await starting;

  const snapshot =
    target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.phase, "active");
  assert.equal(snapshot.draft?.targetId, "target-t1");

  target.controller.dispose();
  target.tabs.dispose();
});

test("selecting the same DOM node edits its existing numbered comment", async () => {
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget: () => ({ sessionId: "chat-1" }),
        async sendScreenshot() {},
      },
    },
  );
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  await target.controller.startAnnotation(tab.id);

  target.publishAnnotation(selectedAnnotationEvent());
  target.controller.commitAnnotation(tab.id, "first question");
  target.publishAnnotation(selectedAnnotationEvent(annotationTarget({
    rect: { x: 140, y: 70, width: 210, height: 44 },
  })));

  let snapshot =
    target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.editingIndex, 1);
  assert.equal(snapshot.draftComment, "first question");
  assert.deepEqual(snapshot.draft?.rect, {
    x: 140,
    y: 70,
    width: 210,
    height: 44,
  });
  const renderer = createAgentBrowserTabRenderer(
    target.controller,
    translate,
  );
  const editorMarkup = renderToStaticMarkup(
    renderer.renderView(target.tabs.tab(tab.id), true),
  );
  assert.match(
    editorMarkup,
    /class="minke-agent-browser__annotation-editor"/u,
  );
  assert.match(editorMarkup, /<textarea[^>]*rows="2"/u);
  assert.doesNotMatch(editorMarkup, /data-multiline/u);
  assert.doesNotMatch(editorMarkup, /<header>|<footer>/u);

  target.controller.commitAnnotation(tab.id, "updated question");
  snapshot = target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.comments[0].comment, "updated question");
  assert.deepEqual(snapshot.comments[0].target.rect, {
    x: 140,
    y: 70,
    width: 210,
    height: 44,
  });

  target.controller.dispose();
  target.tabs.dispose();
});

test("annotation lifecycle changes prevent an old send from reaching Chat", async (t) => {
  for (const action of [
    "cancel",
    "close",
    "dispose",
    "return-control",
  ]) {
    await t.test(action, async () => {
      const composeStarted = deferred();
      const composeGate = deferred();
      const sent = [];
      const targetNode = annotationTarget();
      const target = fixture(
        [projection("session-1")],
        {
          chat: {
            currentTarget: () => ({ sessionId: "chat-1" }),
            async sendScreenshot(...args) {
              sent.push(args);
            },
          },
          async composeImage() {
            composeStarted.resolve();
            await composeGate.promise;
            return "YW5ub3RhdGVk";
          },
        },
      );
      target.setAnnotationCommit(async (request) => ({
        sessionId: request.sessionId,
        annotationSessionId: request.annotationSessionId,
        generation: 2,
        page: annotationPage(),
        targets: [targetNode],
        mimeType: "image/png",
        data: "aGVsbG8=",
      }));
      await target.controller.initialize();
      const tab = target.tabs.getSnapshot().tabs[0];
      await target.controller.startAnnotation(tab.id);
      target.publishAnnotation(
        selectedAnnotationEvent(targetNode),
      );
      target.controller.commitAnnotation(tab.id, "question");

      const sending = target.controller.sendAnnotations(tab.id);
      await composeStarted.promise;
      if (action === "cancel") {
        await target.controller.cancelAnnotation(tab.id);
      } else if (action === "close") {
        target.controller.beforeClose(tab);
        target.tabs.close(tab.id);
      } else if (action === "dispose") {
        target.controller.dispose();
      } else {
        await target.controller.setOwner(tab.id, "agent");
      }
      composeGate.resolve();
      await sending;

      assert.equal(sent.length, 0);
      if (action !== "dispose") target.controller.dispose();
      target.tabs.dispose();
    });
  }
});

test("send supplies an abort signal to Chat ports that support it", async () => {
  const chatStarted = deferred();
  let observedSignal;
  const targetNode = annotationTarget();
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget: () => ({ sessionId: "chat-1" }),
        async sendScreenshot(_screenshot, _chatTarget, options) {
          observedSignal = options.signal;
          chatStarted.resolve();
          await new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(
                new DOMException("cancelled", "AbortError"),
              ),
              { once: true },
            );
          });
        },
      },
      async composeImage() {
        return "YW5ub3RhdGVk";
      },
    },
  );
  target.setAnnotationCommit(async (request) => ({
    sessionId: request.sessionId,
    annotationSessionId: request.annotationSessionId,
    generation: 2,
    page: annotationPage(),
    targets: [targetNode],
    mimeType: "image/png",
    data: "aGVsbG8=",
  }));
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  await target.controller.startAnnotation(tab.id);
  target.publishAnnotation(selectedAnnotationEvent(targetNode));
  target.controller.commitAnnotation(tab.id, "question");

  const sending = target.controller.sendAnnotations(tab.id);
  await chatStarted.promise;
  await target.controller.cancelAnnotation(tab.id);
  await sending;

  assert.equal(observedSignal instanceof AbortSignal, true);
  assert.equal(observedSignal.aborted, true);
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).phase,
    "idle",
  );

  target.controller.dispose();
  target.tabs.dispose();
});

test("missing refreshed DOM targets stay editable but cannot be sent", async () => {
  const targetNode = annotationTarget();
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget: () => ({ sessionId: "chat-1" }),
        async sendScreenshot() {
          assert.fail("a stale annotation must not be sent");
        },
      },
    },
  );
  target.setAnnotationRefresh(async (request) => ({
    sessionId: request.sessionId,
    annotationSessionId: request.annotationSessionId,
    generation: 2,
    page: annotationPage(),
    targets: [],
  }));
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  await target.controller.startAnnotation(tab.id);
  target.publishAnnotation(selectedAnnotationEvent(targetNode));
  target.controller.commitAnnotation(tab.id, "question");

  await new Promise((resolve) => setTimeout(resolve, 740));
  let snapshot =
    target.controller.getAnnotationSnapshot(tab.id);
  assert.deepEqual(snapshot.staleTargetIds, ["target-t1"]);
  assert.match(snapshot.error, /no longer available/u);
  assert.equal(snapshot.count, 1);

  const renderer = createAgentBrowserTabRenderer(
    target.controller,
    translate,
  );
  const actionMarkup = renderToStaticMarkup(
    renderer.renderTrailingActions(target.tabs.tab(tab.id)),
  );
  const sendActionMarkup = actionMarkup.match(
    /<button[^>]*minke-agent-browser__annotation-send-action[\s\S]*?<\/button>/u,
  )?.[0];
  assert.ok(sendActionMarkup);
  assert.match(sendActionMarkup, /<svg/u);
  assert.match(
    sendActionMarkup,
    /minke-agent-browser__annotation-send-count">1</u,
  );
  assert.match(sendActionMarkup, /title="Send 1 annotations"/u);
  assert.doesNotMatch(sendActionMarkup, />Send(?: 1)?</u);
  assert.match(sendActionMarkup, /disabled=""/u);
  assert.doesNotMatch(sendActionMarkup, /<b>/u);
  const viewMarkup = renderToStaticMarkup(
    renderer.renderView(target.tabs.tab(tab.id), true),
  );
  assert.match(viewMarkup, /data-stale="true"/u);
  assert.match(viewMarkup, /no longer available/u);

  target.controller.editAnnotation(tab.id, 1);
  snapshot = target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.editingIndex, 1);
  assert.equal(snapshot.draftComment, "question");
  target.controller.removeAnnotation(tab.id, 1);
  snapshot = target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.count, 0);
  assert.equal(snapshot.staleTargetIds, undefined);
  assert.equal(snapshot.error, undefined);

  target.controller.dispose();
  target.tabs.dispose();
});

test("an in-flight layout refresh cannot overwrite the sending state", async () => {
  const refreshStarted = deferred();
  const refreshGate = deferred();
  const commitGate = deferred();
  const targetNode = annotationTarget();
  const target = fixture(
    [projection("session-1")],
    {
      chat: {
        currentTarget: () => ({ sessionId: "chat-1" }),
        async sendScreenshot() {},
      },
      async composeImage() {
        return "YW5ub3RhdGVk";
      },
    },
  );
  target.setAnnotationRefresh(async (request) => {
    refreshStarted.resolve();
    await refreshGate.promise;
    return {
      sessionId: request.sessionId,
      annotationSessionId: request.annotationSessionId,
      generation: 2,
      page: annotationPage(),
      targets: [annotationTarget({
        rect: { x: 500, y: 400, width: 50, height: 20 },
      })],
    };
  });
  target.setAnnotationCommit(
    async () => await commitGate.promise,
  );
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  await target.controller.startAnnotation(tab.id);
  target.publishAnnotation(selectedAnnotationEvent(targetNode));
  target.controller.commitAnnotation(tab.id, "question");
  await refreshStarted.promise;

  const sending = target.controller.sendAnnotations(tab.id);
  assert.equal(
    target.controller.getAnnotationSnapshot(tab.id).phase,
    "sending",
  );
  refreshGate.resolve();
  await nextTurn();
  let snapshot =
    target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.phase, "sending");
  assert.deepEqual(snapshot.comments[0].target.rect, targetNode.rect);

  commitGate.resolve({
    sessionId: "session-1",
    annotationSessionId: "annotation-a1",
    generation: 2,
    page: annotationPage(),
    targets: [targetNode],
    mimeType: "image/png",
    data: "aGVsbG8=",
  });
  await sending;
  snapshot = target.controller.getAnnotationSnapshot(tab.id);
  assert.equal(snapshot.phase, "idle");

  target.controller.dispose();
  target.tabs.dispose();
});

test("Agent Browser webviews start blank in their assigned partition", () => {
  const attributes = new Map();
  const view = {
    className: "",
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };

  configureAgentBrowserWebview(view, {
    partition: "minke-agent-session-1",
    label: "Agent session",
  });

  assert.equal(view.className, "minke-agent-browser__guest");
  assert.equal(attributes.get("src"), "about:blank");
  assert.equal(
    attributes.get("partition"),
    "minke-agent-session-1",
  );
  assert.equal(attributes.get("aria-label"), "Agent session");
  assert.equal(attributes.has("useragent"), false);
  assert.match(attributes.get("webpreferences"), /sandbox=yes/u);
  assert.match(
    attributes.get("webpreferences"),
    /nodeIntegration=no/u,
  );
});

test("Agent Browser renderer shields agent input and exposes takeover", () => {
  const target = fixture();
  const renderer = createAgentBrowserTabRenderer(
    target.controller,
    translate,
  );
  const agentTab = {
    id: "tab-1",
    kind: AGENT_BROWSER_TAB_KIND,
    key: "session:session-1",
    title: "Agent Browser",
    payload: {
      ...projection("session-1", {
        cursor: agentCursor(),
      }),
      controlPending: false,
    },
  };

  assert.equal(renderer.kind, AGENT_BROWSER_TAB_KIND);
  assert.equal(renderer.createOptions, undefined);
  const agentIconMarkup = renderToStaticMarkup(
    renderer.renderIcon(agentTab),
  );
  assert.match(
    agentIconMarkup,
    /class="minke-agent-browser__tab-signal"/u,
  );
  assert.match(agentIconMarkup, /data-agent-active="true"/u);
  assert.match(agentIconMarkup, /data-owner="agent"/u);
  assert.match(agentIconMarkup, /data-status="ready"/u);
  assert.match(agentIconMarkup, /aria-hidden="true"/u);
  const actionMarkup = renderToStaticMarkup(
    renderer.renderTrailingActions(agentTab),
  );
  const controlIconMarkup = renderToStaticMarkup(
    createElement(LucideIcon, {
      icon: MousePointerClick,
      size: 14,
    }),
  );
  assert.match(actionMarkup, /aria-label="Take control"/u);
  assert.ok(
    actionMarkup.includes(controlIconMarkup),
    "the control action must use MousePointerClick, not the page globe",
  );
  const annotationIconMarkup = renderToStaticMarkup(
    createElement(LucideIcon, {
      icon: MessageCirclePlus,
      size: 14,
    }),
  );
  assert.ok(
    actionMarkup.includes(annotationIconMarkup),
    "the annotation action must use MessageCirclePlus",
  );
  assert.match(actionMarkup, /data-active-tone="success"/u);
  const agentMarkup = renderToStaticMarkup(
    renderer.renderView(agentTab, true),
  );
  assert.match(agentMarkup, /data-agent-input-shield=""/u);
  assert.match(agentMarkup, />Take control</u);
  assert.match(agentMarkup, /data-owner="agent"/u);
  assert.match(agentMarkup, /data-agent-active="true"/u);
  assert.match(agentMarkup, /data-agent-cursor=""/u);
  assert.match(agentMarkup, /aria-hidden="true"/u);
  assert.match(agentMarkup, /data-phase="moving"/u);
  assert.match(agentMarkup, /data-sequence="1"/u);
  assert.doesNotMatch(agentMarkup, /data-click-sequence/u);
  assert.doesNotMatch(agentMarkup, /agent-cursor-particle/u);
  assert.match(agentMarkup, /<linearGradient/u);
  assert.match(agentMarkup, /stop-color="#4cecff"/u);
  assert.match(agentMarkup, /stop-color="#ff6fc6"/u);
  assert.match(
    agentMarkup,
    /agent-cursor-body" d="M3[\s\S]*l-6\.1\.3[\s\S]*l-2\.18/u,
  );
  assert.match(
    agentMarkup,
    /--minke-agent-cursor-duration:180ms/u,
  );
  assert.match(agentMarkup, /--minke-agent-cursor-x:50/u);
  assert.match(agentMarkup, /--minke-agent-cursor-y:50/u);

  const clickingMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        cursor: agentCursor({
          sequence: 2,
          phase: "clicking",
          point: { x: -40, y: 900 },
          durationMs: 260,
        }),
      },
    }, true),
  );
  assert.match(clickingMarkup, /data-phase="clicking"/u);
  assert.match(clickingMarkup, /data-sequence="2"/u);
  assert.match(clickingMarkup, /data-flip-y="true"/u);
  assert.doesNotMatch(clickingMarkup, /data-flip-x="true"/u);
  assert.match(clickingMarkup, /data-click-sequence="2"/u);
  assert.match(clickingMarkup, /data-pressed="true"/u);
  assert.match(clickingMarkup, /agent-cursor-bloom/u);
  assert.equal(
    [
      ...clickingMarkup.matchAll(
        /class="minke-agent-browser__agent-cursor-particle"/gu,
      ),
    ].length,
    8,
  );
  assert.match(
    clickingMarkup,
    /--minke-agent-cursor-duration:260ms/u,
  );
  assert.match(
    clickingMarkup,
    /--minke-agent-cursor-feedback-delay:0ms/u,
  );
  assert.match(clickingMarkup, /--minke-agent-cursor-x:0/u);
  assert.match(clickingMarkup, /--minke-agent-cursor-y:100/u);
  const rightEdgeMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        cursor: agentCursor({
          sequence: 3,
          point: { x: 900, y: 40 },
        }),
      },
    }, true),
  );
  assert.match(rightEdgeMarkup, /data-flip-x="true"/u);
  assert.doesNotMatch(rightEdgeMarkup, /data-flip-y="true"/u);
  assert.match(rightEdgeMarkup, /--minke-agent-cursor-x:100/u);

  const humanMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        owner: "human",
        status: "paused",
      },
    }, true),
  );
  assert.doesNotMatch(humanMarkup, /data-agent-input-shield/u);
  assert.match(humanMarkup, /data-owner="human"/u);
  assert.doesNotMatch(humanMarkup, /data-agent-active/u);
  assert.doesNotMatch(humanMarkup, /data-agent-cursor/u);
  const humanIconMarkup = renderToStaticMarkup(
    renderer.renderIcon({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        owner: "human",
        status: "paused",
      },
    }),
  );
  assert.doesNotMatch(humanIconMarkup, /data-agent-active/u);
  assert.match(humanIconMarkup, /data-owner="human"/u);
  const pendingIconMarkup = renderToStaticMarkup(
    renderer.renderIcon({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        controlPending: true,
      },
    }),
  );
  assert.match(pendingIconMarkup, /data-control-pending="true"/u);
  assert.doesNotMatch(pendingIconMarkup, /data-agent-active/u);
  const pendingMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        status: "pending",
        controlPending: false,
      },
    }, true),
  );
  assert.doesNotMatch(pendingMarkup, /data-agent-cursor/u);
  const switchingMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        controlPending: true,
      },
    }, true),
  );
  assert.doesNotMatch(switchingMarkup, /data-agent-cursor/u);
  const crashedIconMarkup = renderToStaticMarkup(
    renderer.renderIcon({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        status: "crashed",
      },
    }),
  );
  assert.doesNotMatch(crashedIconMarkup, /data-agent-active/u);
  const crashedMarkup = renderToStaticMarkup(
    renderer.renderView({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        status: "crashed",
      },
    }, true),
  );
  assert.doesNotMatch(crashedMarkup, /data-agent-cursor/u);

  target.controller.dispose();
  target.tabs.dispose();
});

test("Agent Browser control styling animates only agent-owned surfaces", async () => {
  const source = await readFile(
    new URL(
      "../packages/harness-overlay/src/client/tabs/agent-browser/styles.css",
      import.meta.url,
    ),
    "utf8",
  );
  const contract = inspectCssContract(source);

  assert.match(
    source,
    /\.minke-tab:has\([\s\S]*data-agent-active[\s\S]*\)::after/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__view\[data-agent-active\]::before/u,
  );
  assert.match(source, /offset-path:\s*inset\(/u);
  assert.match(source, /offset-distance:\s*100%/u);
  assert.doesNotMatch(
    source,
    /\.minke-tab:has\([\s\S]*?data-agent-active[\s\S]*?\)\s*\{[^}]*overflow:\s*hidden/u,
  );
  assert.doesNotMatch(source, /filter:\s*drop-shadow/u);
  assert.match(
    source,
    /@keyframes minke-agent-browser-tab-flow[\s\S]*from\s*\{[\s\S]*background-position:\s*100% 50%[\s\S]*to\s*\{[\s\S]*background-position:\s*0% 50%/u,
  );
  assert.match(
    source,
    /animation:\s*minke-agent-browser-tab-flow 7\.2s linear infinite/u,
  );
  assert.equal(
    [
      ...source.matchAll(
        /var\(--dsw-alias-brand-primary\) 10%,\s*transparent\s*\) (?:0|50)%/gu,
      ),
    ].length,
    2,
  );
  assert.match(source, /background-size:\s*200% 100%/u);
  assert.match(
    source,
    /@keyframes minke-agent-browser-frame-flow/u,
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__agent-cursor-layer\s*\{[^}]*container-type:\s*size[^}]*pointer-events:\s*none/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__agent-cursor-layer \*[\s\S]*pointer-events:\s*none/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__agent-cursor-track\s*\{[\s\S]*transform:\s*translate3d\([\s\S]*var\(--minke-agent-cursor-x\) \* 1cqw[\s\S]*var\(--minke-agent-cursor-y\) \* 1cqh[\s\S]*transition-duration:\s*var\(--minke-agent-cursor-duration\)[\s\S]*transition-property:\s*transform/u,
  );
  assert.equal(
    [
      ...source.matchAll(
        /animation-delay:\s*var\(--minke-agent-cursor-feedback-delay\)/gu,
      ),
    ].length,
    3,
  );
  assert.equal(
    contract.hasSelector(
      ".minke-agent-browser__agent-cursor-beacon::before",
    ),
    false,
  );
  assert.match(
    source,
    /\.minke-agent-browser__agent-cursor-beacon\s*\{[^}]*z-index:\s*2[\s\S]*\.minke-agent-browser__agent-cursor-beacon\[data-pressed\]\s*\{[\s\S]*animation:\s*minke-agent-browser-cursor-press/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__agent-cursor-ripple\s*\{[^}]*z-index:\s*1[^}]*width:\s*0[^}]*height:\s*0/u,
  );
  const bloomSelector =
    ".minke-agent-browser__agent-cursor-bloom";
  const particleSelector =
    ".minke-agent-browser__agent-cursor-particle";
  assert.deepEqual(
    {
      bloomAnimation:
        contract.declaration(bloomSelector, "animation")
          ?.split(/\s/u)[0],
      bloomBackground:
        contract.declaration(bloomSelector, "background")
          ?.split("(", 1)[0],
      particleAnimation:
        contract.declaration(particleSelector, "animation")
          ?.split(/\s/u)[0],
      particleBackground:
        contract.declaration(particleSelector, "background"),
    },
    {
      bloomAnimation:
        "minke-agent-browser-cursor-bloom",
      bloomBackground: "linear-gradient",
      particleAnimation:
        "minke-agent-browser-cursor-scatter",
      particleBackground:
        "var(--minke-agent-cursor-particle-fill)",
    },
  );
  assert.equal(
    contract.hasSelector(
      '.minke-agent-browser__agent-cursor-particle[data-particle="8"]',
    ),
    true,
  );
  assert.deepEqual(
    {
      rippleAfter: contract.hasSelector(
        ".minke-agent-browser__agent-cursor-ripple::after",
      ),
      rippleBefore: contract.hasSelector(
        ".minke-agent-browser__agent-cursor-ripple::before",
      ),
      wave: contract.hasKeyframes(
        "minke-agent-browser-cursor-wave",
      ),
    },
    {
      rippleAfter: false,
      rippleBefore: false,
      wave: false,
    },
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.minke-agent-browser__agent-cursor-track[\s\S]*transition:\s*none[\s\S]*will-change:\s*auto/u,
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.minke-agent-browser__agent-cursor-bloom\s*\{[^}]*animation:\s*minke-agent-browser-cursor-bloom-reduced[\s\S]*\.minke-agent-browser__agent-cursor-particle\s*\{[^}]*display:\s*none/u,
  );
  assert.match(
    source,
    /\.minke-agent-browser__annotation-layer\[data-phase="sending"\]\s*\{[^}]*pointer-events:\s*auto[^}]*touch-action:\s*none[^}]*user-select:\s*none/u,
  );
  const sendSelector =
    ".minke-agent-browser__annotation-send-action";
  const drawerSendSelector =
    '.minke-tabs-panel[data-placement="right"]' +
    '[data-presentation="drawer"] ' +
    sendSelector;
  const editorButtonSelector =
    ".minke-agent-browser__annotation-editor > button";
  const editorTextAreaSelector =
    ".minke-agent-browser__annotation-editor textarea";
  assert.deepEqual(
    {
      accent: contract.declaration(
        ".minke-agent-browser__annotation-layer",
        "--minke-agent-browser-annotation-accent",
      ),
      add: {
        background: contract.declaration(
          ".minke-agent-browser__annotation-add",
          "background",
        ),
        borderRadius: contract.declaration(
          ".minke-agent-browser__annotation-add",
          "border-radius",
        ),
        color: contract.declaration(
          ".minke-agent-browser__annotation-add",
          "color",
        ),
      },
      count: {
        font: contract.declaration(
          ".minke-agent-browser__annotation-send-count",
          "font",
        ),
        numeric: contract.declaration(
          ".minke-agent-browser__annotation-send-count",
          "font-variant-numeric",
        ),
      },
      disabledSend: {
        background: contract.declaration(
          `${sendSelector}:disabled`,
          "background",
        ),
        color: contract.declaration(
          `${sendSelector}:disabled`,
          "color",
        ),
      },
      drawerSend: {
        height: contract.declaration(
          drawerSendSelector,
          "height",
        ),
        minWidth: contract.declaration(
          drawerSendSelector,
          "min-width",
        ),
      },
      editor: {
        alignItems: contract.declaration(
          ".minke-agent-browser__annotation-editor",
          "align-items",
        ),
        buttonHeight: contract.declaration(
          editorButtonSelector,
          "height",
        ),
        buttonMarginTop: contract.declaration(
          editorButtonSelector,
          "margin-top",
        ),
        buttonWidth: contract.declaration(
          editorButtonSelector,
          "width",
        ),
        numberAlignSelf: contract.declaration(
          ".minke-agent-browser__annotation-editor-number",
          "align-self",
        ),
        numberMarginTop: contract.declaration(
          ".minke-agent-browser__annotation-editor-number",
          "margin-top",
        ),
        textareaHeight: contract.declaration(
          editorTextAreaSelector,
          "height",
        ),
        textareaMaxHeight: contract.declaration(
          editorTextAreaSelector,
          "max-height",
        ),
        textareaMinHeight: contract.declaration(
          editorTextAreaSelector,
          "min-height",
        ),
      },
      legacyModeSelector: contract.hasSelector(
        ".minke-agent-browser__annotation-mode",
      ),
      send: {
        background: contract.declaration(
          sendSelector,
          "background",
        ),
        borderRadius: contract.declaration(
          sendSelector,
          "border-radius",
        ),
        color: contract.declaration(sendSelector, "color"),
        gap: contract.declaration(sendSelector, "gap"),
        height: contract.declaration(sendSelector, "height"),
        minWidth: contract.declaration(
          sendSelector,
          "min-width",
        ),
        padding: contract.declaration(sendSelector, "padding"),
      },
    },
    {
      accent: "#096fdb",
      add: {
        background:
          "var(--minke-agent-browser-annotation-accent) !important",
        borderRadius: "8px !important",
        color: "#fff !important",
      },
      count: {
        font: "700 10px/1 var(--ds-font-family-ui)",
        numeric: "tabular-nums",
      },
      disabledSend: {
        background:
          "color-mix( in srgb, " +
          "var(--minke-agent-browser-annotation-accent) 9%, " +
          "var(--dsw-alias-bg-base) )",
        color: "var(--dsw-alias-label-tertiary)",
      },
      drawerSend: {
        height: "44px",
        minWidth: "52px",
      },
      editor: {
        alignItems: "flex-start",
        buttonHeight: "28px",
        buttonMarginTop: "1px",
        buttonWidth: "28px",
        numberAlignSelf: "flex-start",
        numberMarginTop: "4px",
        textareaHeight: "48px",
        textareaMaxHeight: "102px",
        textareaMinHeight: "48px",
      },
      legacyModeSelector: false,
      send: {
        background:
          "var(--minke-agent-browser-annotation-accent)",
        borderRadius: "999px",
        color: "#fff",
        gap: "4px",
        height: "28px",
        minWidth: "40px",
        padding: "0 8px",
      },
    },
  );
  assert.deepEqual(
    [
      annotationCommentEditorLayout(24),
      annotationCommentEditorLayout(72),
      annotationCommentEditorLayout(132),
    ],
    [
      { height: 48, overflowY: "hidden" },
      { height: 72, overflowY: "hidden" },
      { height: 102, overflowY: "auto" },
    ],
  );
  assert.deepEqual(
    {
      enter: shouldSubmitAnnotationComment("Enter", false),
      shiftedEnter:
        shouldSubmitAnnotationComment("Enter", true),
      text: shouldSubmitAnnotationComment("a", false),
    },
    {
      enter: true,
      shiftedEnter: false,
      text: false,
    },
  );
});

test("failed return to agent control remains visible in the toolbar", async () => {
  const target = fixture([
    projection("session-1", {
      owner: "human",
      status: "paused",
    }),
  ]);
  const renderer = createAgentBrowserTabRenderer(
    target.controller,
    translate,
  );
  await target.controller.initialize();
  const tab = target.tabs.getSnapshot().tabs[0];
  target.setControl(async () => {
    throw new Error("Cannot return control");
  });

  await target.controller.setOwner(tab.id, "agent");

  const current = target.tabs.tab(tab.id);
  assert.equal(current.payload.owner, "human");
  assert.equal(current.payload.controlError, "Cannot return control");
  const toolbarMarkup = renderToStaticMarkup(
    renderer.renderToolbarCenter(current),
  );
  assert.match(toolbarMarkup, /role="alert"/u);
  assert.match(toolbarMarkup, />Cannot return control</u);
  const viewMarkup = renderToStaticMarkup(
    renderer.renderView(current, true),
  );
  assert.doesNotMatch(viewMarkup, /data-agent-input-shield/u);

  target.controller.dispose();
  target.tabs.dispose();
});
