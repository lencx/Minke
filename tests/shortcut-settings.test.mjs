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
  ShortcutSettingsStore,
} from "@minke/desktop/main/shortcut-settings.ts";
import {
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
} from "@minke/harness-overlay/shortcut-contract.ts";

const roots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "minke-shortcuts-"));
  roots.push(root);
  return {
    path: join(root, "settings", "shortcuts.json"),
    store: new ShortcutSettingsStore(
      join(root, "settings", "shortcuts.json"),
    ),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

test("the desktop store writes a versioned atomic document", async () => {
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
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    version: 1,
    bindings: {
      "settings.open": "Mod+Comma",
      "session.new": "",
    },
  });
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
