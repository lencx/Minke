import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
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
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "@minke/desktop/main/harness-launch.ts";
import {
  HarnessRuntime,
  harnessRuntimeEnvironment,
  parseHarnessRuntimeEndpoint,
} from "@minke/desktop/main/harness-runtime.ts";
import {
  bindModelRuntimeSettingsIpc,
} from "@minke/desktop/main/model-runtime-settings.ts";
import {
  AGENT_BROWSER_IPC_VERSION_ENV,
  AGENT_BROWSER_PROTOCOL_VERSION,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import {
  agentTurnErrorResponse,
  agentTurnResultResponse,
  parseAgentTurnProcessRequest,
} from "@minke/harness-overlay/agent-turn-contract.ts";
import {
  HarnessLifecycle,
} from "@minke/desktop/main/harness-lifecycle.ts";
import {
  DEFAULT_MODEL_RUNTIME_CONTROL_TIMEOUT_MS,
  HarnessControlChannel,
  LM_STUDIO_COLD_START_BUDGET_MS,
  MODEL_RUNTIME_RECONFIGURE_BUDGET,
  OLLAMA_COLD_START_BUDGET_MS,
} from "@minke/desktop/main/harness-control.ts";
import {
  replacedTrustedHostsResponse,
} from "@minke/harness-overlay/trusted-host-control-contract.ts";
import {
  createReconfigureModelRuntimesRequest,
  MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  modelRuntimesReconfiguredResponse,
  parseModelRuntimeControlResponse,
  parseReconfigureModelRuntimesRequest,
} from "@lencx/minke-model-runtime/contract";

const HARNESS_ORIGIN = "http://127.0.0.1:43117";
const HARNESS_LAUNCH_TOKEN = "a".repeat(43);
const HARNESS_AUTHENTICATED_URL =
  `${HARNESS_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}`;

function harnessEndpoint() {
  return {
    origin: HARNESS_ORIGIN,
    authenticatedUrl: HARNESS_AUTHENTICATED_URL,
    launchToken: HARNESS_LAUNCH_TOKEN,
  };
}

function hasEnvironmentName(environment, name) {
  const normalized = name.toUpperCase();
  return Object.keys(environment).some(
    (key) => key.toUpperCase() === normalized,
  );
}

async function withRuntime(metadata, callback) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-harness-launch-"));
  try {
    await writeFile(
      join(runtimeRoot, "dsh-runtime.json"),
      `${JSON.stringify(metadata)}\n`,
    );
    await callback(runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test("desktop and smoke launch Harness through one staged layout contract", async () => {
  await withRuntime(
    {
      schemaVersion: 3,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "cordis.patch.yml",
      },
    },
    async (runtimeRoot) => {
      const layout = await readHarnessRuntimeLayout(runtimeRoot);
      assert.deepEqual(layout, {
        entryPath: join(runtimeRoot, "index.mjs"),
        pnpmEntry: join(
          runtimeRoot,
          "node_modules",
          "pnpm",
          "bin",
          "pnpm.cjs",
        ),
        productPackageName: "@lencx/minke-harness-overlay",
        productPatch: join(
          runtimeRoot,
          "node_modules",
          "@lencx",
          "minke-harness-overlay",
          "cordis.patch.yml",
        ),
        runtimeBin: join(runtimeRoot, "bin"),
      });
      assert.deepEqual(harnessWebArguments(layout), [
        "--expose-internals",
        join(runtimeRoot, "index.mjs"),
        "web",
        "--patch",
        layout.productPatch,
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ]);
    },
  );
});

test("the staged layout contract rejects unsafe product metadata", async () => {
  await withRuntime(
    {
      schemaVersion: 3,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "../outside.yml",
      },
    },
    async (runtimeRoot) => {
      await assert.rejects(
        readHarnessRuntimeLayout(runtimeRoot),
        /invalid product bundle metadata/u,
      );
    },
  );
});

test("the staged layout contract rejects stale runtime metadata", async () => {
  await withRuntime(
    {
      schemaVersion: 2,
      productBundle: {
        packageName: "@lencx/minke-harness-overlay",
        patch: "cordis.patch.yml",
      },
    },
    async (runtimeRoot) => {
      await assert.rejects(
        readHarnessRuntimeLayout(runtimeRoot),
        /invalid product bundle metadata/u,
      );
    },
  );
});

test("Harness readiness requires the exact alpha.2 authenticated loopback URL", () => {
  assert.deepEqual(
    parseHarnessRuntimeEndpoint(HARNESS_AUTHENTICATED_URL),
    harnessEndpoint(),
  );

  for (const candidate of [
    HARNESS_ORIGIN,
    `${HARNESS_ORIGIN}/?token=short`,
    `${HARNESS_AUTHENTICATED_URL}&debug=1`,
    `${HARNESS_AUTHENTICATED_URL}#fragment`,
    `${HARNESS_ORIGIN}/session?token=${HARNESS_LAUNCH_TOKEN}`,
    `${HARNESS_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}&token=${HARNESS_LAUNCH_TOKEN}`,
    `http://localhost:43117/?token=${HARNESS_LAUNCH_TOKEN}`,
    `https://127.0.0.1:43117/?token=${HARNESS_LAUNCH_TOKEN}`,
    `http://user@127.0.0.1:43117/?token=${HARNESS_LAUNCH_TOKEN}`,
  ]) {
    assert.throws(
      () => parseHarnessRuntimeEndpoint(candidate),
      (error) =>
        error instanceof Error &&
        error.message ===
          "Harness published an invalid authenticated readiness URL" &&
        !error.message.includes(HARNESS_LAUNCH_TOKEN),
      candidate,
    );
  }
});

test("the desktop runtime passes both explicit local-model opt-ins", () => {
  const layout = {
    pnpmEntry: "/runtime/node_modules/pnpm/bin/pnpm.cjs",
    runtimeBin: "/runtime/bin",
  };
  const options = {
    dshHome: "/data/harness",
    electronExecutable: "/app/electron",
    modelRuntimes: {
      lmStudio: {
        enabled: false,
        command: "/home/user/.lmstudio/bin/lms",
      },
      ollama: {
        enabled: true,
        command: "/usr/local/bin/ollama",
      },
    },
    pluginManagement: {
      safeMode: true,
      disabledPlugins: ["broken-plugin"],
    },
    webSearch: {
      fallbackEnabled: false,
    },
  };
  const inherited = {
    Path: "/usr/bin",
    dsh_home: "/stale/dsh",
    electron_run_as_node: "ambient",
    node_options: "--require /tmp/ambient.cjs",
    Node_Path: "/tmp/ambient-modules",
    minke_node_executable: "/stale/electron",
    minke_pnpm_entry: "/stale/pnpm.cjs",
    dsh_electron_executable: "/legacy/electron",
    dsh_pnpm_entry: "/legacy/pnpm.cjs",
    MINKE_LM_STUDIO_ENABLED: "1",
    MINKE_LM_STUDIO_COMMAND: "/stale/lms",
    minke_lm_studio_command: "/stale/lowercase-lms",
    MINKE_OLLAMA_ENABLED: "0",
    MINKE_OLLAMA_COMMAND: "/stale/ollama",
    minke_ollama_command: "/stale/lowercase-ollama",
    MINKE_PLUGIN_SAFE_MODE: "0",
    MINKE_DISABLED_PLUGINS: "[\"stale-plugin\"]",
    [MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV]: "1",
    [MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV.toLowerCase()]:
      "stale-lowercase",
    [AGENT_BROWSER_IPC_VERSION_ENV]: "stale",
    [AGENT_BROWSER_IPC_VERSION_ENV.toLowerCase()]:
      "stale-lowercase",
    minke_host_root: "/stale/root",
    PRESERVED: "yes",
  };

  assert.deepEqual(
    harnessRuntimeEnvironment(layout, options, inherited),
    {
      PATH: ["/runtime/bin", "/usr/bin"].join(process.platform === "win32" ? ";" : ":"),
      MINKE_LM_STUDIO_ENABLED: "0",
      MINKE_LM_STUDIO_COMMAND: "/home/user/.lmstudio/bin/lms",
      MINKE_OLLAMA_ENABLED: "1",
      MINKE_OLLAMA_COMMAND: "/usr/local/bin/ollama",
      MINKE_PLUGIN_SAFE_MODE: "1",
      MINKE_DISABLED_PLUGINS: "[\"broken-plugin\"]",
      [MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV]: "0",
      PRESERVED: "yes",
      DSH_HOME: "/data/harness",
      ELECTRON_RUN_AS_NODE: "1",
      MINKE_INTERACTIVE_NODE_OPTIONS:
        "--require /tmp/ambient.cjs",
      MINKE_INTERACTIVE_NODE_PATH: "/tmp/ambient-modules",
      MINKE_NODE_BOOTSTRAP:
        join(layout.runtimeBin, "node-environment-bootstrap.cjs"),
      MINKE_NODE_EXECUTABLE: "/app/electron",
      MINKE_PNPM_ENTRY: "/runtime/node_modules/pnpm/bin/pnpm.cjs",
    },
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        webSearch: {
          fallbackEnabled: true,
        },
      },
      inherited,
    )[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV],
    "1",
  );
  const { webSearch: _webSearch, ...optionsWithoutWebSearch } =
    options;
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      optionsWithoutWebSearch,
      inherited,
    )[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV],
    "1",
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        agentBrowser: {},
      },
      inherited,
    )[AGENT_BROWSER_IPC_VERSION_ENV],
    String(AGENT_BROWSER_PROTOCOL_VERSION),
  );
  assert.equal(
    hasEnvironmentName(harnessRuntimeEnvironment(
      layout,
      options,
      inherited,
    ), AGENT_BROWSER_IPC_VERSION_ENV),
    false,
  );
  assert.equal(
    hasEnvironmentName(
      harnessRuntimeEnvironment(layout, options, inherited),
      "MINKE_HOST_ROOT",
    ),
    false,
  );
  assert.equal(
    harnessRuntimeEnvironment(
      layout,
      {
        ...options,
        modelRuntimes: {
          ...options.modelRuntimes,
          lmStudio: {
            ...options.modelRuntimes.lmStudio,
            enabled: true,
          },
        },
      },
      inherited,
    ).MINKE_LM_STUDIO_ENABLED,
    "1",
  );
  assert.equal(
    hasEnvironmentName(
      harnessRuntimeEnvironment(
        layout,
        {
          ...options,
          modelRuntimes: {
            ...options.modelRuntimes,
            lmStudio: {
              enabled: false,
              command: undefined,
            },
          },
        },
        inherited,
      ),
      "MINKE_LM_STUDIO_COMMAND",
    ),
    false,
  );
  assert.equal(
    hasEnvironmentName(
      harnessRuntimeEnvironment(
        layout,
        {
          ...options,
          modelRuntimes: {
            ...options.modelRuntimes,
            ollama: {
              enabled: false,
              command: undefined,
            },
          },
        },
        inherited,
      ),
      "MINKE_OLLAMA_COMMAND",
    ),
    false,
  );
});

