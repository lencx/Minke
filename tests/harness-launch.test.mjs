import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "@minke/desktop/main/harness-launch.ts";
import {
  harnessRuntimeEnvironment,
} from "@minke/desktop/main/harness-runtime.ts";

async function withRuntime(metadata, callback) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-harness-launch-"));
  try {
    await writeFile(
      join(runtimeRoot, "dsh-runtime.json"),
      `${JSON.stringify(metadata)}\n`,
    );
    await callback(runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test("desktop and smoke launch Harness through one staged layout contract", async () => {
  await withRuntime(
    {
      schemaVersion: 3,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "cordis.patch.yml",
      },
    },
    async (runtimeRoot) => {
      const layout = await readHarnessRuntimeLayout(runtimeRoot);
      assert.deepEqual(layout, {
        entryPath: join(runtimeRoot, "index.mjs"),
        pnpmEntry: join(
          runtimeRoot,
          "node_modules",
          "pnpm",
          "bin",
          "pnpm.cjs",
        ),
        productPackageName: "@lencx/minke-harness-overlay",
        productPatch: join(
          runtimeRoot,
          "node_modules",
          "@lencx",
          "minke-harness-overlay",
          "cordis.patch.yml",
        ),
        runtimeBin: join(runtimeRoot, "bin"),
      });
      assert.deepEqual(harnessWebArguments(layout), [
        "--expose-internals",
        join(runtimeRoot, "index.mjs"),
        "web",
        "--patch",
        layout.productPatch,
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ]);
    },
  );
});

test("the staged layout contract rejects unsafe product metadata", async () => {
  await withRuntime(
    {
      schemaVersion: 3,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "../outside.yml",
      },
    },
    async (runtimeRoot) => {
      await assert.rejects(
        readHarnessRuntimeLayout(runtimeRoot),
        /invalid product bundle metadata/u,
      );
    },
  );
});

test("the staged layout contract rejects stale runtime metadata", async () => {
  await withRuntime(
    {
      schemaVersion: 2,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "cordis.patch.yml",
      },
    },
    async (runtimeRoot) => {
      await assert.rejects(
        readHarnessRuntimeLayout(runtimeRoot),
        /invalid product bundle metadata/u,
      );
    },
  );
});

test("the desktop adds only canonical explicit trusted hosts", () => {
  const layout = {
    entryPath: "/runtime/index.mjs",
    productPatch: "/runtime/cordis.patch.yml",
  };
  assert.deepEqual(
    harnessWebArguments(layout, [
      "minke.example-tailnet.ts.net",
      "minke.example-tailnet.ts.net",
    ]).slice(-2),
    [
      "--trusted-host",
      "minke.example-tailnet.ts.net",
    ],
  );
  for (const authority of [
    "minke.example-tailnet.ts.net/path",
    "user@minke.example-tailnet.ts.net",
    " minke.example-tailnet.ts.net",
    "minke.example-tailnet.ts.net:",
  ]) {
    assert.throws(
      () => harnessWebArguments(layout, [authority]),
      /invalid Harness trusted-host authority/u,
    );
  }
});

test("the desktop runtime passes both explicit local-model opt-ins", () => {
  const layout = {
    pnpmEntry: "/runtime/node_modules/pnpm/bin/pnpm.cjs",
    runtimeBin: "/runtime/bin",
  };
  const options = {
    dshHome: "/data/harness",
    electronExecutable: "/app/electron",
    modelRuntimes: {
      lmStudio: {
        enabled: false,
        command: "/home/user/.lmstudio/bin/lms",
      },
      ollama: {
        enabled: true,
        command: "/usr/local/bin/ollama",
      },
    },
    pluginManagement: {
      safeMode: true,
      disabledPlugins: ["broken-plugin"],
    },
  };
  const inherited = {
    PATH: "/usr/bin",
    MINKE_LM_STUDIO_ENABLED: "1",
    MINKE_LM_STUDIO_COMMAND: "/stale/lms",
    MINKE_OLLAMA_ENABLED: "0",
    MINKE_OLLAMA_COMMAND: "/stale/ollama",
    MINKE_PLUGIN_SAFE_MODE: "0",
    MINKE_DISABLED_PLUGINS: "[\"stale-plugin\"]",
    PRESERVED: "yes",
  };

  assert.deepEqual(
    harnessRuntimeEnvironment(layout, options, inherited),
    {
      PATH: ["/runtime/bin", "/usr/bin"].join(process.platform === "win32" ? ";" : ":"),
      MINKE_LM_STUDIO_ENABLED: "0",
      MINKE_LM_STUDIO_COMMAND: "/home/user/.lmstudio/bin/lms",
      MINKE_OLLAMA_ENABLED: "1",
      MINKE_OLLAMA_COMMAND: "/usr/local/bin/ollama",
      MINKE_PLUGIN_SAFE_MODE: "1",
      MINKE_DISABLED_PLUGINS: "[\"broken-plugin\"]",
      PRESERVED: "yes",
      DSH_HOME: "/data/harness",
      ELECTRON_RUN_AS_NODE: "1",
      MINKE_NODE_EXECUTABLE: "/app/electron",
      MINKE_PNPM_ENTRY: "/runtime/node_modules/pnpm/bin/pnpm.cjs",
    },
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        modelRuntimes: {
          ...options.modelRuntimes,
          lmStudio: {
            ...options.modelRuntimes.lmStudio,
            enabled: true,
          },
        },
      },
      inherited,
    ).MINKE_LM_STUDIO_ENABLED,
    "1",
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        modelRuntimes: {
          ...options.modelRuntimes,
          lmStudio: {
            enabled: false,
            command: undefined,
          },
        },
      },
      inherited,
    ).MINKE_LM_STUDIO_COMMAND,
    undefined,
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        modelRuntimes: {
          ...options.modelRuntimes,
          ollama: {
            enabled: false,
            command: undefined,
          },
        },
      },
      inherited,
    ).MINKE_OLLAMA_COMMAND,
    undefined,
  );
});
