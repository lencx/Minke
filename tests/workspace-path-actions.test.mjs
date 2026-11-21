import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MINKE_HOST_PROTOCOL_VERSION } from "@minke/harness-overlay/minke-host-contract.ts";
import { HostWorkspacePaths, installWorkspacePathActions } from "@minke/harness-overlay/client/host/path-actions.ts";
import { FilesTabsController } from "@minke/harness-overlay/client/tabs/files/controller.ts";
import { createFilesTabRenderer } from "@minke/harness-overlay/client/tabs/files/renderer.tsx";
import { PreviewActions } from "@minke/harness-overlay/client/tabs/files/PreviewActions.tsx";
import { filesTabsEn } from "@minke/harness-overlay/client/tabs/files/locales.ts";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";
import { desktopFilesPort } from "@minke/harness-overlay/client/desktop/workspace.ts";
import { browserFilesPort } from "@minke/harness-overlay/client/host/workspace.ts";

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };
const t = key => filesTabsEn[key];

test("a desktop directory permission denial offers a native folder picker and recovers in the same Files tab", async t => {
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const requested = [];
  let selected = null;
  const desktop = desktopFilesPort({
    __DSH_DIRECTORY_PICKER__: { async pick() { return selected; } },
    minkeDesktop: { files: {
      async list({ path }) {
        requested.push(path);
        if (path === "/workspace/protected") return { kind: "permission-denied" };
        return { path, entries: [], truncated: false };
      },
    } },
  });
  const files = new FilesTabsController(tabs, desktop);
  t.after(() => { files.dispose(); tabs.dispose(); });
  const renderer = createFilesTabRenderer(files, {}, key => filesTabsEn[key]);
  const id = files.create("/workspace/protected", "Files");
  await settle();
  const markup = () => renderToStaticMarkup(renderer.renderView(tabs.tab(id), true));
  assert.match(markup(), /The system denied access to this folder/);
  assert.match(markup(), /Choose another folder/);
  await files.chooseDirectory(id);
  assert.deepEqual(requested, ["/workspace/protected"]);
  assert.match(markup(), /Choose another folder/);
  selected = "/workspace/readable";
  await files.chooseDirectory(id);
  await settle();
  assert.deepEqual(requested, ["/workspace/protected", "/workspace/readable"]);
  assert.equal(tabs.tab(id).payload.path, "/workspace/readable");
  assert.equal(tabs.tab(id).payload.error, undefined);
});

test("Files uses remote.session in either data transport and follows Host capability", async () => {
  const paths = new HostWorkspacePaths();
  const permission = deferred();
  const opened = [];
  const changes = [];
  const unsubscribe = paths.subscribe(() => changes.push(paths.getSnapshot()));
  const disconnect = paths.connect({
    canOpenWorkspacePath: () => permission.promise,
    async openWorkspacePath(request, signal) { opened.push({ request, signal }); return { ok: true, value: { opened: true } }; },
  });
  const desktop = desktopFilesPort({ minkeDesktop: { files: {
    async list({ path }) { return { path, entries: [], truncated: false }; },
    async readViewState() { return {}; }, watch() { return () => {}; },
    // A removed private opener must never be used even if an older carrier exposes it.
    open() { throw new Error("private Files IPC used"); },
  } } });
  const portable = browserFilesPort({ rpc: { async call(_channel, endpoint) {
    if (endpoint === "minke/capabilities") return { ok: true, value: {
      protocolVersion: MINKE_HOST_PROTOCOL_VERSION,
      files: { available: true, root: "/workspace", write: true, watch: false },
      tabs: { available: true, embeddedWeb: false, state: "client" },
    } };
    return { ok: true, value: { path: "/workspace", entries: [], truncated: false } };
  } } }, { getItem: () => null, setItem() {} });
  permission.resolve({ ok: true, value: true });
  assert.equal(paths.getSnapshot(), false, "availability is false until the Host answers");
  await settle();
  for (const data of [desktop, portable]) {
    const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
    const files = new FilesTabsController(tabs, data, { pathActions: paths });
    try {
      assert.equal("open" in data, false);
      const id = files.create("/workspace", "Files");
      files.open(id, "/workspace/document.txt");
      await settle();
      assert.equal(tabs.tab(id).payload.error, undefined);
      assert.deepEqual(opened.at(-1).request, { path: "/workspace/document.txt" });
      assert.equal(opened.at(-1).signal.aborted, false);
    } finally { files.dispose(); tabs.dispose(); }
  }
  disconnect();
  assert.equal(opened.length, 2);
  assert.equal(opened[0].signal.aborted, true);
  assert.deepEqual(changes, [true, false]);
  await assert.rejects(paths.open("/workspace"), /cannot open paths/u);
  unsubscribe();
});

