import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  bindTerminalSettingsIpc,
} from "@minke/desktop/main/terminal-settings.ts";
import {
  MINKE_CONFIG_VERSION,
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  TerminalSettingsRuntime,
} from "@minke/harness-overlay/client/tabs/terminal/settings/runtime.ts";
import {
  preferencesEn,
  preferencesZh,
} from "@minke/harness-overlay/client/preferences/locales.ts";
import {
  applyTerminalRenderingSettings,
} from "@minke/harness-overlay/client/tabs/terminal/settings/rendering.ts";
import {
  loadTerminalCodeTheme,
  terminalCodeThemeFallback,
} from "@minke/harness-overlay/client/tabs/files/code-themes.ts";
import {
  stageDraftChange,
} from "@minke/harness-overlay/client/tabs/terminal/settings/drafts.ts";
import {
  terminalTabsEn,
  terminalTabsZh,
} from "@minke/harness-overlay/client/tabs/terminal/locales.ts";
import {
  TERMINAL_TAB_STYLES,
} from "@minke/harness-overlay/client/tabs/terminal/styles.ts";

const roots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "minke-terminal-settings-"));
  roots.push(root);
  const config = new MinkeConfigStore(root);
  return {
    path: config.path,
    store: config.terminal,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

function assertDefaultRemoteSettings(settings) {
  assert.match(
    settings.cloudflare.generatedLabel,
    /^m-[0123456789abcdefghjkmnpqrstvwxyz]{16}$/u,
  );
  assert.deepEqual(settings, {
    enabled: false,
    method: "tailscale",
    tailscale: {
      transport: "serve",
      ipAddress: "",
    },
    cloudflare: {
      hostnameMode: "generated",
      domain: "",
      generatedLabel:
        settings.cloudflare.generatedLabel,
      customHostname: "",
      teamName: "",
      audience: "",
      tunnel: "",
      configPath: "",
      originPort: 49_321,
    },
  });
}

test("Terminal settings validate a small, exact rendering contract", () => {
  assert.deepEqual(
    parseTerminalSettings({
      fontFamily: "  JetBrains Mono, monospace  ",
      fontSize: 14,
      lineHeight: 1.35,
    }),
    {
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
      lineHeight: 1.35,
    },
  );
  assert.throws(
    () => parseTerminalSettings({
      ...DEFAULT_TERMINAL_SETTINGS,
      fontSize: 7,
    }),
    /font size/u,
  );
  assert.throws(
    () => parseTerminalSettings({
      ...DEFAULT_TERMINAL_SETTINGS,
      lineHeight: 2.01,
    }),
    /line height/u,
  );
  assert.throws(
    () => parseTerminalSettings({
      ...DEFAULT_TERMINAL_SETTINGS,
      fontFamily: "Monaco\nserif",
    }),
    /font family/u,
  );
  assert.throws(
    () => parseTerminalSettings({
      ...DEFAULT_TERMINAL_SETTINGS,
      futureOption: true,
    }),
    /terminal settings/u,
  );
});

test("Personal preferences copy stays complete in English and Chinese", () => {
  assert.deepEqual(
    Object.keys(preferencesEn).sort(),
    Object.keys(preferencesZh).sort(),
  );
  assert.equal(preferencesZh["preferences.nav"], "个人偏好");
  assert.equal(preferencesEn["preferences.nav"], "Preferences");
  assert.equal(
    preferencesZh["preferences.codeTheme.light.label"],
    "浅色外观",
  );
  assert.equal(
    preferencesZh["preferences.codeTheme.dark.label"],
    "深色外观",
  );
  assert.equal(
    preferencesEn["preferences.terminal.title"],
    "Terminal",
  );
  assert.equal(
    preferencesZh["preferences.code.title"],
    "代码与终端主题",
  );
  assert.deepEqual(
    Object.keys(terminalTabsEn).sort(),
    Object.keys(terminalTabsZh).sort(),
  );
});

test("Personal preferences groups code theme and Terminal controls", () => {
  const source = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/preferences/PreferencesSection.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /data-minke-preferences/u);
  assert.match(source, /data-minke-terminal-settings/u);
  assert.match(source, /data-appearance=\{colorScheme\}/u);
  assert.match(
    source,
    /data-code-theme=\{codeTheme\}/u,
    "the Terminal preview must expose the shared active theme",
  );
  assert.match(
    source,
    /className="minke-preferences__input minke-preferences__select"/u,
  );
  assert.match(
    source,
    /CODE_THEME_GROUPS\.map\(\(group\)\s*=>\s*\(/u,
  );
  assert.match(source, /<optgroup/u);
  assert.match(source, /<CodeThemePreferences/u);
  assert.match(source, /<TerminalPreferences/u);
});

test("Terminal reuses the selected editor theme including ANSI colors", async () => {
  assert.deepEqual(
    terminalCodeThemeFallback("catppuccin-mocha"),
    {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "#9399b240",
    },
  );

  const mocha = await loadTerminalCodeTheme(
    "catppuccin-mocha",
  );
  assert.deepEqual(
    {
      background: mocha.background,
      foreground: mocha.foreground,
      cursor: mocha.cursor,
      selectionBackground: mocha.selectionBackground,
      red: mocha.red,
      green: mocha.green,
      yellow: mocha.yellow,
      blue: mocha.blue,
      magenta: mocha.magenta,
      cyan: mocha.cyan,
    },
    {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#585b70",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
    },
  );

  const solarizedLight = await loadTerminalCodeTheme(
    "solarized-light",
  );
  assert.equal(solarizedLight.background, "#FDF6E3");
  assert.equal(solarizedLight.foreground, "#657b83");
  assert.equal(solarizedLight.red, "#dc322f");
  assert.equal(solarizedLight.blue, "#268bd2");

  const terminalViewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/terminal/TerminalView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(terminalViewSource, /props\.codeThemes\.subscribe/u);
  assert.match(
    terminalViewSource,
    /loadTerminalCodeTheme\(codeThemeSnapshot\.theme\)/u,
  );
  assert.match(
    terminalViewSource,
    /data-code-theme=\{codeThemeSnapshot\.theme\}/u,
  );
});

test("Terminal viewport covers the FitAddon row remainder with the active theme", () => {
  assert.match(
    TERMINAL_TAB_STYLES,
    /\.minke-terminal-host\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?:\s*var\(--minke-code-background\)/u,
  );
});

test("the desktop store writes Terminal settings into Minke config", async () => {
  const { path, store } = await fixture();
  assert.deepEqual(await store.read(), DEFAULT_TERMINAL_SETTINGS);

  await store.write({
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    lineHeight: 1.35,
  });

  assert.deepEqual(await store.read(), {
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    lineHeight: 1.35,
  });
  const document = JSON.parse(await readFile(path, "utf8"));
  const { remote, ...documentWithoutRemote } = document;
  assert.deepEqual(documentWithoutRemote, {
    version: MINKE_CONFIG_VERSION,
    shortcuts: {},
    terminal: {
      fontFamily: "JetBrains Mono",
      fontSize: 14,
      lineHeight: 1.35,
    },
    modelRuntime: {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    plugins: {
      safeMode: false,
      disabledPlugins: [],
    },
    webSearch: {
      fallbackEnabled: true,
    },
    telegramNetwork: {
      httpProxyUrl: "",
    },
    discordNetwork: {
      httpProxyUrl: "",
    },
    appUpdate: {
      autoDownload: true,
    },
    browser: {
      webUserAgent: "",
      agentUserAgent: "",
    },
  });
  assertDefaultRemoteSettings(remote);
});

test("Terminal settings IPC authorizes and validates reads and writes", async () => {
  const { store } = await fixture();
  const handlers = new Map();
  const binding = bindTerminalSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    store,
    (event) => event === "allowed",
  );

  await handlers.get(TERMINAL_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    {
      fontFamily: "",
      fontSize: 15,
      lineHeight: 1.4,
    },
  );
  assert.deepEqual(
    await handlers.get(TERMINAL_SETTINGS_READ_CHANNEL)("allowed"),
    {
      fontFamily: "",
      fontSize: 15,
      lineHeight: 1.4,
    },
  );
  await assert.rejects(
    handlers.get(TERMINAL_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      {
        fontFamily: "",
        fontSize: 100,
        lineHeight: 1.4,
      },
    ),
    /font size/u,
  );
  await assert.rejects(
    handlers.get(TERMINAL_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );

  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("Terminal settings hydrate, update optimistically, and reset", async () => {
  const writes = [];
  const runtime = new TerminalSettingsRuntime({
    available: true,
    async read() {
      return {
        fontFamily: "Monaco",
        fontSize: 13,
        lineHeight: 1.3,
      };
    },
    async write(settings) {
      writes.push({ ...settings });
    },
  });

  await runtime.initialize();
  assert.deepEqual(runtime.getSnapshot().settings, {
    fontFamily: "Monaco",
    fontSize: 13,
    lineHeight: 1.3,
  });
  assert.equal(runtime.getSnapshot().editable, true);

  runtime.update({ fontSize: 15 });
  assert.equal(runtime.getSnapshot().settings.fontSize, 15);
  await runtime.flush();
  assert.deepEqual(writes.at(-1), {
    fontFamily: "Monaco",
    fontSize: 15,
    lineHeight: 1.3,
  });

  runtime.reset();
  await runtime.flush();
  assert.deepEqual(runtime.getSnapshot().settings, DEFAULT_TERMINAL_SETTINGS);
  assert.deepEqual(writes.at(-1), DEFAULT_TERMINAL_SETTINGS);
  runtime.dispose();
});

test("Terminal input changes do not retain React event.currentTarget", () => {
  let currentTarget = { value: "16" };
  let pendingUpdate;
  const event = {
    get currentTarget() {
      return currentTarget;
    },
  };

  stageDraftChange(
    (update) => {
      pendingUpdate = update;
    },
    "fontSize",
    event,
  );
  currentTarget = null;

  assert.equal(typeof pendingUpdate, "function");
  assert.deepEqual(
    pendingUpdate({
      fontFamily: "",
      fontSize: "12",
      lineHeight: "1.24",
    }),
    {
      fontFamily: "",
      fontSize: "16",
      lineHeight: "1.24",
    },
  );
});

test("Terminal rendering settings update an existing xterm target", () => {
  const terminal = {
    options: {
      fontFamily: "old",
      fontSize: 10,
      lineHeight: 1,
    },
  };

  applyTerminalRenderingSettings(
    terminal,
    {
      fontFamily: "JetBrains Mono",
      fontSize: 15,
      lineHeight: 1.4,
    },
    "App Mono",
  );
  assert.deepEqual(terminal.options, {
    fontFamily: "JetBrains Mono",
    fontSize: 15,
    lineHeight: 1.4,
  });

  applyTerminalRenderingSettings(
    terminal,
    DEFAULT_TERMINAL_SETTINGS,
    "App Mono",
  );
  assert.equal(terminal.options.fontFamily, "App Mono");
});

test("Terminal persistence failures remain observable", async () => {
  const runtime = new TerminalSettingsRuntime({
    available: true,
    async read() {
      return DEFAULT_TERMINAL_SETTINGS;
    },
    async write() {
      throw new Error("disk full");
    },
  });
  await runtime.initialize();

  runtime.update({ fontSize: 16 });
  await runtime.flush();
  assert.equal(runtime.getSnapshot().error, "write");
  runtime.dispose();
});
