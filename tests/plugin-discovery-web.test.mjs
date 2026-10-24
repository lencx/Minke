import assert from "node:assert/strict";
import { test } from "node:test";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";
import { WebTabsController } from "@minke/harness-overlay/client/tabs/web/controller.ts";
import { PluginTabsController } from "@minke/harness-overlay/client/tabs/plugins/controller.ts";
import { PLUGIN_DISCOVERY_TOPIC_URL } from "@minke/harness-overlay/client/tabs/plugins/resources.ts";

test("plugin discovery uses the shared browser navigation, failure and retry state", () => {
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const external = [];
  const desktop = { available: true, embeddedWebAvailable: true, openExternal: url => external.push(url) };
  const web = new WebTabsController(tabs, desktop);
  const discovery = new PluginTabsController(tabs, desktop, web);
  const id = discovery.create("Discover plugins");
  assert.equal(tabs.tab(id).payload.url, PLUGIN_DISCOVERY_TOPIC_URL);
  const commands = [];
  const view = {
    getURL: () => PLUGIN_DISCOVERY_TOPIC_URL,
    getTitle: () => "GitHub topic",
    canGoBack: () => true, canGoForward: () => true,
    goBack: () => commands.push("back"), goForward: () => commands.push("forward"),
    loadURL: url => { commands.push(url); }, reload: () => commands.push("reload"),
    stop: () => commands.push("stop"),
  };
  const detach = web.attach(id, view);
  web.syncFromView(id, { loading: false });
  assert.equal(tabs.tab(id).payload.canGoBack, true);
  assert.equal(tabs.tab(id).title, "Discover plugins", "a preset keeps its discoverable title");
  const search = "https://github.com/search?q=topic%3Adsh-plugin+language%3Atypescript+tools&type=repositories";
  assert.equal(web.navigate(id, search), true);
  assert.equal(tabs.tab(id).payload.url, search);
  assert.equal(discovery.create("Discover plugins"), id, "navigation must not create duplicate presets");
  web.reloadOrStop(id);
  web.update(id, { error: "offline", loading: false });
  assert.equal(tabs.tab(id).payload.error, "offline");
  web.retry(id);
  web.goBack(id);
  web.goForward(id);
  web.openExternal(id);
  assert.deepEqual(commands, [search, "stop", "reload", "back", "forward"]);
  assert.deepEqual(external, [search]);
  detach(); discovery.dispose(); web.dispose(); tabs.dispose();
});

test("saved legacy plugin discovery tabs become browser presets and retain valid URLs", () => {
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const desktop = { available: true, embeddedWebAvailable: true, openExternal() {} };
  const web = new WebTabsController(tabs, desktop);
  const discovery = new PluginTabsController(tabs, desktop, web);
  discovery.restore({ id: "tab-12", key: "plugins", kind: "plugin-catalog", title: "Discover plugins", payload: {} });
  assert.equal(tabs.tab("tab-12").payload.url, PLUGIN_DISCOVERY_TOPIC_URL);
  assert.equal(tabs.tab("tab-12").payload.loading, true);
  const search = "https://github.com/search?q=topic%3Adsh-plugin+stars%3A%3E50&type=repositories";
  discovery.restore({ id: "tab-13", key: "saved", kind: "plugin-catalog", title: "Discover plugins", payload: { url: search } });
  assert.equal(tabs.tab("tab-13").payload.url, search);
  discovery.restore({ id: "tab-14", key: "unsafe", kind: "plugin-catalog", title: "Discover plugins", payload: { url: "javascript:alert(1)" } });
  assert.equal(tabs.tab("tab-14"), undefined);
  discovery.dispose(); web.dispose(); tabs.dispose();
});

