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
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createStatefulMainWindow,
} from "@minke/desktop/main/main-window-state.ts";
import {
  MINKE_CONFIG_VERSION,
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  FILES_VIEW_STATE_VERSION,
  FilesViewStateStore,
  filesViewStateFilePath,
} from "@minke/desktop/main/tabs/files-view-state.ts";
import {
  TABS_LAYOUT_STATE_VERSION,
  TabsLayoutStateStore,
  tabsLayoutStateFilePath,
} from "@minke/desktop/main/tabs/layout-state.ts";
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

function assertDefaultRemoteSettings(settings, enabled = false) {
  assert.match(
    settings.cloudflare.generatedLabel,
    /^m-[0123456789abcdefghjkmnpqrstvwxyz]{16}$/u,
  );
  assert.deepEqual(settings, {
    enabled,
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

test("main window state is restored and tracked beside minke.config.json", () => {
  const config = new MinkeConfigStore(
    join(tmpdir(), "minke-window-state-profile"),
  );
  const restoredBounds = {
    x: 120,
    y: 80,
    width: 1440,
    height: 900,
  };
  const window = {};
  let stateOptions;
  let windowBounds;
  let managedWindow;

  const result = createStatefulMainWindow(
    config.path,
    (bounds) => {
      windowBounds = bounds;
      return window;
    },
    (options) => {
      stateOptions = options;
      return {
        ...restoredBounds,
        manage(candidate) {
          managedWindow = candidate;
        },
      };
    },
  );

  assert.equal(result, window);
  assert.deepEqual(stateOptions, {
    defaultWidth: 1280,
    defaultHeight: 820,
    path: dirname(config.path),
    file: "window-state.json",
    maximize: true,
    fullScreen: true,
  });
  assert.deepEqual(windowBounds, restoredBounds);
  assert.equal(managedWindow, window);
});

test("Files view state persists beside minke.config.json", async () => {
  await withStore(async ({ store }) => {
    const viewState = new FilesViewStateStore(store.path);
    assert.equal(
      viewState.path,
      filesViewStateFilePath(store.path),
    );
    assert.equal(
      dirname(viewState.path),
      dirname(store.path),
    );
    assert.deepEqual(await viewState.read(), {});

    await Promise.all([
      viewState.write({
        placement: "right",
        previewWidth: 468,
      }),
      viewState.write({
        placement: "right",
        viewMode: "tree",
      }),
      viewState.write({
        placement: "bottom",
        previewWidth: 672,
      }),
      viewState.write({
        placement: "bottom",
        viewMode: "list",
      }),
    ]);

    assert.deepEqual(
      await new FilesViewStateStore(store.path).read(),
      {
        right: {
          previewWidth: 468,
          viewMode: "tree",
        },
        bottom: {
          previewWidth: 672,
          viewMode: "list",
        },
      },
    );
    assert.deepEqual(
      JSON.parse(await readFile(viewState.path, "utf8")),
      {
        version: FILES_VIEW_STATE_VERSION,
        right: {
          previewWidth: 468,
          viewMode: "tree",
        },
        bottom: {
          previewWidth: 672,
          viewMode: "list",
        },
      },
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(viewState.path)).mode & 0o077, 0);
    }
  });
});

test("invalid Files view state falls back without blocking Files", async () => {
  await withStore(async ({ store }) => {
    const viewState = new FilesViewStateStore(store.path);
    await mkdir(dirname(viewState.path), { recursive: true });
    await writeFile(viewState.path, "{not-json");

    assert.deepEqual(await viewState.read(), {});
  });
});

test("Tabs panel dimensions persist beside minke.config.json", async () => {
  await withStore(async ({ store }) => {
    const layoutState = new TabsLayoutStateStore(store.path);
    assert.equal(
      layoutState.path,
      tabsLayoutStateFilePath(store.path),
    );
    assert.equal(
      dirname(layoutState.path),
      dirname(store.path),
    );
    assert.deepEqual(await layoutState.read(), {});

    await Promise.all([
      layoutState.write({
        placement: "right",
        size: 468,
      }),
      layoutState.write({
        placement: "bottom",
        size: 372,
      }),
    ]);

    assert.deepEqual(
      await new TabsLayoutStateStore(store.path).read(),
      {
        rightWidth: 468,
        bottomHeight: 372,
      },
    );
    assert.deepEqual(
      JSON.parse(await readFile(layoutState.path, "utf8")),
      {
        version: TABS_LAYOUT_STATE_VERSION,
        rightWidth: 468,
        bottomHeight: 372,
      },
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(layoutState.path)).mode & 0o077, 0);
    }
  });
});

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
    const remote = await store.remote.read();
    assertDefaultRemoteSettings(remote);

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
      store.remote.write({
        ...remote,
        enabled: true,
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
      remote: {
        ...remote,
        enabled: true,
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
    await assert.rejects(
      store.remote.write({
        tailscale: { enabled: "yes" },
      }),
      /remote settings/u,
    );
    assert.equal(await readFile(store.path, "utf8"), before);
  });
});

test("legacy version 1 configs migrate remote settings into the new schema", async () => {
  await withStore(async ({ root, store }) => {
    await mkdir(join(root, "desktop"), { recursive: true });
    await writeFile(
      store.path,
      JSON.stringify({
        version: 1,
        shortcuts: {},
        terminal: DEFAULT_TERMINAL_SETTINGS,
        remote: {
          tailscale: { enabled: true },
        },
      }),
    );

    assert.deepEqual(await store.modelRuntime.read(), {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    });
    assertDefaultRemoteSettings(
      await store.remote.read(),
      true,
    );
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
        remote: {
          tailscale: { enabled: false },
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
