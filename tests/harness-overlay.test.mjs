import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
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
    /id: tool-subagent-codex[\s\S]*provider: codex[\s\S]*toolName: subagent_codex/u,
  );
  assert.match(
    patch,
    /id: llm-pi-ai[\s\S]*disabled: true/u,
  );
  assert.match(
    patch,
    /id: model-runtime[\s\S]*name: '@lencx\/minke-harness-overlay\/model-runtime'[\s\S]*lifecycle: ensure-running/u,
  );
  assert.doesNotMatch(
    patch,
    /MINKE_LM_STUDIO_PROVIDERS|MINKE_LM_STUDIO_API_KEY/u,
  );
});

test("the model runtime uses DSH services and keeps local secrets out of profiles", () => {
  assert.match(
    modelRuntimeBundle,
    /@deepseek-ai\/dsh-llm-pi-ai/u,
  );
  assert.match(modelRuntimeBundle, /ctx\.subprocess/u);
  assert.match(modelRuntimeBundle, /ctx\.credentials\.resolve/u);
  assert.match(modelRuntimeBundle, /ensure-running/u);
  assert.match(modelRuntimeBundle, /openAICompatible/u);
  assert.doesNotMatch(
    modelRuntimeBundle,
    /node:child_process|execFile|spawnSync|settings\.(?:update|mutate)/u,
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
  assert.match(bundle, /minke-overlay: tabs runtime/u);
  assert.match(bundle, /minke-overlay: Files tab renderer/u);
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
  assert.match(bundle, /minke-overlay: Terminal tab renderer/u);
  assert.match(bundle, /minke-overlay: Terminal settings runtime/u);
  assert.match(bundle, /minke-terminal/u);
  assert.match(bundle, /minke-overlay: Web tab renderer/u);
  assert.match(bundle, /minke-overlay: Web link tabs/u);
  assert.match(bundle, /minke-overlay: session header action styles/u);
  assert.match(bundle, /minke-tabs-toggle/u);
  assert.match(bundle, /minkeDesktop\?\.sessionLogs/u);
  assert.match(bundle, /data-minke-session-log-action/u);
  assert.match(bundle, /conversation\.session\.header\.utilities/u);
  assert.match(bundle, /minke-tabs-panel/u);
  assert.doesNotMatch(bundle, /require\(["']@deepseek-ai\//u);
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
    /name:\s*"shell\.overlay"[\s\S]*id:\s*"minke-tabs"/u,
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
    /id:\s*"tabs\.toggle"[\s\S]*defaultBinding:\s*DEFAULT_SHORTCUT_BINDINGS\["tabs\.toggle"\][\s\S]*tabs\.toggle\(\)/u,
  );
  assert.match(bundle, /tabs\.toggle/u);
  assert.match(bundle, /Mod\+P/u);
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
    return {
      attributes,
      querySelector: () => ({ textContent: label }),
      toggleAttribute: (name, enabled) => {
        if (enabled) attributes.add(name);
        else attributes.delete(name);
      },
    };
  };
  const general = createButton("General");
  const shortcuts = createButton("Keyboard shortcuts");
  const root = {
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
  const iconDataUrl = SHORTCUT_STYLES.match(
    /--minke-shortcuts-nav-icon: url\("(data:image\/svg\+xml;base64,[^"]+)"\)/u,
  )?.[1];
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
});
