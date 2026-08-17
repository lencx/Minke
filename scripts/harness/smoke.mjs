#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "../../desktop/main/harness-launch.ts";
import { verifyHarnessContract } from "./contract.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packaged = process.argv.slice(2).includes("--packaged");
if (
  process.argv.slice(2).some((argument) => argument !== "--packaged") ||
  process.argv.slice(2).filter((argument) => argument === "--packaged").length > 1
) {
  throw new Error("usage: smoke.mjs [--packaged]");
}
if (packaged && process.platform !== "darwin") {
  throw new Error("packaged smoke currently supports macOS");
}
const packagedAppRoot = join(
  projectRoot,
  "out",
  `Minke-${process.platform}-${process.arch}`,
  "Minke.app",
);
const runtimeRoot = packaged
  ? join(packagedAppRoot, "Contents", "Resources", "host")
  : join(projectRoot, "runtime", "host");
const fixtureSource = join(projectRoot, "tests", "fixtures", "web-plugin");
const startupTimeoutMs = 90_000;
const hmrTimeoutMs = 15_000;

function systemPath() {
  if (process.platform === "win32") {
    return [
      process.env.SystemRoot === undefined
        ? undefined
        : join(process.env.SystemRoot, "System32"),
    ]
      .filter(Boolean)
      .join(delimiter);
  }
  return process.platform === "darwin"
    ? "/usr/bin:/bin:/usr/sbin:/sbin"
    : "/usr/bin:/bin";
}

function executable(name) {
  return join(
    runtimeRoot,
    "bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
}

function formatOutput(stdout, stderr) {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

async function run(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolvePromise({ code, signal, stdout, stderr }),
    );
  });
}

async function runSuccessful(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${basename(command)} ${args.join(" ")} failed ${
        result.signal === null
          ? `with exit code ${String(result.code)}`
          : `on ${result.signal}`
      }\n${formatOutput(result.stdout, result.stderr)}`,
    );
  }
  return result;
}

function parseManifest(html) {
  const match =
    /<script>window\.__DSH_BOOT__ = (?<manifest>.*?)<\/script>/su.exec(html);
  if (match?.groups?.manifest === undefined) {
    throw new Error("served page has no window.__DSH_BOOT__ manifest");
  }
  const manifest = JSON.parse(match.groups.manifest);
  if (!Array.isArray(manifest.entries)) {
    throw new Error("served window.__DSH_BOOT__ manifest has no entries array");
  }
  return manifest;
}

async function fetchManifest(baseUrl) {
  const response = await fetch(`${baseUrl}/?smoke=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`GET / failed with HTTP ${String(response.status)}`);
  }
  return parseManifest(await response.text());
}

async function waitForChangedRevision(baseUrl, pluginId, initialRevision) {
  const deadline = Date.now() + hmrTimeoutMs;
  while (Date.now() < deadline) {
    const manifest = await fetchManifest(baseUrl);
    const row = manifest.entries.find((entry) => entry.id === pluginId);
    if (row?.rev !== undefined && row.rev !== initialRevision) return row;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(
    `external Web plugin revision did not change within ${String(hmrTimeoutMs)} ms`,
  );
}

async function startServer(
  electronExecutable,
  runtimeLayout,
  env,
) {
  const child = spawn(
    electronExecutable,
    harnessWebArguments(runtimeLayout),
    {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  let settled = false;

  const ready = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Harness did not become ready within ${String(startupTimeoutMs)} ms\n${output}`,
        ),
      );
    }, startupTimeoutMs);
    const consume = (chunk) => {
      output += chunk;
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
      if (match?.[1] === undefined || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Harness exited before readiness (code ${String(code)}, signal ${String(signal)})\n${output}`,
        ),
      );
    });
  });

  return { baseUrl: await ready, child, output: () => output };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  const signal = (name) => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) =>
      child.once("exit", () => resolvePromise(true)),
    ),
    new Promise((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 2_000),
    ),
  ]);
  if (!exited) signal("SIGKILL");
}