test("Harness control waits for an acknowledged trusted-host replacement", async () => {
  const child = new EventEmitter();
  child.connected = true;
  const requests = [];
  child.send = (message, callback) => {
    requests.push(message);
    callback?.(null);
    queueMicrotask(() => {
      child.emit(
        "message",
        replacedTrustedHostsResponse(message.requestId),
      );
    });
    return true;
  };
  const control = new HarnessControlChannel(child, 50, 50);

  assert.throws(
    () =>
      control.replaceTrustedHosts([
        "minke.example-tailnet.ts.net/path",
      ]),
    /invalid Harness trusted-host authority/u,
  );
  await control.replaceTrustedHosts([
    "minke.example-tailnet.ts.net",
  ]);

  assert.deepEqual(requests, [{
    channel: "minke:harness-control",
    protocolVersion: 1,
    requestId: 1,
    type: "trusted-hosts/replace",
    trustedHosts: ["minke.example-tailnet.ts.net"],
  }]);
  control.dispose();
});

test("Harness control waits for live model-runtime reconciliation", async () => {
  const child = new EventEmitter();
  child.connected = true;
  const requests = [];
  child.send = (message, callback) => {
    requests.push(message);
    callback?.(null);
    queueMicrotask(() => {
      child.emit(
        "message",
        modelRuntimesReconfiguredResponse(message.requestId),
      );
    });
    return true;
  };
  const control = new HarnessControlChannel(child, 50, 50);

  await control.reconfigureModelRuntimes({
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  });

  assert.deepEqual(requests, [{
    channel: "minke:model-runtime-control",
    protocolVersion: 1,
    requestId: 1,
    type: "model-runtimes/reconfigure",
    mode: "apply",
    settings: {
      lmStudio: { enabled: true },
      ollama: { enabled: false },
    },
  }]);
  control.dispose();
});

