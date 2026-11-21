import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { Context } from "@deepseek-ai/cordis";
import * as dockkit from "../vendor/deepseek-harness/packages/client/ui-dockkit/lib/index.js";
import * as store from "../vendor/deepseek-harness/packages/client/store/lib/index.js";
import * as zod from "../vendor/deepseek-harness/node_modules/zod/index.js";
import { applyHarnessRuntimePatches, resolveHarnessRuntimePatches, verifyHarnessRuntimePatchesApplied } from "../scripts/harness/runtime-patches.mjs";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";
import { TabRendererRegistry } from "@minke/harness-overlay/client/tabs/registry.ts";
import { NativeTabsRuntime } from "@minke/harness-overlay/client/tabs/native/runtime.ts";
import { installNativeTabs } from "@minke/harness-overlay/client/tabs/native/install.tsx";
import { nativeContentId } from "@minke/harness-overlay/client/tabs/native/contract.ts";
import { subtractRect } from "@minke/harness-overlay/client/tabs/native/viewport.ts";
import { bindDrawerFocus } from "@minke/harness-overlay/client/tabs/native/drawer-focus.ts";
import { ResourceRegistry } from "../vendor/deepseek-harness/packages/client/resources/src/client/resources.ts";
import { minkeTabResourceProvider } from "@minke/harness-overlay/client/tabs/native/resources.ts";
import { persistTabs } from "@minke/harness-overlay/client/tabs/persistence.ts";
import { JSDOM } from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";

const projectRoot = resolve(import.meta.dirname, "..");
const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-native-sidebar-"));
const target = join(runtimeRoot, "node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js");
const upstream = await readFile(join(projectRoot, "vendor/deepseek-harness/packages/client/ui-sidebar-right/lib/client.js"), "utf8");
await mkdir(join(target, ".."), { recursive: true });
await writeFile(target, upstream);
const patches = await resolveHarnessRuntimePatches(projectRoot, ["patches/deepseek-harness/sidebar-tab-lifecycle.patch"]);
await applyHarnessRuntimePatches(runtimeRoot, patches);
await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);
const patched = await readFile(target, "utf8");
await rm(runtimeRoot, { recursive: true, force: true });

const tick = async () => { await new Promise(resolve => setTimeout(resolve, 25)); };

async function boot(source = patched, savedStates = new Map()) {
  let plugin;
  const dom = new JSDOM();
  const dependencies = {
    react: React, "react/jsx-runtime": jsx, "react-dom": ReactDOM,
    zod,
    "@deepseek-ai/dsh-client-ui-dockkit": dockkit,
    "@deepseek-ai/dsh-client-store": store,
    "@deepseek-ai/dsh-client-ui-primitives": {},
  };
  new Function("window", "document", "MutationObserver", "Element", source)({ __ModuleLoader__: { load({ factory }) {
    plugin = factory(name => {
      assert.ok(name in dependencies, `unhandled native dependency ${name}`);
      return dependencies[name];
    });
  } } }, dom.window.document, dom.window.MutationObserver, dom.window.Element);
  const ctx = new Context();
  const registered = [];
  ctx.provide("slots", {
    inject: (_name, callback) => ctx.effect(callback),
    register: (options, component) => {
      const entry = { ...options, component };
      registered.push(entry);
      return () => { registered.splice(registered.indexOf(entry), 1); };
    },
  });
  ctx.provide("locale", { bind: () => key => key, register: () => () => {} });
  ctx.provide("contextMenus", { register: () => () => {} });
  const panelInfo = store.createSnapshotStore({ activePanelId: null });
  const current = store.createSnapshotStore({ key: undefined });
  ctx.provide("layout", { openRightbar() {}, closeRightbar() {}, panelInfo });
  ctx.provide("resources", new ResourceRegistry(ctx));
  ctx.provide("sessions", { retain: () => ({ ready: Promise.resolve(), release() {} }) });
  ctx.provide("uiSession", { adapter: { current } });
  ctx.provide("shortcuts", { register: () => () => {}, closeWindow: async () => {} });
  const fiber = ctx.plugin(plugin);
  await fiber.await();
  const seat = registered.find(entry => entry.name === "rightbar.session");
  assert.ok(seat);
  const instances = new Map();
  const mount = id => {
    if (id === undefined) { panelInfo.set({ activePanelId: "plugins" }); return; }
    current.set({ key: id });
    panelInfo.set({ activePanelId: null });
    let instance = instances.get(id);
    if (!instance) {
      instance = seat.store.create(id);
      if (savedStates.has(id)) instance.store.update(draft => Object.assign(draft, structuredClone(savedStates.get(id))));
      instances.set(id, instance);
      instance.actions.open(id);
    }
    return instance;
  };
  return { ctx, instances, mount, async dispose() { await fiber.dispose(); dom.window.close(); } };
}

