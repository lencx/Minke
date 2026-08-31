import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PLUGIN_INSTALLED_READ_CHANNEL,
  PLUGIN_INSTALL_CHANNEL,
  PLUGIN_RESTART_CHANNEL,
  PLUGIN_SAFE_MODE_SET_CHANNEL,
  PLUGIN_SET_ENABLED_CHANNEL,
  PLUGIN_UNINSTALL_CHANNEL,
  parseInstalledPluginsSnapshot,
  parsePluginInstallCommand,
  parsePluginInstallRequest,
  parsePluginInstallTarget,
  parsePluginManagementSettings,
  parsePluginSafeModeSetRequest,
  parsePluginSetEnabledRequest,
  parsePluginUninstallRequest,
  parsePluginUninstallTarget,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  bindPluginInstallIpc,
} from "@minke/desktop/main/plugin-install.ts";
import {
  clearLegacyPluginCatalogCache,
  legacyPluginCatalogCacheFilePath,
} from "@minke/desktop/main/plugin-cache.ts";
import {
  PluginInstallationRuntime,
} from "@minke/desktop/main/plugin-installation.ts";
import {
  desktopPluginInstallerPort,
} from "@minke/harness-overlay/client/desktop/workspace.ts";
import {
  PluginTabsController,
} from "@minke/harness-overlay/client/tabs/plugins/controller.ts";
import {
  PluginsView,
} from "@minke/harness-overlay/client/tabs/plugins/PluginsView.tsx";
import {
  createPluginTabRenderer,
} from "@minke/harness-overlay/client/tabs/plugins/renderer.tsx";
import {
  createHarnessPluginInventoryPort,
  createPluginLifecyclePort,
} from "@minke/harness-overlay/client/tabs/plugins/lifecycle.ts";
import {
  pluginsEn,
  pluginsZh,
} from "@minke/harness-overlay/client/tabs/plugins/locales.ts";
import {
  PLUGIN_DISCOVERY_TOPIC_URL,
  createPluginSearchUrl,
  readPluginSearchQuery,
  removeInsertedWebviewCssSafely,
} from "@minke/harness-overlay/client/tabs/plugins/resources.ts";
import {
  PLUGIN_DISCOVERY_WEB_PREFERENCES,
  configurePluginDiscoveryWebview,
} from "@minke/harness-overlay/client/tabs/plugins/webview.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";

const roots = [];

