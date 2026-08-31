#!/usr/bin/env node

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
import { embeddedNodeEnvironment } from "../../config/embedded-node-runtime.mts";
import {
  readHarnessRuntimeLayout,
} from "../../desktop/main/harness-launch.ts";
import { packagedApplicationLayout } from "../forge/application-layout.mjs";
import {
  isCommandUnavailableResult,
  signalCommandProcessTree,
  spawnCommand,
} from "./command-invocation.mjs";
import { parseBootManifest } from "./boot-manifest.mjs";
import { verifyHarnessContract } from "./contract.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packaged = process.argv.slice(2).includes("--packaged");
if (
  process.argv.slice(2).some((argument) => argument !== "--packaged") ||
  process.argv.slice(2).filter((argument) => argument === "--packaged").length > 1
) {
  throw new Error("usage: smoke.mjs [--packaged]");
}
const packagedLayout = packagedApplicationLayout(projectRoot);
const runtimeRoot = packaged
  ? join(packagedLayout.resourcesRoot, "host")
  : join(projectRoot, "runtime", "host");
const fixtureSource = join(projectRoot, "tests", "fixtures", "web-plugin");
const failingFixtureSource = join(
  projectRoot,
  "tests",
  "fixtures",
  "failing-web-plugin",
);
const ptyProbePath = join(
  projectRoot,
  "scripts",
  "harness",
  "node-pty-probe.cjs",
);
const startupTimeoutMs = 90_000;
const hmrTimeoutMs = 15_000;
const maxCapturedOutput = 64 * 1024;
const launchTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const tokenQueryValuePattern = /([?&]token=)[^&\s)]*/giu;
const recursiveNodeChildSource = String.raw`
const controls = new Set([
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH",
]);
process.stdout.write(JSON.stringify({
  controls: Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => controls.has(key.toUpperCase()),
    ),
  ),
  execArgv: process.execArgv,
  node: process.versions.node,
}));
`;
const recursiveNodeProbeSource = `
const { spawnSync } = require("node:child_process");
const controls = [
  "ELECTRON_RUN_AS_NODE",
  "MINKE_INTERACTIVE_NODE_OPTIONS",
  "MINKE_INTERACTIVE_NODE_PATH",
  "MINKE_NODE_BOOTSTRAP",
  "NODE_OPTIONS",
  "NODE_PATH",
];
process.env.ELECTRON_RUN_AS_NODE = "poisoned";
process.env.NODE_OPTIONS = "--no-warnings";
process.env.NODE_PATH = "poisoned-modules";
const child = spawnSync(
  process.execPath,
  ["--eval", ${JSON.stringify(recursiveNodeChildSource)}],
  { encoding: "utf8" },
);
if (child.status !== 0) {
  throw new Error("recursive Node child failed: " + child.stderr);
}
const report = JSON.parse(child.stdout);
if (
  Object.keys(report.controls).length !== 0 ||
  report.node !== process.versions.node ||
  report.execArgv[0] !== "--require" ||
  !String(report.execArgv[1]).endsWith("node-environment-bootstrap.cjs")
) {
  throw new Error("recursive Node bootstrap contract failed: " + child.stdout);
}
const native = process.platform === "win32"
  ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "set"], {
      encoding: "utf8",
    })
  : spawnSync("env", [], { encoding: "utf8" });
if (native.status !== 0) {
  throw new Error("native child failed: " + native.stderr);
}
for (const name of controls) {
  if (new RegExp("^" + name + "=", "mi").test(native.stdout)) {
    throw new Error("native child inherited " + name);
  }
}
process.stdout.write("recursive-node-ok");
`;
const piAiMistralProbeSource = String.raw`
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const runtimeRoot = process.argv[1];
const entry = join(
  runtimeRoot,
  "node_modules",
  "@earendil-works",
  "pi-ai",
  "dist",
  "providers",
  "mistral.js",
);
import(pathToFileURL(entry).href)
  .then(({ mistralProvider }) => {
    if (typeof mistralProvider !== "function") {
      throw new Error("pi-ai has no compiled Mistral provider");
    }
    const provider = mistralProvider();
    if (
      provider.id !== "mistral" ||
      provider.name !== "Mistral" ||
      provider.baseUrl !== "https://api.mistral.ai" ||
      typeof provider.getModels !== "function" ||
      provider.getModels().length === 0 ||
      typeof provider.stream !== "function"
    ) {
      throw new Error("pi-ai Mistral provider contract is incomplete");
    }
  })
  .catch((error) => {
    process.stderr.write(String(error.stack || error) + "\n");
    process.exitCode = 1;
  });
`;

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