test("late capability answers and open completions cannot outlive the Host binding", async () => {
  const paths = new HostWorkspacePaths();
  const first = deferred(), opening = deferred();
  let signal;
  const disconnectOld = paths.connect({ canOpenWorkspacePath: () => first.promise });
  const disconnectCurrent = paths.connect({
    async canOpenWorkspacePath() { return { ok: true, value: false }; },
  });
  first.resolve({ ok: true, value: true });
  await settle();
  assert.equal(paths.getSnapshot(), false);
  disconnectOld();
  disconnectCurrent();
  const disconnect = paths.connect({
    async canOpenWorkspacePath() { return { ok: true, value: true }; },
    openWorkspacePath(_request, lifetime) { signal = lifetime; return opening.promise; },
  });
  await settle();
  const pending = paths.open("/workspace");
  disconnect();
  opening.resolve({ ok: true, value: { opened: true } });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(signal.aborted, true);
  assert.equal(paths.getSnapshot(), false);
});

test("standard Host errors reach the Files error surface and unavailable actions stay hidden", async () => {
  const paths = new HostWorkspacePaths();
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const files = new FilesTabsController(tabs, {
    available: true, watchAvailable: false,
    async list({ path }) { return { path, entries: [], truncated: false }; },
  }, { pathActions: paths });
  const renderer = createFilesTabRenderer(files, {}, t);
  const id = files.create("/workspace", "Files");
  await settle();
  const toolbar = () => renderToStaticMarkup(renderer.renderTrailingActions(tabs.tab(id)));
  const preview = () => renderToStaticMarkup(createElement(PreviewActions, {
    tabId: id, preview: { entry: { name: "a.txt", path: "/workspace/a.txt", kind: "file" }, mode: "source" },
    controller: files, t, active: true,
  }));
  try {
    assert.equal(toolbar(), "");
    assert.equal(preview().includes("Open containing folder"), false);
    const disconnect = paths.connect({
      async canOpenWorkspacePath() { return { ok: true, value: true }; },
      async openWorkspacePath() { return { ok: false, error: new Error("Path has no verified Host path") }; },
    });
    await settle();
    assert.match(toolbar(), /Open in system file manager/u);
    assert.equal(preview().includes("Open containing folder"), true);
    files.open(id, "/workspace/blocked.txt");
    await settle();
    assert.equal(tabs.tab(id).payload.error, "Path has no verified Host path");
    disconnect();
    assert.equal(toolbar(), "");
    assert.equal(preview().includes("Open containing folder"), false);
    for (const answer of [{ ok: false, error: new Error("unauthorized") }, { ok: true, value: "true" }]) {
      const disconnect = paths.connect({ async canOpenWorkspacePath() { return answer; } });
      await settle();
      assert.equal(paths.getSnapshot(), false);
      disconnect();
    }
  } finally { files.dispose(); tabs.dispose(); }
});

test("path actions attach and detach with the tracked remote.session scope", async () => {
  let connectScope, cleanup;
  const remote = { session: { async canOpenWorkspacePath() { return { ok: true, value: true }; } } };
  const paths = installWorkspacePathActions({ inject(dependencies, callback) {
    assert.deepEqual(dependencies, ["remote.session"]);
    connectScope = callback;
  } });
  assert.equal(paths.getSnapshot(), false);
  connectScope({
    get(name) { assert.equal(name, "remote"); return remote; },
    effect(effect) { cleanup = effect(); },
  });
  await settle();
  assert.equal(paths.getSnapshot(), true);
  cleanup();
  assert.equal(paths.getSnapshot(), false);
});