async function temporaryRoot() {
  const root = await mkdtemp(
    join(tmpdir(), "minke-plugin-install-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  );
});

test("plugin discovery searches accept keywords and GitHub qualifiers", () => {
  const keywordUrl = new URL(
    createPluginSearchUrl("status rotator"),
  );
  assert.equal(
    keywordUrl.searchParams.get("q"),
    "topic:dsh-plugin status rotator",
  );

  const searchUrl = new URL(
    createPluginSearchUrl(
      '  language:typescript   stars:>50 "status line"  ',
    ),
  );
  assert.equal(searchUrl.origin, "https://github.com");
  assert.equal(searchUrl.pathname, "/search");
  assert.equal(searchUrl.searchParams.get("type"), "repositories");
  assert.equal(
    searchUrl.searchParams.get("q"),
    'topic:dsh-plugin language:typescript stars:>50 "status line"',
  );
  assert.equal(
    readPluginSearchQuery(searchUrl.toString()),
    'language:typescript stars:>50 "status line"',
  );
  assert.equal(
    createPluginSearchUrl(" \n\t "),
    PLUGIN_DISCOVERY_TOPIC_URL,
  );
  assert.equal(
    readPluginSearchQuery(
      "https://github.com/deepseek-ai/deepseek-harness",
    ),
    undefined,
  );
});

test("detached plugin webviews skip native CSS cleanup", () => {
  let removals = 0;
  removeInsertedWebviewCssSafely(
    {
      isConnected: false,
      removeInsertedCSS() {
        removals += 1;
        throw new Error("webview is detached");
      },
    },
    ["compact", "topic"],
  );
  assert.equal(removals, 0);
});

test("plugin webview CSS cleanup contains synchronous Electron failures", () => {
  assert.doesNotThrow(() => {
    removeInsertedWebviewCssSafely(
      {
        isConnected: true,
        removeInsertedCSS() {
          throw new Error("dom-ready has not fired");
        },
      },
      ["compact"],
    );
  });
});

test("plugin discovery webviews receive one explicit security contract", () => {
  const attributes = new Map();
  const view = {
    className: "",
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  configurePluginDiscoveryWebview(view, {
    label: "Discover plugins",
    url: PLUGIN_DISCOVERY_TOPIC_URL,
  });

  assert.equal(view.className, "minke-plugins-browser__guest");
  assert.deepEqual(Object.fromEntries(attributes), {
    "aria-label": "Discover plugins",
    partition: "persist:minke-tabs-web",
    src: PLUGIN_DISCOVERY_TOPIC_URL,
    webpreferences: [
      "contextIsolation=yes",
      "nodeIntegration=no",
      "sandbox=yes",
      "webSecurity=yes",
    ].join(","),
  });
  assert.deepEqual(PLUGIN_DISCOVERY_WEB_PREFERENCES, [
    "contextIsolation=yes",
    "nodeIntegration=no",
    "sandbox=yes",
    "webSecurity=yes",
  ]);
});

test("plugin install commands accept one web-profile package target", () => {
  assert.deepEqual(
    parsePluginInstallCommand(
      "  dsh  plugin --profile web add dsh-status-rotator  ",
    ),
    {
      command:
        "dsh plugin --profile web add dsh-status-rotator",
      target: "dsh-status-rotator",
    },
  );
  assert.deepEqual(
    parsePluginInstallCommand(
      "dsh plugin --profile web add github:minke-labs/plugin#path:packages/web",
    ),
    {
      command:
        "dsh plugin --profile web add github:minke-labs/plugin#path:packages/web",
      target:
        "github:minke-labs/plugin#path:packages/web",
    },
  );
  assert.equal(
    parsePluginInstallTarget("@minke/plugin@1.2.3"),
    "@minke/plugin@1.2.3",
  );
  assert.deepEqual(
    parsePluginInstallRequest({
      command:
        "dsh\tplugin --profile web add @minke/plugin",
    }),
    {
      command:
        "dsh plugin --profile web add @minke/plugin",
    },
  );

  for (const invalid of [
    "rm -rf plugin",
    "dsh plugin --profile tui add plugin",
    "dsh plugin --profile web remove plugin",
    "dsh plugin --profile web add plugin other-plugin",
    "dsh plugin --profile web add --save-dev",
    "dsh plugin --profile web add file:../plugin",
    "dsh plugin --profile web add plugin\nwhoami",
  ]) {
    assert.throws(
      () => parsePluginInstallCommand(invalid),
      /plugin install/u,
    );
  }
});

test("plugin uninstall requests accept one installed package name", () => {
  assert.equal(
    parsePluginUninstallTarget("@minke/example-plugin"),
    "@minke/example-plugin",
  );
  assert.deepEqual(
    parsePluginUninstallRequest({
      name: "example-plugin",
    }),
    {
      name: "example-plugin",
    },
  );

  for (const invalid of [
    "",
    "../escape",
    "example-plugin@1.0.0",
    "example-plugin\nother-plugin",
  ]) {
    assert.throws(
      () => parsePluginUninstallTarget(invalid),
      /plugin uninstall/u,
    );
  }
  assert.throws(
    () => parsePluginUninstallRequest({
      name: "example-plugin",
      extra: true,
    }),
    /plugin uninstall/u,
  );
});

test("installed plugin snapshots accept only bounded display metadata", () => {
  assert.deepEqual(
    parseInstalledPluginsSnapshot({
      safeMode: false,
      plugins: [
        {
          name: "@minke/example-plugin",
          requested: "^1.2.0",
          version: "1.2.3",
          description: "A web profile plugin.",
          repositoryUrl:
            "https://github.com/minke/example-plugin",
          enabled: true,
          state: "ready",
        },
        {
          name: "missing-plugin",
          requested: "github:minke/missing-plugin",
          enabled: false,
          state: "missing",
        },
      ],
    }),
    {
      safeMode: false,
      plugins: [
        {
          name: "@minke/example-plugin",
          requested: "^1.2.0",
          version: "1.2.3",
          description: "A web profile plugin.",
          repositoryUrl:
            "https://github.com/minke/example-plugin",
          enabled: true,
          state: "ready",
        },
        {
          name: "missing-plugin",
          requested: "github:minke/missing-plugin",
          enabled: false,
          state: "missing",
        },
      ],
    },
  );

  const inheritedSnapshot = Object.assign(
    Object.create({
      plugins: [],
      safeMode: false,
    }),
    {
      unrelated: true,
      other: true,
    },
  );
  for (const invalid of [
    { plugins: "not-an-array", safeMode: false },
    inheritedSnapshot,
    {
      safeMode: false,
      plugins: [{
        name: "../escape",
        requested: "^1.0.0",
        enabled: true,
        state: "ready",
      }],
    },
    {
      safeMode: false,
      plugins: [{
        name: "example-plugin",
        requested: "^1.0.0",
        enabled: true,
        repositoryUrl:
          "https://token@github.com/minke/example-plugin",
        state: "ready",
      }],
    },
    {
      safeMode: false,
      plugins: [{
        name: "example-plugin",
        requested: "^1.0.0",
        enabled: true,
        state: "unknown",
      }],
    },
  ]) {
    assert.throws(
      () => parseInstalledPluginsSnapshot(invalid),
      /installed plugin/u,
    );
  }
});

test("plugin management requests reject ambiguous persisted state", () => {
  assert.deepEqual(
    parsePluginManagementSettings({
      safeMode: true,
      disabledPlugins: ["broken-plugin"],
    }),
    {
      safeMode: true,
      disabledPlugins: ["broken-plugin"],
    },
  );
  assert.deepEqual(
    parsePluginSetEnabledRequest({
      name: "broken-plugin",
      enabled: false,
    }),
    {
      name: "broken-plugin",
      enabled: false,
    },
  );
  assert.deepEqual(
    parsePluginSafeModeSetRequest({ enabled: true }),
    { enabled: true },
  );
  assert.throws(
    () =>
      parsePluginManagementSettings({
        safeMode: false,
        disabledPlugins: ["broken-plugin", "broken-plugin"],
      }),
    /duplicate disabled plugins/u,
  );
});

test("plugin lifecycle combines installed packages with loader inventory", async () => {
  const lifecycle = createPluginLifecyclePort({
    available: true,
    async install() {},
    async restart() {},
    async setEnabled() {},
    async setSafeMode() {},
    async uninstall() {},
    async readInstalled() {
      return {
        safeMode: false,
        plugins: [
          {
            name: "active-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "failed-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "disabled-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "pending-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "unobserved-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "missing-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "missing",
          },
        ],
      };
    },
  }, {
    async read() {
      return {
        entries: [
          {
            entryId: "active",
            moduleName: "active-plugin",
            enabled: true,
            fiberPhase: "active",
          },
          {
            entryId: "failed",
            moduleName: "failed-plugin",
            enabled: true,
            fiberPhase: "failed",
          },
          {
            entryId: "disabled",
            moduleName: "disabled-plugin",
            enabled: false,
            fiberPhase: null,
          },
          {
            entryId: "pending",
            moduleName: "pending-plugin",
            enabled: true,
            fiberPhase: "loading",
          },
        ],
      };
    },
  });

  assert.deepEqual(
    (await lifecycle.read()).plugins.map(({ name, state }) => ({
      name,
      state,
    })),
    [
      { name: "active-plugin", state: "active" },
      { name: "failed-plugin", state: "failed" },
      { name: "disabled-plugin", state: "disabled" },
      { name: "pending-plugin", state: "pending" },
      { name: "unobserved-plugin", state: "unobserved" },
      { name: "missing-plugin", state: "missing" },
    ],
  );
});

test("plugin lifecycle keeps installed metadata when inventory is unavailable", async () => {
  const lifecycle = createPluginLifecyclePort({
    available: true,
    async install() {},
    async restart() {},
    async setEnabled() {},
    async setSafeMode() {},
    async uninstall() {},
    async readInstalled() {
      return {
        safeMode: false,
        plugins: [
          {
            name: "unknown-plugin",
            requested: "^1.0.0",
            version: "1.2.3",
            enabled: true,
            state: "ready",
          },
          {
            name: "missing-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "missing",
          },
        ],
      };
    },
  }, {
    async read() {
      throw new Error("inventory offline");
    },
  });

  assert.deepEqual(await lifecycle.read(), {
    plugins: [
      {
        name: "unknown-plugin",
        requested: "^1.0.0",
        version: "1.2.3",
        enabled: true,
        state: "unknown",
      },
      {
        name: "missing-plugin",
        requested: "^1.0.0",
        enabled: true,
        state: "missing",
      },
    ],
    safeMode: false,
    runtimeError: "inventory offline",
  });
});

test("safe mode and per-plugin disablement override live inventory", async () => {
  const enabledUpdates = [];
  const safeModeUpdates = [];
  const lifecycle = createPluginLifecyclePort({
    available: true,
    async install() {},
    async restart() {},
    async uninstall() {},
    async setEnabled(name, enabled) {
      enabledUpdates.push({ name, enabled });
    },
    async setSafeMode(enabled) {
      safeModeUpdates.push(enabled);
    },
    async readInstalled() {
      return {
        safeMode: true,
        plugins: [
          {
            name: "active-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          },
          {
            name: "disabled-plugin",
            requested: "^1.0.0",
            enabled: false,
            state: "ready",
          },
        ],
      };
    },
  }, {
    async read() {
      return {
        entries: [
          {
            entryId: "active",
            moduleName: "active-plugin",
            enabled: true,
            fiberPhase: "active",
          },
        ],
      };
    },
  });

  const snapshot = await lifecycle.read();
  assert.equal(snapshot.safeMode, true);
  assert.deepEqual(
    snapshot.plugins.map(({ name, state }) => ({ name, state })),
    [
      { name: "active-plugin", state: "disabled" },
      { name: "disabled-plugin", state: "disabled" },
    ],
  );
  await lifecycle.setEnabled("disabled-plugin", true);
  await lifecycle.setSafeMode(false);
  assert.deepEqual(enabledUpdates, [{
    name: "disabled-plugin",
    enabled: true,
  }]);
  assert.deepEqual(safeModeUpdates, [false]);
});

test("the Harness inventory port validates the authoritative loader snapshot", async () => {
  const calls = [];
  const inventory = createHarnessPluginInventoryPort({
    async list() {
      calls.push("list");
      return {
        ok: true,
        value: {
          entries: [{
            entryId: "visual-workflow",
            moduleName: "dsh-visual-workflow",
            enabled: true,
            fiberPhase: "failed",
          }],
          // Alpha.2 owns preset grouping and cross-preset search. The
          // lifecycle port intentionally ignores that unrelated payload.
          agentPresets: [{
            id: "standard",
            trust: "system",
            name: "Standard",
            isDefault: true,
            rows: [{
              entryId: null,
              moduleName: "dsh-visual-workflow",
              enabled: "conditional",
              condition: "env.ENABLE_VISUAL_WORKFLOW",
              fiberPhase: null,
            }],
          }],
        },
      };
    },
  });

  assert.deepEqual(await inventory.read(), {
    entries: [{
      entryId: "visual-workflow",
      moduleName: "dsh-visual-workflow",
      enabled: true,
      fiberPhase: "failed",
    }],
  });
  assert.deepEqual(calls, ["list"]);

  const invalidInventory = createHarnessPluginInventoryPort({
    async list() {
      return {
        ok: true,
        value: {
          entries: [{
            entryId: "invalid",
            moduleName: "invalid-plugin",
            enabled: true,
            fiberPhase: "crashed",
          }],
        },
      };
    },
  });
  await assert.rejects(
    invalidInventory.read(),
    /plugin inventory fiber phase/u,
  );

  const unrelatedPresetInventory = createHarnessPluginInventoryPort({
    async list() {
      return {
        ok: true,
        value: {
          entries: [],
          agentPresets: "owned by the native inventory UI",
        },
      };
    },
  });
  assert.deepEqual(await unrelatedPresetInventory.read(), {
    entries: [],
  });

  const remoteFailure = Object.assign(
    new Error("inventory unavailable"),
    {
      code: "gateway/unavailable",
      details: {},
    },
  );
  const failingInventory = createHarnessPluginInventoryPort({
    async list() {
      return {
        ok: false,
        error: remoteFailure,
      };
    },
  });
  await assert.rejects(
    failingInventory.read(),
    (error) => error === remoteFailure,
  );
});

test("the installation runtime forwards a validated target without a shell", async () => {
  const root = await temporaryRoot();
  const dshHome = join(root, "dsh-home");
  const layout = {
    entryPath: join(root, "runtime", "index.mjs"),
    pnpmEntry: join(root, "runtime", "pnpm.cjs"),
    productPackageName: "@minke/runtime",
    productPatch: join(root, "runtime", "product.yml"),
    runtimeBin: join(root, "runtime", "bin"),
  };
  const commands = [];
  const installation = new PluginInstallationRuntime({
    runtimeRoot: join(root, "runtime"),
    dshHome,
    electronExecutable: join(root, "Minke"),
    environment: {
      Path: "/usr/bin",
      dsh_home: "/ambient/dsh",
      electron_run_as_node: "ambient",
      node_options: "--require /tmp/ambient.cjs",
      Node_Path: "/tmp/ambient-modules",
      Dsh_Electron_Executable: "ambient-electron",
      dsh_pnpm_entry: "ambient-pnpm",
    },
    readRuntimeLayout: async () => layout,
    runCommand: async (command, args, options) => {
      commands.push({ command, args, options });
    },
  });

  await installation.install("dsh-status-rotator");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, join(root, "Minke"));
  assert.deepEqual(commands[0].args, [
    "--expose-internals",
    layout.entryPath,
    "plugin",
    "--profile",
    "web",
    "add",
    "dsh-status-rotator",
  ]);
  assert.equal(commands[0].options.cwd, dshHome);
  assert.equal(commands[0].options.env.DSH_HOME, dshHome);
  assert.equal(
    commands[0].options.env.ELECTRON_RUN_AS_NODE,
    "1",
  );
  assert.equal(
    commands[0].options.env.MINKE_NODE_EXECUTABLE,
    join(root, "Minke"),
  );
  assert.equal(
    commands[0].options.env.MINKE_PNPM_ENTRY,
    layout.pnpmEntry,
  );
  assert.equal(
    commands[0].options.env.DSH_ELECTRON_EXECUTABLE,
    undefined,
  );
  assert.equal(
    commands[0].options.env.DSH_PNPM_ENTRY,
    undefined,
  );
  assert.equal(
    Object.keys(commands[0].options.env).some(
      (key) => key.toUpperCase() === "NODE_OPTIONS",
    ),
    false,
  );
  assert.equal(
    Object.keys(commands[0].options.env).some(
      (key) => key.toUpperCase() === "NODE_PATH",
    ),
    false,
  );
  await installation.uninstall("dsh-status-rotator");
  assert.equal(commands.length, 2);
  assert.equal(commands[1].command, join(root, "Minke"));
  assert.deepEqual(commands[1].args, [
    "--expose-internals",
    layout.entryPath,
    "plugin",
    "--profile",
    "web",
    "remove",
    "dsh-status-rotator",
  ]);
  assert.equal(commands[1].options.cwd, dshHome);
  assert.equal(commands[1].options.env.DSH_HOME, dshHome);
  await assert.rejects(
    installation.install("file:../plugin"),
    /invalid plugin install target/u,
  );
  await assert.rejects(
    installation.uninstall("dsh-status-rotator@1.0.0"),
    /invalid plugin uninstall target/u,
  );
});

test("the installation runtime lists only active web-profile plugins", async () => {
  const root = await temporaryRoot();
  const dshHome = join(root, "dsh-home");
  const profileRoot = join(dshHome, "profiles", "web");
  await mkdir(
    join(profileRoot, "node_modules", "@minke", "example-plugin"),
    { recursive: true },
  );
  await writeFile(
    join(profileRoot, "package.json"),
    JSON.stringify({
      dependencies: {
        "@minke/example-plugin": "^1.2.0",
        "missing-plugin": "github:minke/missing-plugin",
        "profile-helper": "^4.0.0",
      },
      dsh: {
        profile: {
          bundles: [
            "@deepseek-ai/dsh-base",
            "@deepseek-ai/dsh-web-app",
            "@minke/example-plugin",
            "missing-plugin",
          ],
        },
      },
    }),
  );
  await writeFile(
    join(
      profileRoot,
      "node_modules",
      "@minke",
      "example-plugin",
      "package.json",
    ),
    JSON.stringify({
      name: "@minke/example-plugin",
      version: "1.2.3",
      description: "A web profile plugin.",
      repository: {
        type: "git",
        url:
          "git+https://github.com/minke/example-plugin.git",
      },
    }),
  );
  let pluginSettings = {
    safeMode: false,
    disabledPlugins: ["missing-plugin"],
  };
  const installation = new PluginInstallationRuntime({
    runtimeRoot: join(root, "runtime"),
    dshHome,
    electronExecutable: join(root, "Minke"),
    settings: {
      async read() {
        return pluginSettings;
      },
      async write(value) {
        pluginSettings = value;
      },
    },
  });

  assert.deepEqual(await installation.listInstalled(), {
    safeMode: false,
    plugins: [
      {
        name: "@minke/example-plugin",
        requested: "^1.2.0",
        version: "1.2.3",
        description: "A web profile plugin.",
        repositoryUrl:
          "https://github.com/minke/example-plugin",
        enabled: true,
        state: "ready",
      },
      {
        name: "missing-plugin",
        requested: "github:minke/missing-plugin",
        enabled: false,
        state: "missing",
      },
    ],
  });
  await installation.setEnabled("missing-plugin", true);
  await installation.setSafeMode(true);
  assert.deepEqual(pluginSettings, {
    safeMode: true,
    disabledPlugins: [],
  });
});

test("the installation runtime treats a missing web profile as empty", async () => {
  const root = await temporaryRoot();
  const installation = new PluginInstallationRuntime({
    runtimeRoot: join(root, "runtime"),
    dshHome: join(root, "dsh-home"),
    electronExecutable: join(root, "Minke"),
  });

  assert.deepEqual(await installation.listInstalled(), {
    plugins: [],
    safeMode: false,
  });
});

test("the desktop IPC binding authorizes and parses install commands", async () => {
  const handlers = new Map();
  const installs = [];
  const uninstalls = [];
  const enabledUpdates = [];
  const safeModeUpdates = [];
  let restarts = 0;
  const binding = bindPluginInstallIpc(
    {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async install(target) {
        installs.push(target);
      },
      async uninstall(name) {
        uninstalls.push(name);
        if (name === "broken-plugin") {
          throw new Error("plugin remove failed");
        }
      },
      async setEnabled(name, enabled) {
        enabledUpdates.push({ name, enabled });
      },
      async setSafeMode(enabled) {
        safeModeUpdates.push(enabled);
      },
      async listInstalled() {
        return {
          safeMode: false,
          plugins: [{
            name: "example-plugin",
            requested: "^1.0.0",
            enabled: true,
            state: "ready",
          }],
        };
      },
    },
    (event) => event === "trusted",
    () => {
      restarts += 1;
    },
  );
  const handler = handlers.get(PLUGIN_INSTALL_CHANNEL);
  const readHandler = handlers.get(
    PLUGIN_INSTALLED_READ_CHANNEL,
  );
  const uninstallHandler = handlers.get(
    PLUGIN_UNINSTALL_CHANNEL,
  );
  const restartHandler = handlers.get(PLUGIN_RESTART_CHANNEL);
  const setEnabledHandler = handlers.get(
    PLUGIN_SET_ENABLED_CHANNEL,
  );
  const safeModeHandler = handlers.get(
    PLUGIN_SAFE_MODE_SET_CHANNEL,
  );
  assert.equal(typeof handler, "function");
  assert.equal(typeof readHandler, "function");
  assert.equal(typeof uninstallHandler, "function");
  assert.equal(typeof restartHandler, "function");
  assert.equal(typeof setEnabledHandler, "function");
  assert.equal(typeof safeModeHandler, "function");

  await handler("trusted", {
    command:
      "dsh plugin --profile web add dsh-status-rotator",
  });
  assert.deepEqual(installs, ["dsh-status-rotator"]);
  assert.equal(restarts, 0);
  await assert.rejects(
    handler("untrusted", {
      command:
        "dsh plugin --profile web add another-plugin",
    }),
    /unauthorized/u,
  );
  assert.deepEqual(installs, ["dsh-status-rotator"]);
  restartHandler("trusted");
  assert.equal(restarts, 1);
  assert.throws(
    () => restartHandler("untrusted"),
    /unauthorized/u,
  );
  assert.equal(restarts, 1);
  await uninstallHandler("trusted", {
    name: "dsh-status-rotator",
  });
  assert.deepEqual(uninstalls, ["dsh-status-rotator"]);
  assert.equal(restarts, 2);
  await setEnabledHandler("trusted", {
    name: "dsh-status-rotator",
    enabled: false,
  });
  assert.deepEqual(enabledUpdates, [{
    name: "dsh-status-rotator",
    enabled: false,
  }]);
  assert.equal(restarts, 3);
  await safeModeHandler("trusted", { enabled: true });
  assert.deepEqual(safeModeUpdates, [true]);
  assert.equal(restarts, 4);
  await assert.rejects(
    safeModeHandler("untrusted", { enabled: false }),
    /unauthorized/u,
  );
  await assert.rejects(
    uninstallHandler("untrusted", {
      name: "dsh-status-rotator",
    }),
    /unauthorized/u,
  );
  assert.deepEqual(uninstalls, ["dsh-status-rotator"]);
  assert.equal(restarts, 4);
  await assert.rejects(
    uninstallHandler("trusted", {
      name: "broken-plugin",
    }),
    /plugin remove failed/u,
  );
  assert.deepEqual(uninstalls, [
    "dsh-status-rotator",
    "broken-plugin",
  ]);
  assert.equal(restarts, 4);
  assert.deepEqual(await readHandler("trusted"), {
    safeMode: false,
    plugins: [{
      name: "example-plugin",
      requested: "^1.0.0",
      enabled: true,
      state: "ready",
    }],
  });
  await assert.rejects(
    readHandler("untrusted"),
    /unauthorized/u,
  );

  binding.dispose();
  assert.equal(handlers.has(PLUGIN_INSTALL_CHANNEL), false);
  assert.equal(
    handlers.has(PLUGIN_INSTALLED_READ_CHANNEL),
    false,
  );
  assert.equal(
    handlers.has(PLUGIN_UNINSTALL_CHANNEL),
    false,
  );
  assert.equal(handlers.has(PLUGIN_RESTART_CHANNEL), false);
  assert.equal(handlers.has(PLUGIN_SET_ENABLED_CHANNEL), false);
  assert.equal(handlers.has(PLUGIN_SAFE_MODE_SET_CHANNEL), false);
});

test("legacy cleanup removes only the retired catalog cache", async () => {
  const root = await temporaryRoot();
  const pluginDirectory = join(root, "plugins");
  const credentialPath = join(
    pluginDirectory,
    "github-token-v1.json",
  );
  await mkdir(pluginDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      legacyPluginCatalogCacheFilePath(root),
      '{"repositories":[]}',
    ),
    writeFile(credentialPath, '{"encrypted":"preserve"}'),
  ]);

  await clearLegacyPluginCatalogCache(root);
  await assert.rejects(
    readFile(legacyPluginCatalogCacheFilePath(root)),
    { code: "ENOENT" },
  );
  assert.equal(
    await readFile(credentialPath, "utf8"),
    '{"encrypted":"preserve"}',
  );
  await clearLegacyPluginCatalogCache(root);
});

