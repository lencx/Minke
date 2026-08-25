import assert from "node:assert/strict";
import test from "node:test";
import {
  createElement,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  installMinkeSettings,
  installMinkeSettingsNavigationLogo,
  MINKE_SETTINGS_LOGO_DATA_URL,
  MINKE_SETTINGS_STYLES,
  MinkeSettingsSection,
  MinkeSettingsRuntime,
  minkeSettingsEn,
  minkeSettingsZh,
  nextMinkeSettingsTabIndex,
  reconcileMinkeSettingsNavigationLogo,
  shouldMountMinkeSettingsPage,
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
  assert.equal(nextMinkeSettingsTabIndex(0, 5, "ArrowLeft"), 4);
  assert.equal(nextMinkeSettingsTabIndex(4, 5, "ArrowRight"), 0);
  assert.equal(nextMinkeSettingsTabIndex(3, 5, "Home"), 0);
  assert.equal(nextMinkeSettingsTabIndex(1, 5, "End"), 4);
  assert.equal(nextMinkeSettingsTabIndex(1, 5, "Enter"), undefined);
  assert.equal(
    shouldMountMinkeSettingsPage(
      { ...page("shortcuts", 20), keepAlive: false },
      "preferences",
      new Set(["shortcuts"]),
    ),
    false,
    "leaving shortcut recording must unmount its global Escape guard",
  );
  assert.equal(
    shouldMountMinkeSettingsPage(
      page("data-home", 20),
      "preferences",
      new Set(["data-home"]),
    ),
    true,
    "stateful settings drafts remain mounted after their first visit",
  );
  unsubscribe();
  runtime.dispose();
});

test("the installer exposes only one Minke section in DSH Settings", () => {
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
    ],
  );
  assert.equal(
    registrations[0].options.inject().runtime,
    runtime,
  );

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

test("the Minke Settings row uses an adaptive SVG logo", () => {
  const marker = "data-minke-settings-navigation-logo";
  const variable = "--minke-settings-navigation-logo";
  const createButton = (label) => {
    const attributes = new Set();
    const declarations = new Map();
    return {
      attributes,
      style: {
        getPropertyPriority: () => "",
        getPropertyValue: (name) => declarations.get(name) ?? "",
        removeProperty: (name) => declarations.delete(name),
        setProperty: (name, value) => declarations.set(name, value),
      },
      querySelector: () => ({ textContent: label }),
      toggleAttribute(name, enabled) {
        if (enabled) attributes.add(name);
        else attributes.delete(name);
      },
    };
  };
  const general = createButton("General");
  const minke = createButton("Minke");
  let reconcile;
  const root = {
    defaultView: {
      MutationObserver: class {
        disconnect() {}
        observe() {}
      },
      requestAnimationFrame(callback) {
        reconcile = callback;
        return 1;
      },
      cancelAnimationFrame() {},
    },
    documentElement: {},
    querySelectorAll: () => [general, minke],
  };

  reconcileMinkeSettingsNavigationLogo(root, "Minke");
  assert.equal(general.attributes.has(marker), false);
  assert.equal(minke.attributes.has(marker), true);

  const dispose = installMinkeSettingsNavigationLogo(
    () => "Minke",
    root,
  );
  assert.equal(typeof reconcile, "function");
  reconcile();
  assert.equal(general.style.getPropertyValue(variable), "");
  assert.equal(
    minke.style.getPropertyValue(variable),
    `url("${MINKE_SETTINGS_LOGO_DATA_URL}")`,
  );

  const svg = decodeURIComponent(
    MINKE_SETTINGS_LOGO_DATA_URL.slice(
      MINKE_SETTINGS_LOGO_DATA_URL.indexOf(",") + 1,
    ),
  );
  assert.match(
    svg,
    /<svg[^>]*viewBox="0 0 832 832"/u,
  );
  assert.match(
    svg,
    /<rect width="832" height="832" rx="182\.8125"/u,
  );
  assert.match(svg, /<mask id="minke-logo-cutout">/u);
  assert.match(svg, /<path fill="black"/u);
  assert.doesNotMatch(svg, /#0e1324|#fdfdfd/u);
  assert.match(
    MINKE_SETTINGS_STYLES,
    /\[data-minke-settings-navigation-logo\]::before/u,
  );
  assert.match(
    MINKE_SETTINGS_STYLES,
    /background:\s*currentColor/u,
  );
  assert.match(
    MINKE_SETTINGS_STYLES,
    /mask:[\s\S]*var\(--minke-settings-navigation-logo\)/u,
  );

  dispose();
  assert.equal(minke.style.getPropertyValue(variable), "");
  assert.equal(minke.attributes.has(marker), false);
});

test("the unified DSH section renders accessible icon tabs", () => {
  const runtime = new MinkeSettingsRuntime();
  runtime.register(page("preferences", 0, "Preferences"));
  runtime.register({
    ...page("browser", 5, "Browser"),
    icon: "browser",
  });
  runtime.register({
    ...page("shortcuts", 10, "Keyboard shortcuts"),
    icon: "shortcuts",
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
  assert.equal((html.match(/role="tab"/gu) ?? []).length, 4);
  assert.equal((html.match(/role="tabpanel"/gu) ?? []).length, 4);
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(html.includes('aria-label="Preferences"'));
  assert.ok(html.includes('aria-label="Browser"'));
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
