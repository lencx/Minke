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
import {
  parsePackageArtifactPolicy,
  verifyPackagedApplication,
} from "../scripts/forge/package-artifact.ts";

const productPackageName = "@lencx/minke-harness-overlay";

test("the packaged bootstrap resolves its logo beside the renderer document", async () => {
  const source = await readFile(
    new URL("../desktop/renderer/App.tsx", import.meta.url),
    "utf8",
  );
  const logoSource = source.match(
    /<img[\s\S]*?src="([^"]+minke\.svg)"/u,
  )?.[1];
  assert.ok(logoSource, "the bootstrap must render the Minke logo");
  const documentUrl = new URL(
    "file:///app.asar/.vite/renderer/main_window/index.html",
  );
  assert.equal(
    new URL(logoSource, documentUrl).href,
    "file:///app.asar/.vite/renderer/main_window/minke.svg",
  );
});

function verificationOptions(platform) {
  return {
    appSizeBudgetBytes: 1024 * 1024,
    arch: "arm64",
    platform,
    productPackageName,
    runtimeFileBudget: 100,
    runtimeSizeBudgetBytes: 1024 * 1024,
  };
}

async function write(path, contents = "fixture") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function nativeAssetPaths(hostRoot, platform) {
  const nodePtyRoot = join(hostRoot, "node_modules", "node-pty");
  if (platform === "darwin") {
    const targetRoot = join(nodePtyRoot, "prebuilds", "darwin-arm64");
    return [
      join(targetRoot, "pty.node"),
      join(targetRoot, "spawn-helper"),
    ];
  }
  if (platform === "win32") {
    const targetRoot = join(nodePtyRoot, "prebuilds", "win32-arm64");
    return [
      join(targetRoot, "pty.node"),
      join(targetRoot, "conpty.node"),
      join(targetRoot, "conpty_console_list.node"),
      join(targetRoot, "winpty-agent.exe"),
      join(targetRoot, "winpty.dll"),
      join(targetRoot, "conpty", "OpenConsole.exe"),
      join(targetRoot, "conpty", "conpty.dll"),
    ];
  }
  return [join(nodePtyRoot, "build", "Release", "pty.node")];
}