test("the renderer port exposes installation and installed plugins", async () => {
  const commands = [];
  const uninstalls = [];
  const enabledUpdates = [];
  const safeModeUpdates = [];
  let restarts = 0;
  const port = desktopPluginInstallerPort({
    minkeDesktop: {
      pluginInstaller: {
        async install(command) {
          commands.push(command);
        },
        async uninstall(name) {
          uninstalls.push(name);
        },
        async restart() {
          restarts += 1;
        },
        async setEnabled(name, enabled) {
          enabledUpdates.push({ name, enabled });
        },
        async setSafeMode(enabled) {
          safeModeUpdates.push(enabled);
        },
        async readInstalled() {
          return {
            safeMode: false,
            plugins: [{
              name: "example-plugin",
              requested: "^1.0.0",
              enabled: true,
              state: "ready",
            }],
          };
        },
      },
    },
  });
  assert.equal(port.available, true);
  await port.install(
    "dsh plugin --profile web add dsh-status-rotator",
  );
  assert.deepEqual(commands, [
    "dsh plugin --profile web add dsh-status-rotator",
  ]);
  await port.uninstall("dsh-status-rotator");
  assert.deepEqual(uninstalls, ["dsh-status-rotator"]);
  await port.restart();
  assert.equal(restarts, 1);
  await port.setEnabled("example-plugin", false);
  assert.deepEqual(enabledUpdates, [{
    name: "example-plugin",
    enabled: false,
  }]);
  await port.setSafeMode(true);
  assert.deepEqual(safeModeUpdates, [true]);
  assert.deepEqual(await port.readInstalled(), {
    safeMode: false,
    plugins: [{
      name: "example-plugin",
      requested: "^1.0.0",
      enabled: true,
      state: "ready",
    }],
  });

  const unavailable = desktopPluginInstallerPort({});
  assert.equal(unavailable.available, false);
  await assert.rejects(
    unavailable.install(
      "dsh plugin --profile web add dsh-status-rotator",
    ),
    /bridge is unavailable/u,
  );
  await assert.rejects(
    unavailable.readInstalled(),
    /bridge is unavailable/u,
  );
  await assert.rejects(
    unavailable.uninstall("dsh-status-rotator"),
    /bridge is unavailable/u,
  );
  await assert.rejects(
    unavailable.restart(),
    /bridge is unavailable/u,
  );
  await assert.rejects(
    unavailable.setEnabled("dsh-status-rotator", false),
    /bridge is unavailable/u,
  );
  await assert.rejects(
    unavailable.setSafeMode(true),
    /bridge is unavailable/u,
  );
});

