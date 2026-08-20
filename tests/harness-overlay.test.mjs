import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  aboutMetadata,
  aboutTagline,
  DEEPSEEK_HARNESS_URL,
  MINKE_PROJECT_URL,
  platformLabel,
} from "@minke/harness-overlay/client/about/model.ts";
import {
  en as aboutEn,
  zh as aboutZh,
} from "@minke/harness-overlay/client/about/locales.ts";
import {
  desktopAboutInfo,
} from "@minke/harness-overlay/client/desktop/index.ts";
import {
  installShortcutNavigationIcon,
  reconcileShortcutNavigationIcon,
  SHORTCUT_STYLES,
} from "@minke/harness-overlay/client/shortcuts/styles.ts";

const manifest = JSON.parse(
  readFileSync(
    new URL("../packages/harness-overlay/package.json", import.meta.url),
    "utf8",
  ),
);
const pluginCatalogManifest = JSON.parse(
  readFileSync(
    new URL("../packages/plugin-catalog/package.json", import.meta.url),
    "utf8",
  ),
);
const remoteAccessManifest = JSON.parse(
  readFileSync(
    new URL("../packages/remote-access/package.json", import.meta.url),
    "utf8",
  ),
);
const modelRuntimeManifest = JSON.parse(
  readFileSync(
    new URL("../packages/model-runtime/package.json", import.meta.url),
    "utf8",
  ),
);
const contract = JSON.parse(
  readFileSync(
    new URL("../config/harness-runtime.json", import.meta.url),
    "utf8",
  ),
);
const patch = readFileSync(
  new URL("../packages/harness-overlay/cordis.patch.yml", import.meta.url),
  "utf8",
);
const bundle = readFileSync(
  new URL("../packages/harness-overlay/lib/client.js", import.meta.url),
  "utf8",
);
const modelRuntimeBundle = readFileSync(
  new URL(
    "../packages/model-runtime/lib/dsh.js",
    import.meta.url,
  ),
  "utf8",
);
const clientSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/index.tsx",
    import.meta.url,
  ),
  "utf8",
);
const aboutInstallSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/about/install.tsx",
    import.meta.url,
  ),
  "utf8",
);
const dataHomeInstallSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/data-home/install.tsx",
    import.meta.url,
  ),
  "utf8",
);
const onboardingInstallSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/onboarding/install.tsx",
    import.meta.url,
  ),
  "utf8",
);
const shortcutInstallSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/shortcuts/install.tsx",
    import.meta.url,
  ),
  "utf8",
);
const tabsInstallSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/tabs/install.tsx",
    import.meta.url,
  ),
  "utf8",
);
const shortcutStylesSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/shortcuts/styles.ts",
    import.meta.url,
  ),
  "utf8",
);
const aboutStylesSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/about/styles.css",
    import.meta.url,
  ),
  "utf8",
);
const aboutViewSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/about/view.tsx",
    import.meta.url,
  ),
  "utf8",
);
const dataHomeStylesSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/data-home/styles.css",
    import.meta.url,
  ),
  "utf8",
);
const productBuildSource = readFileSync(
  new URL(
    "../scripts/harness/build-product-packages.mjs",
    import.meta.url,
  ),
  "utf8",
);
const tabsCoreSource = [
  "index.ts",
  "locales.ts",
  "styles.ts",
  "types.ts",
].map((name) =>
  readFileSync(
    new URL(
      `../packages/harness-overlay/src/client/tabs/${name}`,
      import.meta.url,
    ),
    "utf8",
  ),
).join("\n");

test("the client entry stays a composition root", () => {
  for (const installer of [
    "installDesktopClient",
    "installAbout",
    "installDataHome",
    "installLocalModel",
    "installRemote",
    "installTabs",
    "installShortcuts",
    "installOnboarding",
  ]) {
    assert.match(clientSource, new RegExp(`${installer}\\(ctx`, "u"));
  }
  assert.doesNotMatch(
    clientSource,
    /ctx\.slots\.(?:inject|register)|new (?:ShortcutRuntime|TabsRuntime)|runtime\.register/u,
  );
});

