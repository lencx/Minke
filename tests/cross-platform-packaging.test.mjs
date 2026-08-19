import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  isCommandUnavailableResult,
  resolveCommandInvocation,
} from "../scripts/harness/command-invocation.mjs";
import {
  packagedApplicationLayout,
} from "../scripts/forge/application-layout.mjs";
import {
  forgeUsesElectronWorker,
} from "../scripts/forge/runtime-selection.mjs";
import {
  resolvePnpmInvocation,
} from "../scripts/harness/pnpm-invocation.mjs";

const require = createRequire(import.meta.url);
const {
  nodePtyProbeInvocation,
} = require("../scripts/harness/node-pty-probe.cjs");

function assertHarnessStagingOrder(stageSource) {
  stageSource = stageSource.replaceAll("\r\n", "\n");
  const completeInstall = stageSource.indexOf(
    '"install",\n        "--recursive",\n        "--frozen-lockfile"',
  );
  const build = stageSource.search(
    /await runPnpm\(\s*\["run", "build"\],\s*harnessRoot,\s*minkeHarnessClientBuildEnvironment\(process\.env\),?\s*\);/u,
  );
  const runtimeOnlyInstall = stageSource.indexOf(
    '"--filter",\n        `${generatedPackageName}...`',
  );

  assert.ok(completeInstall >= 0, "staging must restore every workspace link");
  assert.ok(build > completeInstall, "Harness must build after full install");
  assert.ok(
    runtimeOnlyInstall > build,
    "runtime-only installation must not remove build dependencies before build",
  );
}

function withWindowsLineEndings(source) {
  return source.replace(/\r?\n/gu, "\r\n");
}

test("Windows batch adapters run through ComSpec without enabling a global shell", () => {
  assert.deepEqual(
    resolveCommandInvocation(
      "C:\\runtime\\bin\\node.cmd",
      ["--version"],
      {
        comspec: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32",
      },
    ),
    {
      args: ["/d", "/c", "C:\\runtime\\bin\\node.cmd", "--version"],
      command: "C:\\Windows\\System32\\cmd.exe",
    },
  );
  assert.deepEqual(
    resolveCommandInvocation("/runtime/bin/node", ["--version"], {
      platform: "linux",
    }),
    {
      args: ["--version"],
      command: "/runtime/bin/node",
    },
  );
});

test("missing command controls recognize Windows and POSIX exit conventions", () => {
  assert.equal(
    isCommandUnavailableResult(
      {
        code: 1,
        stderr:
          "'pnpm' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n",
      },
      "pnpm",
      { platform: "win32" },
    ),
    true,
  );
  assert.equal(
    isCommandUnavailableResult(
      {
        code: 127,
        stderr: "dsh: pnpm not found on PATH\n",
      },
      "pnpm",
      { platform: "linux" },
    ),
    true,
  );
  assert.equal(
    isCommandUnavailableResult(
      {
        code: 1,
        stderr: "unrelated fixture failure\n",
      },
      "pnpm",
      { platform: "win32" },
    ),
    false,
  );
});

test("node-pty smoke uses a real Windows console command", () => {
  assert.deepEqual(
    nodePtyProbeInvocation({
      comspec: "C:\\Windows\\System32\\cmd.exe",
      execPath: "C:\\Minke\\electron.exe",
      platform: "win32",
    }),
    {
      args: ["/d", "/c", "echo", "minke-pty-ok"],
      command: "C:\\Windows\\System32\\cmd.exe",
    },
  );
  assert.deepEqual(
    nodePtyProbeInvocation({
      execPath: "/opt/Minke/minke",
      platform: "linux",
    }),
    {
      args: ["--eval", "process.stdout.write('minke-pty-ok')"],
      command: "/opt/Minke/minke",
    },
  );
});

test("Forge keeps its Electron ABI worker only on macOS", () => {
  assert.equal(forgeUsesElectronWorker("darwin"), true);
  assert.equal(forgeUsesElectronWorker("win32"), false);
  assert.equal(forgeUsesElectronWorker("linux"), false);
  assert.throws(
    () => forgeUsesElectronWorker("freebsd"),
    /unsupported desktop platform/u,
  );
});

test("Forge package and make reserve enough standard Node heap", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const scriptName of ["forge:package", "forge:make"]) {
    assert.match(
      manifest.scripts[scriptName],
      /^node --max-old-space-size=8192 scripts\/forge\/run\.mjs /u,
    );
  }
});

test("Squirrel maker has a required Windows installer graph", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    manifest.devDependencies["electron-winstaller"],
    "5.4.4",
  );
  assert.doesNotThrow(() => require("electron-winstaller"));
});