test("Harness control runs and cancels Agent turns over private IPC", async () => {
  const child = new EventEmitter();
  child.connected = true;
  const requests = [];
  child.send = (message, callback) => {
    requests.push(message);
    callback?.(null);
    if (message.type === "agent-turn/run") {
      queueMicrotask(() => {
        child.emit(
          "message",
          agentTurnResultResponse(message.requestId, {
            outcome: "completed",
            sessionId: "session-im-account-1-peer-2",
            text: "hello from Harness",
            turn: 0,
            endReason: "completed",
          }),
        );
      });
    }
    return true;
  };
  const control = new HarnessControlChannel(child, 50, 50, 50);

  assert.deepEqual(
    await control.runAgentTurn({
      operationId: "weixin:account-1:message-7",
      sessionId: "session-im-account-1-peer-2",
      text: "hello",
    }),
    {
      outcome: "completed",
      sessionId: "session-im-account-1-peer-2",
      text: "hello from Harness",
      turn: 0,
      endReason: "completed",
    },
  );
  assert.deepEqual(
    parseAgentTurnProcessRequest(requests[0]),
    requests[0],
  );
  assert.deepEqual(requests[0], {
    channel: "minke:agent-turn:process",
    protocolVersion: 1,
    requestId: 1,
    type: "agent-turn/run",
    input: {
      operationId: "weixin:account-1:message-7",
      sessionId: "session-im-account-1-peer-2",
      text: "hello",
    },
  });

  const abortingChild = new EventEmitter();
  abortingChild.connected = true;
  const abortRequests = [];
  abortingChild.send = (message, callback) => {
    abortRequests.push(message);
    callback?.(null);
    return true;
  };
  const abortingControl =
    new HarnessControlChannel(abortingChild, 50, 50, 50);
  const abort = new AbortController();
  const pending = abortingControl.runAgentTurn({
    operationId: "telegram:account-1:update-9",
    sessionId: "session-im-account-1-peer-9",
    text: "stop",
  }, { signal: abort.signal });
  abort.abort(new Error("caller stopped"));
  await assert.rejects(pending, {
    name: "AbortError",
    message: "caller stopped",
  });
  assert.equal(abortRequests[1]?.type, "agent-turn/cancel");
  assert.equal(abortRequests[1]?.requestId, 1);

  control.dispose();
  abortingControl.dispose();
});