async function workspace(t, { beforeClose = () => true, source = patched, activate, inactive = false, host = { showPanel() {}, hidePanel() {} } } = {}) {
  const harness = await boot(source);
  const runtime = new TabsRuntime(host);
  const renderers = new TabRendererRegistry();
  for (const kind of ["web", "files", "terminal"]) {
    renderers.register({ kind, renderIcon: () => null, renderView: () => null, beforeClose });
    harness.ctx.sidebarRightTabs.register({ id: `spec/${kind}`, kind: `minke.${kind}`, title: () => kind });
  }
  harness.ctx.sidebarRightTabs.register({ id: "spec/text", kind: "text", patterns: ["dsh-resource://file/**"], title: () => "Native preview" });
  const releaseResources = harness.ctx.resources.register(minkeTabResourceProvider(runtime));
  const native = new NativeTabsRuntime(runtime, renderers, activate);
  const release = native.connect(harness.ctx.sidebarRight);
  t.after(async () => { release(); releaseResources(); await harness.dispose(); });
  const instance = inactive ? undefined : harness.mount("session-a");
  await tick();
  const surface = (id = "session-a") => harness.instances.get(id).getSnapshot().bySession[id].layout;
  const record = (id, sessionId) => Object.values(surface(sessionId).tabs).find(tab => tab.contentId === nativeContentId(id));
  return { ...harness, runtime, native, instance, surface, record, release };
}

test("connected native Sidebar queues Terminal and Start while outside the Conversation", async t => {
  let activations = 0;
  const w = await workspace(t, { inactive: true, activate: () => { activations++; } });
  w.ctx.sidebarRightTabs.register({ id: "spec/native-terminal", kind: "terminal", title: () => "Terminal" });
  assert.equal(w.native.connected, true);
  assert.equal(w.native.active, false);
  assert.equal(activations, 0, "connecting on Plugins must not navigate away from it");
  assert.doesNotThrow(() => w.native.openNative("terminal"));
  w.native.openNative("guide");
  assert.equal(activations, 1, "requests share the pending Conversation activation");
  assert.equal(w.instances.size, 0, "no detached native surface is written");
  w.mount("session-a");
  await tick();
  const kinds = Object.values(w.surface().tabs).map(tab => tab.kind);
  assert.ok(kinds.includes("terminal"));
  assert.ok(kinds.includes("guide"));
  assert.equal(w.native.active, true);
});

test("pending custom content keeps its draft and never opens the fallback host", async t => {
  let activations = 0;
  let fallback = 0;
  const w = await workspace(t, { inactive: true, activate: () => { activations++; },
    host: { showPanel() { fallback++; }, hidePanel() { fallback++; } } });
  const payload = { draft: "unsaved" };
  const id = w.runtime.open({ kind: "files", key: "pending", title: "Draft", payload });
  w.runtime.activate(id);
  w.runtime.show();
  assert.equal(fallback, 0);
  assert.equal(activations, 1);
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount("session-a");
  await tick();
  assert.ok(w.record(id));
  assert.equal(w.runtime.getSnapshot().activeId, id);
  assert.equal(w.surface().expanded, true);
  assert.equal(w.runtime.tab(id).payload, payload);
});

test("native requests wait through an unmount before the queued sync runs", async t => {
  let activations = 0;
  const w = await workspace(t, { activate: () => { activations++; } });
  w.mount(undefined);
  assert.doesNotThrow(() => w.native.openNative("guide"));
  assert.equal(activations, 1);
  await tick();
  assert.equal(w.native.connected, true);
  assert.equal(w.native.active, false);
  w.mount("session-a");
  await tick();
  assert.equal(w.surface().expanded, true);
});