test("Forge Vite packaging bypasses the redundant production-tree prune", async () => {
  const forgeConfig = await readFile(
    new URL("../forge.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    forgeConfig,
    /packagerConfig:\s*\{[\s\S]*?\n\s*prune:\s*false,/u,
  );
});

test("patched Forge skips bin cleanup when the packaged app has no node_modules", async () => {
  const forgePackageSource = await readFile(
    join(dirname(require.resolve("@electron-forge/core")), "package.js"),
    "utf8",
  );

  assert.match(
    forgePackageSource,
    /const nodeModulesPath = .*?join\(buildPath, 'node_modules'\);/u,
  );
  assert.match(
    forgePackageSource,
    /pathExists\(nodeModulesPath\)/u,
  );
  assert.doesNotMatch(
    forgePackageSource,
    /join\(buildPath, '\*\*\/\.bin\/\*\*\/\*'\)/u,
  );
});

test("Forge logs the boundaries around slow packaging stages", async () => {
  const forgeConfig = await readFile(
    new URL("../forge.config.ts", import.meta.url),
    "utf8",
  );

  for (const hookName of [
    "afterCopy",
    "beforeAsar",
    "afterAsar",
    "beforeCopyExtraResources",
    "afterCopyExtraResources",
    "afterComplete",
  ]) {
    assert.match(
      forgeConfig,
      new RegExp(`\\b${hookName}:\\s*\\[`, "u"),
    );
  }
  for (const stage of [
    "package copy hook started",
    "package copy hook completed",
    "native dependencies ready",
    "asar started",
    "asar completed",
    "extra resources started",
    "extra resources completed",
    "package completed",
  ]) {
    assert.ok(forgeConfig.includes(stage));
  }
});

test("pnpm package scripts reuse the active cross-platform entrypoint", () => {
  assert.deepEqual(
    resolvePnpmInvocation(["install"], {
      nodeExecutable: "C:\\node.exe",
      npmExecPath: "C:\\tools\\pnpm.exe",
      platform: "win32",
    }),
    {
      args: ["install"],
      command: "C:\\tools\\pnpm.exe",
    },
  );
  assert.deepEqual(
    resolvePnpmInvocation(["install"], {
      nodeExecutable: "C:\\node.exe",
      npmExecPath: "C:\\tools\\pnpm.cjs",
      platform: "win32",
    }),
    {
      args: ["C:\\tools\\pnpm.cjs", "install"],
      command: "C:\\node.exe",
    },
  );
  assert.deepEqual(
    resolvePnpmInvocation(["install"], {
      comspec: "C:\\Windows\\System32\\cmd.exe",
      nodeExecutable: "C:\\node.exe",
      npmExecPath: "C:\\tools\\pnpm.cmd",
      platform: "win32",
    }),
    {
      args: ["/d", "/c", "C:\\tools\\pnpm.cmd", "install"],
      command: "C:\\Windows\\System32\\cmd.exe",
    },
  );
});

test("Windows staging refuses an ambiguous ambient pnpm command", () => {
  assert.throws(
    () =>
      resolvePnpmInvocation(["install"], {
        npmExecPath: "",
        platform: "win32",
      }),
    /run Harness staging through a pnpm package script/u,
  );
});

test("Harness builds from the complete workspace before runtime-only installation", async () => {
  const stageSource = await readFile(
    new URL("../scripts/harness/stage.mjs", import.meta.url),
    "utf8",
  );
  assertHarnessStagingOrder(stageSource);
});

test("Harness staging contract supports Windows line endings", async () => {
  const stageSource = await readFile(
    new URL("../scripts/harness/stage.mjs", import.meta.url),
    "utf8",
  );
  const windowsSource = withWindowsLineEndings(stageSource);
  assert.equal(withWindowsLineEndings(windowsSource), windowsSource);
  assertHarnessStagingOrder(windowsSource);
});

test("Linux makers target the packaged executable with matching case", async () => {
  const forgeSource = await readFile(
    new URL("../forge.config.ts", import.meta.url),
    "utf8",
  );

  for (const maker of ["MakerRpm", "MakerDeb"]) {
    const makerStart = forgeSource.indexOf(`new ${maker}({`);
    const makerEnd = forgeSource.indexOf("\n    }),", makerStart);
    assert.ok(makerStart >= 0, `${maker} must be configured`);
    assert.ok(makerEnd > makerStart, `${maker} config must be complete`);
    assert.match(
      forgeSource.slice(makerStart, makerEnd),
      /options:\s*\{[\s\S]*?\bbin:\s*"Minke",/u,
      `${maker} must use the case-sensitive packaged executable name`,
    );
  }
});

test("Electron uses the Linux package desktop entry", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.desktopName, "minke.desktop");
});

for (const platform of ["darwin", "win32", "linux"]) {
  test(`packaged application layout supports ${platform}`, () => {
    const layout = packagedApplicationLayout("/project", platform, "arm64");
    const outputRoot = join("/project", "out", `Minke-${platform}-arm64`);
    assert.equal(layout.outputRoot, outputRoot);
    if (platform === "darwin") {
      assert.equal(layout.appRoot, join(outputRoot, "Minke.app"));
      assert.equal(
        layout.resourcesRoot,
        join(outputRoot, "Minke.app", "Contents", "Resources"),
      );
      assert.equal(
        layout.executablePath,
        join(outputRoot, "Minke.app", "Contents", "MacOS", "Minke"),
      );
    } else {
      assert.equal(layout.appRoot, outputRoot);
      assert.equal(layout.resourcesRoot, join(outputRoot, "resources"));
      assert.equal(
        layout.executablePath,
        join(outputRoot, platform === "win32" ? "Minke.exe" : "Minke"),
      );
    }
  });
}
