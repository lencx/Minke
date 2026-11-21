import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  createElement,
} from "react";
import { JSDOM } from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  installMinkeSettings,
  MinkeSettingsSection,
  MinkeSettingsRuntime,
  minkeSettingsEn,
  minkeSettingsZh,
} from "@minke/harness-overlay/client/minke-settings/index.ts";
import {
  installRemote,
} from "@minke/harness-overlay/client/remote/install.tsx";

function page(id, order, label = id) {
  return {
    id,
    order,
    label: () => label,
    icon: "preferences",
    render: () => createElement("p", null, `${label} content`),
  };
}

test("Minke Settings owns a sorted directory and one secondary tab", () => {
  const runtime = new MinkeSettingsRuntime();
  const revisions = [];
  const unsubscribe = runtime.subscribe(() => {
    revisions.push(runtime.getSnapshot().revision);
  });
  const unregisterStorage = runtime.register(
    page("data-home", 20, "Data & Storage"),
  );
  const unregisterPreferences = runtime.register(
    page("preferences", 0, "Preferences"),
  );

  assert.deepEqual(
    runtime.getSnapshot().pages.map(({ id }) => id),
    ["preferences", "data-home"],
  );
  assert.equal(runtime.getSnapshot().activeId, "preferences");
  runtime.select("data-home");
  assert.equal(runtime.getSnapshot().activeId, "data-home");
  runtime.select("missing");
  assert.equal(runtime.getSnapshot().activeId, "data-home");

  assert.throws(
    () => runtime.register(page("data-home", 99)),
    /already registered/u,
    "duplicate contributions are a known-invalid registry input",
  );
  unregisterStorage();
  assert.equal(runtime.getSnapshot().activeId, "preferences");
  unregisterPreferences();
  assert.equal(runtime.getSnapshot().activeId, undefined);
  assert.ok(revisions.length >= 4);
  unsubscribe();
  runtime.dispose();
});

test("the installer exposes one Minke Settings section and its native navigation icon", () => {
  const runtime = new MinkeSettingsRuntime();
  const registrations = [];
  const cleanups = [];
  const ctx = {
    effect(callback, label) {
      if (label.endsWith(" styles")) return;
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return (key) => minkeSettingsEn[key];
      },
    },
    slots: {
      inject(_name, register) {
        register();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  installMinkeSettings(ctx, runtime);

  assert.deepEqual(
    registrations.map(({ options }) => ({
      name: options.name,
      id: options.id,
    })),
    [
      {
        name: "settings.section",
        id: "minke-settings",
      },
      {
        name: "settings.section.icon",
        id: "minke-settings",
      },
    ],
  );
  assert.equal(
    registrations[0].options.inject().runtime,
    runtime,
  );
  const icon = renderToStaticMarkup(createElement(registrations[1].component, { size: 16 }));
  assert.match(icon, /<svg[^>]*width="16"[^>]*height="16"[^>]*viewBox="0 0 832 832"[^>]*aria-hidden="true"/u);
  assert.match(icon, /<mask id="[^"]+">/u);
  assert.match(icon, /<rect[^>]*rx="182\.8125"[^>]*fill="currentColor"[^>]*mask="url\(#[^"]+\)"/u);

  for (const cleanup of cleanups.reverse()) cleanup();
});

test("remote access is configured only through Connections", () => {
  const originalWindow = globalThis.window;
  const effectLabels = [];
  globalThis.window = {
    minkeDesktop: {
      remote: {
        async read() {
          throw new Error("not exercised");
        },
        async write() {
          throw new Error("not exercised");
        },
      },
    },
  };

  try {
    installRemote({
      effect(_callback, label) {
        effectLabels.push(label);
      },
      locale: {
        register() {
          return () => {};
        },
        bind() {
          return (key) => key;
        },
      },
    });
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }

  assert.doesNotMatch(
    effectLabels.join("\n"),
    /Minke Settings/u,
  );
});

test("the unified DSH section renders accessible labeled tabs", () => {
  const runtime = new MinkeSettingsRuntime();
  runtime.register(page("preferences", 0, "Preferences"));
  runtime.register({
    ...page("browser", 5, "Browser"),
    icon: "browser",
  });
  runtime.register({
    ...page("data-home", 20, "Data & Storage"),
    icon: "data-home",
  });
  const html = renderToStaticMarkup(
    createElement(MinkeSettingsSection, {
      runtime,
      t: (key) => minkeSettingsEn[key],
    }),
  );

  assert.ok(html.includes('role="tablist"'));
  assert.equal((html.match(/role="tab"/gu) ?? []).length, 3);
  assert.equal((html.match(/role="tabpanel"/gu) ?? []).length, 3);
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(html.includes('>Preferences</span>'));
  assert.ok(html.includes('>Browser</span>'));
  assert.equal(
    (html.match(/class="minke-settings__tab-label"/gu) ?? []).length,
    3,
  );
  assert.ok(!html.includes('title="Remote access"'));
  assert.ok(html.includes("Preferences content"));
  assert.ok(!html.includes("Local models"));
  assert.ok(!html.includes('role="dialog"'));
  assert.deepEqual(
    Object.keys(minkeSettingsEn).sort(),
    Object.keys(minkeSettingsZh).sort(),
  );
  runtime.dispose();
});

test("native settings tabs move keyboard focus and preserve visited drafts", async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const runtime = new MinkeSettingsRuntime();
  runtime.register({ ...page("preferences", 0, "Preferences"), render: () => createElement("input", { defaultValue: "draft" }) });
  runtime.register(page("browser", 1, "Browser"));
  runtime.register(page("data-home", 2, "Storage"));
  let root;
  try {
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
    }
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("root");
    root = createRoot(container);
    await act(async () => root.render(createElement(MinkeSettingsSection, { runtime, t: key => minkeSettingsEn[key] })));
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const draft = container.querySelector('input');
    draft.value = "unsaved change";
    tabs[0].focus();
    for (const [key, index] of [["ArrowLeft", 2], ["ArrowRight", 0], ["End", 2], ["Home", 0], ["ArrowRight", 1]]) {
      await act(async () => dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true })));
      assert.equal(dom.window.document.activeElement, tabs[index]);
      assert.equal(tabs[index].getAttribute("aria-selected"), "true");
      assert.equal(tabs[index].tabIndex, 0);
      const panel = dom.window.document.getElementById(tabs[index].getAttribute("aria-controls"));
      assert.equal(panel.hidden, false);
      assert.equal(panel.getAttribute("aria-labelledby"), tabs[index].id);
      assert.equal(container.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
    }
    await act(async () => tabs[0].click());
    assert.equal(container.querySelector('input'), draft);
    assert.equal(draft.value, "unsaved change");
  } finally {
    if (root) await act(async () => root.unmount());
    runtime.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