test("discovery shares one secure guest through navigation, error recovery and unmount", async () => {
  const { JSDOM } = await import("../vendor/deepseek-harness/node_modules/jsdom/lib/api.js");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const acquired = [], released = [];
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
    dshDesktop: { protocolVersion: 1, browser: {
      acquire: async workspace => { acquired.push(workspace); return { lease: "discovery", partition: "persist:minke-tabs-web" }; },
      release: async lease => { released.push(lease); }, onOpenRequested: () => () => {},
    } } };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  let root;
  let tabs;
  let web;
  let discovery;
  try {
    const { act, createElement, useSyncExternalStore } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { createPluginTabRenderer } = await import("@minke/harness-overlay/client/tabs/plugins/renderer.tsx");
    const { pluginsEn } = await import("@minke/harness-overlay/client/tabs/plugins/locales.ts");
    const { webTabsEn } = await import("@minke/harness-overlay/client/tabs/web/locales.ts");
    const created = [];
    const commands = [];
    const css = [];
    const removedCss = [];
    let cancelInitial;
    let guestUrl = PLUGIN_DISCOVERY_TOPIC_URL;
    const create = dom.window.document.createElement.bind(dom.window.document);
    dom.window.document.createElement = (name, options) => {
      const node = create(name, options);
      if (name !== "webview") return node;
      Object.assign(node, {
        getURL: () => guestUrl, getTitle: () => "Topic", canGoBack: () => false, canGoForward: () => false,
        loadURL: url => {
          guestUrl = url; commands.push(url);
          return commands.length === 1 ? new Promise((_resolve, reject) => { cancelInitial = reject; }) : Promise.resolve();
        }, reload: () => commands.push("reload"), stop() {}, clearHistory() {},
        insertCSS: async source => { css.push(source); return `css-${css.length}`; },
        removeInsertedCSS: async key => { removedCss.push(key); },
      });
      created.push(node);
      return node;
    };
    tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
    const desktop = { available: true, embeddedWebAvailable: true, openExternal() {} };
    web = new WebTabsController(tabs, desktop);
    discovery = new PluginTabsController(tabs, desktop, web);
    const renderer = createPluginTabRenderer(discovery, key => pluginsEn[key], key => webTabsEn[key]);
    const id = discovery.create("Discover plugins");
    function Screen() {
      useSyncExternalStore(tabs.subscribe, tabs.getSnapshot, tabs.getSnapshot);
      const tab = tabs.tab(id);
      return createElement("div", null, renderer.renderToolbarCenter(tab), renderer.renderTrailingActions(tab), renderer.renderView(tab, true));
    }
    root = createRoot(dom.window.document.getElementById("root"));
    await act(async () => root.render(createElement(Screen)));
    const guest = created[0];
    assert.equal(created.length, 1);
    assert.equal(guest.className, "minke-tabs-view__guest");
    assert.equal(guest.getAttribute("partition"), "persist:minke-tabs-web");
    assert.equal(guest.hasAttribute("allowpopups"), false);
    assert.equal(guest.getAttribute("src"), "about:blank#discovery");
    assert.deepEqual(acquired, ["minke:persistent-browser"]);
    await act(async () => guest.dispatchEvent(new dom.window.Event("dom-ready")));
    assert.equal(css.length, 0, "discovery leaves GitHub presentation to the website");
    const search = "https://github.com/search?q=topic%3Adsh-plugin+tools+stars%3A%3E5&type=repositories";
    await act(async () => web.navigate(id, search));
    // Electron may serialize a canceled load's error without its `code` field.
    // It is a navigation failure, never a reason to detach the live guest.
    await act(async () => cancelInitial(new Error("ERR_ABORTED (-3) loading initial page")));
    guestUrl = "https://github.com/search?q=topic%3Adsh-plugin+tools+stars%3A%3E10&type=repositories";
    await act(async () => guest.dispatchEvent(Object.assign(new dom.window.Event("did-navigate"), { url: guestUrl })));
    assert.equal(tabs.tab(id).payload.url, guestUrl, "a canceled initial load must retain navigation observation and URL persistence");
    assert.equal(created.length, 1, "navigation must retain the guest and its history");
    assert.equal(dom.window.document.querySelector('input[role="combobox"]').value, guestUrl);
    await act(async () => guest.dispatchEvent(new dom.window.Event("dom-ready")));
    assert.equal(css.length, 0, "navigation does not inject site-specific styles");
    assert.equal(removedCss.length, 0);
    const failure = new dom.window.Event("did-fail-load");
    Object.assign(failure, { isMainFrame: true, errorCode: -105, errorDescription: "offline", validatedURL: search });
    await act(async () => guest.dispatchEvent(failure));
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent, /offline/);
    const retry = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === webTabsEn["web.error.retry"]);
    await act(async () => retry.click());
    assert.deepEqual(commands, [PLUGIN_DISCOVERY_TOPIC_URL, search, "reload"]);
    assert.equal(created.length, 1);
    await act(async () => root.unmount());
    root = undefined;
    assert.equal(guest.isConnected, false);
    assert.deepEqual(released, ["discovery"]);
    assert.equal(removedCss.length, 0, "shared guests need no site-specific CSS cleanup");
    web.update(id, { loading: false });
    const before = tabs.tab(id).payload;
    guest.dispatchEvent(new dom.window.Event("did-start-loading"));
    assert.equal(tabs.tab(id).payload, before, "unmounted guests no longer publish state");
  } finally {
    if (root) { const { act } = await import("react"); await act(async () => root.unmount()); }
    discovery?.dispose(); web?.dispose(); tabs?.dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
