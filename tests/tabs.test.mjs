import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  normalizeWebTabUrl,
  TABS_WEB_PARTITION,
} from "../packages/harness-overlay/src/tabs/contract.ts";
import {
  NewSessionTabsHeaderAction,
  SESSION_HEADER_ACTION_STYLES,
  SessionLogHeaderAction,
  TabsHeaderAction,
} from "../packages/harness-overlay/src/client/tabs/HeaderActions.ts";
import {
  tabsEn,
  tabsZh,
} from "../packages/harness-overlay/src/client/tabs/locales.ts";
import {
  TabRendererRegistry,
} from "../packages/harness-overlay/src/client/tabs/registry.ts";
import {
  TABS_CHROME_HEIGHT,
} from "../packages/harness-overlay/src/client/tabs/constants.ts";
import {
  clampTabsPanelWidth,
  TabsPanelResizeController,
  TABS_PANEL_MAX_WIDTH,
} from "../packages/harness-overlay/src/client/tabs/resize.ts";
import {
  TabsRuntime,
} from "../packages/harness-overlay/src/client/tabs/runtime.ts";
import {
  TABS_STYLES,
} from "../packages/harness-overlay/src/client/tabs/styles.ts";
import {
  normalizeWebAddressInput,
  normalizeWebFaviconUrl,
  WebTabsController,
} from "../packages/harness-overlay/src/client/tabs/web/controller.ts";
import {
  DSH_PLUGINS_URL,
  openDshPlugins,
} from "../packages/harness-overlay/src/client/tabs/web/plugins.ts";
import {
  protectTabWebviewGuest,
  secureTabWebview,
} from "../desktop/main/tabs/security.ts";

test("Web tab URLs accept only credential-free HTTP(S)", () => {
  assert.equal(
    normalizeWebTabUrl("https://example.com/docs?q=1#intro"),
    "https://example.com/docs?q=1#intro",
  );
  assert.equal(
    normalizeWebTabUrl("http://localhost:4173"),
    "http://localhost:4173/",
  );
  for (const candidate of [
    "mailto:hello@example.com",
    "file:///tmp/report.html",
    "javascript:alert(1)",
    "https://user:secret@example.com/",
    "not a url",
  ]) {
    assert.equal(normalizeWebTabUrl(candidate), undefined);
  }
  assert.equal(
    normalizeWebAddressInput("example.com/docs"),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeWebAddressInput("localhost:4173"),
    "https://localhost:4173/",
  );
  assert.equal(
    normalizeWebAddressInput("666"),
    "https://www.google.com/search?q=666",
  );
  assert.equal(
    normalizeWebAddressInput("best terminal for mac"),
    "https://www.google.com/search?q=best+terminal+for+mac",
  );
  assert.equal(
    normalizeWebAddressInput("file:///tmp/report.html"),
    undefined,
  );
  assert.equal(
    normalizeWebAddressInput(
      "https://user:secret@example.com/",
    ),
    undefined,
  );
});

test("the Plugins launcher opens the curated DSH topic", () => {
  const calls = [];
  const result = openDshPlugins(
    {
      open(url, title) {
        calls.push({ url, title });
        return "tab-plugins";
      },
    },
    "Plugins",
  );

  assert.equal(
    DSH_PLUGINS_URL,
    "https://github.com/topics/dsh-plugin",
  );
  assert.equal(result, "tab-plugins");
  assert.deepEqual(calls, [
    {
      url: DSH_PLUGINS_URL,
      title: "Plugins",
    },
  ]);
});

test("Web tab favicons accept safe site and CDN URLs", () => {
  assert.equal(
    normalizeWebFaviconUrl(
      "https://github.com/favicon.ico",
      "https://github.com/openai/codex",
    ),
    "https://github.com/favicon.ico",
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "https://cdn.example.com/favicon.ico",
      "https://example.com/",
    ),
    "https://cdn.example.com/favicon.ico",
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "data:image/png;base64,AAAA",
      "https://example.com/",
    ),
    undefined,
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "https://user:secret@example.com/favicon.ico",
      "https://example.com/",
    ),
    undefined,
  );
});

