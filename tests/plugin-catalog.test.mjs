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
  PLUGIN_INSTALL_CHANNEL,
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
    },
    (event) => event === "trusted",
  );
  const handler = handlers.get(PLUGIN_INSTALL_CHANNEL);
  assert.equal(typeof handler, "function");

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

  binding.dispose();
  assert.equal(handlers.has(PLUGIN_INSTALL_CHANNEL), false);
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

test("the renderer port exposes only command installation", async () => {
  const commands = [];
  const port = desktopPluginInstallerPort({
    minkeDesktop: {
      pluginInstaller: {
        async install(command) {
          commands.push(command);
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

  const unavailable = desktopPluginInstallerPort({});
  assert.equal(unavailable.available, false);
  await assert.rejects(
    unavailable.install(
      "dsh plugin --profile web add dsh-status-rotator",
    ),
    /bridge is unavailable/u,
  );
});

test("the Plugins tab reports command installation outcomes", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const commands = [];
  const externalUrls = [];
  const controller = new PluginTabsController(tabs, {
    available: true,
    async install(command) {
      commands.push(command);
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

  await controller.install(
    tabId,
    " dsh  plugin --profile web add dsh-status-rotator ",
  );
  assert.deepEqual(commands, [
    "dsh plugin --profile web add dsh-status-rotator",
  ]);
  assert.deepEqual(tabs.getSnapshot().tabs[0].payload, {
    installing: false,
    attemptedCommand:
      "dsh plugin --profile web add dsh-status-rotator",
    installedCommand:
      "dsh plugin --profile web add dsh-status-rotator",
  });

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

test("the Plugins view embeds a sandboxed, compact GitHub topic browser", async () => {
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
  assert.doesNotMatch(
    `${viewSource}\n${rendererSource}`,
    /catalog\.refresh|cancelRefresh|GitHub Token|minke-plugins-card/u,
  );
  assert.equal(pluginsEn["plugins.install.action"], "Install");
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