test("product capability packages follow the shared naming convention", () => {
  assert.equal(manifest.name, "@lencx/minke-harness-overlay");
  assert.equal(
    pluginCatalogManifest.name,
    "@lencx/minke-plugin-catalog",
  );
  assert.equal(
    remoteAccessManifest.name,
    "@lencx/minke-remote-access",
  );
  assert.equal(
    modelRuntimeManifest.name,
    "@lencx/minke-model-runtime",
  );
  assert.equal(
    contract.productBundle.packageName,
    "@lencx/minke-harness-overlay",
  );
  assert.match(patch, /name: '@lencx\/minke-harness-overlay'/u);
  assert.doesNotMatch(
    `${JSON.stringify(manifest)}\n${JSON.stringify(contract)}\n${patch}`,
    /@minke\//u,
  );
  assert.ok(
    manifest.dsh.client.inject.includes(
      "@deepseek-ai/dsh-client-ui-theme",
    ),
  );
  assert.ok(
    manifest.dsh.client.inject.includes(
      "@deepseek-ai/dsh-client-ui-layout",
    ),
  );
  assert.ok(
    manifest.dsh.client.inject.includes(
      "@deepseek-ai/dsh-client-ui-sidebar",
    ),
  );
  assert.equal(manifest.exports["./model-runtime"], undefined);
  assert.equal(
    modelRuntimeManifest.exports["./dsh"].default,
    "./lib/dsh.js",
  );
  assert.equal(
    manifest.dependencies["@lencx/minke-model-runtime"],
    "workspace:*",
  );
  assert.equal(
    manifest.dependencies["@lencx/minke-remote-access"],
    "workspace:*",
  );
  assert.deepEqual(
    contract.productBundle.workspaceRuntimePackages,
    [
      {
        packageName: "@lencx/minke-model-runtime",
        packagePath: "packages/model-runtime",
      },
    ],
  );
  assert.deepEqual(contract.productBundle.runtimePackages, []);
  assert.match(
    manifest.devDependencies?.["@lucide/icons"] ?? "",
    /^\d+\.\d+\.\d+$/u,
  );
  assert.equal(
    manifest.devDependencies?.["@iconify-json/vscode-icons"],
    "1.2.73",
  );
  assert.equal(manifest.devDependencies?.shiki, "4.4.3");
  assert.equal(manifest.devDependencies?.codemirror, "6.0.2");
  assert.equal(
    manifest.devDependencies?.["@codemirror/state"],
    "6.7.1",
  );
  assert.equal(
    manifest.devDependencies?.["@codemirror/view"],
    "6.43.9",
  );
});

test("the product overlay leaves product subagents on demand and composes the model runtime", () => {
  assert.doesNotMatch(
    patch,
    /@deepseek-ai\/dsh-subagent-(?:codex|claude-code)/u,
  );
  assert.doesNotMatch(
    patch,
    /toolName: subagent_(?:codex|claude_code)/u,
  );
  assert.match(
    patch,
    /id: llm-pi-ai[\s\S]*disabled: true/u,
  );
  assert.match(
    patch,
    /id: model-runtime[\s\S]*name: '@lencx\/minke-model-runtime\/dsh'[\s\S]*enabled: true[\s\S]*lifecycle: !!js "process\.env\.MINKE_LM_STUDIO_ENABLED === '1' && process\.env\.MINKE_LM_STUDIO_COMMAND \? 'ensure-running' : 'external'"[\s\S]*command: !!js process\.env\.MINKE_LM_STUDIO_COMMAND/u,
  );
  assert.match(
    patch,
    /ollama:[\s\S]*enabled: true[\s\S]*lifecycle: !!js "process\.env\.MINKE_OLLAMA_ENABLED === '1' && process\.env\.MINKE_OLLAMA_COMMAND \? 'ensure-running' : 'external'"[\s\S]*command: !!js process\.env\.MINKE_OLLAMA_COMMAND/u,
  );
  assert.doesNotMatch(
    patch,
    /lmStudio:[\s\S]*lifecycle: ensure-running/u,
  );
  assert.doesNotMatch(
    patch,
    /MINKE_LM_STUDIO_PROVIDERS|MINKE_LM_STUDIO_API_KEY/u,
  );
});