test("Harness Agent turn IPC rejects on timeout and child exit", async () => {
  const timeoutChild = new EventEmitter();
  timeoutChild.connected = true;
  const timeoutRequests = [];
  timeoutChild.send = (message, callback) => {
    timeoutRequests.push(message);
    callback?.(null);
    return true;
  };
  const timeoutControl =
    new HarnessControlChannel(timeoutChild, 50, 50, 10);
  await assert.rejects(
    timeoutControl.runAgentTurn({
      operationId: "discord:account-1:event-1",
      sessionId: "session-im-account-1-peer-1",
      text: "wait",
    }),
    /Agent turn within 10 ms/u,
  );
  assert.equal(timeoutRequests[1]?.type, "agent-turn/cancel");

  const exitChild = new EventEmitter();
  exitChild.connected = true;
  exitChild.send = (_message, callback) => {
    callback?.(null);
    return true;
  };
  const exitControl =
    new HarnessControlChannel(exitChild, 50, 50, 1_000);
  const pending = exitControl.runAgentTurn({
    operationId: "weixin:account-1:message-8",
    sessionId: "session-im-account-1-peer-2",
    text: "hello",
  });
  exitChild.emit("exit", 17, null);
  await assert.rejects(
    pending,
    /Harness control channel closed/u,
  );

  timeoutControl.dispose();
  exitControl.dispose();
});

test("Harness control rejects Agent turn control-plane failures", async () => {
  const child = new EventEmitter();
  child.connected = true;
  child.send = (message, callback) => {
    callback?.(null);
    if (message.type === "agent-turn/run") {
      queueMicrotask(() => {
        child.emit(
          "message",
          agentTurnErrorResponse(
            message.requestId,
            "control-rpc-error",
            "session.history failed: store busy",
          ),
        );
      });
    }
    return true;
  };
  const control = new HarnessControlChannel(
    child,
    50,
    50,
    50,
  );

  await assert.rejects(
    control.runAgentTurn({
      operationId: "weixin:account-1:message-12",
      sessionId: "session-im-account-1-peer-2",
      text: "retry me",
    }),
    /control-rpc-error: session\.history failed: store busy/u,
  );
  control.dispose();
});

