import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentBrowserComposerBridge,
  createAgentBrowserChatPort,
} from "@minke/harness-overlay/client/tabs/agent-browser/chat.ts";

function sessionFixture({
  current = "chat-1",
  prompt,
  scope = () => ({ sessionId: "chat-1" }),
} = {}) {
  const opened = [];
  const promptCalls = [];
  const sessions = {
    list: {
      getSnapshot() {
        return {
          current,
          byId: {
            "chat-1": { title: "Chat one" },
          },
        };
      },
      subscribe() {
        return () => {};
      },
    },
    binding(sessionId) {
      if (sessionId !== "chat-1") return undefined;
      return {
        session: {
          async prompt(...args) {
            promptCalls.push(args);
            return prompt === undefined
              ? { ok: true, value: undefined }
              : await prompt(...args);
          },
        },
      };
    },
    scope,
    open(sessionId) {
      opened.push(sessionId);
    },
  };
  return { opened, promptCalls, sessions };
}

function composerFixture({
  draft = "Keep my question",
  acceptImages = true,
} = {}) {
  const calls = [];
  let currentDraft = draft;
  let draftRev = 1;
  let occurrences = [];
  let source;
  const input = {
    state: {
      getSnapshot() {
        return {
          draft: currentDraft,
          draftRev,
          occurrences,
        };
      },
    },
    addImages(ids) {
      calls.push(["addImages", [...ids]]);
      return acceptImages;
    },
    removeImage(id) {
      calls.push(["removeImage", id]);
    },
    insertReference(reference, span) {
      calls.push(["insertReference", reference, span]);
      if (
        span.draftRev !== draftRev ||
        currentDraft.slice(span.start, span.end)
          !== "@browser-comments"
      ) {
        return false;
      }
      const display = `@${reference.label}`;
      currentDraft = currentDraft.slice(0, span.start)
        + display
        + " "
        + currentDraft.slice(span.end);
      occurrences = [{
        source: reference.source,
        ref: reference.ref,
      }];
      draftRev += 1;
      return true;
    },
    setDraft(text) {
      currentDraft = text;
      draftRev += 1;
      if (!text.includes("@1 annotation")) occurrences = [];
      calls.push(["setDraft", text]);
    },
  };
  const service = {
    input: {
      for(scope) {
        calls.push(["for", scope]);
        return input;
      },
    },
    createDraftImages(files) {
      calls.push([
        "createDraftImages",
        files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      ]);
      return [{ id: "draft-image-1" }];
    },
    releaseDraftImages(images) {
      calls.push([
        "releaseDraftImages",
        images.map(({ id }) => id),
      ]);
    },
  };
  const inputTriggers = {
    registerSource(value) {
      source = value;
      calls.push(["registerSource", value.name]);
      return () => {
        calls.push(["unregisterSource", value.name]);
        if (source === value) source = undefined;
      };
    },
  };
  return {
    calls,
    currentDraft: () => currentDraft,
    input,
    inputTriggers,
    service,
    source: () => source,
  };
}

const screenshot = {
  data: "iVBORw0KGgo=",
  text: "# Browser comments\n\n### User Comment 1\n这是",
};

test("Agent Browser stages PNG and evidence in the selected Chat composer", async () => {
  const target = sessionFixture();
  const composer = composerFixture();
  const bridge = createAgentBrowserComposerBridge(target.sessions);
  bridge.connect(composer.service, composer.inputTriggers);
  const port = createAgentBrowserChatPort(
    target.sessions,
    bridge,
  );

  await port.sendScreenshot(
    screenshot,
    { sessionId: "chat-1", title: "Chat one" },
  );

  assert.deepEqual(target.promptCalls, []);
  assert.deepEqual(target.opened, ["chat-1"]);
  assert.equal(
    composer.currentDraft(),
    "Keep my question\n\n@1 annotation ",
  );
  assert.deepEqual(composer.calls.slice(0, 5), [
    ["registerSource", "browser-comments"],
    ["for", { sessionId: "chat-1" }],
    [
      "createDraftImages",
      [{
        name: "minke-browser-comments.png",
        size: 8,
        type: "image/png",
      }],
    ],
    ["addImages", ["draft-image-1"]],
    [
      "setDraft",
      "Keep my question\n\n@browser-comments",
    ],
  ]);
  const insert = composer.calls.find(
    ([name]) => name === "insertReference",
  );
  assert.equal(insert[1].source, "browser-comments");
  assert.equal(insert[1].label, "1 annotation");
  assert.equal(
    await composer.source().codec.serialize(
      insert[1].ref,
      new AbortController().signal,
    ),
    screenshot.text,
  );
});

test("Agent Browser falls back to direct prompt only without composer support", async () => {
  const target = sessionFixture();
  const port = createAgentBrowserChatPort(target.sessions, {
    stage: () => false,
  });

  await port.sendScreenshot(
    screenshot,
    { sessionId: "chat-1" },
  );

  assert.equal(target.promptCalls.length, 1);
  assert.equal(target.promptCalls[0][0][0].type, "image");
  assert.equal(target.promptCalls[0][0][1].type, "text");
  assert.equal(target.promptCalls[0][1], "queue");
  assert.deepEqual(target.opened, ["chat-1"]);
});

test("busy supported composer releases the PNG and never auto-submits", async () => {
  const target = sessionFixture();
  const composer = composerFixture({ acceptImages: false });
  const bridge = createAgentBrowserComposerBridge(target.sessions);
  bridge.connect(composer.service, composer.inputTriggers);
  const port = createAgentBrowserChatPort(
    target.sessions,
    bridge,
  );

  await assert.rejects(
    port.sendScreenshot(screenshot, { sessionId: "chat-1" }),
    /composer is busy/u,
  );

  assert.deepEqual(target.promptCalls, []);
  assert.deepEqual(target.opened, []);
  assert.deepEqual(
    composer.calls.slice(-2),
    [
      ["addImages", ["draft-image-1"]],
      ["releaseDraftImages", ["draft-image-1"]],
    ],
  );
});

test("Browser comment evidence is purged after its chip leaves every draft", async () => {
  const target = sessionFixture();
  const composer = composerFixture({ draft: "" });
  const bridge = createAgentBrowserComposerBridge(target.sessions);
  bridge.connect(composer.service, composer.inputTriggers);
  const port = createAgentBrowserChatPort(target.sessions, bridge);

  await port.sendScreenshot(screenshot, { sessionId: "chat-1" });
  const first = composer.calls.find(
    ([name]) => name === "insertReference",
  )[1].ref;
  composer.input.setDraft("");
  await port.sendScreenshot(
    { ...screenshot, text: `${screenshot.text}\n\n### User Comment 2\n什么` },
    { sessionId: "chat-1" },
  );

  await assert.rejects(
    composer.source().codec.serialize(
      first,
      new AbortController().signal,
    ),
    /no longer available/u,
  );
});