function redactLaunchTokens(value) {
  return value.replace(
    tokenQueryValuePattern,
    "$1<redacted>",
  );
}

function parseAuthenticatedReadyUrl(value) {
  try {
    const url = new URL(value);
    const entries = [...url.searchParams];
    const launchToken = entries[0]?.[1];
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.hash !== "" ||
      entries.length !== 1 ||
      entries[0]?.[0] !== "token" ||
      typeof launchToken !== "string" ||
      !launchTokenPattern.test(launchToken) ||
      value !== url.href
    ) {
      throw new TypeError("invalid endpoint");
    }
    return {
      authenticatedUrl: url.href,
      baseUrl: url.origin,
      launchToken,
    };
  } catch {
    throw new Error(
      "Harness published an invalid authenticated readiness URL",
    );
  }
}

async function exchangeBrowserAuthentication(endpoint) {
  const { baseUrl } = endpoint;
  const unauthenticated = await fetch(`${baseUrl}/`, {
    redirect: "manual",
  });
  if (unauthenticated.status !== 401) {
    throw new Error(
      `unauthenticated GET / returned HTTP ${String(unauthenticated.status)}, expected 401`,
    );
  }

  const exchange = await fetch(endpoint.authenticatedUrl, {
    redirect: "manual",
  });
  const setCookie = exchange.headers.get("set-cookie");
  if (
    exchange.status !== 303 ||
    exchange.headers.get("location") !== "/" ||
    setCookie === null
  ) {
    throw new Error(
      `Harness browser authentication exchange returned HTTP ${String(exchange.status)} without the required redirect cookie`,
    );
  }
  const cookie = setCookie.split(";", 1)[0];
  if (!cookie.includes("=")) {
    throw new Error(
      "Harness browser authentication exchange returned an invalid cookie",
    );
  }

  const authenticatedFetch = async (input, init = {}) => {
    const url = new URL(input, baseUrl);
    if (url.origin !== baseUrl) {
      throw new Error(
        `authenticated smoke request escaped Harness origin: ${url.origin}`,
      );
    }
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    return await fetch(url, {
      ...init,
      headers,
    });
  };
  const index = await authenticatedFetch(`${baseUrl}/`, {
    redirect: "manual",
  });
  if (!index.ok) {
    throw new Error(
      `authenticated GET / failed with HTTP ${String(index.status)}`,
    );
  }
  return authenticatedFetch;
}