test("webview attachment overwrites untrusted guest preferences", () => {
  const preferences = {
    contextIsolation: false,
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    preload: "/tmp/untrusted.cjs",
    sandbox: false,
    webSecurity: false,
    webviewTag: true,
  };
  const params = {
    src: "https://example.com/docs",
    allowpopups: "",
    partition: "persist:attacker",
    preload: "file:///tmp/untrusted.cjs",
    webpreferences: "nodeIntegration=yes",
  };

  assert.equal(secureTabWebview(preferences, params), true);
  assert.equal(params.src, "https://example.com/docs");
  assert.equal(params.partition, TABS_WEB_PARTITION);
  assert.equal(Object.hasOwn(params, "allowpopups"), false);
  assert.equal(Object.hasOwn(params, "preload"), false);
  assert.equal(Object.hasOwn(params, "webpreferences"), false);
  assert.equal(Object.hasOwn(preferences, "preload"), false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.nodeIntegrationInSubFrames, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.webviewTag, false);
  assert.equal(preferences.partition, TABS_WEB_PARTITION);

  assert.equal(
    secureTabWebview(
      {},
      { src: "file:///tmp/report.html" },
    ),
    false,
  );
});

test("attached Web guests keep navigation isolated and deny popups", () => {
  const listeners = new Map();
  const opened = [];
  let openWindow;
  const guest = {
    on(name, listener) {
      listeners.set(name, listener);
    },
    setWindowOpenHandler(handler) {
      openWindow = handler;
    },
  };
  protectTabWebviewGuest(guest, {
    openExternal(url) {
      opened.push(url);
      return Promise.resolve();
    },
  });

  let prevented = false;
  listeners.get("will-navigate")({
    isMainFrame: true,
    url: "https://example.com/next",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);

  listeners.get("will-redirect")({
    isMainFrame: true,
    url: "mailto:hello@example.com",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["mailto:hello@example.com"]);
  assert.deepEqual(
    openWindow({ url: "https://example.com/popup" }),
    { action: "deny" },
  );
  assert.deepEqual(opened, [
    "mailto:hello@example.com",
    "https://example.com/popup",
  ]);
  assert.deepEqual(
    openWindow({ url: "javascript:alert(1)" }),
    { action: "deny" },
  );
  assert.equal(opened.length, 2);
});

test("Tabs is content-agnostic and preserves hidden tab state", () => {
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const web = new WebTabsController(tabs, {
    available: true,
    openExternal: (url) => hostEvents.push(`external:${url}`),
  });
  let notifications = 0;
  const unsubscribe = tabs.subscribe(() => {
    notifications += 1;
  });

  const first = web.open("https://example.com/docs", "Docs");
  const terminal = tabs.open({
    kind: "terminal",
    key: "shell-1",
    title: "Terminal",
    payload: { cwd: "/workspace" },
  });
  assert.equal(first, "tab-1");
  assert.equal(terminal, "tab-2");
  assert.equal(tabs.getSnapshot().activeId, terminal);
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.kind),
    ["web", "terminal"],
  );

  assert.equal(
    web.open("https://example.com/docs", "Duplicate"),
    first,
  );
  assert.equal(tabs.getSnapshot().activeId, first);
  assert.equal(tabs.getSnapshot().tabs.length, 2);

  tabs.hide();
  assert.equal(tabs.getSnapshot().visible, false);
  assert.equal(tabs.getSnapshot().tabs.length, 2);
  tabs.show();
  assert.equal(tabs.getSnapshot().visible, true);
  tabs.hide();
  tabs.activate(terminal);
  assert.equal(tabs.getSnapshot().visible, true);

  tabs.close(terminal);
  assert.equal(tabs.getSnapshot().activeId, first);
  tabs.close(first);
  assert.deepEqual(tabs.getSnapshot(), {
    tabs: [],
    activeId: undefined,
    visible: false,
  });
  assert.ok(notifications >= 7);
  assert.equal(hostEvents.at(-1), "hide");

  unsubscribe();
  web.dispose();
  tabs.dispose();
});