async function main() {
  const verified = await verifyHarnessContract(projectRoot);
  const require = createRequire(import.meta.url);
  const electronExecutable = packaged
    ? join(packagedAppRoot, "Contents", "MacOS", "Minke")
    : require("electron");
  const runtimeLayout = await readHarnessRuntimeLayout(runtimeRoot);
  const {
    entryPath,
    pnpmEntry,
    productPackageName,
    runtimeBin,
  } = runtimeLayout;
  if (
    productPackageName !== verified.productBundle.bundle.packageName
  ) {
    throw new Error(
      `staged product bundle ${productPackageName} does not match ${verified.productBundle.bundle.packageName}`,
    );
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-runtime-smoke-"));
  const harnessHome = join(temporaryRoot, "home");
  const negativeHome = join(temporaryRoot, "negative-home");
  const fixtureCopy = join(temporaryRoot, "web-plugin");
  const pluginId = "@dsh-desktop/smoke-web-plugin";
  const baseEnv = {
    ...process.env,
    DSH_ELECTRON_EXECUTABLE: electronExecutable,
    DSH_PNPM_ENTRY: pnpmEntry,
    ELECTRON_RUN_AS_NODE: "1",
  };
  const env = {
    ...baseEnv,
    DSH_HOME: harnessHome,
    PATH: [runtimeBin, systemPath()].filter(Boolean).join(delimiter),
  };
  let server;

  try {
    await cp(fixtureSource, fixtureCopy, { recursive: true });

    // Sensitivity check: the stock upstream installer must fail when our pnpm
    // adapter is removed from PATH. This proves the positive check exercises
    // the desktop adapter rather than an ambient developer installation.
    const negative = await run(
      electronExecutable,
      [
        "--expose-internals",
        entryPath,
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureCopy,
      ],
      {
        cwd: projectRoot,
        env: {
          ...baseEnv,
          DSH_HOME: negativeHome,
          PATH: systemPath(),
        },
      },
    );
    if (
      negative.code !== 127 ||
      !negative.stderr.includes("pnpm not found on PATH")
    ) {
      throw new Error(
        `negative control did not prove the pnpm seam (exit ${String(negative.code)})\n${formatOutput(negative.stdout, negative.stderr)}`,
      );
    }

    const nodeVersion = await runSuccessful(executable("node"), ["--version"], {
      cwd: projectRoot,
      env,
    });
    const pnpmVersion = await runSuccessful(executable("pnpm"), ["--version"], {
      cwd: projectRoot,
      env,
    });
    if (pnpmVersion.stdout.trim() !== verified.contract.pnpmVersion) {
      throw new Error(
        `bundled pnpm is ${JSON.stringify(pnpmVersion.stdout.trim())}, expected ${verified.contract.pnpmVersion}`,
      );
    }
    const esbuildRoot = join(runtimeRoot, "node_modules", "esbuild");
    const esbuildManifest = JSON.parse(
      await readFile(join(esbuildRoot, "package.json"), "utf8"),
    );
    const esbuildVersion = await runSuccessful(
      electronExecutable,
      [join(esbuildRoot, "bin", "esbuild"), "--version"],
      { cwd: projectRoot, env },
    );
    if (esbuildVersion.stdout.trim() !== esbuildManifest.version) {
      throw new Error(
        `bundled esbuild is ${JSON.stringify(esbuildVersion.stdout.trim())}, expected ${JSON.stringify(esbuildManifest.version)}`,
      );
    }

    await runSuccessful(
      electronExecutable,
      [
        "--expose-internals",
        entryPath,
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureCopy,
      ],
      { cwd: projectRoot, env },
    );

    server = await startServer(
      electronExecutable,
      runtimeLayout,
      env,
    );
    const manifest = await fetchManifest(server.baseUrl);
    const productRow = manifest.entries.find(
      (entry) => entry.id === productPackageName,
    );
    if (productRow === undefined) {
      throw new Error(
        `${productPackageName} is absent from the patched Web boot manifest`,
      );
    }
    const productClient = await fetch(
      new URL(productRow.url, server.baseUrl),
    );
    const productSource = productClient.ok
      ? await productClient.text()
      : "";
    if (
      !productClient.ok ||
      !productSource.includes("settings.open") ||
      !productSource.includes("session.new") ||
      !productSource.includes("locale/change")
    ) {
      throw new Error(`${productPackageName} client bundle was not served`);
    }

    const initialRow = manifest.entries.find((entry) => entry.id === pluginId);
    if (initialRow === undefined) {
      throw new Error(
        `external Web plugin is absent from ${String(manifest.entries.length)} boot entries`,
      );
    }

    const initialBundle = await fetch(new URL(initialRow.url, server.baseUrl));
    if (!initialBundle.ok || !(await initialBundle.text()).includes('"active"')) {
      throw new Error("external Web plugin initial bundle was not served");
    }

    const clientPath = join(fixtureCopy, "lib", "client.js");
    const initialSource = await readFile(clientPath, "utf8");
    await writeFile(clientPath, initialSource.replace('"active"', '"reloaded"'));
    const reloadedRow = await waitForChangedRevision(
      server.baseUrl,
      pluginId,
      initialRow.rev,
    );
    const reloadedBundle = await fetch(
      new URL(reloadedRow.url, server.baseUrl),
    );
    if (
      !reloadedBundle.ok ||
      !(await reloadedBundle.text()).includes('"reloaded"')
    ) {
      throw new Error("external Web plugin HMR bundle was not served");
    }

    console.log(
      [
        "Harness runtime smoke passed:",
        `  Electron Node: ${nodeVersion.stdout.trim()}`,
        `  bundled pnpm:  ${pnpmVersion.stdout.trim()}`,
        `  bundled esbuild: ${esbuildVersion.stdout.trim()}`,
        `  Web plugins:   ${String(manifest.entries.length)}`,
        `  product overlay: ${productPackageName}`,
        `  external plugin install/load/HMR: ${server.baseUrl}`,
        "  ambient Node/pnpm dependency: none",
        `  runtime source: ${packaged ? "packaged app" : "staged development host"}`,
      ].join("\n"),
    );
  } catch (error) {
    if (server !== undefined) {
      const output = server.output().trim();
      if (output !== "") console.error(output);
    }
    throw error;
  } finally {
    if (server !== undefined) await stopServer(server.child);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `harness:smoke: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