test("the model-runtime ACK deadline covers the bounded cold-start path", () => {
  assert.equal(LM_STUDIO_COLD_START_BUDGET_MS, 93_250);
  assert.equal(OLLAMA_COLD_START_BUDGET_MS, 15_250);
  assert.ok(LM_STUDIO_COLD_START_BUDGET_MS > 90_000);
  assert.equal(
    DEFAULT_MODEL_RUNTIME_CONTROL_TIMEOUT_MS,
    LM_STUDIO_COLD_START_BUDGET_MS +
      OLLAMA_COLD_START_BUDGET_MS +
      MODEL_RUNTIME_RECONFIGURE_BUDGET
        .controlDeliveryMarginMs,
  );
  assert.ok(
    DEFAULT_MODEL_RUNTIME_CONTROL_TIMEOUT_MS >
      LM_STUDIO_COLD_START_BUDGET_MS,
  );
});

test("crash recovery keeps the persisted model settings when persistence and live rollback both fail", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "minke-model-runtime-transaction-"),
  );
  const runtimeRoot = join(root, "runtime");
  const dshHome = join(root, "data");
  const launchesPath = join(dshHome, "launches.txt");
  const handlers = new Map();
  let resolveCrash;
  const crashed = new Promise((resolve) => {
    resolveCrash = resolve;
  });
  let runtime;
  let binding;
  try {
    await Promise.all([
      mkdir(join(runtimeRoot, "bin"), { recursive: true }),
      mkdir(
        join(runtimeRoot, "node_modules", "pnpm", "bin"),
        { recursive: true },
      ),
      mkdir(
        join(
          runtimeRoot,
          "node_modules",
          "@lencx",
          "minke-harness-overlay",
        ),
        { recursive: true },
      ),
      mkdir(dshHome, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(runtimeRoot, "dsh-runtime.json"),
        `${JSON.stringify({
          schemaVersion: 3,
          productBundle: {
            packageName: "@lencx/minke-harness-overlay",
            patch: "cordis.patch.yml",
          },
        })}\n`,
      ),
      writeFile(
        join(runtimeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
        "",
      ),
      writeFile(
        join(
          runtimeRoot,
          "node_modules",
          "@lencx",
          "minke-harness-overlay",
          "cordis.patch.yml",
        ),
        "",
      ),
      writeFile(
        join(runtimeRoot, "index.mjs"),
        [
          'import { appendFile } from "node:fs/promises";',
          'import { join } from "node:path";',
          "await appendFile(",
          '  join(process.env.DSH_HOME, "launches.txt"),',
          '  `${process.env.MINKE_LM_STUDIO_ENABLED}\\n`,',
          ");",
          `process.stdout.write(${JSON.stringify(`dsh web: ${HARNESS_AUTHENTICATED_URL.slice(0, -12)}`)});`,
          `setTimeout(() => process.stdout.write(${JSON.stringify(`${HARNESS_AUTHENTICATED_URL.slice(-12)}\n`)}), 5);`,
          'process.on("message", (message) => {',
          '  if (message?.type !== "model-runtimes/reconfigure") return;',
          '  const response = {',
          "    channel: message.channel,",
          "    protocolVersion: message.protocolVersion,",
          "    requestId: message.requestId,",
          "    type: message.mode === \"rollback\"",
          '      ? "model-runtimes/error"',
          '      : "model-runtimes/reconfigured",',
          '    ...(message.mode === "rollback"',
          '      ? { message: "rollback crashed" }',
          "      : {}),",
          "  };",
          "  process.send(response, () => {",
          '    if (message.mode === "rollback") process.exit(17);',
          "  });",
          "});",
          "setInterval(() => {}, 1_000).unref();",
          "",
        ].join("\n"),
      ),
    ]);

    runtime = new HarnessRuntime({
      runtimeRoot,
      dshHome,
      electronExecutable: process.execPath,
      modelRuntimes: {
        lmStudio: { enabled: false },
        ollama: { enabled: false },
      },
      pluginManagement: {
        safeMode: false,
        disabledPlugins: [],
      },
      onUnexpectedExit(exit) {
        resolveCrash(exit);
      },
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 2_000,
      controlTimeoutMs: 500,
      modelRuntimeControlTimeoutMs: 2_000,
    });
    await runtime.start();

    const persisted = {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    };
    binding = bindModelRuntimeSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        removeHandler(channel) {
          handlers.delete(channel);
        },
      },
      {
        async read() {
          return persisted;
        },
        async write() {
          throw new Error("disk unavailable");
        },
      },
      {
        lmStudio: true,
        ollama: true,
      },
      () => true,
      async (settings, mode) => {
        await runtime.reconfigureModelRuntimes(settings, mode);
      },
    );

    await assert.rejects(
      handlers.get(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL)(
        "allowed",
        {
          lmStudio: { enabled: true },
          ollama: { enabled: false },
        },
      ),
      /persistence failed and live rollback also failed/u,
    );
    const exit = await crashed;
    assert.equal(exit.code, 17);
    assert.match(exit.output, /token=<redacted>/u);
    assert.doesNotMatch(exit.output, new RegExp(HARNESS_LAUNCH_TOKEN, "u"));

    await runtime.start();
    assert.equal(
      await readFile(launchesPath, "utf8"),
      "0\n0\n",
    );
  } finally {
    binding?.dispose();
    await runtime?.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("model-runtime control messages reject non-exact payloads", () => {
  const request = createReconfigureModelRuntimesRequest(1, {
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  });
  assert.deepEqual(
    parseReconfigureModelRuntimesRequest(request),
    request,
  );
  assert.throws(
    () => parseReconfigureModelRuntimesRequest({
      ...request,
      unexpected: true,
    }),
    /invalid model runtime control request/u,
  );
  assert.throws(
    () => parseModelRuntimeControlResponse({
      ...modelRuntimesReconfiguredResponse(1),
      unexpected: true,
    }),
    /invalid model runtime control response/u,
  );
});

test("Harness window navigation cannot leave the bootstrap pending forever", async () => {
  let navigationStops = 0;
  let remoteStarts = 0;
  let loadedUrl;
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        return harnessEndpoint();
      },
    },
    remote: {
      async start() {
        remoteStarts += 1;
      },
      async detach() {},
    },
    navigationTimeoutMs: 10,
  });
  const navigation = lifecycle.start({
    isDestroyed() {
      return false;
    },
    async loadURL(url) {
      loadedUrl = url;
      return await new Promise(() => {});
    },
    webContents: {
      isDestroyed() {
        return false;
      },
      stop() {
        navigationStops += 1;
      },
    },
  });
  const outcome = await Promise.race([
    navigation.then(
      () => "resolved",
      (error) => error,
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve("still-pending"), 50);
    }),
  ]);

  assert.notEqual(
    outcome,
    "still-pending",
    "Harness navigation must settle before the external deadline",
  );
  assert.equal(outcome?.name, "HarnessNavigationError");
  assert.match(outcome?.message, /did not finish within 10 ms/u);
  assert.equal(lifecycle.url, HARNESS_ORIGIN);
  assert.equal(loadedUrl, HARNESS_AUTHENTICATED_URL);
  assert.equal(navigationStops, 1);
  assert.equal(remoteStarts, 0);
});