test("Session Header uses compact Lucide actions for export and Tabs", () => {
  const sharedActionRule = SESSION_HEADER_ACTION_STYLES.match(
    /\[data-minke-session-log-action\],[\s\S]*?\{([\s\S]*?)\n\}/u,
  )?.[1];
  assert.ok(sharedActionRule);
  assert.match(sharedActionRule, /border:\s*none;/u);

  const exportMarkup = renderToStaticMarkup(
    createElement(SessionLogHeaderAction, {
      sessionId: "session-1",
      exportSession: async () => {},
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(exportMarkup, /data-minke-session-log-action=""/u);
  assert.match(exportMarkup, /aria-label="Export Session log"/u);
  assert.match(exportMarkup, /title="Export Session log"/u);
  assert.match(exportMarkup, /aria-busy="false"/u);
  assert.doesNotMatch(exportMarkup, />Session log</u);

  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  tabs.open({
    kind: "web",
    key: "https://example.com/",
    title: "Example",
    payload: {},
  });
  tabs.hide();
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtime: tabs,
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(markup, /data-minke-tabs-header-action=""/u);
  assert.match(markup, /aria-label="Open Tabs sidebar"/u);
  assert.match(markup, /title="Open Tabs sidebar"/u);
  assert.match(markup, /aria-controls="minke-tabs-panel"/u);
  assert.match(markup, /aria-expanded="false"/u);

  tabs.show();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.equal(hostEvents.at(-1), "show");
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, false);
  assert.equal(hostEvents.at(-1), "hide");
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.deepEqual(Object.keys(tabsEn), Object.keys(tabsZh));
  assert.equal(tabsZh["header.sessionLog"], "导出 Session 日志");

  const decodeIcon = (name) => {
    const dataUrl = SESSION_HEADER_ACTION_STYLES.match(
      new RegExp(
        `--minke-${name}-icon: url\\("(data:image/svg\\+xml;base64,[^"]+)"\\)`,
        "u",
      ),
    )?.[1];
    assert.ok(dataUrl);
    return Buffer.from(
      dataUrl.slice(dataUrl.indexOf(",") + 1),
      "base64",
    ).toString("utf8");
  };
  assert.match(decodeIcon("file-down"), /class="lucide lucide-file-down"/u);
  assert.match(
    decodeIcon("panel-right"),
    /class="lucide lucide-panel-right"/u,
  );
});

test("Tabs toggle stays operable with no open tabs", () => {
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtime: tabs,
      t: (key) => tabsEn[key],
    }),
  );

  assert.doesNotMatch(markup, /\sdisabled(?:=""|(?=\s|>))/u);
  assert.match(markup, /aria-pressed="false"/u);
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.deepEqual(hostEvents, ["show"]);

  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    panelSource,
    /panelRendered\s*=\s*hasTabs\s*\|\|\s*snapshot\.visible/u,
  );
  assert.doesNotMatch(panelSource, /if\s*\(!hasTabs\)\s*return null/u);

  const newSessionMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtime: tabs,
      useSessions: (selector) =>
        selector({ current: undefined, byId: {} }),
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(
    newSessionMarkup,
    /data-minke-new-session-tabs-action=""/u,
  );
  assert.match(
    newSessionMarkup,
    /data-minke-tabs-header-action=""/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-new-session-tabs-action\][\s\S]*?position:\s*absolute;/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /right:\s*calc\(var\(--minke-tabs-panel-width,\s*360px\)\s*\+\s*16px\);/u,
  );
  assert.doesNotMatch(
    SESSION_HEADER_ACTION_STYLES,
    /grid-template-columns:\s*inherit;/u,
  );

  const resizeSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/resize.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    resizeSource,
    /#overlay\?\.style\.setProperty\(\s*"--minke-tabs-panel-width"/u,
  );

  const activeSessionMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtime: tabs,
      useSessions: (selector) =>
        selector({
          current: "session-1",
          byId: { "session-1": { blank: false } },
        }),
      t: (key) => tabsEn[key],
    }),
  );
  assert.equal(activeSessionMarkup, "");
  tabs.dispose();
});