test("the model runtime uses DSH services and keeps local secrets out of profiles", () => {
  const exposedSettingsRegistration =
    /installSettingsSection|settings\.register/u;
  assert.match(
    "installSettingsSection(ctx, namespace, Config, config, hooks)",
    exposedSettingsRegistration,
  );
  assert.match(
    modelRuntimeBundle,
    /@deepseek-ai\/dsh-llm-pi-ai/u,
  );
  assert.match(modelRuntimeBundle, /ctx\.subprocess/u);
  assert.match(modelRuntimeBundle, /ctx\.credentials\.resolve/u);
  assert.match(modelRuntimeBundle, /ensure-running/u);
  assert.match(modelRuntimeBundle, /openAICompatible/u);
  assert.match(modelRuntimeBundle, /\/api\/v1\/models/u);
  assert.match(modelRuntimeBundle, /ctx\.on\(\s*"llm\/stream"/u);
  assert.match(modelRuntimeBundle, /LM_STUDIO_CONTEXT_TOO_SMALL/u);
  assert.doesNotMatch(
    modelRuntimeBundle,
    /node:child_process|execFile|spawnSync|settings\.(?:update|mutate)/u,
  );
  assert.doesNotMatch(
    modelRuntimeBundle,
    exposedSettingsRegistration,
    "desktop-owned model settings must not become browser-exposed Harness settings",
  );
});

test("the built client half is a Harness module-loader bundle", () => {
  assert.match(
    bundle,
    /^window\.__ModuleLoader__\.load\(\{ id: "@lencx\/minke-harness-overlay"/u,
  );
  assert.match(bundle, /settings\.open/u);
  assert.match(bundle, /session\.new/u);
  assert.match(bundle, /theme\/change/u);
  assert.match(bundle, /locale\/change/u);
  assert.match(bundle, /minke-overlay: macOS desktop surface/u);
  assert.match(bundle, /data-dsh-desktop-new-session/u);
  assert.match(bundle, /minke-overlay: shortcut navigation icon/u);
  assert.match(bundle, /data-minke-shortcuts-nav/u);
  assert.doesNotMatch(bundle, /IconKeyboardOutline16/u);
  assert.match(
    bundle,
    /minke-overlay: \$\{placement\} tabs runtime/u,
  );
  assert.match(
    bundle,
    /minke-overlay: \$\{placement\} Files tab renderer/u,
  );
  assert.match(bundle, /minke-files-row/u);
  assert.match(bundle, /minke-files-tree/u);
  assert.match(bundle, /minke-files-preview/u);
  assert.match(bundle, /minke-files-preview-resize/u);
  assert.match(
    bundle,
    /["']data-highlighter["']:\s*["']shiki["']/u,
  );
  assert.match(bundle, /github-dark-default/u);
  assert.match(bundle, /data-editor/u);
  assert.match(bundle, /codemirror/u);
  assert.match(bundle, /minke-vscode-file-icon/u);
  assert.match(bundle, /file-type-rust/u);
  assert.match(
    bundle,
    /minke-overlay: \$\{placement\} Terminal tab renderer/u,
  );
  assert.match(bundle, /minke-overlay: Terminal settings runtime/u);
  assert.match(bundle, /minke-overlay: data-home runtime/u);
  assert.match(bundle, /data-minke-data-home-nav/u);
  assert.match(bundle, /data-minke-data-home/u);
  assert.match(bundle, /minke-data-home__plan/u);
  assert.match(bundle, /minke-data-home-mode/u);
  assert.match(bundle, /Use as a fresh directory/u);
  assert.match(bundle, /Check fresh directory/u);
  assert.match(bundle, /minke-overlay: local model settings runtime/u);
  assert.match(bundle, /data-minke-local-model-settings/u);
  assert.match(bundle, /lm-studio/u);
  assert.match(bundle, /ollama/u);
  assert.match(
    bundle,
    /setAttribute\(["']role["'],\s*["']switch["']\)/u,
  );
  assert.match(bundle, /minke-terminal/u);
  assert.match(
    bundle,
    /minke-overlay: \$\{placement\} Web tab renderer/u,
  );
  assert.match(bundle, /minke-overlay: Web link tabs/u);
  assert.match(bundle, /minke-overlay: session header action styles/u);
  assert.match(bundle, /minke-tabs-toggle/u);
  assert.match(bundle, /minkeDesktop\?\.sessionLogs/u);
  assert.match(bundle, /data-minke-session-log-action/u);
  assert.match(bundle, /conversation\.session\.header\.utilities/u);
  assert.match(bundle, /minke-tabs-panel/u);
  assert.match(bundle, /sidebar\.footer\.action/u);
  assert.match(bundle, /data-minke-about-trigger/u);
  assert.match(bundle, /data-minke-about-dialog/u);
  assert.match(bundle, /data:image\/png;base64/u);
  assert.doesNotMatch(bundle, /require\(["']@deepseek-ai\//u);
});

test("About uses the public sidebar action and packaged desktop metadata", () => {
  assert.match(
    aboutInstallSource,
    /ctx\.slots\.inject\("sidebar\.footer\.action"[\s\S]*name:\s*"sidebar\.footer\.action"[\s\S]*id:\s*"minke-about"[\s\S]*order:\s*100/u,
  );
  assert.match(aboutInstallSource, /desktopAboutInfo\(\)/u);
  assert.match(aboutInstallSource, /installAboutStyles\(\)/u);
  assert.match(
    productBuildSource,
    /loader:\s*\{[\s\S]*"\.png":\s*"dataurl"/u,
  );

  const info = desktopAboutInfo({
    minkeDesktop: {
      about: {
        productName: "Minke",
        version: "0.1.0",
        platform: "darwin",
        arch: "arm64",
      },
    },
  });
  assert.deepEqual(info, {
    available: true,
    productName: "Minke",
    version: "0.1.0",
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(platformLabel(info.platform), "macOS");

  const t = (key, params) =>
    aboutZh[key].replace(/\{(\w+)\}/gu, (match, name) =>
      params !== undefined && Object.hasOwn(params, name)
        ? String(params[name])
        : match,
    );
  assert.equal(
    aboutMetadata(info, t),
    "版本 0.1.0 · macOS · arm64",
  );
  assert.deepEqual(aboutTagline(t), [
    "为 ",
    " 打造的原生桌面工作空间",
  ]);
  assert.match(aboutViewSource, /data-minke-about-dialog/u);
  assert.match(aboutViewSource, /role="dialog"/u);
  assert.match(aboutViewSource, /aria-modal="true"/u);
  assert.match(aboutViewSource, /aria-label=\{info\.productName\}/u);
  assert.match(aboutViewSource, /aria-describedby=/u);
  assert.match(aboutViewSource, /event\.key === "Escape"/u);
  assert.match(aboutViewSource, /event\.key !== "Tab"/u);
  assert.match(aboutViewSource, /triggerRef\.current\?\.focus\(\)/u);
  assert.match(aboutViewSource, /t\("iconAlt"\)/u);
  assert.match(aboutViewSource, /t\("community"\)/u);
  assert.match(aboutViewSource, /t\("project"\)/u);
  assert.match(aboutViewSource, /t\("harness"\)/u);
  assert.match(aboutViewSource, /function GitHubMark/u);
  assert.doesNotMatch(
    aboutViewSource,
    /minke-about__description|minke-about__title|t\("description"\)/u,
  );
  assert.match(
    aboutViewSource,
    /minke-about__copy[\s\S]*minke-about__actions[\s\S]*minke-about__community/u,
  );
  assert.doesNotMatch(
    aboutViewSource,
    /icon=\{ExternalLink\}|t\("license"\)/u,
  );

  assert.equal(aboutEn.trigger, "About Minke");
  assert.equal(aboutZh.trigger, "关于 Minke");
  assert.equal(
    aboutEn.tagline,
    "A native desktop workspace for {harness}",
  );
  assert.equal(
    aboutZh.tagline,
    "为 {harness} 打造的原生桌面工作空间",
  );
  assert.equal(aboutEn.project, "Minke");
  assert.equal(aboutZh.project, "Minke");
  assert.equal(Object.hasOwn(aboutEn, "title"), false);
  assert.equal(Object.hasOwn(aboutZh, "title"), false);
  assert.equal(Object.hasOwn(aboutEn, "description"), false);
  assert.equal(Object.hasOwn(aboutZh, "description"), false);
  assert.equal(Object.hasOwn(aboutEn, "license"), false);
  assert.equal(Object.hasOwn(aboutZh, "license"), false);
  assert.deepEqual(
    [MINKE_PROJECT_URL, DEEPSEEK_HARNESS_URL],
    [
      "https://github.com/lencx/Minke",
      "https://github.com/deepseek-ai/deepseek-harness",
    ],
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about\s*\{[\s\S]*justify-content:\s*flex-end/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about__trigger:focus-visible[\s\S]*outline:/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about__actions\s*\{[\s\S]*justify-content:\s*center[\s\S]*margin:\s*0/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about\[data-wide="true"\]\s*\{[\s\S]*position:\s*absolute[\s\S]*bottom:\s*7px/u,
  );
  assert.match(
    aboutStylesSource,
    /\[data-slot="sidebar\.settings"\]\)\s*\{[\s\S]*padding-right:\s*40px/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about__action\s*\{[\s\S]*height:\s*38px[\s\S]*box-sizing:\s*border-box/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about__tagline\s*\{[\s\S]*max-width:\s*100%[\s\S]*text-wrap:\s*balance/u,
  );
  assert.doesNotMatch(
    aboutStylesSource,
    /\.minke-about__(?:description|title)/u,
  );
  assert.match(
    aboutStylesSource,
    /\.minke-about__community\s*\{[\s\S]*padding-top:\s*14px[\s\S]*border-top:\s*1px solid var\(--dsw-alias-border-l2\)[\s\S]*font-size:\s*11px[\s\S]*text-align:\s*center/u,
  );
  assert.match(
    aboutStylesSource,
    /@media \(prefers-reduced-motion:\s*reduce\)/u,
  );
});

test("About stays hidden when desktop metadata is unavailable", () => {
  assert.deepEqual(desktopAboutInfo({}), {
    available: false,
    productName: "Minke",
    version: "",
    platform: "",
    arch: "",
  });
  assert.deepEqual(
    desktopAboutInfo({
      minkeDesktop: {
        about: {
          productName: "Minke",
          version: "",
          platform: "darwin",
          arch: "arm64",
        },
      },
    }),
    {
      available: false,
      productName: "Minke",
      version: "",
      platform: "",
      arch: "",
    },
  );
});

test("Tabs stays generic while content types register as adapters", () => {
  assert.match(
    tabsInstallSource,
    /new TabsRuntime\([\s\S]*new TabRendererRegistry\(\)[\s\S]*new WebTabsController[\s\S]*new FilesTabsController[\s\S]*new TerminalTabsController/u,
  );
  assert.match(
    tabsInstallSource,
    /createFilesTabRenderer\(filesTabs,\s*filesT\)/u,
  );
  assert.match(
    tabsInstallSource,
    /installConversationFileRouter\(\s*ctx\.workspaces,\s*rightFilesTabs,/u,
  );
  assert.match(
    tabsInstallSource,
    /createTerminalTabRenderer\(\s*terminalTabs,\s*terminalSettings,\s*terminalT,\s*\)/u,
  );
  assert.match(
    tabsInstallSource,
    /createWebTabRenderer\(webTabs,\s*webT\)/u,
  );
  assert.match(
    tabsInstallSource,
    /name:\s*"shell\.overlay"[\s\S]*id:\s*"minke-tabs-right"[\s\S]*id:\s*"minke-tabs-bottom"/u,
  );
  assert.match(
    tabsInstallSource,
    /name:\s*"shell\.overlay"[\s\S]*?id:\s*"minke-tabs-toggle"[\s\S]*?TabsHeaderAction as ComponentType<never>/u,
  );
  assert.doesNotMatch(
    tabsInstallSource,
    /id:\s*"minke-tabs-new-session-toggle"/u,
  );
  assert.doesNotMatch(tabsInstallSource, /ResourceTabs|resource-tabs/u);
  assert.doesNotMatch(
    tabsCoreSource,
    /from\s+["']\.\/(?:terminal|web)\//u,
  );
  assert.match(tabsInstallSource, /installTerminalTabStyles\(\)/u);
  assert.match(tabsInstallSource, /installFilesTabStyles\(\)/u);
  assert.match(tabsInstallSource, /installWebTabStyles\(\)/u);
  assert.match(tabsInstallSource, /FILES_TABS_NAMESPACE/u);
  assert.match(tabsInstallSource, /TERMINAL_TABS_NAMESPACE/u);
  assert.match(tabsInstallSource, /WEB_TABS_NAMESPACE/u);
});

test("Terminal settings register as a separate settings section", () => {
  assert.match(
    tabsInstallSource,
    /name:\s*"settings\.section"[\s\S]*id:\s*"minke-terminal"[\s\S]*order:\s*6[\s\S]*TerminalSettingsSection as ComponentType<never>/u,
  );
  assert.match(tabsInstallSource, /new TerminalSettingsRuntime/u);
  assert.match(tabsInstallSource, /installTerminalSettingsStyles\(\)/u);
  assert.match(
    tabsInstallSource,
    /createTerminalTabRenderer\(\s*terminalTabs,\s*terminalSettings,/u,
  );
});

test("Data Home settings remain registered across preload capability upgrades", () => {
  assert.match(
    dataHomeInstallSource,
    /const dataHomePort = desktopDataHomeSettingsPort\(\);\s*if \(!shouldExposeDesktopDataHomeSettings\(\)\) return;[\s\S]*id:\s*"minke-data-home"[\s\S]*DataHomeSettingsSection as ComponentType<never>/u,
  );
  assert.doesNotMatch(
    dataHomeInstallSource,
    /if \(dataHomePort\.available\) \{[\s\S]*id:\s*"minke-data-home"/u,
  );
});

test("Data Home primary action keeps readable colors on hover", () => {
  assert.match(
    dataHomeStylesSource,
    /\.minke-data-home__button--primary:hover:not\(:disabled\) \{[\s\S]*background:\s*var\(--dsw-alias-button-primary-hover\);[\s\S]*color:\s*var\(--dsw-alias-label-primary-foreground\);[\s\S]*\}/u,
  );
});

test("desktop Session export shadows the upstream Web action and modal", () => {
  assert.match(
    tabsInstallSource,
    /name:\s*"conversation\.session\.header\.utilities"[\s\S]*id:\s*"session-log-download"[\s\S]*priority:\s*-100/u,
  );
  assert.match(
    tabsInstallSource,
    /SessionLogHeaderAction as ComponentType<never>/u,
  );
  assert.match(
    tabsInstallSource,
    /sessionLogsPort\.export\(sessionId\)/u,
  );
  assert.doesNotMatch(bundle, /data-minke-session-log-download/u);
});

test("Mod+S toggles the upstream sidebar through the public layout service", () => {
  assert.match(
    shortcutInstallSource,
    /id:\s*"sidebar\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["sidebar\.toggle"\][\s\S]*ctx\.layout\.toggleSidebar\(\)/u,
  );
  assert.match(bundle, /sidebar\.toggle/u);
  assert.match(bundle, /Mod\+S/u);
  assert.match(bundle, /layout\.toggleSidebar\(\)/u);
});

test("Mod+P toggles the resident right sidebar through Tabs runtime", () => {
  assert.match(
    shortcutInstallSource,
    /id:\s*"tabs\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["tabs\.toggle"\][\s\S]*tabsRuntimes\.right\.toggle\(\)/u,
  );
  assert.match(bundle, /tabs\.toggle/u);
  assert.match(bundle, /Mod\+P/u);
});

test("right and bottom panels own separate Tabs workspaces", () => {
  assert.match(
    tabsInstallSource,
    /const rightTabs = new TabsRuntime\([\s\S]*const bottomTabs = new TabsRuntime\(/u,
  );
  assert.match(
    tabsInstallSource,
    /const bottomTabs = new TabsRuntime\([\s\S]*idPrefix:\s*"bottom-"/u,
  );
  assert.match(
    tabsInstallSource,
    /createTabsWorkspace\(\s*rightTabs,\s*"right",?\s*\)[\s\S]*createTabsWorkspace\(\s*bottomTabs,\s*"bottom",?\s*\)/u,
  );
  assert.match(
    tabsInstallSource,
    /id:\s*"minke-tabs-right"[\s\S]*placement:\s*"right"[\s\S]*id:\s*"minke-tabs-bottom"[\s\S]*placement:\s*"bottom"/u,
  );
});

test("Mod+B toggles the independent bottom Tabs panel", () => {
  assert.match(
    shortcutInstallSource,
    /id:\s*"tabs\.bottom\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["tabs\.bottom\.toggle"\][\s\S]*tabsRuntimes\.bottom\.toggle\(\)/u,
  );
  assert.match(bundle, /tabs\.bottom\.toggle/u);
  assert.match(bundle, /Mod\+B/u);
});

test("Minke bypasses the upstream internal-testing notice through slot shadowing", () => {
  assert.match(
    onboardingInstallSource,
    /ctx\.slots\.inject\("settings\.onboarding"/u,
  );
  assert.match(
    onboardingInstallSource,
    /name:\s*"settings\.onboarding"[\s\S]*id:\s*"welcome-notice"[\s\S]*priority:\s*-100/u,
  );
  assert.match(bundle, /settings\.onboarding/u);
  assert.match(bundle, /welcome-notice/u);
});

test("the shortcuts settings row receives the keyboard navigation icon", () => {
  const createButton = (label) => {
    const attributes = new Set();
    const declarations = new Map();
    return {
      attributes,
      style: {
        getPropertyPriority: () => "",
        getPropertyValue: (name) => declarations.get(name) ?? "",
        removeProperty: (name) => declarations.delete(name),
        setProperty: (name, value) => declarations.set(name, value),
      },
      querySelector: () => ({ textContent: label }),
      toggleAttribute: (name, enabled) => {
        if (enabled) attributes.add(name);
        else attributes.delete(name);
      },
    };
  };
  const general = createButton("General");
  const shortcuts = createButton("Keyboard shortcuts");
  let reconcile;
  const root = {
    defaultView: {
      MutationObserver: class {
        disconnect() {}
        observe() {}
      },
      requestAnimationFrame(callback) {
        reconcile = callback;
        return 1;
      },
      cancelAnimationFrame() {},
    },
    documentElement: {},
    querySelectorAll: () => [general, shortcuts],
  };

  reconcileShortcutNavigationIcon(root, "Keyboard shortcuts");

  assert.equal(
    general.attributes.has("data-minke-shortcuts-nav"),
    false,
  );
  assert.equal(
    shortcuts.attributes.has("data-minke-shortcuts-nav"),
    true,
  );

  reconcileShortcutNavigationIcon(root, "快捷键");
  assert.equal(
    shortcuts.attributes.has("data-minke-shortcuts-nav"),
    false,
    "a stale marker must be removed when the localized label changes",
  );
  assert.match(
    shortcutStylesSource,
    /import \{ Keyboard \} from "@lucide\/icons";/u,
  );
  assert.match(
    shortcutStylesSource,
    /import \{ buildLucideDataUri \} from "@lucide\/icons\/build";/u,
  );
  assert.match(
    shortcutStylesSource,
    /buildLucideDataUri\(Keyboard,\s*\{\s*size:\s*16,\s*\}\)/u,
  );
  assert.doesNotMatch(shortcutStylesSource, /KEYBOARD_ICON_PATHS|<path/u);
  assert.match(
    SHORTCUT_STYLES,
    /mask:\s*var\(--minke-shortcuts-nav-icon\)/u,
  );
  const dispose = installShortcutNavigationIcon(
    () => "Keyboard shortcuts",
    root,
  );
  reconcile();
  const iconDataUrl = shortcuts.style
    .getPropertyValue("--minke-shortcuts-nav-icon")
    .match(
      /^url\("(data:image\/svg\+xml;base64,[^"]+)"\)$/u,
    )?.[1];
  assert.equal(
    general.style.getPropertyValue(
      "--minke-shortcuts-nav-icon",
    ),
    "",
  );
  assert.ok(iconDataUrl);
  const iconSvg = Buffer.from(
    iconDataUrl.slice(iconDataUrl.indexOf(",") + 1),
    "base64",
  ).toString("utf8");
  assert.match(iconSvg, /class="lucide lucide-keyboard"/u);
  assert.match(
    iconSvg,
    /<rect width="20" height="16" x="2" y="4" rx="2"/u,
  );
  dispose();
  assert.equal(
    shortcuts.style.getPropertyValue(
      "--minke-shortcuts-nav-icon",
    ),
    "",
  );
});