test("remote exposure starts only after the Harness window has loaded", async () => {
  const events = [];
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        events.push("runtime");
        return harnessEndpoint();
      },
    },
    remote: {
      async start(url, launchToken) {
        events.push(["remote", url, launchToken]);
      },
      async detach() {
        events.push("remote-detach");
      },
    },
    navigationTimeoutMs: 50,
  });

  assert.equal(
    await lifecycle.start({
      isDestroyed() {
        return false;
      },
      async loadURL(url) {
        events.push(["window", url]);
      },
      webContents: {
        isDestroyed() {
          return false;
        },
        stop() {
          events.push("window-stop");
        },
      },
    }),
    HARNESS_ORIGIN,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    "remote-detach",
    "runtime",
    ["window", HARNESS_AUTHENTICATED_URL],
    ["remote", HARNESS_ORIGIN, HARNESS_LAUNCH_TOKEN],
  ]);
});

test("Harness navigation errors redact the launch capability", async () => {
  let remoteStarts = 0;
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        return harnessEndpoint();
      },
    },
    remote: {
      async start() {
        remoteStarts += 1;
      },
      async detach() {},
    },
  });

  await assert.rejects(
    lifecycle.start({
      isDestroyed() {
        return false;
      },
      async loadURL(url) {
        throw new Error(`navigation failed for ${url}`);
      },
      webContents: {
        isDestroyed() {
          return false;
        },
        stop() {},
      },
    }),
    (error) =>
      error?.name === "HarnessNavigationError" &&
      error.message.includes(HARNESS_ORIGIN) &&
      !error.message.includes(HARNESS_LAUNCH_TOKEN) &&
      error.cause instanceof Error &&
      error.cause.message.includes("token=<redacted>") &&
      !error.cause.message.includes(HARNESS_LAUNCH_TOKEN),
  );
  assert.equal(remoteStarts, 0);
  assert.equal(lifecycle.url, HARNESS_ORIGIN);
});
