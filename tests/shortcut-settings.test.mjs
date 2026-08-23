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
  bindShortcutSettingsIpc,
} from "@minke/desktop/main/shortcut-settings.ts";
import {
  MINKE_CONFIG_VERSION,
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  DEFAULT_TERMINAL_SETTINGS,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

const roots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "minke-shortcuts-"));
  roots.push(root);
  const config = new MinkeConfigStore(root);
  return {
    path: config.path,
    store: config.shortcuts,
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

test("the desktop store writes the shared Minke config", async () => {
  const { path, store } = await fixture();
  assert.deepEqual(await store.read(), {});

  await store.write({
    "settings.open": "Mod+Comma",
    "session.new": "",
  });

  assert.deepEqual(await store.read(), {
    "settings.open": "Mod+Comma",
    "session.new": "",
  });
  const document = JSON.parse(await readFile(path, "utf8"));
  const { remote, ...documentWithoutRemote } = document;
  assert.deepEqual(documentWithoutRemote, {
    version: MINKE_CONFIG_VERSION,
    shortcuts: {
      "settings.open": "Mod+Comma",
      "session.new": "",
    },
    terminal: DEFAULT_TERMINAL_SETTINGS,
    modelRuntime: {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    plugins: {
      safeMode: false,
      disabledPlugins: [],
    },
    appUpdate: {
      autoDownload: true,
    },
  });
  assertDefaultRemoteSettings(remote);
});

test("invalid bindings never reach disk", async () => {
  const { store } = await fixture();

  await assert.rejects(
    store.write({ "session.new": "N" }),
    /invalid shortcut binding/u,
  );
  assert.deepEqual(await store.read(), {});
});

test("IPC handlers authorize both reads and writes", async () => {
  const { store } = await fixture();
  const handlers = new Map();
  const persisted = [];
  const binding = bindShortcutSettingsIpc(
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
    (bindings) => persisted.push(bindings),
  );

  await handlers.get(SHORTCUT_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    { "session.new": "Mod+N" },
  );
  assert.deepEqual(
    await handlers.get(SHORTCUT_SETTINGS_READ_CHANNEL)("allowed"),
    { "session.new": "Mod+N" },
  );
  assert.deepEqual(persisted, [{ "session.new": "Mod+N" }]);
  await assert.rejects(
    handlers.get(SHORTCUT_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      { "session.new": "N" },
    ),
    /invalid shortcut binding/u,
  );
  assert.deepEqual(persisted, [{ "session.new": "Mod+N" }]);
  await assert.rejects(
    handlers.get(SHORTCUT_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );

  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});