test("toggling from Plugins restores the selected Sidebar tab instead of hiding an unmounted seat", async t => {
  let activations = 0;
  let fallback = 0;
  const w = await workspace(t, {
    activate: () => { activations++; },
    host: { showPanel() { fallback++; }, hidePanel() { fallback++; } },
  });
  const payload = { draft: "unsaved before opening Plugins" };
  const id = w.runtime.open({ kind: "files", key: "selected-draft", title: "Draft", payload });
  assert.equal(w.runtime.getSnapshot().visible, true);
  assert.equal(w.runtime.getSnapshot().activeId, id);
  w.mount(undefined);
  await tick();

  w.runtime.toggle();
  assert.equal(activations, 1, "the global-page shortcut must reveal the Conversation");
  assert.equal(fallback, 0);
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount("session-a");
  await tick();
  assert.equal(w.surface().expanded, true);
  assert.equal(w.runtime.getSnapshot().activeId, id);
  assert.equal(w.runtime.tab(id).payload, payload);

  w.runtime.toggle();
  assert.equal(w.surface().expanded, false, "a mounted Sidebar still toggles closed");
  w.runtime.toggle();
  assert.equal(w.surface().expanded, true, "a mounted Sidebar still toggles open");
  assert.equal(activations, 1);
});

test("disconnect clears pending requests and publishes connection state", async t => {
  let activations = 0;
  const w = await workspace(t, { inactive: true, activate: () => { activations++; } });
  let notifications = 0;
  w.native.subscribe(() => { notifications++; });
  w.native.openNative("guide");
  w.release();
  assert.equal(w.native.connected, false);
  assert.ok(notifications > 0);
  const connectRevision = w.native.getSnapshot();
  const disconnect = w.native.connect(w.ctx.sidebarRight);
  assert.ok(w.native.getSnapshot() > connectRevision, "inactive connection changes must be observable");
  w.mount("session-a");
  await tick();
  assert.equal(w.surface().expanded, false, "a disposed pending open cannot replay after reconnect");
  assert.equal(activations, 1);
  disconnect();
});

test("restoring and opening background content does not leave Settings", async t => {
  let activations = 0;
  let fallback = 0;
  const w = await workspace(t, { inactive: true, activate: () => { activations++; },
    host: { showPanel() { fallback++; }, hidePanel() { fallback++; } } });
  const restored = { id: "tab-40", kind: "files", key: "restored", title: "Draft", payload: { draft: "retained" } };
  w.runtime.restore(restored);
  w.runtime.projectLayout([], restored.id, true);
  w.runtime.syncPanel();
  const background = w.runtime.open({ kind: "web", key: "background", title: "Background", payload: {} }, { activate: false });
  w.runtime.hide();
  assert.equal(activations, 0);
  assert.equal(fallback, 0);
  assert.equal(w.instances.size, 0);
  w.mount("session-a");
  await tick();
  assert.ok(w.record(restored.id));
  assert.ok(w.record(background));
  assert.equal(activations, 0, "mounting and synchronizing content is not an activation request");
});

test("installing the native bridge activates the existing Conversation or starts one only on demand", async t => {
  for (const selected of [true, false]) {
    await t.test(selected ? "existing Conversation" : "no Conversation", async () => {
      const harness = await boot();
      const panels = [];
      let starts = 0;
      harness.ctx.layout.selectPanel = id => { panels.push(id); };
      harness.ctx.sessions.list = { getSnapshot: () => ({ byId: selected
        ? { "session-a": { retainedBy: { mainView: 1 } } }
        : { "sidebar-only": { retainedBy: { sidebar: 1 } } } }) };
      harness.ctx.provide("uiWorkspace", { startSession() { starts++; } });
      const tabs = new TabsRuntime({ showPanel() { assert.fail("native owns the host"); }, hidePanel() {} });
      let native;
      const fiber = harness.ctx.plugin(scope => {
        native = installNativeTabs(scope, tabs, new TabRendererRegistry(), {});
      });
      try {
        await fiber.await();
        await tick();
        assert.equal(native.connected, true);
        assert.deepEqual(panels, []);
        assert.equal(starts, 0);
        native.openNative("guide");
        tabs.show();
        assert.deepEqual(panels, [null]);
        assert.equal(starts, selected ? 0 : 1);
        harness.mount("session-a");
        await tick();
        assert.equal(native.active, true);
        assert.equal(starts, selected ? 0 : 1);
      } finally {
        await fiber.dispose();
        await harness.dispose();
      }
    });
  }
});

test("native tab patch is required by the compatibility contract", async () => {
  const harness = await boot(upstream);
  assert.equal(harness.ctx.sidebarRight.connectMinkeTabs, undefined);
  await harness.dispose();
});