test("Tabs renderer registry notifies the shell about runtime adapters", () => {
  const registry = new TabRendererRegistry();
  const revisions = [];
  const unsubscribe = registry.subscribe(() => {
    revisions.push(registry.getSnapshot());
  });
  const unregister = registry.register({
    kind: "terminal",
    renderView: () => null,
  });

  assert.equal(registry.get("terminal")?.kind, "terminal");
  unregister();
  assert.equal(registry.get("terminal"), undefined);
  assert.deepEqual(revisions, [1, 2]);

  unsubscribe();
});

test("Tabs can be reordered by pointer target or keyboard delta", () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const first = tabs.open({
    kind: "terminal",
    key: "one",
    title: "One",
    payload: {},
  });
  const second = tabs.open({
    kind: "terminal",
    key: "two",
    title: "Two",
    payload: {},
  });
  const third = tabs.open({
    kind: "terminal",
    key: "three",
    title: "Three",
    payload: {},
  });
  assert.ok(first && second && third);

  tabs.place(third, first, "before");
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.title),
    ["Three", "One", "Two"],
  );
  tabs.move(first, 1);
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.title),
    ["Three", "Two", "One"],
  );
  assert.equal(tabs.getSnapshot().activeId, third);
});

test("Tabs chrome puts tabs above the URL row without a visible scrollbar", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const addressSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/WebAddressBar.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webViewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/WebTabView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webRendererSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/renderer.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webStylesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/styles.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const webIconsSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/icons.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    panelSource.indexOf('className="minke-tabs-tabbar"') <
      panelSource.indexOf('className="minke-tabs-toolbar"'),
  );
  assert.match(addressSource, /className="minke-tabs-location"/u);
  assert.match(addressSource, /type="text"/u);
  assert.match(addressSource, /inputMode="search"/u);
  assert.match(panelSource, /\sdraggable\s/u);
  assert.match(panelSource, /role="separator"/u);
  assert.match(panelSource, /label=\{t\("tab\.new"\)\}/u);
  assert.doesNotMatch(
    panelSource,
    /label=\{t\("panel\.hide"\)\}/u,
  );
  assert.match(webViewSource, /className="minke-tabs-blank"/u);
  assert.match(webViewSource, /<ExternalIcon \/>/u);
  assert.match(
    webIconsSource,
    /square-arrow-out-up-right/u,
  );
  assert.doesNotMatch(webIconsSource, /external-link/u);
  assert.match(
    webViewSource,
    /tab\.payload\.url === undefined/u,
  );
  assert.match(
    webViewSource,
    /\[canCreateView,\s*controller,\s*tab\.id\]/u,
  );
  assert.doesNotMatch(
    webViewSource,
    /\[controller,\s*tab\.id,\s*tab\.payload\.url\]/u,
  );
  assert.match(
    webRendererSource,
    /className="minke-tab__favicon-preload"/u,
  );
  assert.match(
    webRendererSource,
    /data-loading=\{busy \|\| undefined\}/u,
  );
  assert.match(
    webStylesSource,
    /\.minke-tab__favicon\s*\{[\s\S]*?width:\s*12px;/u,
  );
  assert.match(
    webStylesSource,
    /@keyframes minke-tab-favicon-spin/u,
  );
  assert.match(
    webStylesSource,
    /@media \(prefers-reduced-motion:\s*reduce\)/u,
  );

  assert.match(
    TABS_STYLES,
    /--minke-tabs-chrome-height:\s*74px;/u,
  );
  assert.match(
    TABS_STYLES,
    /--minke-tabs-control-height:\s*24px;/u,
  );
  assert.match(
    TABS_STYLES,
    /--minke-tabs-secondary-control-offset-y:\s*-4px;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tab\s*\{[\s\S]*?height:\s*var\(--minke-tabs-control-height\);/u,
  );
  assert.match(
    webStylesSource,
    /\.minke-tabs-location\s*\{[\s\S]*?height:\s*var\(--minke-tabs-control-height\);/u,
  );
  assert.equal(TABS_CHROME_HEIGHT, 74);
  assert.match(
    TABS_STYLES,
    /max-width:\s*min\(760px,\s*calc\(100% - 320px\)\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-strip::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-strip\s*\{[\s\S]*?padding:\s*0 6px;/u,
  );
  assert.doesNotMatch(
    TABS_STYLES,
    /\.minke-tabs-tabbar__actions\s*\{[^}]*border-left:/u,
  );
  assert.match(TABS_STYLES, /scrollbar-width:\s*none;/u);
  assert.equal(
    clampTabsPanelWidth(1000, 1200),
    TABS_PANEL_MAX_WIDTH,
  );
  assert.equal(clampTabsPanelWidth(700, 900), 580);
  const terminalStylesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/terminal/styles.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    terminalStylesSource,
    /\.minke-terminal-host\s*\{[\s\S]*?padding:\s*4px 8px 8px 12px;/u,
  );
});

test("Tabs new button always opens the type chooser", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const registrySource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/registry.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const typesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/types.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /const \[choosingType, setChoosingType\] = useState\(false\);/u,
  );
  assert.match(
    panelSource,
    /const showCreateChooser = !hasTabs \|\| choosingType;/u,
  );
  assert.match(
    panelSource,
    /onClick=\{\(\) => setChoosingType\(\(open\) => !open\)\}/u,
  );
  assert.match(panelSource, /pressed=\{choosingType\}/u);
  assert.match(
    panelSource,
    /onCreated=\{\(\) => setChoosingType\(false\)\}/u,
  );
  assert.doesNotMatch(
    panelSource,
    /tabCreator|renderers\.creator\s*\(/u,
  );
  assert.doesNotMatch(registrySource, /\bcreator\s*\(/u);
  assert.doesNotMatch(typesSource, /\bcreateTab\??\s*\(/u);
});

test("Tabs resize stays interactive with and without a host details handle", () => {
  class FakeStyle {
    values = new Map();
    priorities = new Map();

    setProperty(name, value, priority = "") {
      this.values.set(name, value);
      this.priorities.set(name, priority);
    }

    removeProperty(name) {
      this.values.delete(name);
      this.priorities.delete(name);
    }

    getPropertyValue(name) {
      return this.values.get(name) ?? "";
    }

    getPropertyPriority(name) {
      return this.priorities.get(name) ?? "";
    }
  }

  class FakeElement {
    attributes = new Map();
    children = [];
    dataset = {};
    listeners = new Map();
    parentElement;
    style = new FakeStyle();
    tabIndex = -1;

    constructor(width = 0) {
      this.width = width;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type) {
      this.listeners.delete(type);
    }

    getBoundingClientRect() {
      return { width: this.width };
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    toggleAttribute(name, force) {
      if (force) this.attributes.set(name, "");
      else this.attributes.delete(name);
    }
  }

  class FakeObserver {
    observe() {}
    disconnect() {}
  }

  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  let panelWidth = "";
  let nativeZIndex = "";
  let restoredZIndex = "";
  let overlayPanelWidth = "";
  let overlayHandleTabIndex = -1;
  try {
    const handle = new FakeElement();
    const nativeHandle = new FakeElement();
    nativeHandle.dataset.side = "details";
    const detailsColumn = new FakeElement(520);
    const detailsSlot = new FakeElement();
    detailsSlot.parentElement = detailsColumn;
    const frame = new FakeElement(1200);
    frame.children.push(nativeHandle);
    const overlay = new FakeElement();
    overlay.parentElement = frame;
    const panel = new FakeElement();
    panel.setAttribute("data-open", "");
    panel.parentElement = overlay;
    panel.closest = (selector) =>
      selector === "[data-shell-overlay]" ? overlay : undefined;
    panel.querySelector = (selector) =>
      selector === ".minke-tabs-resize-handle"
        ? handle
        : undefined;
    panel.ownerDocument = {
      defaultView: {
        ResizeObserver: FakeObserver,
        MutationObserver: FakeObserver,
        addEventListener() {},
        removeEventListener() {},
      },
      querySelector: (selector) =>
        selector === '[data-slot="details"]'
          ? detailsSlot
          : undefined,
    };

    const resize = new TabsPanelResizeController(panel);
    nativeZIndex = nativeHandle.style.getPropertyValue("z-index");
    nativeHandle.listeners.get("pointerdown")({ clientX: 680 });
    nativeHandle.listeners.get("pointermove")({ clientX: 640 });
    panelWidth = panel.style.getPropertyValue(
      "--minke-tabs-panel-width",
    );
    resize.dispose();
    restoredZIndex =
      nativeHandle.style.getPropertyValue("z-index");

    const overlayHandle = new FakeElement();
    const emptyDetailsColumn = new FakeElement(0);
    const emptyDetailsSlot = new FakeElement();
    emptyDetailsSlot.parentElement = emptyDetailsColumn;
    const overlayFrame = new FakeElement(1200);
    const overlayLayer = new FakeElement();
    overlayLayer.parentElement = overlayFrame;
    const overlayPanel = new FakeElement();
    overlayPanel.setAttribute("data-open", "");
    overlayPanel.parentElement = overlayLayer;
    overlayPanel.closest = (selector) =>
      selector === "[data-shell-overlay]"
        ? overlayLayer
        : undefined;
    overlayPanel.querySelector = (selector) =>
      selector === ".minke-tabs-resize-handle"
        ? overlayHandle
        : undefined;
    overlayPanel.ownerDocument = {
      defaultView: {
        ResizeObserver: FakeObserver,
        MutationObserver: FakeObserver,
        addEventListener() {},
        removeEventListener() {},
      },
      querySelector: (selector) =>
        selector === '[data-slot="details"]'
          ? emptyDetailsSlot
          : undefined,
    };

    const overlayResize =
      new TabsPanelResizeController(overlayPanel);
    overlayHandleTabIndex = overlayHandle.tabIndex;
    overlayResize.beginExtendedDrag(680);
    overlayResize.moveExtendedDrag(620);
    overlayPanelWidth =
      overlayPanel.style.getPropertyValue(
        "--minke-tabs-panel-width",
      );
    overlayResize.dispose();
  } finally {
    if (previousHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = previousHTMLElement;
    }
  }

  assert.equal(nativeZIndex, "21");
  assert.equal(panelWidth, "560px");
  assert.equal(restoredZIndex, "");
  assert.equal(overlayHandleTabIndex, 0);
  assert.equal(overlayPanelWidth, "420px");
});

test("Web tab controls delegate to their attached webview", () => {
  const calls = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const web = new WebTabsController(tabs, {
    available: true,
    openExternal: (url) => calls.push(`external:${url}`),
  });
  const id = web.open("https://example.com/") ?? "";
  const view = {
    canGoBack: () => true,
    canGoForward: () => true,
    getTitle: () => "Example",
    getURL: () => "https://example.com/guide",
    goBack: () => calls.push("back"),
    goForward: () => calls.push("forward"),
    loadURL: (url) => calls.push(`load:${url}`),
    reload: () => calls.push("reload"),
    stop: () => calls.push("stop"),
  };
  web.attach(id, view);
  web.syncFromView(id, { loading: false });
  web.updateFavicon(id, [
    "data:image/png;base64,AAAA",
    "https://github.githubassets.com/favicons/favicon.svg",
  ]);
  assert.equal(
    tabs.tab(id)?.payload.faviconUrl,
    "https://github.githubassets.com/favicons/favicon.svg",
  );
  web.goBack(id);
  web.goForward(id);
  web.reloadOrStop(id);
  web.update(id, { loading: true });
  web.reloadOrStop(id);
  web.openExternal(id);
  assert.equal(web.navigate(id, "openai.com/docs"), true);
  assert.equal(tabs.tab(id)?.payload.faviconUrl, undefined);
  const blank = web.createBlank("New tab");
  assert.ok(blank);
  assert.equal(tabs.tab(blank)?.payload.url, undefined);
  assert.equal(web.navigate(blank, "example.com"), true);
  assert.equal(
    tabs.tab(blank)?.payload.url,
    "https://example.com/",
  );
  const search = web.createBlank("New tab");
  assert.ok(search);
  assert.equal(web.navigate(search, "666"), true);
  assert.equal(
    tabs.tab(search)?.payload.url,
    "https://www.google.com/search?q=666",
  );

  assert.deepEqual(calls, [
    "back",
    "forward",
    "reload",
    "stop",
    "external:https://example.com/guide",
    "load:https://openai.com/docs",
  ]);
});
