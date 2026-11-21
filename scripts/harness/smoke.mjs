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
  harnessHostArguments,
  readHarnessRuntimeLayout,
} from "../../desktop/main/harness-launch.ts";
import { HarnessHostChannel } from "../../desktop/main/harness-host-channel.ts";
import { parseMinkeHostCapabilities } from "../../packages/harness-overlay/src/minke-host-contract.ts";
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
    exchange.headers.get("location") !== "./" ||
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
    `${server.baseUrl}/api/minke/${endpoint}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method: `minke/${endpoint}`,
        payload: { args: endpoint === "capabilities" ? {} : { request: payload } },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `POST /api/minke/${endpoint} failed with HTTP ${String(response.status)}`,
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
  try {
    return parseMinkeHostCapabilities(capabilities);
  } catch (cause) {
    throw new Error(
      `Minke Host returned unexpected capabilities: ${JSON.stringify(capabilities)}`,
      { cause },
    );
  }
}

async function smokeMinkeApiTrust(server) {
  const url = `${server.baseUrl}/api/minke/capabilities`;
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: "minke-auth-smoke",
      method: "minke/capabilities", payload: { args: {} } }),
  };
  const unauthenticated = await fetch(url, request);
  if (unauthenticated.status !== 401) {
    throw new Error(`Minke Remote API admitted an unauthenticated caller (${unauthenticated.status})`);
  }
  const foreignOrigin = await server.fetch(url, {
    ...request, headers: { ...request.headers, origin: "https://untrusted.invalid" },
  });
  if (foreignOrigin.status !== 403) {
    throw new Error(`Minke Remote API admitted a foreign Origin (${foreignOrigin.status})`);
  }
  const retired = await server.fetch(`${server.baseUrl}/minke/capabilities`, request);
  // With no named route, DSH frontend-static rejects POST through its 405 fallback.
  if (retired.status !== 405) {
    throw new Error(`Retired Minke channel still responds (${retired.status})`);
  }
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

async function smokeDshTerminal(server) {
  const response = await server.fetch(
    `${server.baseUrl}/smoke/terminal`, { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(`DSH Terminal smoke failed (${response.status}): ${await response.text()}`);
  }
  const result = await response.json();
  if (result?.command !== true || result.resize !== true || result.exit !== true || result.close !== true) {
    throw new Error(`DSH Terminal smoke returned an incomplete result: ${JSON.stringify(result)}`);
  }
}

async function smokeFeedbackPolicy(server) {
  const response = await server.fetch(`${server.baseUrl}/smoke/feedback-policy`);
  if (!response.ok || (await response.json()).sharing !== "disabled") {
    throw new Error("Minke must disable the upstream session feedback uploader");
  }
}

async function smokeAutomationTasks(server) {
  const modules = [
    "@deepseek-ai/dsh-schedule",
    "@deepseek-ai/dsh-client-ui-schedule",
  ];
  const response = await server.fetch(`${server.baseUrl}/smoke/automation-tasks`);
  if (!response.ok) throw new Error(`Native automation tasks unavailable (${response.status})`);
  const state = await response.json();
  for (const moduleName of modules) {
    const rows = state.inventory.entries.filter(row => row.moduleName === moduleName);
    if (rows.length !== 1 || rows[0].fiberPhase !== "active") {
      throw new Error(`Native automation tasks ${moduleName} must be active without enabling a bundle`);
    }
  }
  const manifest = await fetchManifest(server);
  if (!manifest.entries.some(row => row.id === "@deepseek-ai/dsh-client-ui-schedule")) {
    throw new Error("Native automation tasks client is missing from the boot manifest");
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

async function waitForModelProvider(server, provider) {
  const deadline = Date.now() + 10_000;
  let state;
  while (Date.now() < deadline) {
    const response = await server.fetch(`${server.baseUrl}/smoke/model-settings`);
    if (!response.ok) throw new Error(`native model settings unavailable (${response.status})`);
    state = await response.json();
    if (state.descriptor?.ns === "llm-pi-ai" && state.providers?.includes(provider)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`native model settings did not publish ${provider}: ${JSON.stringify(state)}`);
}

async function startServer(command, args, env) {
  const child = spawnCommand(command, args, {
    cwd: projectRoot, detached: process.platform !== "win32", env,
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  let rawOutput = "";
  const output = () => redactLaunchTokens(rawOutput);
  const consume = chunk => { rawOutput = `${rawOutput}${String(chunk)}`.slice(-maxCapturedOutput); };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  const channel = new HarnessHostChannel(child, startupTimeoutMs, output);
  child.once("exit", () => channel.dispose());
  try {
    const endpoint = parseAuthenticatedReadyUrl(await channel.ready);
    const authenticatedFetch = await exchangeBrowserAuthentication(endpoint);
    if (output().includes(endpoint.launchToken)) throw new Error("Harness launch token reached smoke output");
    return { baseUrl: endpoint.baseUrl, child, fetch: authenticatedFetch, output };
  } catch (error) {
    await stopServer(child).catch(() => {});
    channel.dispose();
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

  if (child.connected) child.send({ type: "shutdown" }, () => {});
  else signalCommandProcessTree(child, "SIGTERM");
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

async function verifyDesktopHostLifecycle(executable, layout, environment, home) {
  for (const mode of ["shutdown", "disconnect", "startup-failure"]) {
    const child = spawnCommand(executable, harnessHostArguments(mode === "startup-failure"
      ? { ...layout, productPatch: join(home, "missing-overlay.yml") } : layout), {
      cwd: projectRoot, detached: process.platform !== "win32", windowsHide: true,
      env: { ...environment, DSH_HOME: home, MINKE_LM_STUDIO_ENABLED: "0", MINKE_OLLAMA_ENABLED: "0" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let output = "";
    const consume = chunk => { output = `${output}${String(chunk)}`.slice(-maxCapturedOutput); };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const channel = new HarnessHostChannel(child, startupTimeoutMs, () => redactLaunchTokens(output));
    let timer;
    try {
      if (mode === "startup-failure") {
        await channel.ready.then(() => { throw new Error("invalid Host overlay unexpectedly booted"); }, () => {});
        if (channel.diagnostic === undefined) throw new Error("Host startup failed without a structured diagnostic");
      } else {
        const endpoint = parseAuthenticatedReadyUrl(await channel.ready);
        const authenticatedFetch = await exchangeBrowserAuthentication(endpoint);
        const response = await authenticatedFetch(`${endpoint.baseUrl}/`);
        if (!response.ok) throw new Error(`Desktop Host page failed (${response.status})`);
        const inspection = await channel.inspectQuit();
        if (inspection.activeTasks || inspection.scheduledTasks) throw new Error("fresh Desktop Host reported interruptible work");
      }
      const exited = child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise(resolve => child.once("exit", resolve));
      if (mode === "shutdown") channel.requestShutdown();
      if (mode === "disconnect") child.disconnect();
      await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Desktop Host did not exit after ${mode}`)), 15_000);
      })]);
      if (mode === "startup-failure" ? child.exitCode !== 1 : child.exitCode !== 0) {
        throw new Error(`Desktop Host exit ${String(child.exitCode)} after ${mode}\n${redactLaunchTokens(output)}`);
      }
      if (mode === "shutdown" && !channel.shutdownCompleted) throw new Error("Desktop Host did not acknowledge profile teardown");
    } finally {
      clearTimeout(timer);
      channel.dispose();
      if (child.exitCode === null && child.signalCode === null) await stopServer(child);
    }
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
    await verifyDesktopHostLifecycle(electronExecutable, runtimeLayout, env, join(temporaryRoot, "desktop-home"));
    await Promise.all([
      cp(fixtureSource, fixtureCopy, { recursive: true }),
      cp(failingFixtureSource, failingFixtureCopy, { recursive: true }),
      writeFile(
        criticalFailurePatch,
        [
          "- insert:",
          "    - id: minke-overlay",
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

    await cp(
      join(verified.harnessRoot, "packages", "bundle", "web-app", "tests", "fixtures", "document-conversion.docx"),
      join(fixtureCopy, "document-conversion.docx"),
    );

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
    const ptc = await runSuccessful(
      executable("node"),
      [join(projectRoot, "scripts/harness/ptc-runtime-probe.mjs"), runtimeRoot, temporaryRoot],
      { cwd: projectRoot, env },
    );
    if (ptc.stdout.trim() !== "ptc-runtime-ok") {
      throw new Error(`Node PTC probe returned ${JSON.stringify(ptc.stdout.trim())}`);
    }
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

    // Minke's required host overlay stays fail-fast while upstream isolates
    // optional profile entries.
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

    const legacyModelSettings = JSON.stringify({
      "llm-pi-ai": { providers: {
        "minke-smoke-imported": {
          api: "openai-completions", baseURL: "http://127.0.0.1:1/v1",
          models: [{ id: "fixture", contextWindow: 8192, maxTokens: 1024 }],
        },
      } },
    });
    await writeFile(join(harnessHome, "settings.yaml"), legacyModelSettings, "utf8");
    server = await startServer(electronExecutable, harnessHostArguments(runtimeLayout), env);
    const isolatedFailureMarker =
      `${failingEntryId} (${failingPluginId})`;
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
    if (!inventory.entries.some(entry =>
      entry.moduleName === "@lencx/minke-model-runtime/dsh" && entry.fiberPhase === "active")) {
      throw new Error("the product composition did not activate Minke's local model runtime");
    }
    const fetchProviders = inventory.webProviders?.fetch?.map(provider => provider.id);
    if (fetchProviders?.length !== 1 || fetchProviders[0] !== "deepseek-fetch-api") {
      throw new Error(`unexpected web fetch providers: ${JSON.stringify(fetchProviders)}`);
    }
    if (inventory.webSettings?.fetchProvider !== "deepseek-fetch-api") {
      throw new Error("the staged web settings did not select DeepSeek Fetch API by default");
    }
    const manifest = await fetchManifest(server);
    await waitForModelProvider(server, "minke-smoke-imported");
    if (await readFile(join(harnessHome, "settings.yaml.imported"), "utf8") !== legacyModelSettings) {
      throw new Error("legacy model settings migration did not retain its original document");
    }
    const modelUpdate = await server.fetch(`${server.baseUrl}/smoke/model-settings`, { method: "POST" });
    if (!modelUpdate.ok) throw new Error(`native model settings edit failed (${modelUpdate.status})`);
    await waitForModelProvider(server, "minke-smoke-live");
    const minkeCapabilities = await fetchMinkeHostCapabilities(server);
    await smokeMinkeApiTrust(server);
    await smokeMinkePwa(server);
    await smokeFeedbackPolicy(server);
    await smokeAutomationTasks(server);
    await smokeDshTerminal(server);
    const officePreview = await server.fetch(`${server.baseUrl}/smoke/office-preview`);
    const officePdf = Buffer.from(await officePreview.arrayBuffer());
    if (!officePreview.ok ||
      officePreview.headers.get("content-type") !== "application/pdf" ||
      officePdf.subarray(0, 5).toString() !== "%PDF-" ||
      !officePdf.subarray(-32).includes(Buffer.from("%%EOF"))) {
      throw new Error(`bundled Office preview did not produce a complete PDF (${officePreview.status})`);
    }
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
    const stagedProductSource = await readFile(
      join(runtimeRoot, "node_modules", productPackageName, "lib", "client.js"),
      "utf8",
    );
    // DSH client-modules replaces the map trailer and terminates every combo
    // entry with ";\n". Compare the entire executable payload it should serve.
    const sourceMapTrailer = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/u;
    const expectedExecutable = `${stagedProductSource.replace(sourceMapTrailer, "\n")};\n`;
    if (!productClient.ok || productSource.replace(sourceMapTrailer, "\n") !== expectedExecutable) {
      throw new Error(`${productPackageName} client bundle differs from the staged artifact`);
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

    const externalPluginUrl = server.baseUrl;
    const disableResponse = await server.fetch(`${server.baseUrl}/smoke/disable-failed-plugin`, { method: "POST" });
    const disabled = disableResponse.ok ? await disableResponse.json() : undefined;
    const disabledBundle = disabled?.bundles?.find(bundle => bundle.name === failingPluginId);
    if (disabled?.change?.application !== "applied" || disabledBundle?.enabled !== false || disabledBundle?.installed !== true) {
      throw new Error("native PluginManager must disable a bundle live and retain it in the installed list");
    }
    for (const safeMode of [false, true]) {
      await stopServer(server.child);
      server = undefined;
      server = await startServer(electronExecutable, harnessHostArguments(runtimeLayout), {
        ...env,
        MINKE_PLUGIN_SAFE_MODE: safeMode ? "1" : "0",
      });
      const recoveryManifest = await fetchManifest(server);
      if (!recoveryManifest.entries.some(entry => entry.id === productPackageName)
        || recoveryManifest.entries.some(entry => entry.id === pluginId) === safeMode
        || server.output().includes(isolatedFailureMarker)) {
        throw new Error(`plugin recovery policy failed (safe mode: ${safeMode})`);
      }
      await fetchMinkeHostCapabilities(server);
      if (!safeMode) {
        await waitForModelProvider(server, "minke-smoke-live");
        const response = await server.fetch(`${server.baseUrl}/smoke/plugin-inventory`);
        const current = response.ok ? await response.json() : undefined;
        if (!Array.isArray(current?.entries)
          || current.entries.some(entry => entry.moduleName === failingPluginId)) {
          throw new Error("disabled profile plugin remained in the Loader inventory");
        }
      }
      const retained = JSON.parse(await readFile(webProfileManifestPath, "utf8"));
      if (retained.dependencies?.[pluginId] !== installedPluginSpec
        || retained.dependencies?.[failingPluginId] !== installedFailingPluginSpec) {
        throw new Error("plugin recovery changed installed Profile dependencies");
      }
    }

    console.log(
      [
        "Harness runtime smoke passed:",
        "  Desktop Host: IPC readiness, task inspection, acknowledged shutdown, parent loss and startup diagnostics functional",
        `  Electron Node: ${nodeVersion.stdout.trim()}`,
        `  bundled dsh:   ${dshVersion.stdout.trim()}`,
        `  bundled pnpm:  ${pnpmVersion.stdout.trim()}`,
        "  recursive Electron Node/native child policy: functional",
        "  bundled node-pty: functional",
        "  Node PTC: control channel, tool calls and workspace sandbox functional",
        "  bundled pi-ai Mistral provider: functional",
        `  bundled esbuild: ${esbuildVersion.stdout.trim()}`,
        `  Web plugins:   ${String(manifest.entries.length)}`,
        `  product overlay: ${productPackageName}`,
        `  isolated plugin failure: ${failingPluginId}`,
        "  native PluginManager: live disabling retains installed bundles across restart",
        "  Automation tasks: native scheduler and task UI are active by default",
        "  native model settings: legacy import, live edits and restart persistence",
        "  plugin recovery: safe mode retains installations",
        `  Minke shared Remote API: files=${String(minkeCapabilities.files.available)}, tabs=${String(minkeCapabilities.tabs.available)}`,
        "  native DSH Terminal: shell command, resize, exit and close functional",
        "  Minke PWA: standalone manifest/icons/service worker",
        `  bundled Office preview: DOCX converted to ${String(officePdf.length)} PDF bytes`,
        `  external plugin install/load/HMR: ${externalPluginUrl}`,
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