test("the Plugins tab reports command installation outcomes", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const commands = [];
  const uninstalls = [];
  const enabledUpdates = [];
  const safeModeUpdates = [];
  let restarts = 0;
  let restartFails = true;
  let pluginInstalled = true;
  let pluginEnabled = true;
  let safeMode = false;
  let installedReads = 0;
  const externalUrls = [];
  const internalUrls = [];
  const controller = new PluginTabsController(tabs, {
    available: true,
    async install(command) {
      commands.push(command);
    },
    async restart() {
      restarts += 1;
      if (restartFails) throw new Error("restart unavailable");
    },
    async uninstall(name) {
      uninstalls.push(name);
      pluginInstalled = false;
    },
    async setEnabled(name, enabled) {
      enabledUpdates.push({ name, enabled });
      pluginEnabled = enabled;
    },
    async setSafeMode(enabled) {
      safeModeUpdates.push(enabled);
      safeMode = enabled;
    },
    async read() {
      installedReads += 1;
      return {
        safeMode,
        plugins: pluginInstalled
          ? [{
              name: "example-plugin",
              requested: "^1.0.0",
              version: "1.0.0",
              enabled: pluginEnabled,
              state:
                safeMode || !pluginEnabled
                  ? "disabled"
                  : "active",
            }]
          : [],
      };
    },
  }, {
    available: true,
    async readLayoutState() {
      return {};
    },
    async writeLayoutState() {},
    openExternal(url) {
      externalUrls.push(url);
    },
  }, {
    open(url) {
      internalUrls.push(url);
    },
  });
  const tabId = controller.create("Plugins");
  assert.equal(typeof tabId, "string");
  assert.equal(controller.create("Plugins"), tabId);
  assert.equal(tabs.getSnapshot().tabs.length, 1);
  await controller.refreshInstalled(tabId);
  assert.equal(installedReads >= 1, true);
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.view,
    "installed",
  );
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.catalog,
    {
      status: "ready",
      safeMode: false,
      plugins: [{
        name: "example-plugin",
        requested: "^1.0.0",
        version: "1.0.0",
        enabled: true,
        state: "active",
      }],
    },
  );
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.operation,
    { kind: "idle" },
  );
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.feedback,
    { kind: "none" },
  );
  controller.setView(tabId, "discover");
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.view,
    "discover",
  );

  await controller.install(
    tabId,
    " dsh  plugin --profile web add dsh-status-rotator ",
  );
  assert.deepEqual(commands, [
    "dsh plugin --profile web add dsh-status-rotator",
  ]);
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.operation,
    { kind: "idle" },
  );
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.feedback,
    {
      kind: "install-success",
      command:
        "dsh plugin --profile web add dsh-status-rotator",
    },
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.view,
    "installed",
  );
  assert.equal(installedReads >= 2, true);

  await controller.uninstall(tabId, "example-plugin");
  assert.deepEqual(uninstalls, ["example-plugin"]);
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.feedback,
    { kind: "uninstall-success", plugin: "example-plugin" },
  );
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.catalog.plugins,
    [],
  );

  await controller.uninstall(tabId, "../escape");
  assert.deepEqual(uninstalls, ["example-plugin"]);
  assert.match(
    tabs.getSnapshot().tabs[0].payload.feedback.message,
    /plugin uninstall/u,
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.feedback.kind,
    "uninstall-error",
  );

  await controller.install(tabId, "echo unsafe");
  assert.equal(commands.length, 1);
  assert.match(
    tabs.getSnapshot().tabs[0].payload.feedback.message,
    /plugin install command/u,
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.feedback.kind,
    "install-error",
  );
  controller.openExternal(
    "https://github.com/topics/dsh-plugin",
  );
  controller.openExternal("javascript:alert(1)");
  assert.deepEqual(externalUrls, [
    "https://github.com/topics/dsh-plugin",
  ]);
  controller.openInTab("https://github.com/minke/example-plugin");
  controller.openInTab("javascript:alert(1)");
  assert.deepEqual(internalUrls, [
    "https://github.com/minke/example-plugin",
  ]);
  await controller.restart(tabId);
  assert.equal(restarts, 1);
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.operation,
    { kind: "idle" },
  );
  assert.match(
    tabs.getSnapshot().tabs[0].payload.feedback.message,
    /restart unavailable/u,
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.feedback.kind,
    "restart-error",
  );

  pluginInstalled = true;
  await controller.refreshInstalled(tabId);
  await controller.setEnabled(tabId, "example-plugin", false);
  assert.deepEqual(enabledUpdates, [{
    name: "example-plugin",
    enabled: false,
  }]);
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.catalog.plugins[0].state,
    "disabled",
  );
  await controller.setSafeMode(tabId, true);
  assert.deepEqual(safeModeUpdates, [true]);
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.catalog.safeMode,
    true,
  );

  restartFails = false;
  await controller.restart(tabId);
  assert.equal(restarts, 2);
  assert.deepEqual(
    tabs.getSnapshot().tabs[0].payload.operation,
    { kind: "restart" },
  );
  controller.dispose();
  tabs.dispose();
});

