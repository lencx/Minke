import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertRuntimeFileBudget,
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
  pruneRuntimeArtifacts,
  runtimeArtifactCategory,
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
    await writeFile(join(root, "lib", "native-debug.pdb"), "debug symbols");
    await writeFile(join(root, "README.md"), "documentation");
    await writeFile(join(root, "CHANGELOG.txt"), "history");
    await writeFile(join(root, "LICENSE.md"), "license");
    await writeFile(join(root, "NOTICE"), "notice");
    await writeFile(join(root, "guide.md"), "runtime content");

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.files, 6);
    const report = await pruneRuntimeArtifacts(root);

    assert.equal(report.removed.files, 6);
    assert.equal(report.afterFiles, 4);
    assert.equal(
      await readFile(join(root, "lib", "index.js"), "utf8"),
      "export {};\n",
    );
    assert.equal(await readFile(join(root, "LICENSE.md"), "utf8"), "license");
    assert.equal(await readFile(join(root, "NOTICE"), "utf8"), "notice");
    assert.equal(
      await readFile(join(root, "guide.md"), "utf8"),
      "runtime content",
    );
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

test("runtime file budgets reject small-file regressions at the boundary", () => {
  assert.doesNotThrow(() => assertRuntimeFileBudget(100, 100));
  assert.throws(
    () => assertRuntimeFileBudget(101, 100),
    /above the 100 file budget/u,
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
    await assert.rejects(access(join(bundledPnpm, "artifacts")), {
      code: "ENOENT",
    });
  });
});

test("runtime pruning removes published package baggage without removing runtime code", async () => {
  await withTemporaryRuntime(async (root) => {
    const dominoRoot = join(root, "node_modules", "@mixmark-io", "domino");
    const mistralRoot = join(
      root,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "node_modules",
      "@mistralai",
      "mistralai",
    );
    const baggageFiles = [
      join(dominoRoot, ".yarn", "plugins", "plugin.cjs"),
      join(dominoRoot, "test", "domino.test.js"),
      join(mistralRoot, "examples", "chat.js"),
      join(mistralRoot, "packages", "mistralai-azure", "src", "index.ts"),
      join(mistralRoot, "src", "index.ts"),
      join(mistralRoot, "tests", "sdk.test.ts"),
    ];
    for (const path of baggageFiles) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "development-only package content");
    }

    const runtimeFiles = [
      [join(dominoRoot, "lib", "index.js"), "module.exports = {};\n"],
      [join(mistralRoot, "esm", "index.js"), "export class Mistral {}\n"],
      [
        join(mistralRoot, "package.json"),
        `${JSON.stringify(
          {
            name: "@mistralai/mistralai",
            main: "./esm/index.js",
            exports: {
              ".": {
                source: "./src/index.ts",
                types: "./esm/index.d.ts",
                default: "./esm/index.js",
              },
            },
          },
          null,
          2,
        )}\n`,
      ],
    ];
    for (const [path, source] of runtimeFiles) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
    }

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.files, baggageFiles.length);
    assert.equal(
      before.prunable.categories.publishedPackageBaggage.files,
      baggageFiles.length,
    );

    const report = await pruneRuntimeArtifacts(root);

    assert.equal(
      report.removed.categories.publishedPackageBaggage.files,
      baggageFiles.length,
    );
    assert.equal(report.normalized.files, 1);
    for (const path of baggageFiles) {
      await assert.rejects(access(path), { code: "ENOENT" });
    }
    await assert.rejects(access(join(dominoRoot, ".yarn")), { code: "ENOENT" });
    await assert.rejects(access(join(dominoRoot, "test")), { code: "ENOENT" });
    await assert.rejects(access(join(mistralRoot, "examples")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(mistralRoot, "packages")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(mistralRoot, "tests")), {
      code: "ENOENT",
    });
    for (const [path, source] of runtimeFiles) {
      if (path.endsWith("package.json")) continue;
      assert.equal(await readFile(path, "utf8"), source);
    }
    const manifest = JSON.parse(
      await readFile(join(mistralRoot, "package.json"), "utf8"),
    );
    assert.equal(manifest.exports["."].source, undefined);
    assert.equal(manifest.exports["."].default, "./esm/index.js");
    assert.equal((await inspectRuntimeArtifacts(root)).prunable.files, 0);
  });
});

test("runtime pruning refuses Mistral sources without a compiled export", async () => {
  await withTemporaryRuntime(async (root) => {
    const mistralRoot = join(
      root,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "node_modules",
      "@mistralai",
      "mistralai",
    );
    const sourcePath = join(mistralRoot, "src", "index.ts");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "export class Mistral {}\n");
    await writeFile(
      join(mistralRoot, "package.json"),
      JSON.stringify({
        name: "@mistralai/mistralai",
        main: "./esm/index.js",
        exports: {
          ".": {
            source: "./src/index.ts",
          },
        },
      }),
    );

    await assert.rejects(
      pruneRuntimeArtifacts(root),
      /without a compiled esm default/u,
    );
    assert.equal(
      await readFile(sourcePath, "utf8"),
      "export class Mistral {}\n",
    );
  });
});

