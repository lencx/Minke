import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PLUGIN_SETTINGS_READ_CHANNEL, PLUGIN_SAFE_MODE_SET_CHANNEL,
  parsePluginManagementSettings, parsePluginSafeModeSetRequest,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";
import { bindPluginRecoveryIpc } from "@minke/desktop/main/plugin-recovery-ipc.ts";
import { clearLegacyPluginCatalogCache, legacyPluginCatalogCacheFilePath } from "@minke/desktop/main/plugin-cache.ts";
import { PluginRecoveryRuntime } from "@minke/desktop/main/plugin-recovery.ts";
import { PluginManagementRuntime } from "@minke/desktop/main/plugin-recovery/settings.ts";
import { migrateModelProfile } from "@minke/desktop/main/profile-migration.ts";
import { desktopPluginRecoveryPort } from "@minke/harness-overlay/client/desktop/workspace.ts";
import { PluginTabsController } from "@minke/harness-overlay/client/tabs/plugins/controller.ts";
import { createPluginTabRenderer } from "@minke/harness-overlay/client/tabs/plugins/renderer.tsx";
import { pluginsEn, pluginsZh } from "@minke/harness-overlay/client/tabs/plugins/locales.ts";
import { PLUGIN_DISCOVERY_TOPIC_URL } from "@minke/harness-overlay/client/tabs/plugins/resources.ts";
import { WebTabsController } from "@minke/harness-overlay/client/tabs/web/controller.ts";
import { webTabsEn } from "@minke/harness-overlay/client/tabs/web/locales.ts";
import { TabsRuntime } from "@minke/harness-overlay/client/tabs/runtime.ts";