test("the Plugins view renders installed recovery and GitHub discovery states", async () => {
  const [topicCss, searchCss, styles] =
    await Promise.all([
      readFile(
        new URL(
          "../packages/harness-overlay/src/client/tabs/plugins/github-topic.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../packages/harness-overlay/src/client/tabs/plugins/github-search.css",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../packages/harness-overlay/src/client/tabs/plugins/styles.css",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.equal(
    PLUGIN_DISCOVERY_TOPIC_URL,
    "https://github.com/topics/dsh-plugin",
  );

  const controllerCalls = [];
  const controller = {
    create(title) {
      controllerCalls.push(["create", title]);
    },
    install() {},
    openExternal() {},
    openInTab() {},
    refreshInstalled() {},
    restart() {},
    setEnabled() {},
    setSafeMode() {},
    setView() {},
    uninstall() {},
  };
  const t = (key) => key;
  const renderer = createPluginTabRenderer(controller, t);
  assert.equal(renderer.kind, "plugin-catalog");
  assert.equal(renderer.createOptions().length, 1);
  renderer.createOptions()[0].create();
  assert.deepEqual(controllerCalls, [
    ["create", "plugins.tab.title"],
  ]);

  const installedTab = {
    id: "plugins-1",
    key: "plugins",
    kind: "plugin-catalog",
    title: "Plugins",
    payload: {
      catalog: {
        plugins: [
          {
            description: "A failing plugin",
            enabled: true,
            name: "dsh-failing-plugin",
            requested: "dsh-failing-plugin",
            state: "failed",
            version: "1.0.0",
          },
        ],
        safeMode: false,
        status: "ready",
      },
      feedback: { kind: "none" },
      operation: { kind: "idle" },
      view: "installed",
    },
  };
  assert.equal(renderer.loading(installedTab), false);
  assert.equal(
    renderer.loading({
      ...installedTab,
      payload: {
        ...installedTab.payload,
        operation: {
          command: "dsh plugin --profile web add dsh-failing-plugin",
          kind: "install",
        },
      },
    }),
    true,
  );
  assert.equal(
    renderer.renderView(installedTab, true).type,
    PluginsView,
  );
  const installedMarkup = renderToStaticMarkup(
    createElement(PluginsView, {
      active: true,
      controller,
      t,
      tab: installedTab,
    }),
  );
  for (const contract of [
    'role="tablist"',
    'aria-pressed="true"',
    "plugins.installed.disable",
    "plugins.installed.failedNotice",
    "plugins.installed.enterSafeMode",
    "dsh-failing-plugin",
  ]) {
    assert.equal(
      installedMarkup.includes(contract),
      true,
      `missing rendered Plugins contract: ${contract}`,
    );
  }

  const safeModeMarkup = renderToStaticMarkup(
    createElement(PluginsView, {
      active: true,
      controller,
      t,
      tab: {
        ...installedTab,
        payload: {
          ...installedTab.payload,
          catalog: {
            plugins: [],
            safeMode: true,
            status: "ready",
          },
        },
      },
    }),
  );
  assert.equal(
    safeModeMarkup.includes("plugins.installed.safeModeActive"),
    true,
  );
  assert.equal(
    safeModeMarkup.includes("plugins.installed.exitSafeMode"),
    true,
  );

  const discoverMarkup = renderToStaticMarkup(
    createElement(PluginsView, {
      active: true,
      controller,
      t,
      tab: {
        ...installedTab,
        payload: {
          ...installedTab.payload,
          view: "discover",
        },
      },
    }),
  );
  for (const contract of [
    'role="search"',
    "plugins.browser.back",
    "plugins.browser.external",
    "plugins.browser.searchPlaceholder",
    'class="minke-plugins-browser__host"',
  ]) {
    assert.equal(
      discoverMarkup.includes(contract),
      true,
      `missing rendered discovery contract: ${contract}`,
    );
  }

  assert.match(topicCss, /\.Layout-sidebar/u);
  assert.match(topicCss, /\.col-md-6/u);
  assert.match(searchCss, /\.Layout-sidebar/u);
  assert.match(styles, /@container minke-plugins/u);
  assert.match(styles, /\.minke-plugins-switcher/u);
  assert.match(styles, /\.minke-plugins-installed__grid/u);
  assert.match(styles, /\.minke-plugins-installed__card/u);
  assert.match(styles, /\.minke-plugins-installed__uninstall/u);
  assert.match(styles, /\.minke-plugins-installed__enabled/u);
  assert.match(styles, /\.minke-plugins-installed__state/u);
  assert.equal(pluginsEn["plugins.install.action"], "Install");
  assert.match(
    pluginsEn["plugins.install.trust"],
    /trusted Host\/Client code on every launch/u,
  );
  assert.match(
    pluginsZh["plugins.install.trust"],
    /受信任的 Host\/Client 代码运行/u,
  );
  assert.equal(
    pluginsZh["plugins.view.installed"],
    "已安装",
  );
  assert.equal(
    pluginsEn["plugins.view.discover"],
    "Discover on GitHub",
  );
  assert.equal(
    pluginsZh["plugins.installed.uninstall"],
    "卸载",
  );
  assert.equal(
    pluginsZh["plugins.installed.safeMode"],
    "安全模式",
  );
  assert.match(
    pluginsZh["plugins.installed.uninstallConfirm"],
    /自动重启/u,
  );
  assert.match(
    pluginsEn["plugins.installed.uninstallSuccess"],
    /Restarting Minke/u,
  );
  assert.equal(
    pluginsEn["plugins.install.placeholder"],
    "dsh plugin --profile web add <package-or-github-repo>",
  );
  assert.equal(
    pluginsZh["plugins.browser.searchPlaceholder"],
    "搜索插件",
  );
  assert.equal(
    pluginsEn["plugins.browser.searchPlaceholder"],
    "Search plugins",
  );
  assert.doesNotMatch(
    pluginsEn["plugins.browser.searchPlaceholder"],
    /language:|stars:/u,
  );
  assert.doesNotMatch(
    pluginsEn["plugins.install.placeholder"],
    /dsh-status-rotator/u,
  );
});

test("the bottom Plugins view splits only when its panel is decisively wide", async () => {
  const [pluginStyles, panelStyles] = await Promise.all([
    readFile(
      new URL(
        "../packages/harness-overlay/src/client/tabs/plugins/styles.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../packages/harness-overlay/src/client/tabs/styles.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    panelStyles,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s*\{[^}]*container-name:\s*minke-tabs-panel;[^}]*container-type:\s*size;/su,
  );

  const wideLayout = pluginStyles.match(
    /@container minke-tabs-panel\s*\(min-width:\s*\d+px\)\s*and\s*\(min-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)\)/u,
  );
  assert.notEqual(wideLayout, null);
  assert.equal(
    Number(wideLayout?.[1]) / Number(wideLayout?.[2]) >= 1.5,
    true,
  );
  assert.equal(
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-plugins-page:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid;/su.test(
      pluginStyles,
    ),
    true,
    "opening the new-tab chooser must keep the inactive Plugins view hidden",
  );
  assert.match(
    pluginStyles,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-plugins-page:not\(\[hidden\]\)\s*\{[^}]*grid-template-areas:\s*"install switcher"\s*"install content";/su,
  );
  assert.match(
    pluginStyles,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-plugins-install\s*\{[^}]*grid-area:\s*install;/su,
  );
  assert.match(
    pluginStyles,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-plugins-switcher\s*\{[^}]*grid-area:\s*switcher;/su,
  );
  assert.match(
    pluginStyles,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-plugins-(?:installed|browser)[^{]*\{[^}]*grid-area:\s*content;/su,
  );
});
