import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  parsePackageArtifactPolicy,
  verifyPackagedApplication,
} from "../scripts/forge/package-artifact.ts";

const productPackageName = "@lencx/minke-harness-overlay";
const verificationOptions = Object.freeze({
  appSizeBudgetBytes: 1024 * 1024,
  arch: "arm64",
  platform: "darwin",
  productPackageName,
  runtimeFileBudget: 100,
  runtimeSizeBudgetBytes: 1024 * 1024,
});

async function write(path, contents = "fixture") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function withPackagedApp(callback) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "minke-package-artifact-"),
  );
  const appRoot = join(temporaryRoot, "Minke.app");
  const resourcesRoot = join(appRoot, "Contents", "Resources");
  const hostRoot = join(resourcesRoot, "host");
  const productRoot = join(
    hostRoot,
    "node_modules",
    ...productPackageName.split("/"),
  );
  try {
    await Promise.all([
      write(join(appRoot, "Contents", "MacOS", "Minke")),
      write(join(resourcesRoot, "app.asar")),
      write(
        join(
          resourcesRoot,
          "app.asar.unpacked",
          "node_modules",
          "sys",
          "lencx_mb.node",
        ),
      ),
      write(join(hostRoot, "index.mjs"), "export {};\n"),
      write(join(hostRoot, "dsh-runtime.json"), "{}\n"),
      write(
        join(hostRoot, "bin", "node"),
        '#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 electron "$@"\n',
      ),
      write(join(hostRoot, "bin", "pnpm"), "#!/bin/sh\n"),
      write(
        join(hostRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      ),
      write(join(hostRoot, "node_modules", "pnpm", "dist", "pnpm.mjs")),
      write(join(hostRoot, "node_modules", "esbuild", "bin", "esbuild")),
      write(join(productRoot, "package.json"), "{}\n"),
      write(join(productRoot, "lib", "index.js")),
      write(join(productRoot, "lib", "client.js")),
      write(
        join(
          hostRoot,
          "node_modules",
          "node-pty",
          "prebuilds",
          "darwin-arm64",
          "pty.node",
        ),
      ),
      write(
        join(
          hostRoot,
          "node_modules",
          "node-pty",
          "prebuilds",
          "darwin-arm64",
          "spawn-helper",
        ),
      ),
    ]);
    await callback({ appRoot, hostRoot, outputRoot: temporaryRoot });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("the final package gate accepts a minimal valid Electron app", async () => {
  await withPackagedApp(async ({ outputRoot }) => {
    const report = await verifyPackagedApplication(
      outputRoot,
      verificationOptions,
    );

    assert.ok(report.app.bytes > report.host.bytes);
    assert.ok(report.host.files > 0);
  });
});

test("the final package gate rejects forbidden package baggage", async () => {
  await withPackagedApp(async ({ appRoot, hostRoot }) => {
    await write(
      join(
        hostRoot,
        "node_modules",
        "@mixmark-io",
        "domino",
        "test",
        "domino.test.js",
      ),
    );

    await assert.rejects(
      verifyPackagedApplication(appRoot, verificationOptions),
      /forbidden path/u,
    );
  });
});

test("the final package gate rejects a missing native runtime asset", async () => {
  await withPackagedApp(async ({ appRoot, hostRoot }) => {
    await rm(
      join(
        hostRoot,
        "node_modules",
        "node-pty",
        "prebuilds",
        "darwin-arm64",
        "pty.node",
      ),
    );

    await assert.rejects(
      verifyPackagedApplication(appRoot, verificationOptions),
      /missing required file.*pty\.node/u,
    );
  });
});

test("the final package gate rejects file-count and app-size regressions", async () => {
  await withPackagedApp(async ({ appRoot }) => {
    await assert.rejects(
      verifyPackagedApplication(appRoot, {
        ...verificationOptions,
        runtimeFileBudget: 1,
      }),
      /above the 1 file budget/u,
    );
    await assert.rejects(
      verifyPackagedApplication(appRoot, {
        ...verificationOptions,
        appSizeBudgetBytes: 1,
      }),
      /packaged application is .* above the 0\.0 MiB budget/u,
    );
  });
});

test("package artifact policy rejects invalid budgets", () => {
  assert.deepEqual(
    parsePackageArtifactPolicy({
      schemaVersion: 1,
      appSizeBudgetBytes: { darwin: 100 },
    }),
    {
      schemaVersion: 1,
      appSizeBudgetBytes: { darwin: 100 },
    },
  );
  assert.throws(
    () =>
      parsePackageArtifactPolicy({
        schemaVersion: 1,
        appSizeBudgetBytes: { darwin: 0 },
      }),
    /invalid package artifact size budget/u,
  );
});