async function run(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawnCommand(command, args, {
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

async function fetchManifest(server) {
  const response = await server.fetch(
    `${server.baseUrl}/?smoke=${Date.now()}`,
  );
  if (!response.ok) {
    throw new Error(`GET / failed with HTTP ${String(response.status)}`);
  }
  return parseBootManifest(await response.text());
}

let minkeHostRpcSequence = 0;

async function callMinkeHost(server, endpoint, payload) {
  const rpcId =
    `minke-host-smoke-${String(Date.now())}-${String(++minkeHostRpcSequence)}`;
  const response = await server.fetch(
    `${server.baseUrl}/minke/${endpoint}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method: endpoint,
        payload,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `POST /minke/${endpoint} failed with HTTP ${String(response.status)}`,
    );
  }
  const envelope = await response.json();
  if (
    envelope?.type !== "server-response" ||
    envelope.rpcId !== rpcId
  ) {
    throw new Error(
      `Minke Host returned an invalid ${endpoint} envelope: ${JSON.stringify(envelope)}`,
    );
  }
  if (envelope.result?.ok !== true) {
    throw new Error(
      `Minke Host ${endpoint} failed: ${JSON.stringify(envelope.result?.error)}`,
    );
  }
  return envelope.result.value;
}

async function fetchMinkeHostCapabilities(server) {
  const capabilities = await callMinkeHost(
    server,
    "capabilities",
    {},
  );
  if (
    capabilities?.protocolVersion !== 2 ||
    capabilities.files?.available !== true ||
    capabilities.files?.write !== true ||
    capabilities.tabs?.available !== true ||
    capabilities.tabs?.embeddedWeb !== false ||
    capabilities.terminal?.available !== true ||
    capabilities.terminal?.resize !== true ||
    capabilities.terminal?.transport !== "long-poll"
  ) {
    throw new Error(
      `Minke Host returned unexpected capabilities: ${JSON.stringify(capabilities)}`,
    );
  }
  return capabilities;
}

async function smokeMinkePwa(server) {
  const [indexResponse, manifestResponse, workerResponse, iconResponse] =
    await Promise.all([
      server.fetch(`${server.baseUrl}/`),
      server.fetch(`${server.baseUrl}/manifest.webmanifest`),
      server.fetch(`${server.baseUrl}/minke-sw.js`),
      server.fetch(
        `${server.baseUrl}/minke-pwa/icon-fullbleed-192.png`,
      ),
    ]);
  for (const [label, response] of [
    ["index", indexResponse],
    ["manifest", manifestResponse],
    ["service worker", workerResponse],
    ["icon", iconResponse],
  ]) {
    if (!response.ok) {
      throw new Error(
        `Minke PWA ${label} failed with HTTP ${String(response.status)}`,
      );
    }
  }
  const [index, manifest, worker, icon] = await Promise.all([
    indexResponse.text(),
    manifestResponse.json(),
    workerResponse.text(),
    iconResponse.arrayBuffer(),
  ]);
  if (
    !index.includes('data-minke-pwa="head"') ||
    !index.includes('/minke-pwa/bootstrap.js') ||
    !index.includes('/minke-pwa/apple-touch-icon-fullbleed.png') ||
    manifest?.name !== "Minke" ||
    manifest?.display !== "standalone" ||
    !Array.isArray(manifest.icons) ||
    !manifest.icons.some((entry) => entry?.sizes === "192x192") ||
    !manifest.icons.some((entry) => entry?.sizes === "512x512") ||
    !worker.includes('request.mode !== "navigate"') ||
    /\bcaches\.(?:open|match)|cache\.put/u.test(worker) ||
    workerResponse.headers.get("service-worker-allowed") !== "/" ||
    Buffer.from(icon).toString("ascii", 1, 4) !== "PNG"
  ) {
    throw new Error("Minke PWA resources are incomplete or unsafe");
  }
}

async function smokeMinkeHostTerminal(server) {
  const marker = "minke-host-terminal-smoke";
  const created = await callMinkeHost(
    server,
    "terminal.create",
    {
      cwd: projectRoot,
      cols: 80,
      rows: 24,
    },
  );
  const sessionId = created?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new Error(
      `Minke Host returned an invalid Terminal session: ${JSON.stringify(created)}`,
    );
  }
  let cursor = 0;
  let output = "";
  let exited = false;
  try {
    await callMinkeHost(server, "terminal.resize", {
      sessionId,
      cols: 100,
      rows: 30,
    });
    await callMinkeHost(server, "terminal.write", {
      sessionId,
      data:
        process.platform === "win32"
          ? `echo ${marker}\r\nexit\r\n`
          : `printf '${marker}\\n'; exit\r`,
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !exited) {
      const result = await callMinkeHost(
        server,
        "terminal.read",
        {
          sessionId,
          cursor,
          waitMs: 1_000,
        },
      );
      if (
        typeof result?.cursor !== "number" ||
        !Array.isArray(result.events) ||
        result.truncated === true
      ) {
        throw new Error(
          `Minke Host returned invalid Terminal output: ${JSON.stringify(result)}`,
        );
      }
      cursor = result.cursor;
      for (const event of result.events) {
        if (event?.type === "data") output += event.data;
        if (event?.type === "exit") exited = true;
      }
      if (result.done === true) exited = true;
    }
  } finally {
    await callMinkeHost(
      server,
      "terminal.close",
      sessionId,
    ).catch(() => {});
  }
  if (!output.includes(marker) || !exited) {
    throw new Error(
      `Minke Host Terminal smoke failed: ${JSON.stringify({ output, exited })}`,
    );
  }
}

async function waitForChangedRevision(server, pluginId, initialRevision) {
  const deadline = Date.now() + hmrTimeoutMs;
  while (Date.now() < deadline) {
    const manifest = await fetchManifest(server);
    const row = manifest.entries.find((entry) => entry.id === pluginId);
    if (row?.rev !== undefined && row.rev !== initialRevision) return row;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(
    `external Web plugin revision did not change within ${String(hmrTimeoutMs)} ms`,
  );
}

async function startServer(
  command,
  args,
  env,
) {
  const child = spawnCommand(
    command,
    args,
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
  let readinessOutput = "";
  let settled = false;

  const ready = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      readinessOutput = "";
      reject(
        new Error(
          `Harness did not become ready within ${String(startupTimeoutMs)} ms\n${output}`,
        ),
      );
    }, startupTimeoutMs);
    const consume = (chunk) => {
      if (settled) {
        output = redactLaunchTokens(
          `${output}${chunk}`,
        ).slice(-maxCapturedOutput);
        return;
      }
      readinessOutput =
        `${readinessOutput}${chunk}`.slice(-maxCapturedOutput);
      output = redactLaunchTokens(readinessOutput);
      const match =
        /dsh web: (http:\/\/[^\s)]+)(?=\s|\))/u.exec(
          readinessOutput,
        );
      if (match?.[1] === undefined || settled) return;
      try {
        const endpoint = parseAuthenticatedReadyUrl(match[1]);
        settled = true;
        readinessOutput = "";
        clearTimeout(timeout);
        resolvePromise(endpoint);
      } catch (error) {
        settled = true;
        readinessOutput = "";
        clearTimeout(timeout);
        reject(error);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      readinessOutput = "";
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      readinessOutput = "";
      clearTimeout(timeout);
      reject(
        new Error(
          `Harness exited before readiness (code ${String(code)}, signal ${String(signal)})\n${output}`,
        ),
      );
    });
  });

  try {
    const endpoint = await ready;
    const authenticatedFetch =
      await exchangeBrowserAuthentication(endpoint);
    if (output.includes(endpoint.launchToken)) {
      throw new Error(
        "Harness launch token reached retained smoke output",
      );
    }
    return {
      baseUrl: endpoint.baseUrl,
      child,
      fetch: authenticatedFetch,
      output: () => output,
    };
  } catch (error) {
    await stopServer(child).catch(() => {});
    throw error;
  }
}

async function stopServer(child) {
  const waitForExit = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return await Promise.race([
      new Promise((resolvePromise) =>
        child.once("exit", () => resolvePromise(true)),
      ),
      new Promise((resolvePromise) =>
        setTimeout(() => resolvePromise(false), 2_000),
      ),
    ]);
  };

  signalCommandProcessTree(child, "SIGTERM");
  let exited = await waitForExit();
  if (!exited) {
    signalCommandProcessTree(child, "SIGKILL");
    exited = await waitForExit();
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (!exited) {
    throw new Error("Harness process tree did not exit during smoke cleanup");
  }
}

async function main() {
  const verified = await verifyHarnessContract(projectRoot);
  const require = createRequire(import.meta.url);
  const electronExecutable = packaged
    ? packagedLayout.executablePath
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
  const recursiveNodeProbePath = join(
    temporaryRoot,
    "recursive-node-probe.cjs",
  );
  const fixtureCopy = join(temporaryRoot, "web-plugin");
  const failingFixtureCopy = join(temporaryRoot, "failing-web-plugin");
  const criticalFailurePatch = join(
    temporaryRoot,
    "critical-failure.patch.yml",
  );
  const pluginId = "@dsh-desktop/smoke-web-plugin";
  const failingPluginId = "@dsh-desktop/smoke-failing-web-plugin";
  const failingEntryId = "dsh-desktop-failing-web-plugin";
  const criticalEntryName = "dsh-desktop-critical-plugin-that-does-not-exist";
  const baseEnv = {
    ...process.env,
    [embeddedNodeEnvironment.executable]: electronExecutable,
    [embeddedNodeEnvironment.pnpmEntry]: pnpmEntry,
    [embeddedNodeEnvironment.mode]: "1",
  };
  delete baseEnv.DSH_ELECTRON_EXECUTABLE;
  delete baseEnv.DSH_PNPM_ENTRY;
  const env = {
    ...baseEnv,
    DSH_HOME: harnessHome,
    PATH: [runtimeBin, systemPath()].filter(Boolean).join(delimiter),
  };
  let server;

  try {
    await Promise.all([
      cp(fixtureSource, fixtureCopy, { recursive: true }),
      cp(failingFixtureSource, failingFixtureCopy, { recursive: true }),
      writeFile(
        criticalFailurePatch,
        [
          "- insert:",
          "    - id: dsh-desktop-critical-failure",
          `      name: ${criticalEntryName}`,
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        recursiveNodeProbePath,
        `${recursiveNodeProbeSource}\n`,
        "utf8",
      ),
    ]);

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
    if (!isCommandUnavailableResult(negative, "pnpm")) {
      throw new Error(
        `negative control did not prove the pnpm seam (exit ${String(negative.code)})\n${formatOutput(negative.stdout, negative.stderr)}`,
      );
    }

    const nodeVersion = await runSuccessful(executable("node"), ["--version"], {
      cwd: projectRoot,
      env,
    });
    const dshVersion = await runSuccessful(executable("dsh"), ["--version"], {
      cwd: projectRoot,
      env,
    });
    if (dshVersion.stdout.trim() !== verified.contract.packageVersion) {
      throw new Error(
        `bundled dsh is ${JSON.stringify(dshVersion.stdout.trim())}, expected ${verified.contract.packageVersion}`,
      );
    }
    const pnpmVersion = await runSuccessful(executable("pnpm"), ["--version"], {
      cwd: projectRoot,
      env,
    });
    if (pnpmVersion.stdout.trim() !== verified.contract.pnpmVersion) {
      throw new Error(
        `bundled pnpm is ${JSON.stringify(pnpmVersion.stdout.trim())}, expected ${verified.contract.pnpmVersion}`,
      );
    }
    const recursiveNode = await runSuccessful(
      executable("node"),
      [recursiveNodeProbePath],
      {
        cwd: projectRoot,
        env,
      },
    );
    if (recursiveNode.stdout.trim() !== "recursive-node-ok") {
      throw new Error(
        `recursive embedded Node probe returned ${JSON.stringify(recursiveNode.stdout.trim())}`,
      );
    }
    await runSuccessful(
      electronExecutable,
      [ptyProbePath, runtimeRoot],
      {
        cwd: projectRoot,
        env,
      },
    );
    await runSuccessful(
      electronExecutable,
      ["--eval", piAiMistralProbeSource, runtimeRoot],
      {
        cwd: projectRoot,
        env,
      },
    );
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
      executable("dsh"),
      [
        "plugin",
        "--profile",
        "web",
        "add",
        fixtureCopy,
      ],
      { cwd: projectRoot, env },
    );
    await runSuccessful(
      executable("dsh"),
      [
        "plugin",
        "--profile",
        "web",
        "add",
        failingFixtureCopy,
      ],
      { cwd: projectRoot, env },
    );
    const webProfileManifestPath = join(
      harnessHome,
      "profiles",
      "web",
      "package.json",
    );
    const webProfileManifest = JSON.parse(
      await readFile(webProfileManifestPath, "utf8"),
    );
    const installedPluginSpec =
      webProfileManifest.dependencies?.[pluginId];
    const installedFailingPluginSpec =
      webProfileManifest.dependencies?.[failingPluginId];
    if (
      typeof installedPluginSpec !== "string" ||
      installedPluginSpec === "" ||
      typeof installedFailingPluginSpec !== "string" ||
      installedFailingPluginSpec === ""
    ) {
      throw new Error(
        `plugin install did not persist both smoke plugins in ${webProfileManifestPath}`,
      );
    }

    // Critical launcher overlays stay fail-fast even when profile-installed
    // plugin bundles are isolated.
    const criticalFailure = await run(
      executable("dsh"),
      [
        "web",
        "--patch",
        criticalFailurePatch,
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      { cwd: projectRoot, env },
    );
    if (
      criticalFailure.code === 0 ||
      !formatOutput(
        criticalFailure.stdout,
        criticalFailure.stderr,
      ).includes(criticalEntryName)
    ) {
      throw new Error(
        `critical plugin negative control did not fail loud\n${formatOutput(criticalFailure.stdout, criticalFailure.stderr)}`,
      );
    }

    server = await startServer(
      executable("dsh"),
      [
        "web",
        "--patch",
        runtimeLayout.productPatch,
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      env,
    );
    const isolatedFailureMarker =
      `isolated optional loader entry ${failingEntryId}`;
    if (!server.output().includes(isolatedFailureMarker)) {
      throw new Error(
        `failing profile plugin was not reported as isolated\n${server.output()}`,
      );
    }
    const inventoryResponse = await server.fetch(
      `${server.baseUrl}/smoke/plugin-inventory`,
    );
    const inventory = inventoryResponse.ok
      ? await inventoryResponse.json()
      : undefined;
    const failedInventoryEntry = inventory?.entries?.find(
      (entry) => entry.moduleName === failingPluginId,
    );
    if (
      !inventoryResponse.ok ||
      failedInventoryEntry?.enabled !== true ||
      failedInventoryEntry?.fiberPhase !== "failed"
    ) {
      throw new Error(
        `isolated plugin failure is absent from plugin inventory: ${JSON.stringify(inventory)}`,
      );
    }
    const manifest = await fetchManifest(server);
    const minkeCapabilities = await fetchMinkeHostCapabilities(server);
    await smokeMinkePwa(server);
    await smokeMinkeHostTerminal(server);
    const productRow = manifest.entries.find(
      (entry) => entry.id === productPackageName,
    );
    if (productRow === undefined) {
      throw new Error(
        `${productPackageName} is absent from the patched Web boot manifest`,
      );
    }
    const productClient = await server.fetch(
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

    const initialBundle = await server.fetch(
      new URL(initialRow.url, server.baseUrl),
    );
    if (!initialBundle.ok || !(await initialBundle.text()).includes('"active"')) {
      throw new Error("external Web plugin initial bundle was not served");
    }

    const clientPath = join(fixtureCopy, "lib", "client.js");
    const initialSource = await readFile(clientPath, "utf8");
    await writeFile(clientPath, initialSource.replace('"active"', '"reloaded"'));
    const reloadedRow = await waitForChangedRevision(
      server,
      pluginId,
      initialRow.rev,
    );
    const reloadedBundle = await server.fetch(
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
        `  bundled dsh:   ${dshVersion.stdout.trim()}`,
        `  bundled pnpm:  ${pnpmVersion.stdout.trim()}`,
        "  recursive Electron Node/native child policy: functional",
        "  bundled node-pty: functional",
        "  bundled pi-ai Mistral provider: functional",
        `  bundled esbuild: ${esbuildVersion.stdout.trim()}`,
        `  Web plugins:   ${String(manifest.entries.length)}`,
        `  product overlay: ${productPackageName}`,
        `  isolated plugin failure: ${failingPluginId}`,
        `  Minke Host RPC: files=${String(minkeCapabilities.files.available)}, tabs=${String(minkeCapabilities.tabs.available)}, terminal=${String(minkeCapabilities.terminal.available)}`,
        "  Minke PWA: standalone manifest/icons/service worker",
        `  external plugin install/load/HMR: ${server.baseUrl}`,
        "  ambient dsh/Node/pnpm dependency: none",
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
