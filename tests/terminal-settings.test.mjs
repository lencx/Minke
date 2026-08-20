import assert from "node:assert/strict";
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
  installTerminalSettingsNavigationIcon,
  reconcileTerminalSettingsNavigationIcon,
  TERMINAL_SETTINGS_STYLES,
} from "@minke/harness-overlay/client/tabs/terminal/settings/styles.ts";
import {
  applyTerminalRenderingSettings,
} from "@minke/harness-overlay/client/tabs/terminal/settings/rendering.ts";
import {
  stageDraftChange,
} from "@minke/harness-overlay/client/tabs/terminal/settings/drafts.ts";
import {
  terminalTabsEn,
  terminalTabsZh,
} from "@minke/harness-overlay/client/tabs/terminal/locales.ts";

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
    tailscale: { transport: "serve" },
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

test("Terminal settings copy stays complete in English and Chinese", () => {
  assert.deepEqual(
    Object.keys(terminalTabsEn).sort(),
    Object.keys(terminalTabsZh).sort(),
  );
  assert.equal(terminalTabsZh["terminal.settings.nav"], "终端");
  assert.equal(terminalTabsEn["terminal.settings.nav"], "Terminal");
});

test("Terminal settings navigation uses the Terminal icon", () => {
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
      toggleAttribute: (name, enabled) => {
        if (enabled) attributes.add(name);
        else attributes.delete(name);
      },
    };
  };
  const general = createButton("General");
  const terminal = createButton("Terminal");
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
    querySelectorAll: () => [general, terminal],
  };

  reconcileTerminalSettingsNavigationIcon(root, "Terminal");

  assert.equal(
    general.attributes.has("data-minke-terminal-settings-nav"),
    false,
  );
  assert.equal(
    terminal.attributes.has("data-minke-terminal-settings-nav"),
    true,
  );
  assert.match(
    TERMINAL_SETTINGS_STYLES,
    /mask:\s*var\(--minke-terminal-settings-nav-icon\)/u,
  );
  const dispose = installTerminalSettingsNavigationIcon(
    () => "Terminal",
    root,
  );
  reconcile();
  const iconDataUrl = terminal.style
    .getPropertyValue("--minke-terminal-settings-nav-icon")
    .match(
      /^url\("(data:image\/svg\+xml;base64,[^"]+)"\)$/u,
    )?.[1];
  assert.equal(
    general.style.getPropertyValue(
      "--minke-terminal-settings-nav-icon",
    ),
    "",
  );
  assert.ok(iconDataUrl);
  const iconSvg = Buffer.from(
    iconDataUrl.slice(iconDataUrl.indexOf(",") + 1),
    "base64",
  ).toString("utf8");
  assert.match(
    iconSvg,
    /class="lucide lucide-square-terminal(?:\s|")/u,
  );
  dispose();
  assert.equal(
    terminal.style.getPropertyValue(
      "--minke-terminal-settings-nav-icon",
    ),
    "",
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
