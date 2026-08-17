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
} from "@minke/harness-overlay/client/bridge.ts";
import {
  installShortcutNavigationIcon,
  reconcileShortcutNavigationIcon,
  SHORTCUT_STYLES,
} from "@minke/harness-overlay/client/styles.ts";

const manifest = JSON.parse(
  readFileSync(
    new URL("../packages/harness-overlay/package.json", import.meta.url),
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
    "../packages/harness-overlay/lib/model-runtime.js",
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
const shortcutStylesSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/styles.ts",
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
const overlayBuildSource = readFileSync(
  new URL("../scripts/harness/build-overlay.mjs", import.meta.url),
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

test("the product overlay uses the shared @lencx package scope", () => {
  assert.equal(manifest.name, "@lencx/minke-harness-overlay");
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
  assert.equal(
    manifest.exports["./model-runtime"],
    "./lib/model-runtime.js",
  );
  assert.deepEqual(contract.productBundle.runtimePackages, [
    "@deepseek-ai/dsh-subagent-codex",
  ]);
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

test("the product overlay composes Codex CLI and the generic model runtime", () => {
  assert.match(
    patch,
    /id: subagent-codex[\s\S]*name: '@deepseek-ai\/dsh-subagent-codex'/u,
  );
  assert.match(
    patch,
    /id: tool-subagent-codex[\s\S]*provider: codex[\s\S]*toolName: subagent_codex[\s\S]*enableRunInBackground: true[\s\S]*backgroundMode: one-shot/u,
  );
  assert.match(
    patch,
    /id: llm-pi-ai[\s\S]*disabled: true/u,
  );
  assert.match(
    patch,
    /id: model-runtime[\s\S]*name: '@lencx\/minke-harness-overlay\/model-runtime'[\s\S]*enabled: true[\s\S]*lifecycle: !!js "process\.env\.MINKE_LM_STUDIO_ENABLED === '1' && process\.env\.MINKE_LM_STUDIO_COMMAND \? 'ensure-running' : 'external'"[\s\S]*command: !!js process\.env\.MINKE_LM_STUDIO_COMMAND/u,
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
    clientSource,
    /ctx\.slots\.inject\("sidebar\.footer\.action"[\s\S]*name:\s*"sidebar\.footer\.action"[\s\S]*id:\s*"minke-about"[\s\S]*order:\s*100/u,
  );
  assert.match(clientSource, /desktopAboutInfo\(\)/u);
  assert.match(clientSource, /installAboutStyles\(\)/u);
  assert.match(
    overlayBuildSource,
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
    clientSource,
    /new TabsRuntime\([\s\S]*new TabRendererRegistry\(\)[\s\S]*new WebTabsController[\s\S]*new FilesTabsController[\s\S]*new TerminalTabsController/u,
  );
  assert.match(
    clientSource,
    /createFilesTabRenderer\(filesTabs,\s*filesT\)/u,
  );
  assert.match(
    clientSource,
    /createTerminalTabRenderer\(\s*terminalTabs,\s*terminalSettings,\s*terminalT,\s*\)/u,
  );
  assert.match(
    clientSource,
    /createWebTabRenderer\(webTabs,\s*webT\)/u,
  );
  assert.match(
    clientSource,
    /name:\s*"shell\.overlay"[\s\S]*id:\s*"minke-tabs-right"[\s\S]*id:\s*"minke-tabs-bottom"/u,
  );
  assert.match(
    clientSource,
    /id:\s*"minke-tabs-new-session-toggle"[\s\S]*NewSessionTabsHeaderAction as ComponentType<never>/u,
  );
  assert.doesNotMatch(clientSource, /ResourceTabs|resource-tabs/u);
  assert.doesNotMatch(
    tabsCoreSource,
    /from\s+["']\.\/(?:terminal|web)\//u,
  );
  assert.match(clientSource, /installTerminalTabStyles\(\)/u);
  assert.match(clientSource, /installFilesTabStyles\(\)/u);
  assert.match(clientSource, /installWebTabStyles\(\)/u);
  assert.match(clientSource, /FILES_TABS_NAMESPACE/u);
  assert.match(clientSource, /TERMINAL_TABS_NAMESPACE/u);
  assert.match(clientSource, /WEB_TABS_NAMESPACE/u);
});

test("Terminal settings register as a separate settings section", () => {
  assert.match(
    clientSource,
    /name:\s*"settings\.section"[\s\S]*id:\s*"minke-terminal"[\s\S]*order:\s*6[\s\S]*TerminalSettingsSection as ComponentType<never>/u,
  );
  assert.match(clientSource, /new TerminalSettingsRuntime/u);
  assert.match(clientSource, /installTerminalSettingsStyles\(\)/u);
  assert.match(
    clientSource,
    /createTerminalTabRenderer\(\s*terminalTabs,\s*terminalSettings,/u,
  );
});

test("desktop Session export shadows the upstream Web action and modal", () => {
  assert.match(
    clientSource,
    /name:\s*"conversation\.session\.header\.utilities"[\s\S]*id:\s*"session-log-download"[\s\S]*priority:\s*-100/u,
  );
  assert.match(
    clientSource,
    /SessionLogHeaderAction as ComponentType<never>/u,
  );
  assert.match(
    clientSource,
    /sessionLogsPort\.export\(sessionId\)/u,
  );
  assert.doesNotMatch(bundle, /data-minke-session-log-download/u);
});

test("Mod+S toggles the upstream sidebar through the public layout service", () => {
  assert.match(
    clientSource,
    /id:\s*"sidebar\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["sidebar\.toggle"\][\s\S]*ctx\.layout\.toggleSidebar\(\)/u,
  );
  assert.match(bundle, /sidebar\.toggle/u);
  assert.match(bundle, /Mod\+S/u);
  assert.match(bundle, /layout\.toggleSidebar\(\)/u);
});

test("Mod+P toggles the resident right sidebar through Tabs runtime", () => {
  assert.match(
    clientSource,
    /id:\s*"tabs\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["tabs\.toggle"\][\s\S]*tabsRuntimes\.right\.toggle\(\)/u,
  );
  assert.match(bundle, /tabs\.toggle/u);
  assert.match(bundle, /Mod\+P/u);
});

test("right and bottom panels own separate Tabs workspaces", () => {
  assert.match(
    clientSource,
    /const rightTabs = new TabsRuntime\([\s\S]*const bottomTabs = new TabsRuntime\(/u,
  );
  assert.match(
    clientSource,
    /const bottomTabs = new TabsRuntime\([\s\S]*idPrefix:\s*"bottom-"/u,
  );
  assert.match(
    clientSource,
    /createTabsWorkspace\(\s*rightTabs,\s*"right",?\s*\)[\s\S]*createTabsWorkspace\(\s*bottomTabs,\s*"bottom",?\s*\)/u,
  );
  assert.match(
    clientSource,
    /id:\s*"minke-tabs-right"[\s\S]*placement:\s*"right"[\s\S]*id:\s*"minke-tabs-bottom"[\s\S]*placement:\s*"bottom"/u,
  );
});

test("Mod+B toggles the independent bottom Tabs panel", () => {
  assert.match(
    clientSource,
    /id:\s*"tabs\.bottom\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["tabs\.bottom\.toggle"\][\s\S]*tabsRuntimes\.bottom\.toggle\(\)/u,
  );
  assert.match(bundle, /tabs\.bottom\.toggle/u);
  assert.match(bundle, /Mod\+B/u);
});

test("Minke bypasses the upstream internal-testing notice through slot shadowing", () => {
  assert.match(
    clientSource,
    /ctx\.slots\.inject\("settings\.onboarding"/u,
  );
  assert.match(
    clientSource,
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