test("custom instances and native previews share the DSH tab list", async t => {
  const w = await workspace(t);
  const first = w.runtime.open({ kind: "web", key: "a", title: "A", payload: { value: 1 } });
  const second = w.runtime.open({ kind: "web", key: "b", title: "B", payload: { value: 2 } });
  assert.notEqual(first, second);
  assert.equal(Object.values(w.surface().tabs).filter(tab => tab.kind === "minke.web").length, 2);
  assert.equal(w.runtime.open({ kind: "web", key: "a", title: "A", payload: {} }), first);
  assert.equal(w.runtime.getSnapshot().activeId, first);
  w.ctx.sidebarRight.openResource("dsh-resource://file/example.md");
  await tick();
  assert.equal(w.runtime.getSnapshot().activeId, undefined);
  assert.equal(w.runtime.getSnapshot().tabs.length, 2);
  assert.equal(Object.values(w.surface().tabs).length, 3);
  w.runtime.close(first);
  await tick();
  assert.equal(Object.values(w.surface().tabs).length, 2);
  assert.equal(Object.values(w.surface().tabs).some(tab => tab.kind === "text"), true);
});

test("background custom opens preserve the selected native document", async t => {
  const w = await workspace(t);
  w.ctx.sidebarRight.openResource("dsh-resource://file/example.md");
  await tick();
  const activeId = w.surface().nodes[w.surface().activePaneId].activeTabId;
  const id = w.runtime.open({ kind: "web", key: "background", title: "Background", payload: {} }, { activate: false });
  assert.ok(w.record(id));
  assert.equal(w.surface().nodes[w.surface().activePaneId].activeTabId, activeId);
  assert.equal(w.runtime.getSnapshot().activeId, undefined);
  assert.equal(w.surface().expanded, true);
});

test("creating from Start replaces its slot in the originating pane", async t => {
  const w = await workspace(t);
  const original = w.runtime.open({ kind: "web", key: "first", title: "First", payload: {} });
  const firstPane = w.surface().activePaneId;
  const secondPane = w.ctx.sidebarRight.split();
  assert.ok(secondPane);
  await tick();
  const guide = w.surface().nodes[secondPane].activeTabId;
  assert.equal(w.surface().tabs[guide].kind, "guide");
  w.ctx.sidebarRight.focus(w.record(original).id);
  let created;
  w.native.createAt(guide, () => {
    created = w.runtime.open({ kind: "terminal", key: "new", title: "Terminal", payload: {} });
  });
  await tick();
  assert.deepEqual(w.surface().nodes[firstPane].tabs, [w.record(original).id]);
  assert.deepEqual(w.surface().nodes[secondPane].tabs, [w.record(created).id]);
  assert.equal(w.surface().tabs[guide], undefined);
  assert.equal(w.surface().activePaneId, secondPane);
});

test("a failing or stale Start creator cannot redirect the next open", async t => {
  const w = await workspace(t);
  w.ctx.sidebarRight.openTab("guide");
  await tick();
  const guide = w.surface().nodes[w.surface().activePaneId].activeTabId;
  assert.throws(() => w.native.createAt(guide, () => { throw new Error("creation failed"); }), /creation failed/);
  const id = w.runtime.open({ kind: "web", key: "next", title: "Next", payload: {} });
  assert.ok(w.record(id));
  assert.ok(w.surface().tabs[guide], "a later independent open must not inherit the failed replacement target");
  let staleCalled = false;
  w.native.createAt("closed-tab", () => { staleCalled = true; });
  assert.equal(staleCalled, false);
});

test("native Start placement stays in its pane when focus moves before creation", async t => {
  const w = await workspace(t);
  const first = w.runtime.open({ kind: "web", key: "first", title: "First", payload: {} });
  const firstPane = w.surface().activePaneId;
  const secondPane = w.ctx.sidebarRight.split();
  await tick();
  w.ctx.sidebarRight.openTab("guide", { paneId: secondPane });
  const guide = w.surface().nodes[secondPane].activeTabId;
  w.ctx.sidebarRight.focus(w.record(first).id);
  let created;
  w.native.createAt(guide, () => {
    created = w.runtime.open({ kind: "files", key: "start", title: "Files", payload: {} });
  });
  await tick();
  assert.deepEqual(w.surface().nodes[firstPane].tabs, [w.record(first).id]);
  assert.deepEqual(w.surface().nodes[secondPane].tabs, [w.record(created).id]);
  assert.equal(w.surface().activePaneId, secondPane);
  assert.equal(w.surface().tabs[guide], undefined, "creation replaces its originating Start tab");
});