test("runtime pruning removes assets that cannot run on the target platform", async () => {
  await withTemporaryRuntime(async (root) => {
    const nodePtyRoot = join(root, "node_modules", "node-pty");
    const pnpmRoot = join(root, "node_modules", "pnpm", "dist");
    const incompatibleFiles = [
      join(nodePtyRoot, "deps", "winpty", "LICENSE"),
      join(nodePtyRoot, "third_party", "conpty", "OpenConsole.exe"),
      join(
        pnpmRoot,
        "node_modules",
        "@reflink",
        "reflink-darwin-x64",
        "reflink.darwin-x64.node",
      ),
      join(
        pnpmRoot,
        "node_modules",
        "@reflink",
        "reflink-win32-arm64-msvc",
        "reflink.win32-arm64-msvc.node",
      ),
      join(
        pnpmRoot,
        "node_modules",
        "@reflink",
        "reflink-win32-x64-msvc",
        "reflink.win32-x64-msvc.node",
      ),
      join(pnpmRoot, "vendor", "fastlist-0.3.0-x64.exe"),
      join(pnpmRoot, "vendor", "fastlist-0.3.0-x86.exe"),
    ];
    for (const path of incompatibleFiles) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "wrong platform");
    }

    const runtimeFiles = [
      [join(nodePtyRoot, "lib", "index.js"), "module.exports = {};\n"],
      [
        join(nodePtyRoot, "prebuilds", "darwin-arm64", "pty.node"),
        "native pty",
      ],
      [
        join(
          pnpmRoot,
          "node_modules",
          "@reflink",
          "reflink-darwin-arm64",
          "reflink.darwin-arm64.node",
        ),
        "native reflink",
      ],
      [join(pnpmRoot, "pnpm.mjs"), "export {};\n"],
    ];
    for (const [path, source] of runtimeFiles) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source);
    }

    const target = { arch: "arm64", platform: "darwin" };
    const before = await inspectRuntimeArtifacts(root, target);
    assert.equal(
      before.prunable.categories.incompatiblePlatformAssets.files,
      incompatibleFiles.length,
    );

    const report = await pruneRuntimeArtifacts(root, target);

    assert.equal(
      report.removed.categories.incompatiblePlatformAssets.files,
      incompatibleFiles.length,
    );
    for (const path of incompatibleFiles) {
      await assert.rejects(access(path), { code: "ENOENT" });
    }
    for (const [path, source] of runtimeFiles) {
      assert.equal(await readFile(path, "utf8"), source);
    }
    assert.equal(
      runtimeArtifactCategory(
        "node_modules/node-pty/third_party/conpty/OpenConsole.exe",
        { arch: "x64", platform: "win32" },
      ),
      undefined,
    );
    assert.equal(
      runtimeArtifactCategory(
        "node_modules/pnpm/dist/vendor/fastlist-0.3.0-x64.exe",
        { arch: "x64", platform: "win32" },
      ),
      undefined,
    );
    assert.equal(
      (await inspectRuntimeArtifacts(root, target)).prunable.files,
      0,
    );
  });
});

test("runtime pruning replaces esbuild's duplicate binary with a launcher", async () => {
  await withTemporaryRuntime(async (root) => {
    const esbuildRoot = join(root, "node_modules", "esbuild");
    const launcher = join(esbuildRoot, "bin", "esbuild");
    const binaryPackage = "@esbuild/test-platform";
    const binarySubpath =
      process.platform === "win32"
        ? `${binaryPackage}/esbuild.exe`
        : `${binaryPackage}/bin/esbuild`;
    const binary = join(root, "node_modules", ...binarySubpath.split("/"));
    const binarySource = await readFile(process.execPath);
    const binaryHash = createHash("sha256").update(binarySource).digest("hex");

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

    await rm(launcher);
    await link(binary, launcher);

    const before = await inspectRuntimeArtifacts(root);
    assert.equal(before.prunable.categories.duplicateTooling.files, 1);

    const report = await pruneRuntimeArtifacts(root);

    assert.equal(report.optimized.files, 1);
    assert.ok(report.optimized.bytes > 100_000);
    assert.match(await readFile(launcher, "utf8"), /require\.resolve/u);
    assert.deepEqual(await readFile(binary), binarySource);
    const result = spawnSync(process.execPath, [launcher, "--version"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), process.version);
    assert.equal((await inspectRuntimeArtifacts(root)).prunable.files, 0);
  });
});
