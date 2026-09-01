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
import {
  runtimeAdapterSources,
} from "../scripts/harness/runtime-adapters.mjs";

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
    ...(platform === "darwin"
      ? {
          verifyDarwinCodeSignature: async () => {},
        }
      : {}),
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
      join(targetRoot, "conpty.node"),
      join(targetRoot, "conpty_console_list.node"),
      join(targetRoot, "conpty", "OpenConsole.exe"),
      join(targetRoot, "conpty", "conpty.dll"),
    ];
  }
  return [
    join(nodePtyRoot, "prebuilds", "linux-arm64", "pty.node"),
  ];
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
  const piAiRoot = join(
    hostRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
  );
  const mistralProviderPath = join(
    piAiRoot,
    "dist",
    "providers",
    "mistral.js",
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
        runtimeAdapterSources()[`node${adapterSuffix}`],
      ),
      write(
        join(hostRoot, "bin", "node-environment-bootstrap.cjs"),
        runtimeAdapterSources()["node-environment-bootstrap.cjs"],
      ),
      write(join(hostRoot, "bin", `pnpm${adapterSuffix}`)),
      write(
        join(hostRoot, "bin", `dsh${adapterSuffix}`),
        runtimeAdapterSources()[`dsh${adapterSuffix}`],
      ),
      write(
        join(hostRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      ),
      write(join(hostRoot, "node_modules", "pnpm", "dist", "pnpm.mjs")),
      write(join(hostRoot, "node_modules", "esbuild", "bin", "esbuild")),
      write(join(productRoot, "package.json"), "{}\n"),
      write(join(productRoot, "lib", "index.js")),
      write(join(productRoot, "lib", "client.js")),
      write(
        join(piAiRoot, "package.json"),
        `${JSON.stringify({
          name: "@earendil-works/pi-ai",
          main: "./dist/index.js",
        })}\n`,
      ),
      write(
        mistralProviderPath,
        "export function mistralProvider() {}\n",
      ),
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
      mistralProviderPath,
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
          platform === "win32"
            ? /missing required file.*conpty\.node/u
            : /missing required file.*pty\.node/u,
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

test("the final package gate rejects an invalid macOS code signature", async () => {
  await withPackagedApp(
    "darwin",
    async ({ appRoot, outputRoot }) => {
      let verifiedPath;
      await verifyPackagedApplication(outputRoot, {
        ...verificationOptions("darwin"),
        verifyDarwinCodeSignature: async (path) => {
          verifiedPath = path;
        },
      });
      assert.equal(verifiedPath, appRoot);

      await assert.rejects(
        verifyPackagedApplication(outputRoot, {
          ...verificationOptions("darwin"),
          verifyDarwinCodeSignature: async () => {
            throw new Error("fixture signature failure");
          },
        }),
        /invalid code signature/u,
      );
    },
  );
});

test("the final package gate rejects a missing dsh adapter", async () => {
  await withPackagedApp("darwin", async ({ hostRoot, outputRoot }) => {
    await rm(join(hostRoot, "bin", "dsh"));

    await assert.rejects(
      verifyPackagedApplication(
        outputRoot,
        verificationOptions("darwin"),
      ),
      /missing required file.*bin[\\/]dsh/u,
    );
  });
});

test("the final package gate rejects a missing Node environment bootstrap", async () => {
  await withPackagedApp("darwin", async ({ hostRoot, outputRoot }) => {
    await rm(
      join(hostRoot, "bin", "node-environment-bootstrap.cjs"),
    );

    await assert.rejects(
      verifyPackagedApplication(
        outputRoot,
        verificationOptions("darwin"),
      ),
      /missing required file.*node-environment-bootstrap\.cjs/u,
    );
  });
});

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

test("the final package gate rejects a missing compiled pi-ai Mistral provider", async () => {
  await withPackagedApp(
    "win32",
    async ({ mistralProviderPath, outputRoot }) => {
      await rm(mistralProviderPath);

      await assert.rejects(
        verifyPackagedApplication(
          outputRoot,
          verificationOptions("win32"),
        ),
        /missing required file.*mistral\.js/u,
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