test("native close, replacement and undo respect an unsaved draft veto", async t => {
  let dirty = true;
  const w = await workspace(t, { beforeClose: () => !dirty });
  const id = w.runtime.open({ kind: "files", key: "draft", title: "Draft", payload: { draft: "unsaved" } });
  const record = w.record(id);
  w.instance.actions.closeTab("session-a", record.id);
  await tick();
  assert.ok(w.record(id));
  w.ctx.sidebarRight.openResource("dsh-resource://file/replacement.md", { replaceTab: record.id });
  await tick();
  assert.equal(Object.values(w.surface().tabs).length, 1);
  assert.equal(w.runtime.tab(id).payload.draft, "unsaved");
  w.instance.actions.undo("session-a");
  await tick();
  assert.ok(w.record(id));
  dirty = false;
  w.instance.actions.closeTab("session-a", record.id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined);
  w.instance.actions.undo("session-a");
  await tick();
  assert.equal(w.record(id), undefined, "undo cannot resurrect a disposed content instance");
});

test("draft protection test detects a disabled native admission check", async t => {
  const source = patched.replace("if (!admit(sessionId, before.layout, after.layout)) return before;", "if (false) return before;");
  const w = await workspace(t, { source, beforeClose: () => false });
  const id = w.runtime.open({ kind: "files", key: "draft", title: "Draft", payload: {} });
  w.instance.actions.closeTab("session-a", w.record(id).id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined, "the negative control must lose the unprotected draft");
});

test("global content survives session changes, split, float, dock and collapse", async t => {
  const w = await workspace(t);
  const payload = { processId: "same-process" };
  const id = w.runtime.open({ kind: "terminal", key: "pty-a", title: "Shell", payload });
  w.ctx.sidebarRight.split();
  await tick();
  w.ctx.sidebarRight.float(w.record(id).id);
  await tick();
  assert.equal(w.surface().floats.length, 1);
  w.runtime.hide();
  w.native.activate(id);
  assert.equal(w.surface().expanded, false, "focusing a floating tab does not reopen the docked column");
  w.ctx.sidebarRight.dock(w.surface().floats[0]);
  await tick();
  assert.equal(w.surface().floats.length, 0);
  w.runtime.hide();
  assert.equal(w.runtime.getSnapshot().visible, false);
  w.runtime.show();
  w.mount("session-b");
  await tick();
  assert.ok(w.record(id, "session-b"));
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount(undefined);
  await tick();
  assert.equal(w.native.active, false);
  assert.equal(w.runtime.tab(id).payload, payload);
  w.mount("session-a");
  await tick();
  w.instance.actions.closeTab("session-a", w.record(id).id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined);
  assert.equal(w.record(id, "session-b"), undefined);
});

test("hydrating custom content before connecting retains the native saved layout on refresh", async t => {
  const w = await workspace(t);
  const savedContent = new Map();
  const storage = { getItem: key => savedContent.get(key) ?? null, setItem: (key, value) => savedContent.set(key, value) };
  const registry = new TabRendererRegistry();
  const renderer = runtime => ({ kind: "web", renderIcon: () => null, renderView: () => null,
    persistence: { save: tab => tab.payload, restore: tab => runtime.restore(tab) } });
  registry.register(renderer(w.runtime));
  const stop = persistTabs(w.runtime, registry, "right", storage).start();
  const id = w.runtime.open({ kind: "web", key: "browser", title: "Browser", payload: { url: "https://example.com/" } });
  w.ctx.sidebarRight.split();
  w.ctx.sidebarRight.openResource("dsh-resource://file/example.md");
  await tick();
  const saved = structuredClone(w.instance.getSnapshot());
  const layoutBefore = structuredClone(w.surface());
  stop();
  const refresh = async hydrate => {
    const harness = await boot(patched, new Map([["session-a", saved]]));
    const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
    const renderers = new TabRendererRegistry();
    renderers.register(renderer(tabs));
    if (hydrate) persistTabs(tabs, renderers, "right", storage);
    harness.ctx.sidebarRightTabs.register({ id: "spec/web", kind: "minke.web", title: () => "Web" });
    harness.ctx.sidebarRightTabs.register({ id: "spec/text", kind: "text", patterns: ["dsh-resource://file/**"], title: () => "Native" });
    const releaseResources = harness.ctx.resources.register(minkeTabResourceProvider(tabs));
    const native = new NativeTabsRuntime(tabs, renderers);
    const release = native.connect(harness.ctx.sidebarRight);
    const instance = harness.mount("session-a");
    await tick();
    const layout = structuredClone(instance.getSnapshot().bySession["session-a"].layout);
    release(); releaseResources(); await harness.dispose();
    return layout;
  };
  const withoutContent = await refresh(false);
  assert.equal(Object.values(withoutContent.tabs).some(tab => tab.contentId === nativeContentId(id)), false, "negative control reproduces the former lost tab");
  assert.deepEqual(await refresh(true), layoutBefore, "both custom and native tabs retain ids, panes and selection");
});

