import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MINKE_CONFIG_VERSION,
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  DEFAULT_TERMINAL_SETTINGS,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

async function withStore(callback) {
  const root = await mkdtemp(join(tmpdir(), "minke-config-"));
  try {
    await callback({
      root,
      store: new MinkeConfigStore(root),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("desktop settings share one versioned Minke config", async () => {
  await withStore(async ({ root, store }) => {
    assert.equal(
      store.path,
      join(root, "desktop", "minke.config.json"),
    );
    assert.deepEqual(await store.shortcuts.read(), {});
    assert.deepEqual(
      await store.terminal.read(),
      DEFAULT_TERMINAL_SETTINGS,
    );
    assert.deepEqual(await store.modelRuntime.read(), {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    });

    await Promise.all([
      store.shortcuts.write({
        "settings.open": "Mod+Comma",
        "session.new": "",
      }),
      store.terminal.write({
        fontFamily: "JetBrains Mono",
        fontSize: 14,
        lineHeight: 1.35,
      }),
      store.modelRuntime.write({
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      }),
    ]);

    assert.deepEqual(JSON.parse(await readFile(store.path, "utf8")), {
      version: MINKE_CONFIG_VERSION,
      shortcuts: {
        "settings.open": "Mod+Comma",
        "session.new": "",
      },
      terminal: {
        fontFamily: "JetBrains Mono",
        fontSize: 14,
        lineHeight: 1.35,
      },
      modelRuntime: {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
    });
    assert.deepEqual(
      await readdir(join(root, "desktop")),
      ["minke.config.json"],
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(store.path)).mode & 0o077, 0);
    }
  });
});

test("invalid section updates leave the shared document unchanged", async () => {
  await withStore(async ({ store }) => {
    await store.shortcuts.write({ "session.new": "Mod+N" });
    const before = await readFile(store.path, "utf8");

    await assert.rejects(
      store.terminal.write({
        fontFamily: "",
        fontSize: 100,
        lineHeight: 1.4,
      }),
      /font size/u,
    );
    await assert.rejects(
      store.modelRuntime.write({
        lmStudio: { enabled: "yes" },
        ollama: { enabled: false },
      }),
      /model runtime settings/u,
    );
    assert.equal(await readFile(store.path, "utf8"), before);
  });
});

test("legacy version 1 configs default the new model runtime off", async () => {
  await withStore(async ({ root, store }) => {
    await mkdir(join(root, "desktop"), { recursive: true });
    await writeFile(
      store.path,
      JSON.stringify({
        version: MINKE_CONFIG_VERSION,
        shortcuts: {},
        terminal: DEFAULT_TERMINAL_SETTINGS,
      }),
    );

    assert.deepEqual(await store.modelRuntime.read(), {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    });
  });
});

test("the store rejects unsupported unified config documents", async () => {
  await withStore(async ({ root, store }) => {
    await mkdir(join(root, "desktop"), { recursive: true });
    await writeFile(
      store.path,
      JSON.stringify({
        version: MINKE_CONFIG_VERSION,
        shortcuts: {},
        terminal: DEFAULT_TERMINAL_SETTINGS,
        modelRuntime: {
          lmStudio: { enabled: false },
          ollama: { enabled: false },
        },
        unknown: true,
      }),
    );

    await assert.rejects(
      store.shortcuts.read(),
      /unsupported Minke config document/u,
    );
  });
});
