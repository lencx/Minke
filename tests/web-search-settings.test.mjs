import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bindWebSearchSettingsIpc,
} from "@minke/desktop/main/web-search-settings.ts";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  parseWebSearchSettings,
  WEB_SEARCH_SETTINGS_READ_CHANNEL,
  WEB_SEARCH_SETTINGS_WRITE_CHANNEL,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import {
  desktopWebSearchSettingsStore,
} from "@minke/harness-overlay/client/desktop/settings.ts";
import {
  PreferencesSection,
} from "@minke/harness-overlay/client/preferences/PreferencesSection.tsx";
import {
  preferencesEn,
  preferencesZh,
} from "@minke/harness-overlay/client/preferences/locales.ts";
import {
  WebSearchSettingsRuntime,
} from "@minke/harness-overlay/client/preferences/web-search-runtime.ts";

test("web search settings use one exact default-enabled contract", () => {
  assert.deepEqual(DEFAULT_WEB_SEARCH_SETTINGS, {
    fallbackEnabled: true,
  });
  assert.deepEqual(
    parseWebSearchSettings({ fallbackEnabled: false }),
    { fallbackEnabled: false },
  );
  assert.throws(
    () => parseWebSearchSettings({ fallbackEnabled: "yes" }),
    /web search settings/u,
  );
  assert.throws(
    () =>
      parseWebSearchSettings({
        fallbackEnabled: true,
        retryProviders: true,
      }),
    /web search settings/u,
  );
});

test("web search settings IPC authorizes and validates both verbs", async () => {
  const handlers = new Map();
  let settings = { fallbackEnabled: true };
  const binding = bindWebSearchSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        return settings;
      },
      async write(value) {
        settings = parseWebSearchSettings(value);
      },
    },
    (event) => event === "allowed",
  );

  assert.deepEqual(
    await handlers.get(WEB_SEARCH_SETTINGS_READ_CHANNEL)(
      "allowed",
    ),
    { fallbackEnabled: true },
  );
  await handlers.get(WEB_SEARCH_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    { fallbackEnabled: false },
  );
  assert.deepEqual(settings, { fallbackEnabled: false });
  await assert.rejects(
    handlers.get(WEB_SEARCH_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      { fallbackEnabled: 1 },
    ),
    /web search settings/u,
  );
  await assert.rejects(
    handlers.get(WEB_SEARCH_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized web search settings request/u,
  );
  await assert.rejects(
    handlers.get(WEB_SEARCH_SETTINGS_WRITE_CHANNEL)(
      "denied",
      { fallbackEnabled: true },
    ),
    /unauthorized web search settings request/u,
  );

  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("desktop web search bridge hydrates and persists the fallback toggle", async () => {
  let settings = { fallbackEnabled: true };
  const store = desktopWebSearchSettingsStore({
    minkeDesktop: {
      webSearch: {
        async read() {
          return settings;
        },
        async write(value) {
          settings = parseWebSearchSettings(value);
        },
      },
    },
  });
  const runtime = new WebSearchSettingsRuntime(store);

  await runtime.initialize();
  assert.equal(runtime.getSnapshot().editable, true);
  assert.equal(
    runtime.getSnapshot().settings.fallbackEnabled,
    true,
  );
  runtime.setFallbackEnabled(false);
  assert.equal(
    runtime.getSnapshot().settings.fallbackEnabled,
    false,
  );
  await runtime.flush();
  assert.deepEqual(settings, { fallbackEnabled: false });
  runtime.dispose();
});

test("web search runtime exposes unavailable and failed-write states", async () => {
  const unavailableStore = desktopWebSearchSettingsStore({});
  assert.equal(unavailableStore.available, false);
  assert.deepEqual(
    await unavailableStore.read(),
    DEFAULT_WEB_SEARCH_SETTINGS,
  );

  const runtime = new WebSearchSettingsRuntime({
    available: true,
    async read() {
      return DEFAULT_WEB_SEARCH_SETTINGS;
    },
    async write() {
      throw new Error("read-only fixture");
    },
  });
  await runtime.initialize();
  runtime.setFallbackEnabled(false);
  await runtime.flush();
  assert.equal(runtime.getSnapshot().error, "write");
  runtime.dispose();
});

test("web search fallback renders native-tool routing and restart boundary", async () => {
  const runtime = new WebSearchSettingsRuntime({
    available: true,
    async read() {
      return DEFAULT_WEB_SEARCH_SETTINGS;
    },
    async write() {},
  });
  await runtime.initialize();
  const t = (key) => preferencesZh[key];
  const html = renderToStaticMarkup(
    createElement(PreferencesSection, {
      t,
      webSearchSettings: runtime,
    }),
  );

  assert.equal(
    html.includes("启用 Minke 搜索兜底"),
    true,
  );
  assert.equal(html.includes("web_search 失败"), true);
  assert.equal(html.includes("web_fetch 失败"), true);
  assert.equal(html.includes("重启 Minke 后生效"), true);
  assert.equal(
    html.includes("data-minke-web-search-settings"),
    true,
  );
  assert.equal(
    html.includes(
      'aria-describedby="minke-web-search-fallback-help"',
    ),
    true,
  );
  assert.equal(html.includes('checked=""'), true);
  runtime.dispose();
});

test("web search fallback copy is complete in both locales", () => {
  assert.deepEqual(
    Object.keys(preferencesEn).sort(),
    Object.keys(preferencesZh).sort(),
  );
  assert.equal(
    preferencesEn["preferences.webSearch.fallback.label"],
    "Enable Minke search fallback",
  );
  assert.match(
    preferencesEn["preferences.webSearch.fallback.help"],
    /native web_search[\s\S]*web_fetch/u,
  );
});