test("extension cleanup removes native seats before local ids can be reused", async t => {
  const harness = await boot();
  t.after(() => harness.dispose());
  harness.ctx.sidebarRightTabs.register({ id: "spec/web", kind: "minke.web", title: () => "Web" });
  harness.mount("session-a");
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const native = new NativeTabsRuntime(tabs, new TabRendererRegistry());
  const release = native.connect(harness.ctx.sidebarRight);
  await tick();
  tabs.open({ kind: "web", key: "a", title: "A", payload: {} });
  assert.equal(Object.values(harness.instances.get("session-a").getSnapshot().bySession["session-a"].layout.tabs).length, 1);
  release();
  assert.equal(Object.values(harness.instances.get("session-a").getSnapshot().bySession["session-a"].layout.tabs).length, 0);
});

test("overlapping float occlusion leaves disjoint visible rectangles", () => {
  const pieces = subtractRect({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 20, top: 20, right: 80, bottom: 80 });
  const visible = pieces.flatMap(rect => subtractRect(rect, { left: 50, top: 0, right: 100, bottom: 100 }));
  assert.equal(visible.reduce((area, rect) => area + (rect.right - rect.left) * (rect.bottom - rect.top), 0), 3200);
});

test("fallback drawer keyboard navigation includes its stable content host", () => {
  const dom = new JSDOM('<aside data-open><button>Tab</button></aside><div id="content"><input><button>Save</button><input hidden></div>');
  const { document, KeyboardEvent } = dom.window;
  // JSDOM has no layout boxes. Supply the visibility primitive so this test
  // exercises focus routing; Electron covers actual painted host visibility.
  Object.defineProperty(dom.window.HTMLElement.prototype, "checkVisibility", {
    value() { return !this.hidden; },
  });
  const panel = document.querySelector("aside");
  const content = document.querySelector("#content");
  let closed = 0;
  const press = (key, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  panel.querySelector("button").focus();
  const enterContent = () => {
    press("Tab");
    assert.equal(document.activeElement, content.querySelector("input"));
  };
  // Without the binding the test must catch the disconnected keyboard scope.
  assert.throws(enterContent, { code: "ERR_ASSERTION" });
  const release = bindDrawerFocus(panel, content, () => { closed += 1; });
  enterContent();
  press("Tab");
  assert.equal(document.activeElement, content.querySelector("button"));
  press("Tab");
  assert.equal(document.activeElement, panel.querySelector("button"));
  press("Tab", true);
  assert.equal(document.activeElement, content.querySelector("button"));
  press("Escape");
  assert.equal(closed, 1);
  release();
  press("Escape");
  assert.equal(closed, 1);
  dom.window.close();
});

test("native pins expose Minke resources and release without disposing global content", async t => {
  const w = await workspace(t);
  const id = w.runtime.open({ kind: "web", key: "resource", title: "Resource", payload: {} });
  const source = w.ctx.resources.source(nativeContentId(id));
  await tick();
  assert.deepEqual(source.getSnapshot().value, { id, kind: "web", title: "Resource" });
  assert.equal(source.getSnapshot().status, "live");
  w.mount(undefined);
  await tick();
  assert.ok(w.runtime.tab(id), "leaving a session seat must retain the browser instance");
  w.mount("session-a");
  await tick();
  assert.equal(source.getSnapshot().status, "live");
  w.runtime.close(id);
  await tick();
  assert.equal(w.runtime.tab(id), undefined);
  assert.equal(source.getSnapshot().value, undefined, "closing its final seat releases the resource pin");
});