const roots = [];
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "minke-plugin-recovery-"));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("model Profile migration preserves both user layers, comments and executable YAML without evaluating it", async () => {
  const home = await temporaryRoot();
  const dir = join(home, "profiles", "web");
  await mkdir(dir, { recursive: true });
  const before = '# saved models\n- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:\n    providers: !!js (() => { throw new Error("must not evaluate during migration") })()\n- id: unrelated\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n';
  const paths = [join(dir, "cordis.patch.yml"), join(home, "cordis.patch.yml")];
  for (const path of paths) await writeFile(path, before);
  const options = { runtimeRoot: resolve("runtime/host"), dshHome: home, electronExecutable: process.execPath };
  const { parseDocument } = createRequire(join(options.runtimeRoot, "package.json"))("yaml");
  const parse = text => parseDocument(text, { customTags: [{ tag: "tag:yaml.org,2002:js", resolve: value => value }] });
  const expected = parse(before);
  expected.setIn([0, "name"], "@lencx/minke-model-runtime/dsh");
  await migrateModelProfile(options);
  for (const path of paths) {
    const after = await readFile(path, "utf8");
    const migrated = parse(after);
    assert.deepEqual(migrated.toJSON(), expected.toJSON());
    assert.equal(migrated.getIn([0, "config", "providers"], true).tag, "tag:yaml.org,2002:js");
    assert.equal(migrated.contents.items[0].commentBefore, expected.contents.items[0].commentBefore);
    assert.equal(migrated.contents.commentBefore, expected.contents.commentBefore);
    assert.equal(migrated.commentBefore, expected.commentBefore);
    assert.equal(await readFile(path + ".before-minke-model-runtime", "utf8"), before);
    await migrateModelProfile(options);
    assert.equal(await readFile(path, "utf8"), after);
    assert.equal(await readFile(path + ".before-minke-model-runtime", "utf8"), before);
  }
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

test("recovery settings accept legacy disabled names but reject ambiguous state", () => {
  const settings = { safeMode: false, disabledPlugins: ["example", "@example/plugin"] };
  assert.deepEqual(parsePluginManagementSettings(settings), settings);
  for (const value of [null, {}, { ...settings, safeMode: "false" }, { ...settings, unknown: 1 },
    { ...settings, disabledPlugins: ["bad name"] }, { ...settings, disabledPlugins: ["x", "x"] }]) {
    assert.throws(() => parsePluginManagementSettings(value), TypeError);
  }
  assert.deepEqual(parsePluginSafeModeSetRequest({ enabled: true }), { enabled: true });
  assert.throws(() => parsePluginSafeModeSetRequest({ enabled: "yes" }), TypeError);
});

test("desktop IPC exposes recovery only and authorizes every operation", async () => {
  const handlers = new Map();
  const changes = [];
  let restarts = 0;
  const binding = bindPluginRecoveryIpc({
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: channel => handlers.delete(channel),
  }, {
    readSettings: async () => ({ safeMode: true, disabledPlugins: [] }),
    setSafeMode: async enabled => { changes.push(enabled); },
  }, event => event === "trusted", () => { restarts++; });
  assert.deepEqual([...handlers.keys()].sort(), [PLUGIN_SETTINGS_READ_CHANNEL, PLUGIN_SAFE_MODE_SET_CHANNEL].sort());
  await assert.rejects(handlers.get(PLUGIN_SETTINGS_READ_CHANNEL)("untrusted"), /unauthorized/);
  await assert.rejects(handlers.get(PLUGIN_SAFE_MODE_SET_CHANNEL)("untrusted", { enabled: false }), /unauthorized/);
  await assert.rejects(handlers.get(PLUGIN_SAFE_MODE_SET_CHANNEL)("trusted", { enabled: "yes" }), TypeError);
  assert.deepEqual(changes, []);
  assert.equal(restarts, 0);
  assert.deepEqual(await handlers.get(PLUGIN_SETTINGS_READ_CHANNEL)("trusted"), { safeMode: true, disabledPlugins: [] });
  await handlers.get(PLUGIN_SAFE_MODE_SET_CHANNEL)("trusted", { enabled: false });
  assert.deepEqual(changes, [false]);
  assert.equal(restarts, 1);
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("renderer recovery port validates settings and forwards safe mode without package operations", async () => {
  const updates = [];
  const port = desktopPluginRecoveryPort({ minkeDesktop: { pluginRecovery: {
    readSettings: async () => ({ safeMode: false, disabledPlugins: [] }),
    setSafeMode: async enabled => { updates.push(enabled); },
  } } });
  assert.equal(port.available, true);
  assert.deepEqual(await port.readSettings(), { safeMode: false, disabledPlugins: [] });
  await port.setSafeMode(true);
  assert.deepEqual(updates, [true]);
  assert.equal(port.restart, undefined);
  assert.equal(port.install, undefined);
  assert.equal(port.setEnabled, undefined);
  await assert.rejects(desktopPluginRecoveryPort({}).readSettings(), /unavailable/);
  const invalid = desktopPluginRecoveryPort({ minkeDesktop: { pluginRecovery: {
    readSettings: async () => ({ safeMode: "no", disabledPlugins: [] }),
  } } });
  await assert.rejects(invalid.readSettings(), TypeError);
});

test("plugin discovery remains browsing-only without a recovery or management bridge", () => {
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} });
  const external = [];
  const desktop = {
    available: true, embeddedWebAvailable: true, openExternal: url => external.push(url),
  };
  const web = new WebTabsController(tabs, desktop);
  const controller = new PluginTabsController(tabs, desktop, web);
  const renderer = createPluginTabRenderer(controller, key => pluginsEn[key], key => webTabsEn[key]);
  renderer.createOptions()[0].create();
  const tab = tabs.getSnapshot().tabs[0];
  assert.equal(tab.title, "Discover plugins");
  assert.equal(controller.create("Discover plugins"), tab.id);
  web.openExternal(tab.id);
  assert.deepEqual(external, [PLUGIN_DISCOVERY_TOPIC_URL]);
  const markup = renderToStaticMarkup(renderer.renderToolbarCenter(tab))
    + renderToStaticMarkup(renderer.renderTrailingActions(tab))
    + renderToStaticMarkup(renderer.renderView(tab, true));
  assert.doesNotMatch(markup, /Manage plugins/);
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /github.com\/topics\/dsh-plugin/);
  assert.doesNotMatch(markup, /minke-plugins-browser|minke-agent-browser__annotation/);
  assert.doesNotMatch(markup, /Restart in safe mode/);
  assert.doesNotMatch(markup, /dsh plugin --profile|minke-plugins-installed/);
  assert.deepEqual(Object.keys(pluginsEn).sort(), Object.keys(pluginsZh).sort());
  controller.dispose();
  assert.equal(controller.create("Discover plugins"), undefined);
  assert.deepEqual(external, [PLUGIN_DISCOVERY_TOPIC_URL]);
  web.dispose();
  tabs.dispose();
});

