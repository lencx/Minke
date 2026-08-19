import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
  verifyHarnessRuntimePatchesApplied,
} from "../scripts/harness/runtime-patches.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const fixturePatch = `diff --git a/node_modules/@deepseek-ai/example/lib/index.js b/node_modules/@deepseek-ai/example/lib/index.js
--- a/node_modules/@deepseek-ai/example/lib/index.js
+++ b/node_modules/@deepseek-ai/example/lib/index.js
@@ -1 +1 @@
-export const mode = "upstream";
+export const mode = "minke";
`;

function normalizeLineEndings(source) {
  return source.replaceAll("\r\n", "\n");
}

async function withFixture(callback, parent = tmpdir()) {
  await mkdir(parent, { recursive: true });
  const projectRoot = await mkdtemp(
    join(parent, "minke-runtime-patches-"),
  );
  const runtimeRoot = join(projectRoot, "runtime", "host");
  const target = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "example",
    "lib",
    "index.js",
  );
  const patchPath = join(
    projectRoot,
    "patches",
    "deepseek-harness",
    "example.patch",
  );
  await mkdir(dirname(target), { recursive: true });
  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(target, 'export const mode = "upstream";\n');
  await writeFile(patchPath, fixturePatch);
  try {
    await callback({ patchPath, projectRoot, runtimeRoot, target });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("declared Harness runtime patches apply to a disposable runtime", async () => {
  await withFixture(async ({ projectRoot, runtimeRoot, target }) => {
    const patches = await resolveHarnessRuntimePatches(projectRoot, [
      "patches/deepseek-harness/example.patch",
    ]);

    await applyHarnessRuntimePatches(runtimeRoot, patches);
    await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);

    assert.equal(
      normalizeLineEndings(await readFile(target, "utf8")),
      'export const mode = "minke";\n',
    );
  });
});

test("runtime patches apply inside the Minke Git worktree", async () => {
  await withFixture(
    async ({ projectRoot, runtimeRoot, target }) => {
      const patches = await resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
      ]);

      await applyHarnessRuntimePatches(runtimeRoot, patches);

      assert.equal(
        normalizeLineEndings(await readFile(target, "utf8")),
        'export const mode = "minke";\n',
      );
    },
    join(repositoryRoot, "runtime"),
  );
});

test("a stale Harness runtime patch fails without changing the runtime", async () => {
  await withFixture(async ({ projectRoot, runtimeRoot, target }) => {
    await writeFile(target, 'export const mode = "changed upstream";\n');
    const patches = await resolveHarnessRuntimePatches(projectRoot, [
      "patches/deepseek-harness/example.patch",
    ]);

    await assert.rejects(
      applyHarnessRuntimePatches(runtimeRoot, patches),
      /does not apply cleanly/u,
    );
    assert.equal(
      await readFile(target, "utf8"),
      'export const mode = "changed upstream";\n',
    );
  });
});

test("Harness runtime patches cannot escape owned upstream packages", async () => {
  await withFixture(async ({ patchPath, projectRoot }) => {
    await writeFile(
      patchPath,
      fixturePatch.replaceAll(
        "node_modules/@deepseek-ai/example/lib/index.js",
        "../../desktop/main/main.ts",
      ),
    );

    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
      ]),
      /unsafe runtime path/u,
    );
  });
});

test("Harness runtime patch declarations are unique and convention-bound", async () => {
  await withFixture(async ({ projectRoot }) => {
    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
        "patches/deepseek-harness/example.patch",
      ]),
      /must be unique/u,
    );
    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, ["example.patch"]),
      /must live under patches\/deepseek-harness/u,
    );
  });
});
