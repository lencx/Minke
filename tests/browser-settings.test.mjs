import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bindBrowserSettingsIpc,
} from "@minke/desktop/main/browser-settings.ts";
import {
  BROWSER_SETTINGS_READ_CHANNEL,
  BROWSER_SETTINGS_WRITE_CHANNEL,
  BROWSER_USER_AGENT_MAX_LENGTH,
  DEFAULT_BROWSER_SETTINGS,
  defaultChromeUserAgent,
  parseBrowserSettings,
  resolveBrowserUserAgent,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import {
  desktopBrowserSettingsStore,
} from "@minke/harness-overlay/client/desktop/settings.ts";
import {
  BrowserSettingsSection,
  BrowserSettingsRuntime,
  browserSettingsEn,
  browserSettingsZh,
  browserUserAgentDisplayValue,
  stageBrowserUserAgentChange,
  stageBrowserUserAgentDraft,
} from "@minke/harness-overlay/client/browser-settings/index.ts";
import {
  BROWSER_SETTINGS_STYLES,
} from "@minke/harness-overlay/client/browser-settings/styles.ts";

const ELECTRON_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Minke/0.2.0 Chrome/150.0.7871.224 "
  + "Electron/43.4.0 Safari/537.36";
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/150.0.0.0 Safari/537.36";

test("browser settings default to automatic reduced Chrome identities", () => {
  assert.deepEqual(DEFAULT_BROWSER_SETTINGS, {
    webUserAgent: "",
    agentUserAgent: "",
  });
  assert.equal(
    defaultChromeUserAgent(ELECTRON_USER_AGENT),
    CHROME_USER_AGENT,
  );
  assert.equal(
    resolveBrowserUserAgent("", ELECTRON_USER_AGENT),
    CHROME_USER_AGENT,
  );
  assert.equal(
    resolveBrowserUserAgent(" CustomBrowser/7 ", ELECTRON_USER_AGENT),
    "CustomBrowser/7",
  );
  assert.deepEqual(
    parseBrowserSettings({
      webUserAgent: " WebBrowser/1 ",
      agentUserAgent: "AgentBrowser/2",
    }),
    {
      webUserAgent: "WebBrowser/1",
      agentUserAgent: "AgentBrowser/2",
    },
  );
  assert.throws(
    () =>
      parseBrowserSettings({
        webUserAgent: "Browser/1\nInjected: true",
        agentUserAgent: "",
      }),
    /web user agent/u,
  );
  assert.throws(
    () =>
      parseBrowserSettings({
        webUserAgent: "x".repeat(
          BROWSER_USER_AGENT_MAX_LENGTH + 1,
        ),
        agentUserAgent: "",
      }),
    /web user agent/u,
  );
  assert.throws(
    () =>
      parseBrowserSettings({
        webUserAgent: "",
        agentUserAgent: "",
        shared: true,
      }),
    /browser settings/u,
  );
});

test("browser settings IPC stores before applying and authorizes both verbs", async () => {
  const handlers = new Map();
  const events = [];
  let settings = { ...DEFAULT_BROWSER_SETTINGS };
  const binding = bindBrowserSettingsIpc(
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
        settings = parseBrowserSettings(value);
        events.push("stored");
      },
    },
    (value) => {
      events.push(`applied:${value.agentUserAgent}`);
    },
    (event) => event === "allowed",
  );

  assert.deepEqual(
    await handlers.get(BROWSER_SETTINGS_READ_CHANNEL)("allowed"),
    DEFAULT_BROWSER_SETTINGS,
  );
  await handlers.get(BROWSER_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    {
      webUserAgent: "Web/1",
      agentUserAgent: "Agent/2",
    },
  );
  assert.deepEqual(events, ["stored", "applied:Agent/2"]);
  assert.deepEqual(settings, {
    webUserAgent: "Web/1",
    agentUserAgent: "Agent/2",
  });
  await assert.rejects(
    handlers.get(BROWSER_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      { webUserAgent: "", agentUserAgent: "\rInjected" },
    ),
    /agent user agent/u,
  );
  await assert.rejects(
    handlers.get(BROWSER_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized browser settings request/u,
  );

  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("desktop browser bridge hydrates and persists independent UA values", async () => {
  let settings = { ...DEFAULT_BROWSER_SETTINGS };
  const store = desktopBrowserSettingsStore({
    minkeDesktop: {
      browser: {
        async read() {
          return settings;
        },
        async write(value) {
          settings = parseBrowserSettings(value);
        },
      },
    },
  });
  const runtime = new BrowserSettingsRuntime(
    store,
    ELECTRON_USER_AGENT,
  );

  await runtime.initialize();
  assert.equal(runtime.getSnapshot().editable, true);
  assert.equal(
    runtime.getSnapshot().automaticUserAgent,
    CHROME_USER_AGENT,
  );
  runtime.setUserAgent("webUserAgent", "Ordinary/1");
  runtime.setUserAgent("agentUserAgent", "Agent/2");
  await runtime.flush();
  assert.deepEqual(settings, {
    webUserAgent: "Ordinary/1",
    agentUserAgent: "Agent/2",
  });
  assert.throws(
    () => runtime.setUserAgent("webUserAgent", "浏览器/1"),
    /web user agent/u,
  );
  runtime.dispose();
});

test("browser identity renders as a standalone multiline module", async () => {
  const runtime = new BrowserSettingsRuntime(
    {
      available: true,
      async read() {
        return DEFAULT_BROWSER_SETTINGS;
      },
      async write() {},
    },
    ELECTRON_USER_AGENT,
  );
  await runtime.initialize();
  const html = renderToStaticMarkup(
    createElement(BrowserSettingsSection, {
      t: (key) => browserSettingsZh[key],
      runtime,
    }),
  );

  assert.equal(html.includes("data-minke-browser-settings"), true);
  assert.equal(html.includes("data-minke-preferences"), false);
  assert.equal(html.includes("普通访问"), true);
  assert.equal(html.includes("Agent 访问"), true);
  assert.equal(html.includes("当前自动 Chrome UA"), false);
  assert.equal(html.includes("Chrome/150.0.0.0"), true);
  assert.equal(html.includes("Minke/0.2.0"), false);
  assert.equal(html.includes("Electron/43.4.0"), false);
  assert.equal(html.match(/maxLength="512"/gu)?.length, 2);
  assert.equal(html.match(/恢复推荐 UA/gu)?.length, 2);
  assert.equal(html.match(/<textarea/gu)?.length, 2);
  assert.equal(
    html.match(/<textarea[^>]*>Mozilla\/5\.0/gu)?.length,
    2,
  );
  assert.equal(html.match(/rows="3"/gu)?.length, 2);
  assert.match(
    BROWSER_SETTINGS_STYLES,
    /resize:\s*vertical/u,
  );
  runtime.dispose();
});

test("recommended UA remains editable and restore recommended resets it", () => {
  assert.equal(
    browserUserAgentDisplayValue("", CHROME_USER_AGENT),
    CHROME_USER_AGENT,
  );
  assert.deepEqual(
    stageBrowserUserAgentDraft(
      "CustomBrowser/7\nFeature/2",
      CHROME_USER_AGENT,
    ),
    {
      displayValue: "CustomBrowser/7 Feature/2",
      configuredValue: "CustomBrowser/7 Feature/2",
    },
  );
  assert.deepEqual(
    stageBrowserUserAgentDraft("", CHROME_USER_AGENT),
    {
      displayValue: CHROME_USER_AGENT,
      configuredValue: "",
    },
  );
  assert.deepEqual(
    stageBrowserUserAgentDraft(
      CHROME_USER_AGENT,
      CHROME_USER_AGENT,
    ),
    {
      displayValue: CHROME_USER_AGENT,
      configuredValue: "",
    },
  );
});

test("browser UA input changes snapshot React currentTarget", () => {
  let currentTarget = { value: "CustomBrowser/8" };
  let pendingUpdate;
  const event = {
    get currentTarget() {
      return currentTarget;
    },
  };

  stageBrowserUserAgentChange(
    (update) => {
      pendingUpdate = update;
    },
    "webUserAgent",
    event,
  );
  currentTarget = null;

  assert.equal(typeof pendingUpdate, "function");
  assert.deepEqual(
    pendingUpdate({
      webUserAgent: CHROME_USER_AGENT,
      agentUserAgent: CHROME_USER_AGENT,
    }),
    {
      webUserAgent: "CustomBrowser/8",
      agentUserAgent: CHROME_USER_AGENT,
    },
  );
});

test("browser identity copy is complete in both locales", () => {
  assert.deepEqual(
    Object.keys(browserSettingsEn).sort(),
    Object.keys(browserSettingsZh).sort(),
  );
  assert.match(
    browserSettingsEn["browser.description"],
    /without Minke or Electron tokens[\s\S]*fully editable/u,
  );
  assert.equal(browserSettingsZh["browser.nav"], "浏览器");
  assert.match(
    browserSettingsZh["browser.editHint"],
    /离开输入框即自动保存/u,
  );
  assert.equal(
    browserSettingsEn["browser.reset"],
    "Restore recommended UA",
  );
  assert.equal(
    browserSettingsZh["browser.automatic.label"],
    "推荐 Chrome UA",
    "older hot-loaded views keep a non-rendered locale compatibility key",
  );
});
