import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { KEYBOARD_ICON_SVG } from "../packages/harness-overlay/src/client/icons/data.ts";
import { reconcileShortcutNavigationIcon } from "../packages/harness-overlay/src/client/styles.ts";

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
const stageSource = readFileSync(
  new URL("../scripts/harness/stage.mjs", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../desktop/main/harness-runtime.ts", import.meta.url),
  "utf8",
);
const smokeSource = readFileSync(
  new URL("../scripts/harness/smoke.mjs", import.meta.url),
  "utf8",
);

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
  assert.equal(
    manifest.exports["./model-runtime"],
    "./lib/model-runtime.js",
  );
  assert.deepEqual(contract.productBundle.runtimePackages, [
    "@deepseek-ai/dsh-subagent-codex",
  ]);
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
    `${patch}\n${runtimeSource}`,
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
  assert.match(bundle, /IconKeyboardOutline16/u);
  assert.doesNotMatch(bundle, /require\(["']@deepseek-ai\//u);
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
  assert.match(KEYBOARD_ICON_SVG, /viewBox="0 0 24 24"/u);
  assert.match(
    KEYBOARD_ICON_SVG,
    /class="lucide lucide-keyboard-icon lucide-keyboard"/u,
  );
  assert.match(
    KEYBOARD_ICON_SVG,
    /<rect width="20" height="16" x="2" y="4" rx="2"\/>/u,
  );
});

test("staging injects the bundle and launch composes it with --patch", () => {
  assert.match(stageSource, /injectWorkspacePackage\([\s\S]*productBundle/u);
  assert.match(stageSource, /exposeProductBundleToProfiles/u);
  assert.match(
    stageSource,
    /productBundle\.bundle\.runtimePackages/u,
  );
  assert.match(
    stageSource,
    /flags\.skipInstall && flags\.skipBuild[\s\S]*validateReusableRuntime[\s\S]*without touching the Harness workspace/u,
  );
  assert.ok(
    stageSource.indexOf("flags.skipInstall && flags.skipBuild") <
      stageSource.indexOf("const packages = await readWorkspacePackages"),
  );
  assert.match(
    runtimeSource,
    /"web",[\s\S]*"--patch",[\s\S]*productPatch,[\s\S]*"--host"/u,
  );
  assert.match(
    smokeSource,
    /"web",[\s\S]*"--patch",[\s\S]*productPatch,[\s\S]*"--host"/u,
  );
  assert.match(
    smokeSource,
    /entry\.id === productPackageName[\s\S]*settings\.open[\s\S]*session\.new/u,
  );
});
