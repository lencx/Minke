import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
  pruneRuntimeArtifacts,
} from "../scripts/harness/runtime-prune.mjs";

async function withTemporaryRuntime(callback) {
  const root = await mkdtemp(join(tmpdir(), "minke-runtime-prune-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("runtime pruning removes build artifacts and preserves executable assets", async () => {
  await withTemporaryRuntime(async (root) => {
    await mkdir(join(root, "lib"));
    await writeFile(join(root, "lib", "index.js"), "export {};\n");
    await writeFile(join(root, "lib", "index.js.map"), "source map");
    await writeFile(join(root, "lib", "index.d.ts"), "export {};\n");
    await writeFile(join(root, "lib", "build.tsbuildinfo"), "cache");
    await writeFile(join(root, "README.md"), "documentation");
    await writeFile(join(root, "CHANGELOG.txt"), "history");
    await writeFile(join(root, "LICENSE.md"), "license");
    await writeFile(join(root, "NOTICE"), "notice");
    await writeFile(join(root, "guide.md"), "runtime content");

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.files, 5);
    const report = await pruneRuntimeArtifacts(root);

    assert.equal(report.removed.files, 5);
    assert.equal(report.afterFiles, 4);
    assert.equal(await readFile(join(root, "lib", "index.js"), "utf8"), "export {};\n");
    assert.equal(await readFile(join(root, "LICENSE.md"), "utf8"), "license");
    assert.equal(await readFile(join(root, "NOTICE"), "utf8"), "notice");
    assert.equal(await readFile(join(root, "guide.md"), "utf8"), "runtime content");
    assert.equal((await inspectRuntimeArtifacts(root)).prunable.files, 0);
  });
});

test("runtime size budgets reject regressions at the byte boundary", () => {
  assert.doesNotThrow(() => assertRuntimeSizeBudget(100, 100));
  assert.throws(
    () => assertRuntimeSizeBudget(101, 100),
    /above the 0\.0 MiB budget/u,
  );
});

test("runtime pruning removes pnpm's duplicate executable artifact", async () => {
  await withTemporaryRuntime(async (root) => {
    const bundledPnpm = join(root, "node_modules", "pnpm");
    const runtimeBundle = join(bundledPnpm, "dist", "pnpm.mjs");
    const duplicateBundle = join(
      bundledPnpm,
      "artifacts",
      "exe",
      "dist",
      "pnpm.mjs",
    );
    await mkdir(join(bundledPnpm, "dist"), { recursive: true });
    await mkdir(join(bundledPnpm, "artifacts", "exe", "dist"), {
      recursive: true,
    });
    await writeFile(runtimeBundle, "runtime bundle");
    await writeFile(duplicateBundle, "duplicate executable bundle");

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.categories.duplicateTooling.files, 1);

    const report = await pruneRuntimeArtifacts(root);

    assert.equal(report.removed.categories.duplicateTooling.files, 1);
    assert.equal(await readFile(runtimeBundle, "utf8"), "runtime bundle");
    await assert.rejects(access(duplicateBundle), { code: "ENOENT" });
  });
});

test("runtime pruning replaces esbuild's duplicate binary with a launcher", async () => {
  await withTemporaryRuntime(async (root) => {
    const esbuildRoot = join(root, "node_modules", "esbuild");
    const launcher = join(esbuildRoot, "bin", "esbuild");
    const binaryPackage = "@esbuild/test-platform";
    const binarySubpath = `${binaryPackage}/bin/esbuild`;
    const binary = join(root, "node_modules", ...binarySubpath.split("/"));
    const binarySource = [
      "#!/usr/bin/env node",
      'process.stdout.write("0.0.0-test\\n");',
      ...Array.from({ length: 8_000 }, () => "// executable padding"),
      "",
    ].join("\n");
    const binaryHash = createHash("sha256")
      .update(binarySource)
      .digest("hex");

    await mkdir(join(esbuildRoot, "bin"), { recursive: true });
    await mkdir(join(root, "node_modules", ...binaryPackage.split("/")), {
      recursive: true,
    });
    await mkdir(join(root, "node_modules", ...binaryPackage.split("/"), "bin"));
    await writeFile(
      join(esbuildRoot, "package.json"),
      JSON.stringify({
        name: "esbuild",
        version: "0.0.0-test",
        "esbuild.binaryHashes": {
          [binarySubpath]: binaryHash,
        },
      }),
    );
    await writeFile(
      join(root, "node_modules", ...binaryPackage.split("/"), "package.json"),
      JSON.stringify({
        name: binaryPackage,
        version: "0.0.0-test",
      }),
    );
    await writeFile(launcher, binarySource);
    await writeFile(binary, binarySource);
    await chmod(launcher, 0o755);
    await chmod(binary, 0o755);

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.categories.duplicateTooling.files, 1);

    const report = await pruneRuntimeArtifacts(root);

    assert.equal(report.optimized.files, 1);
    assert.ok(report.optimized.bytes > 100_000);
    assert.match(await readFile(launcher, "utf8"), /require\.resolve/u);
    const result = spawnSync(process.execPath, [launcher, "--version"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "0.0.0-test\n");
    assert.equal((await inspectRuntimeArtifacts(root)).prunable.files, 0);
  });
});