async function withPackagedApp(platform, callback) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "minke-package-artifact-"),
  );
  const outputRoot = join(temporaryRoot, `Minke-${platform}-arm64`);
  const appRoot =
    platform === "darwin" ? join(outputRoot, "Minke.app") : outputRoot;
  const resourcesRoot =
    platform === "darwin"
      ? join(appRoot, "Contents", "Resources")
      : join(appRoot, "resources");
  const hostRoot = join(resourcesRoot, "host");
  const productRoot = join(
    hostRoot,
    "node_modules",
    ...productPackageName.split("/"),
  );
  const mistralRoot = join(
    hostRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "node_modules",
    "@mistralai",
    "mistralai",
  );
  const executable =
    platform === "darwin"
      ? join(appRoot, "Contents", "MacOS", "Minke")
      : join(appRoot, platform === "win32" ? "Minke.exe" : "Minke");
  const adapterSuffix = platform === "win32" ? ".cmd" : "";
  const nativeAssets = nativeAssetPaths(hostRoot, platform);
  try {
    const required = [
      write(executable),
      write(join(resourcesRoot, "app.asar")),
      write(join(hostRoot, "index.mjs"), "export {};\n"),
      write(join(hostRoot, "dsh-runtime.json"), "{}\n"),
      write(
        join(hostRoot, "bin", `node${adapterSuffix}`),
        platform === "win32"
          ? '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n'
          : '#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 electron "$@"\n',
      ),
      write(join(hostRoot, "bin", `pnpm${adapterSuffix}`)),
      write(
        join(hostRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      ),
      write(join(hostRoot, "node_modules", "pnpm", "dist", "pnpm.mjs")),
      write(join(hostRoot, "node_modules", "esbuild", "bin", "esbuild")),
      write(join(productRoot, "package.json"), "{}\n"),
      write(join(productRoot, "lib", "index.js")),
      write(join(productRoot, "lib", "client.js")),
      write(
        join(mistralRoot, "package.json"),
        `${JSON.stringify({
          name: "@mistralai/mistralai",
          main: "./esm/index.js",
          exports: {
            ".": {
              default: "./esm/index.js",
            },
          },
        })}\n`,
      ),
      write(join(mistralRoot, "esm", "index.js")),
      ...nativeAssets.map((path) => write(path)),
    ];
    if (platform === "darwin") {
      required.push(
        write(
          join(
            resourcesRoot,
            "app.asar.unpacked",
            "node_modules",
            "sys",
            "lencx_mb.node",
          ),
        ),
      );
    }
    await Promise.all(required);
    await callback({
      appRoot,
      hostRoot,
      mistralRoot,
      nativeAssets,
      outputRoot,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

for (const platform of ["darwin", "win32", "linux"]) {
  test(`the final package gate accepts a minimal ${platform} Electron app`, async () => {
    await withPackagedApp(platform, async ({ outputRoot }) => {
      const report = await verifyPackagedApplication(
        outputRoot,
        verificationOptions(platform),
      );

      assert.ok(report.app.bytes > report.host.bytes);
      assert.ok(report.host.files > 0);
    });
  });

  test(`the final package gate rejects a missing ${platform} node-pty asset`, async () => {
    await withPackagedApp(
      platform,
      async ({ hostRoot, nativeAssets, outputRoot }) => {
        await rm(nativeAssets[0]);

        await assert.rejects(
          verifyPackagedApplication(
            outputRoot,
            verificationOptions(platform),
          ),
          /missing required file.*pty\.node/u,
        );
        assert.ok(hostRoot);
      },
    );
  });

  test(`the final package gate rejects foreign node-pty prebuilds on ${platform}`, async () => {
    await withPackagedApp(platform, async ({ hostRoot, outputRoot }) => {
      const foreignTarget =
        platform === "darwin" ? "win32-arm64" : "darwin-arm64";
      await write(
        join(
          hostRoot,
          "node_modules",
          "node-pty",
          "prebuilds",
          foreignTarget,
          "pty.node",
        ),
      );

      await assert.rejects(
        verifyPackagedApplication(
          outputRoot,
          verificationOptions(platform),
        ),
        /foreign node-pty prebuild/u,
      );
    });
  });
}

test("the final package gate rejects forbidden package baggage", async () => {
  await withPackagedApp("darwin", async ({ hostRoot, outputRoot }) => {
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
      verifyPackagedApplication(
        outputRoot,
        verificationOptions("darwin"),
      ),
      /forbidden path/u,
    );
  });
});

test("the final package gate rejects dangling Mistral source exports", async () => {
  await withPackagedApp(
    "win32",
    async ({ mistralRoot, outputRoot }) => {
      await write(
        join(mistralRoot, "package.json"),
        `${JSON.stringify({
          name: "@mistralai/mistralai",
          main: "./esm/index.js",
          exports: {
            ".": {
              source: "./src/index.ts",
              default: "./esm/index.js",
            },
          },
        })}\n`,
      );

      await assert.rejects(
        verifyPackagedApplication(
          outputRoot,
          verificationOptions("win32"),
        ),
        /resolve only through compiled esm exports/u,
      );
    },
  );
});

test("the final package gate rejects file-count and app-size regressions", async () => {
  await withPackagedApp("linux", async ({ outputRoot }) => {
    await assert.rejects(
      verifyPackagedApplication(outputRoot, {
        ...verificationOptions("linux"),
        runtimeFileBudget: 1,
      }),
      /above the 1 file budget/u,
    );
    await assert.rejects(
      verifyPackagedApplication(outputRoot, {
        ...verificationOptions("linux"),
        appSizeBudgetBytes: 1,
      }),
      /packaged application is .* above the 0\.0 MiB budget/u,
    );
  });
});

test("package artifact policy requires positive budgets for every desktop platform", () => {
  const policy = {
    schemaVersion: 1,
    appSizeBudgetBytes: {
      darwin: 440401920,
      linux: 536870912,
      win32: 536870912,
    },
  };
  assert.deepEqual(parsePackageArtifactPolicy(policy), policy);
  assert.throws(
    () =>
      parsePackageArtifactPolicy({
        schemaVersion: 1,
        appSizeBudgetBytes: {
          darwin: 440401920,
          win32: 536870912,
        },
      }),
    /size budget for linux/u,
  );
  assert.throws(
    () =>
      parsePackageArtifactPolicy({
        ...policy,
        appSizeBudgetBytes: {
          ...policy.appSizeBudgetBytes,
          linux: 0,
        },
      }),
    /invalid package artifact size budget/u,
  );
});