test("migration failure keeps disabled names and serialized recovery changes", async () => {
  let settings = { safeMode: false, disabledPlugins: ["extra"] };
  const runtime = new PluginManagementRuntime({ read: async () => settings, write: async next => { settings = next; } });
  let release;
  const failure = runtime.migrateDisabled(() => new Promise((_, reject) => { release = reject; }));
  const safeMode = runtime.setSafeMode(true);
  await new Promise(resolve => setImmediate(resolve));
  release(new Error("profile is locked"));
  await assert.rejects(failure, /profile is locked/);
  await safeMode;
  assert.deepEqual(settings, { safeMode: true, disabledPlugins: ["extra"] });
  await runtime.migrateDisabled(async names => { assert.deepEqual(names, ["extra"]); });
  assert.deepEqual(settings, { safeMode: true, disabledPlugins: [] });
  let retried = false;
  await runtime.migrateDisabled(async () => { retried = true; });
  assert.equal(retried, false);
});

test("legacy disabled bundles migrate into DSH and stay installed through native live toggles", async t => {
  const runtimeRoot = resolve("runtime/host");
  const require = createRequire(join(runtimeRoot, "package.json"));
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const { boot, initProfile, readProfileManifest, readProfilePatches } = await load("@deepseek-ai/dsh-app-boot");
  const { default: PluginManager } = await load("@deepseek-ai/dsh-plugin-manager");
  const { default: Hmr } = await load("@deepseek-ai/dsh-hmr");
  const { default: Timer } = await load("@deepseek-ai/cordis-plugin-timer");
  const home = await temporaryRoot();
  const dir = join(home, "profiles", "web");
  const anchor = join(home, "package.json");
  await writeFile(anchor, '{"name":"installation","dependencies":{}}');
  initProfile(dir, ["core", "extra"]);
  for (const [name, rows] of [["core", [{ id: "manager", name: "cordis:manager" }]], ["extra", [{ id: "managed", name: "./plugin.mjs" }]]]) {
    const path = join(dir, "node_modules", name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name, version: "1.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } }));
    await writeFile(join(path, "cordis.patch.yml"), JSON.stringify([{ insert: rows }]));
    await writeFile(join(path, "plugin.mjs"), 'export function apply(ctx) { ctx.provide("managedProbe", true) }');
  }
  const manifest = readProfileManifest("dsh", dir);
  manifest.dependencies = { extra: "1.0.0" };
  manifest.description = "preserve unrelated metadata";
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "cordis.yml"), "[]");
  let settings = { safeMode: false, disabledPlugins: ["extra"] };
  const migration = new PluginRecoveryRuntime({ runtimeRoot, dshHome: home, electronExecutable: process.execPath,
    settings: { read: async () => settings, write: async next => { settings = next; } },
  });
  await migration.migrateLegacyProfile();
  assert.deepEqual(settings.disabledPlugins, []);
  const migrated = readProfileManifest("dsh", dir);
  assert.deepEqual(migrated.dsh.profile.bundles, ["core"]);
  assert.deepEqual(migrated.dependencies, { extra: "1.0.0" });
  assert.equal(migrated.description, manifest.description);
  const profile = { name: "web", dir, patchPath: join(dir, "cordis.patch.yml"), installAnchor: anchor, cwd: home, home,
    startedBundles: ["core"], overlays: [], telemetryDisabledEnv: undefined };
  const ctx = await boot("dsh", join(dir, "cordis.yml"), readProfilePatches("dsh", profile), ctx => {
    ctx.provide("appReady", { onReady: listener => { listener(); return () => {}; } });
    ctx.provide("profileContext", profile);
    ctx.loader.builtins.manager = PluginManager;
  });
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Timer);
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 });
  await ctx.hmr.runExclusive(async () => {});
  const bundle = async () => (await ctx.pluginManager.listBundles()).find(row => row.name === "extra");
  assert.equal((await bundle()).installed, true);
  assert.equal((await bundle()).enabled, false);
  for (const enabled of [true, false, true]) {
    const result = await ctx.pluginManager.setBundleEnabled("extra", enabled);
    assert.equal(result.application, "applied");
    assert.equal((await bundle()).enabled, enabled);
    assert.equal((await bundle()).installed, true, "disabled bundles must remain visible and installed");
    assert.equal(ctx.get("managedProbe") === true, enabled, "native changes take effect in the running Loader");
  }
  // Once migrated, an old Minke setting must never override subsequent native choices.
  await migration.migrateLegacyProfile();
  assert.ok(readProfileManifest("dsh", dir).dsh.profile.bundles.includes("extra"));
});
