import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@vendor/deepseek-harness/vendor/cordis/src/index.ts";
import { createSnapshotStore } from "@vendor/deepseek-harness/packages/client/store/src/index.ts";
import { ConversationController } from "@vendor/deepseek-harness/packages/client/ui-conversation/src/client/service.ts";
import { SessionInputShell } from "@vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts";
import { InputTriggerService } from "@vendor/deepseek-harness/packages/client/ui-input-trigger/src/client/service.ts";
import {
  createAgentBrowserComposerBridge,
  createAgentBrowserChatPort,
} from "@minke/harness-overlay/client/tabs/agent-browser/chat.ts";

// Execute the pinned upstream services/editor, not another copy of their API.
function fixture(t, { draft = "Keep my question" } = {}) {
  const scope = new Context();
  const opened = [];
  const promptCalls = [];
  const input = new SessionInputShell({
    actx: scope,
    defaultSink: async (...args) => {
      promptCalls.push(args);
      return { kind: "success" };
    },
    commandAttachments: {
      serialize: async () => [],
      release() {},
      unsupportedNotice: () => "Unsupported attachments",
    },
  });
  scope.on("slash/input-insert-text", ({ text, span }) =>
    input.insertText(text, span) ? true : undefined);
  scope.on("slash/input-consume-token", ({ guard }) =>
    input.consumeToken(guard) ? true : undefined);
  const service = new ConversationController(scope, {
    input: { for: () => input },
    blocks: {},
    maxConcurrentFileUploads: createSnapshotStore(2),
  });
  const triggers = new InputTriggerService(scope);
  const register = triggers.registerSource.bind(triggers);
  let source;
  triggers.registerSource = value => {
    source = value;
    return register(value);
  };
  const sessions = {
    list: { getSnapshot: () => ({ byId: { "chat-1": { retainedBy: { mainView: 1 } } } }) },
    scope: id => id === "chat-1" ? scope : undefined,
    binding: () => ({ session: { async prompt(...args) {
      promptCalls.push(args);
      return { ok: true };
    } } }),
  };
  const navigation = { openSession: id => opened.push(id) };
  const bridge = createAgentBrowserComposerBridge(sessions, navigation);
  const disconnect = bridge.connect(service, triggers);
  input.setDraft(draft);
  t.after(() => {
    disconnect();
    for (const id of input.dispose()) service.releaseDraftAttachment(id);
  });
  return {
    input, service, bridge, sessions, navigation, opened, promptCalls,
    source: () => source,
    port: createAgentBrowserChatPort(sessions, bridge),
    snapshot: () => input.state.getSnapshot(),
  };
}

const screenshot = {
  data: "iVBORw0KGgo=",
  text: "# Browser comments\n\n### User Comment 1\n这是",
};
const target = { sessionId: "chat-1" };

test("Browser comments target the main view while sidebar Sessions coexist", t => {
  const f = fixture(t);
  let byId = {
    child: { title: "Sidebar child", retainedBy: { sidebar: 1 } },
    "chat-1": { title: "Main Chat", retainedBy: { mainView: 1 } },
  };
  f.sessions.list.getSnapshot = () => ({ byId });
  assert.deepEqual(f.port.currentTarget(), { sessionId: "chat-1", title: "Main Chat" });
  byId = { child: { title: "Sidebar child", retainedBy: { sidebar: 1 } } };
  assert.equal(f.port.currentTarget(), undefined);
});

function addFileReference(input) {
  const snapshot = input.state.getSnapshot();
  assert.equal(input.insertReference({
    source: "files", ref: "/workspace/design.md", label: "design.md",
    clipboardText: "@/workspace/design.md", appearance: "file",
  }, { start: snapshot.draft.length, end: snapshot.draft.length, draftRev: snapshot.draftRev }), true);
  return input.state.getSnapshot().occurrences[0];
}

test("Browser comments stage a PNG and reference using the pinned DSH composer", async t => {
  const f = fixture(t);
  await f.port.sendScreenshot(screenshot, target);
  assert.deepEqual(f.promptCalls, []);
  assert.deepEqual(f.opened, ["chat-1"]);
  assert.equal(f.snapshot().draft, "Keep my question\n\n[1 annotation] ");
  const [attachment] = f.service.resolveDraftAttachments(f.snapshot().attachmentIds);
  assert.equal(attachment.kind, "image");
  assert.equal(attachment.file.name, "minke-browser-comments.png");
  assert.equal(attachment.file.type, "image/png");
  assert.equal(attachment.file.size, 8);
  const [reference] = f.snapshot().occurrences;
  assert.equal(reference.source, "browser-comments");
  assert.equal(reference.label, "1 annotation");
  assert.equal(await f.source().codec.serialize(reference.ref, new AbortController().signal), screenshot.text);
});

