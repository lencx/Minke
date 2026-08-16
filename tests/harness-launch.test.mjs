import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "@minke/desktop/main/harness-launch.ts";

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
      schemaVersion: 1,
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
      schemaVersion: 1,
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
