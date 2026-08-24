#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consumeForgeElectronWorkerEnvironment,
  forgeElectronWorkerEnvironment,
  forgeUsesElectronWorker,
} from "./runtime-selection.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "../..");
const command = process.argv[2];

if (command !== "package" && command !== "make") {
  throw new Error(`expected "package" or "make", received ${JSON.stringify(command)}`);
}

if (
  process.env.DSH_FORGE_WORKER !== "1" &&
  forgeUsesElectronWorker()
) {
  const require = createRequire(import.meta.url);
  const electronExecutable = require("electron");

  // MakerDMG loads macos-alias inside this Electron-as-Node worker. pnpm
  // initially compiles that build-only addon for the developer's Node ABI, so
  // align it with Electron before making macOS distributables.
  if (command === "make" && process.platform === "darwin") {
    const electronVersion = require("electron/package.json").version;
    const rebuildResult = spawnSync(
      process.execPath,
      [
        resolve(dirname(require.resolve("@electron/rebuild")), "cli.js"),
        "--force",
        "--which-module",
        "macos-alias",
        "--version",
        electronVersion,
        "--types",
        "dev",
        "--arch",
        process.arch,
      ],
      {
        cwd: projectRoot,
        stdio: "inherit",
      },
    );
    if (rebuildResult.error !== undefined) throw rebuildResult.error;
    if (rebuildResult.status !== 0) {
      throw new Error(
        `macos-alias rebuild failed with ${String(rebuildResult.status ?? rebuildResult.signal)}`,
      );
    }
  }

  const result = spawnSync(
    electronExecutable,
    [scriptPath, ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: forgeElectronWorkerEnvironment(),
      stdio: "inherit",
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === null) {
    throw new Error(`Forge worker stopped on ${String(result.signal)}`);
  }
  process.exitCode = result.status;
} else {
  if (process.env.DSH_FORGE_WORKER === "1") {
    // Electron's Node runtime treats .asar paths specially by default.
    // Packager must be able to create them as ordinary files.
    process.noAsar = true;
    consumeForgeElectronWorkerEnvironment();
  }
  // Windows and Linux use Forge's standard Node runtime so large dependency
  // graphs are not constrained by Electron's lower worker heap ceiling.
  const { api } = await import("@electron-forge/core");
  const options = {
    dir: projectRoot,
    interactive: true,
    ...(process.argv.includes("--platform=darwin")
      ? { platform: "darwin" }
      : {}),
  };

  if (command === "package") {
    await api.package(options);
  } else {
    await api.make(options);
  }
}