test("appending multiple Browser comments preserves existing file and comment chips", async t => {
  const f = fixture(t);
  const file = addFileReference(f.input);
  const originalDraft = f.snapshot().draft;
  await f.port.sendScreenshot(screenshot, target);
  const first = f.snapshot().occurrences[1];
  await f.port.sendScreenshot(screenshot, target);
  assert.equal(f.snapshot().draft.startsWith(originalDraft), true);
  assert.equal(f.snapshot().occurrences.length, 3);
  assert.deepEqual(f.snapshot().occurrences.slice(0, 2), [file, first]);
  assert.equal(f.snapshot().attachmentIds.length, 2);
  assert.equal(await f.source().codec.serialize(first.ref, new AbortController().signal), screenshot.text);
  assert.deepEqual(f.promptCalls, []);
});

test("unavailable or disconnected composer keeps the handoff retryable without submitting", async t => {
  const f = fixture(t);
  for (const composer of [undefined, { stage: () => false }, createAgentBrowserComposerBridge(f.sessions, f.navigation)]) {
    const port = createAgentBrowserChatPort(f.sessions, composer);
    await assert.rejects(port.sendScreenshot(screenshot, target), /composer is not ready/u);
  }
  assert.deepEqual(f.promptCalls, []);
  assert.deepEqual(f.opened, []);
  assert.equal(f.snapshot().draft, "Keep my question");
});

test("staging does not materialize editors for unrelated historical sessions", async t => {
  const f = fixture(t);
  f.sessions.list.getSnapshot = () => ({
    byId: { "chat-1": { retainedBy: { mainView: 1 } }, unopened: { retainedBy: {} } },
  });
  const scope = f.sessions.scope;
  f.sessions.scope = id => {
    assert.equal(id, "chat-1", "unrelated session must not be resolved");
    return scope(id);
  };
  await f.port.sendScreenshot(screenshot, target);
  await f.port.sendScreenshot(screenshot, target);
  assert.equal(f.snapshot().occurrences.length, 2);
});

test("a busy composer releases the screenshot and preserves the draft", async t => {
  const f = fixture(t, { draft: "/wait" });
  assert.equal(f.input.beginCommand({
    name: "wait", token: "/wait ", submit: () => new Promise(() => {}),
  }, { start: 0, end: 5, draftRev: f.snapshot().draftRev }), true);
  f.input.submit();
  const before = f.snapshot();
  const attachments = [];
  const create = f.service.createDrafts.bind(f.service);
  f.service.createDrafts = (...args) => {
    const drafts = create(...args);
    attachments.push(...drafts.map(({ id }) => id));
    return drafts;
  };
  await assert.rejects(f.port.sendScreenshot(screenshot, target), /composer is busy/u);
  assert.equal(f.snapshot().draft, before.draft);
  assert.deepEqual(f.snapshot().attachmentIds, []);
  assert.deepEqual(f.service.resolveDraftAttachments(attachments), []);
  assert.deepEqual(f.promptCalls, []);
});

test("failed reference insertion rolls back only the appended text and screenshot", async t => {
  const f = fixture(t);
  addFileReference(f.input);
  const before = f.snapshot();
  f.input.insertReference = () => false;
  await assert.rejects(f.port.sendScreenshot(screenshot, target), /changed before staging/u);
  assert.equal(f.snapshot().draft, before.draft);
  assert.deepEqual(f.snapshot().occurrences, before.occurrences);
  assert.deepEqual(f.snapshot().attachmentIds, []);
  assert.deepEqual(f.promptCalls, []);
});

test("Browser comment evidence is purged after its chip leaves every draft", async t => {
  const f = fixture(t, { draft: "" });
  await f.port.sendScreenshot(screenshot, target);
  const first = f.snapshot().occurrences[0].ref;
  f.input.setDraft("");
  await f.port.sendScreenshot(screenshot, target);
  await assert.rejects(f.source().codec.serialize(first, new AbortController().signal), /no longer available/u);
});
