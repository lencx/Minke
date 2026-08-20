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
import {
  PLUGIN_INSTALLED_READ_CHANNEL,
  PLUGIN_INSTALL_CHANNEL,
  parseInstalledPluginsSnapshot,
  parsePluginInstallCommand,
  parsePluginInstallRequest,
  parsePluginInstallTarget,
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
  pluginsEn,
  pluginsZh,
} from "@minke/harness-overlay/client/tabs/plugins/locales.ts";
import {
  PLUGIN_DISCOVERY_TOPIC_URL,
  createPluginSearchUrl,
  readPluginSearchQuery,
} from "@minke/harness-overlay/client/tabs/plugins/resources.ts";
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

test("installed plugin snapshots accept only bounded display metadata", () => {
  assert.deepEqual(
    parseInstalledPluginsSnapshot({
      plugins: [
        {
          name: "@minke/example-plugin",
          requested: "^1.2.0",
          version: "1.2.3",
          description: "A web profile plugin.",
          repositoryUrl:
            "https://github.com/minke/example-plugin",
          state: "ready",
        },
        {
          name: "missing-plugin",
          requested: "github:minke/missing-plugin",
          state: "missing",
        },
      ],
    }),
    {
      plugins: [
        {
          name: "@minke/example-plugin",
          requested: "^1.2.0",
          version: "1.2.3",
          description: "A web profile plugin.",
          repositoryUrl:
            "https://github.com/minke/example-plugin",
          state: "ready",
        },
        {
          name: "missing-plugin",
          requested: "github:minke/missing-plugin",
          state: "missing",
        },
      ],
    },
  );

  for (const invalid of [
    { plugins: "not-an-array" },
    {
      plugins: [{
        name: "../escape",
        requested: "^1.0.0",
        state: "ready",
      }],
    },
    {
      plugins: [{
        name: "example-plugin",
        requested: "^1.0.0",
        repositoryUrl:
          "https://token@github.com/minke/example-plugin",
        state: "ready",
      }],
    },
    {
      plugins: [{
        name: "example-plugin",
        requested: "^1.0.0",
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
      PATH: "/usr/bin",
      DSH_ELECTRON_EXECUTABLE: "ambient-electron",
      DSH_PNPM_ENTRY: "ambient-pnpm",
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
  await assert.rejects(
    installation.install("file:../plugin"),
    /invalid plugin install target/u,
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
  const installation = new PluginInstallationRuntime({
    runtimeRoot: join(root, "runtime"),
    dshHome,
    electronExecutable: join(root, "Minke"),
  });

  assert.deepEqual(await installation.listInstalled(), {
    plugins: [
      {
        name: "@minke/example-plugin",
        requested: "^1.2.0",
        version: "1.2.3",
        description: "A web profile plugin.",
        repositoryUrl:
          "https://github.com/minke/example-plugin",
        state: "ready",
      },
      {
        name: "missing-plugin",
        requested: "github:minke/missing-plugin",
        state: "missing",
      },
    ],
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
  });
});

test("the desktop IPC binding authorizes and parses install commands", async () => {
  const handlers = new Map();
  const installs = [];
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
      async listInstalled() {
        return {
          plugins: [{
            name: "example-plugin",
            requested: "^1.0.0",
            state: "ready",
          }],
        };
      },
    },
    (event) => event === "trusted",
  );
  const handler = handlers.get(PLUGIN_INSTALL_CHANNEL);
  const readHandler = handlers.get(
    PLUGIN_INSTALLED_READ_CHANNEL,
  );
  assert.equal(typeof handler, "function");
  assert.equal(typeof readHandler, "function");

  await handler("trusted", {
    command:
      "dsh plugin --profile web add dsh-status-rotator",
  });
  assert.deepEqual(installs, ["dsh-status-rotator"]);
  await assert.rejects(
    handler("untrusted", {
      command:
        "dsh plugin --profile web add another-plugin",
    }),
    /unauthorized/u,
  );
  assert.deepEqual(installs, ["dsh-status-rotator"]);
  assert.deepEqual(await readHandler("trusted"), {
    plugins: [{
      name: "example-plugin",
      requested: "^1.0.0",
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
  const port = desktopPluginInstallerPort({
    minkeDesktop: {
      pluginInstaller: {
        async install(command) {
          commands.push(command);
        },
        async readInstalled() {
          return {
            plugins: [{
              name: "example-plugin",
              requested: "^1.0.0",
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
  assert.deepEqual(await port.readInstalled(), {
    plugins: [{
      name: "example-plugin",
      requested: "^1.0.0",
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
});

test("the Plugins tab reports command installation outcomes", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const commands = [];
  let installedReads = 0;
  const externalUrls = [];
  const controller = new PluginTabsController(tabs, {
    available: true,
    async install(command) {
      commands.push(command);
    },
    async readInstalled() {
      installedReads += 1;
      return {
        plugins: [{
          name: "example-plugin",
          requested: "^1.0.0",
          version: "1.0.0",
          state: "ready",
        }],
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
    tabs.getSnapshot().tabs[0].payload.installedPlugins,
    [{
      name: "example-plugin",
      requested: "^1.0.0",
      version: "1.0.0",
      state: "ready",
    }],
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
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.installing,
    false,
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.attemptedCommand,
    "dsh plugin --profile web add dsh-status-rotator",
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.installedCommand,
    "dsh plugin --profile web add dsh-status-rotator",
  );
  assert.equal(
    tabs.getSnapshot().tabs[0].payload.view,
    "installed",
  );
  assert.equal(installedReads >= 2, true);

  await controller.install(tabId, "echo unsafe");
  assert.equal(commands.length, 1);
  assert.match(
    tabs.getSnapshot().tabs[0].payload.error,
    /plugin install command/u,
  );
  controller.openExternal(
    "https://github.com/topics/dsh-plugin",
  );
  controller.openExternal("javascript:alert(1)");
  assert.deepEqual(externalUrls, [
    "https://github.com/topics/dsh-plugin",
  ]);
  controller.dispose();
  tabs.dispose();
});

test("the Plugins view switches between installed cards and GitHub discovery", async () => {
  const [
    viewSource,
    topicCss,
    searchCss,
    styles,
    rendererSource,
  ] =
    await Promise.all([
      readFile(
        new URL(
          "../packages/harness-overlay/src/client/tabs/plugins/PluginsView.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
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
      readFile(
        new URL(
          "../packages/harness-overlay/src/client/tabs/plugins/renderer.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.equal(
    PLUGIN_DISCOVERY_TOPIC_URL,
    "https://github.com/topics/dsh-plugin",
  );
  assert.match(
    viewSource,
    /createElement\(\s*"webview"/u,
  );
  assert.match(viewSource, /role="tablist"/u);
  assert.match(viewSource, /plugins\.view\.installed/u);
  assert.match(viewSource, /plugins\.view\.discover/u);
  assert.match(viewSource, /installedPlugins\.map/u);
  assert.match(viewSource, /InstalledPluginCard/u);
  assert.match(viewSource, /controller\.setView/u);
  assert.match(viewSource, /controller\.refreshInstalled/u);
  assert.match(
    viewSource,
    /tab\.payload\.view !== "discover"/u,
  );
  assert.match(viewSource, /TABS_WEB_PARTITION/u);
  assert.match(viewSource, /nodeIntegration=no/u);
  assert.match(viewSource, /sandbox=yes/u);
  assert.match(viewSource, /insertCSS\(source\)/u);
  assert.match(viewSource, /githubTopicCss/u);
  assert.match(viewSource, /githubSearchCss/u);
  assert.match(viewSource, /createPluginSearchUrl/u);
  assert.match(viewSource, /role="search"/u);
  assert.match(viewSource, /parsePluginInstallCommand/u);
  assert.match(viewSource, /plugins\.browser\.back/u);
  assert.match(viewSource, /plugins\.browser\.external/u);
  assert.match(viewSource, /controller\.openExternal/u);
  assert.doesNotMatch(viewSource, /target="_blank"/u);
  assert.match(topicCss, /\.Layout-sidebar/u);
  assert.match(topicCss, /\.col-md-6/u);
  assert.match(searchCss, /\.Layout-sidebar/u);
  assert.match(styles, /@container minke-plugins/u);
  assert.match(styles, /\.minke-plugins-switcher/u);
  assert.match(styles, /\.minke-plugins-installed__grid/u);
  assert.match(styles, /\.minke-plugins-installed__card/u);
  assert.match(styles, /\.minke-plugins-installed__state/u);
  assert.doesNotMatch(
    `${viewSource}\n${rendererSource}`,
    /catalog\.refresh|cancelRefresh|GitHub Token|minke-plugins-card/u,
  );
  assert.equal(pluginsEn["plugins.install.action"], "Install");
  assert.equal(
    pluginsZh["plugins.view.installed"],
    "已安装",
  );
  assert.equal(
    pluginsEn["plugins.view.discover"],
    "Discover on GitHub",
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
