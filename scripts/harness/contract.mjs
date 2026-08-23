import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { resolveHarnessRuntimePatches } from "./runtime-patches.mjs";

const desktopPlatforms = Object.freeze(["darwin", "linux", "win32"]);

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function resolveInside(root, value, label) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const absolute = resolve(root, value);
  if (
    absolute === root ||
    !absolute.startsWith(`${root}${sep}`)
  ) {
    throw new Error(`${label} escapes the Minke project: ${value}`);
  }
  return absolute;
}

function requireSourceSeam(source, fragment, message) {
  if (!source.includes(fragment)) throw new Error(message);
}

function forbidSourceSeam(source, fragment, message) {
  if (source.includes(fragment)) throw new Error(message);
}

function requireStringOrNullUnion(
  source,
  typeName,
  expected,
  message,
) {
  const declaration = new RegExp(
    `export\\s+type\\s+${typeName}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\/\\*\\*|export\\s)|$)`,
    "u",
  ).exec(source);
  if (declaration === null) throw new Error(message);
  const members = declaration[1]
    .split("|")
    .map((member) => member.trim())
    .filter((member) => member !== "");
  const values = members.map((member) => {
    if (member === "null") return null;
    const literal = /^(['"])([^'"]+)\1$/u.exec(member);
    if (literal === null) throw new Error(message);
    return literal[2];
  });
  const actual = new Set(values);
  if (
    values.length !== expected.length ||
    actual.size !== expected.length ||
    expected.some((value) => !actual.has(value))
  ) {
    throw new Error(message);
  }
}

export function runtimeSizeBudgetForPlatform(
  contract,
  platform = process.platform,
) {
  const budget = contract?.runtimeSizeBudgetBytes?.[platform];
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new Error(
      `Harness contract must declare a positive integer runtimeSizeBudgetBytes.${platform}.`,
    );
  }
  return budget;
}

async function verifyProductBundle(projectRoot, harnessRoot, contract) {
  const bundle = contract.productBundle;
  if (
    typeof bundle !== "object" ||
    bundle === null ||
    Array.isArray(bundle)
  ) {
    throw new Error(
      "Harness contract must declare one productBundle extension.",
    );
  }
  if (
    typeof bundle.packageName !== "string" ||
    typeof bundle.packagePath !== "string" ||
    typeof bundle.patch !== "string"
  ) {
    throw new Error(
      "Harness productBundle needs packageName, packagePath, and patch.",
    );
  }
  const runtimePackages = bundle.runtimePackages ?? [];
  if (
    !Array.isArray(runtimePackages) ||
    runtimePackages.some(
      (name) =>
        typeof name !== "string" ||
        !/^@deepseek-ai\/[a-z0-9][a-z0-9-]*$/u.test(name),
    ) ||
    new Set(runtimePackages).size !== runtimePackages.length
  ) {
    throw new Error(
      "Harness productBundle.runtimePackages must be unique @deepseek-ai package names.",
    );
  }
  const workspaceRuntimePackageConfigs =
    bundle.workspaceRuntimePackages ?? [];
  if (
    !Array.isArray(workspaceRuntimePackageConfigs) ||
    workspaceRuntimePackageConfigs.some(
      (entry) =>
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry) ||
        typeof entry.packageName !== "string" ||
        !/^@lencx\/minke-[a-z0-9][a-z0-9-]*$/u.test(
          entry.packageName,
        ) ||
        typeof entry.packagePath !== "string",
    ) ||
    new Set(
      workspaceRuntimePackageConfigs.map((entry) => entry.packageName),
    ).size !== workspaceRuntimePackageConfigs.length ||
    new Set(
      workspaceRuntimePackageConfigs.map((entry) => entry.packagePath),
    ).size !== workspaceRuntimePackageConfigs.length
  ) {
    throw new Error(
      "Harness productBundle.workspaceRuntimePackages must be unique @lencx/minke-* package descriptors.",
    );
  }
  if (!bundle.packageName.startsWith("@lencx/")) {
    throw new Error("Minke product packages must use the @lencx scope.");
  }
  const packageRoot = resolveInside(
    projectRoot,
    bundle.packagePath,
    "productBundle.packagePath",
  );
  if (
    packageRoot === harnessRoot ||
    packageRoot.startsWith(`${harnessRoot}${sep}`)
  ) {
    throw new Error(
      "Minke productBundle must live outside vendor/deepseek-harness.",
    );
  }
  const manifest = await readJson(join(packageRoot, "package.json"));
  if (manifest.name !== bundle.packageName) {
    throw new Error(
      `Minke bundle name changed: expected ${bundle.packageName}, found ${String(manifest.name)}`,
    );
  }
  if (manifest.dsh?.bundle?.patch !== `./${bundle.patch}`) {
    throw new Error(
      `${bundle.packageName} must expose ./${bundle.patch} through dsh.bundle.patch`,
    );
  }
  if (manifest.dsh?.client?.platform !== "web") {
    throw new Error(`${bundle.packageName} must declare a Web client half`);
  }
  const patchSource = await readFile(join(packageRoot, bundle.patch), "utf8");
  requireSourceSeam(
    patchSource,
    `name: '${bundle.packageName}'`,
    `${bundle.patch} does not insert ${bundle.packageName}`,
  );
  for (const runtimePackage of runtimePackages) {
    requireSourceSeam(
      patchSource,
      `name: '${runtimePackage}'`,
      `${bundle.patch} does not compose runtime package ${runtimePackage}`,
    );
  }
  const workspaceRuntimePackages = await Promise.all(
    workspaceRuntimePackageConfigs.map(async (entry) => {
      if (entry.packageName === bundle.packageName) {
        throw new Error(
          "Harness productBundle cannot list itself as a workspace runtime package.",
        );
      }
      const runtimePackageRoot = resolveInside(
        projectRoot,
        entry.packagePath,
        `workspace runtime package ${entry.packageName}`,
      );
      if (
        runtimePackageRoot === harnessRoot ||
        runtimePackageRoot.startsWith(`${harnessRoot}${sep}`)
      ) {
        throw new Error(
          `Minke workspace runtime package ${entry.packageName} must live outside vendor/deepseek-harness.`,
        );
      }
      const runtimeManifest = await readJson(
        join(runtimePackageRoot, "package.json"),
      );
      if (runtimeManifest.name !== entry.packageName) {
        throw new Error(
          `Minke workspace runtime package name changed: expected ${entry.packageName}, found ${String(runtimeManifest.name)}`,
        );
      }
      if (
        manifest.dependencies?.[entry.packageName] !== "workspace:*"
      ) {
        throw new Error(
          `${bundle.packageName} must depend on ${entry.packageName} through workspace:*`,
        );
      }
      const adapterExport = runtimeManifest.exports?.["./dsh"];
      const adapterTarget =
        typeof adapterExport === "string"
          ? adapterExport
          : adapterExport?.default;
      if (adapterTarget !== "./lib/dsh.js") {
        throw new Error(
          `${entry.packageName} must expose its Harness adapter as ./dsh -> ./lib/dsh.js`,
        );
      }
      requireSourceSeam(
        patchSource,
        `name: '${entry.packageName}/dsh'`,
        `${bundle.patch} does not compose workspace runtime package ${entry.packageName}/dsh`,
      );
      return {
        ...entry,
        packageRoot: runtimePackageRoot,
        manifest: runtimeManifest,
      };
    }),
  );
  return {
    bundle,
    packageRoot,
    manifest,
    workspaceRuntimePackages,
  };
}

/**
 * Verify the pinned upstream interface, pristine source checkout, and
 * explicitly declared staged-runtime patches. Every build and explicit
 * verification crosses this same gate.
 */
export async function verifyHarnessContract(projectRoot) {
  const contractPath = join(projectRoot, "config", "harness-runtime.json");
  const contract = await readJson(contractPath);
  for (const platform of desktopPlatforms) {
    runtimeSizeBudgetForPlatform(contract, platform);
  }
  if (
    !Number.isSafeInteger(contract.runtimeFileBudget) ||
    contract.runtimeFileBudget <= 0
  ) {
    throw new Error(
      "Harness contract must declare a positive integer runtimeFileBudget.",
    );
  }
  const runtimePatches = await resolveHarnessRuntimePatches(
    projectRoot,
    contract.patches,
  );

  const harnessRoot = resolveInside(
    projectRoot,
    contract.submodulePath,
    "submodulePath",
  );
  const actualCommit = capture("git", ["rev-parse", "HEAD"], harnessRoot);
  if (actualCommit !== contract.commit) {
    throw new Error(
      [
        "DeepSeek Harness submodule does not match the desktop contract.",
        `expected: ${contract.commit}`,
        `actual:   ${actualCommit}`,
        "Update config/harness-runtime.json deliberately when syncing the SDK.",
      ].join("\n"),
    );
  }

  const status = capture(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    harnessRoot,
  );
  if (status !== "") {
    throw new Error(
      [
        "DeepSeek Harness must remain an unmodified pinned dependency.",
        status,
        "Move Minke behavior to packages/harness-overlay or desktop adapters.",
      ].join("\n"),
    );
  }

  const cliRoot = join(harnessRoot, "apps", "cli");
  const cliManifest = await readJson(join(cliRoot, "package.json"));
  if (
    cliManifest.name !== contract.packageName ||
    cliManifest.version !== contract.packageVersion
  ) {
    throw new Error(
      `Harness CLI contract changed: expected ${contract.packageName}@${contract.packageVersion}, found ${cliManifest.name}@${cliManifest.version}`,
    );
  }

  const frontendManifest = await readJson(
    join(harnessRoot, "apps", "web", "package.json"),
  );
  if (frontendManifest.name !== contract.frontendPackageName) {
    throw new Error(
      `Harness frontend contract changed: expected ${contract.frontendPackageName}, found ${frontendManifest.name}`,
    );
  }

  const [
    pluginSource,
    argsSource,
    profileBootSource,
    webStartupSource,
    bootManifestSource,
    indexInjectionSource,
    webServerSource,
    frontendStaticSource,
    settingsPluginSlotSource,
    settingsApiProxySource,
    llmTypesSource,
    attachmentSource,
    deepSeekAdapterSource,
    settingsSlotsSource,
    settingsRootSource,
    sidebarSource,
    localeRuntimeSource,
    slotRendererSource,
    themeRuntimeSource,
    themePresenterSource,
    appFrameSource,
    workspaceStorageSource,
    credentialsLocalSource,
    pluginInventorySource,
    pluginInventoryTypesSource,
    webAppBundlePatchSource,
  ] = await Promise.all([
    readFile(join(cliRoot, "src", "plugin.ts"), "utf8"),
    readFile(join(cliRoot, "src", "args.ts"), "utf8"),
    readFile(join(cliRoot, "src", "profile-boot.ts"), "utf8"),
    readFile(
      join(
        harnessRoot,
        "packages",
        "bundle",
        "web-app",
        "src",
        "startup.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "modules",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "webserver",
        "src",
        "injections.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "webserver",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "frontend-static",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-settings-plugins",
        "src",
        "client",
        "slot-contract.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "apiproxy",
        "src",
        "api-proxy.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "llm",
        "llm",
        "src",
        "types.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "attachment",
        "attachment",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "llm",
        "llm-deepseek",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-settings",
        "src",
        "client",
        "contract",
        "slots.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-settings-general",
        "src",
        "client",
        "SettingsRoot.tsx",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-sidebar",
        "src",
        "client",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "locale",
        "src",
        "client",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-renderer",
        "src",
        "client",
        "scoped-slots.tsx",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-theme",
        "src",
        "client",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-layout",
        "src",
        "client",
        "theme-presenter.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "client",
        "ui-layout",
        "src",
        "client",
        "AppFrame.tsx",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "workspace",
        "workspace",
        "src",
        "spec.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "credentials",
        "credentials-local",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "plugin-inventory",
        "src",
        "index.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "host",
        "plugin-inventory",
        "src",
        "types.ts",
      ),
      "utf8",
    ),
    readFile(
      join(
        harnessRoot,
        "packages",
        "bundle",
        "web-app",
        "cordis.patch.yml",
      ),
      "utf8",
    ),
  ]);

  requireSourceSeam(
    pluginSource,
    "spawnSync('pnpm'",
    "Harness dynamic plugin installer changed; review the desktop pnpm adapter.",
  );
  requireSourceSeam(
    argsSource,
    ".option('--patch <path>'",
    "Harness --patch launcher seam changed; review product bundle composition.",
  );
  requireSourceSeam(
    profileBootSource,
    "loadOverlayPatches(NAME, resolve(file))",
    "Harness overlay composition changed; review product bundle composition.",
  );
  requireSourceSeam(
    webStartupSource,
    "pass 0 to let the OS pick a free one",
    "Harness loopback-port contract changed; review desktop startup.",
  );
  requireSourceSeam(
    bootManifestSource,
    "{ kind: 'global', name: '__DSH_BOOT__', value: graph }",
    "Harness boot-manifest global changed; review the desktop smoke parser.",
  );
  requireSourceSeam(
    indexInjectionSource,
    "markup: `<script>globalThis[${name}] = ${value}</script>`",
    "Harness structured boot-global serializer changed; review the desktop smoke parser.",
  );
  requireSourceSeam(
    webServerSource,
    "return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))",
    "Harness structured index pipeline changed; review Minke PWA injection ordering.",
  );
  requireSourceSeam(
    frontendStaticSource,
    "ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))",
    "Harness frontend index rendering changed; review boot and PWA injection delivery.",
  );
  requireSourceSeam(
    settingsSlotsSource,
    "'settings.section'",
    "Harness settings.section extension slot changed.",
  );
  requireSourceSeam(
    settingsPluginSlotSource,
    "'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }",
    "Harness keyed plugin settings-card API changed.",
  );
  requireSourceSeam(
    settingsApiProxySource,
    "namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),",
    "Harness settings namespace exposure changed; review every registered Minke namespace.",
  );
  forbidSourceSeam(
    settingsApiProxySource,
    "settings-not-exposed",
    "Harness settings-not-exposed RPC contract returned; review client error handling.",
  );
  requireSourceSeam(
    llmTypesSource,
    "export interface ReplayEnvelope",
    "Harness LLM ReplayEnvelope API changed; review custom adapter replay metadata.",
  );
  requireSourceSeam(
    llmTypesSource,
    "replayState?: ReplayEnvelope",
    "Harness LLM ReplayEnvelope API changed; review finish chunks.",
  );
  requireSourceSeam(
    attachmentSource,
    "async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>",
    "Harness batch image attachment API changed; review MCP/ACP image persistence.",
  );
  requireSourceSeam(
    deepSeekAdapterSource,
    "reasoningEffort?: 'off' | 'low' | 'high' | 'max'",
    "Harness DeepSeek low reasoning-effort API changed.",
  );
  requireSourceSeam(
    settingsRootSource,
    'aria-haspopup="dialog"',
    "Harness Settings trigger accessibility contract changed.",
  );
  requireSourceSeam(
    settingsRootSource,
    "aria-expanded={open}",
    "Harness Settings trigger open-state contract changed.",
  );
  requireSourceSeam(
    sidebarSource,
    "ctx.workspaces.startSession(workspaceId)",
    "Harness New Session service seam changed.",
  );
  requireSourceSeam(
    localeRuntimeSource,
    "ctx.slots.installLocale(locale)",
    "Harness locale installation seam changed; review Minke i18n integration.",
  );
  requireSourceSeam(
    localeRuntimeSource,
    "register<N extends keyof LocaleNamespaceMap",
    "Harness bilingual dictionary registration changed; review Minke i18n integration.",
  );
  requireSourceSeam(
    localeRuntimeSource,
    "getSnapshot(): LocaleSnapshot",
    "Harness locale snapshot changed; review desktop locale synchronization.",
  );
  requireSourceSeam(
    localeRuntimeSource,
    "'locale/change'(snapshot: LocaleSnapshot)",
    "Harness locale change event changed; review desktop locale synchronization.",
  );
  requireSourceSeam(
    slotRendererSource,
    "kit['t'] = localeSeat(face, entry.locale)",
    "Harness locale-aware slot rendering changed; review Minke i18n integration.",
  );
  requireSourceSeam(
    slotRendererSource,
    "useLocaleRevision(host.locale)",
    "Harness locale revision subscription changed; review Minke i18n integration.",
  );
  requireSourceSeam(
    themeRuntimeSource,
    "ctx.provide('theme', theme)",
    "Harness theme service seam changed; review native window synchronization.",
  );
  requireSourceSeam(
    themeRuntimeSource,
    "'theme/change'(snapshot: ThemeSnapshot)",
    "Harness theme change event changed; review native window synchronization.",
  );
  requireSourceSeam(
    themePresenterSource,
    "document.documentElement.style.colorScheme = scheme",
    "Harness resolved color-scheme projection changed.",
  );
  requireSourceSeam(
    appFrameSource,
    "data-shell-overlay",
    "Harness shell DOM anchor changed; review the desktop structural adapter.",
  );
  requireSourceSeam(
    workspaceStorageSource,
    "name: 'workspace',\n  version: 2,",
    "Harness workspace storage format changed; review the Data Home compatibility adapter.",
  );
  requireSourceSeam(
    credentialsLocalSource,
    "export const CREDENTIALS_FILENAME = '.credentials.yaml'",
    "Harness credentials filename changed; review the Data Home opaque-conflict policy.",
  );
  requireSourceSeam(
    credentialsLocalSource,
    "export const DOCUMENT_VERSION = 1",
    "Harness credentials document version changed; review the Data Home opaque-conflict policy.",
  );
  requireSourceSeam(
    pluginInventorySource,
    "super(ctx, 'pluginInventory')",
    "Harness Loader inventory service changed; review the Minke plugin lifecycle adapter.",
  );
  requireSourceSeam(
    pluginInventorySource,
    "@Remote('list')",
    "Harness Loader inventory Remote changed; review the Minke plugin lifecycle adapter.",
  );
  requireSourceSeam(
    pluginInventorySource,
    "moduleName: entry.options.name",
    "Harness Loader inventory module identity changed; review plugin lifecycle matching.",
  );
  requireSourceSeam(
    pluginInventorySource,
    "enabled: !entry.disabled",
    "Harness Loader inventory enablement changed; review plugin lifecycle states.",
  );
  requireSourceSeam(
    pluginInventorySource,
    "fiberPhase:",
    "Harness Loader inventory fiber phase changed; review plugin lifecycle states.",
  );
  requireStringOrNullUnion(
    pluginInventoryTypesSource,
    "PluginFiberPhase",
    [
      "pending",
      "loading",
      "active",
      "failed",
      "unloading",
      null,
    ],
    "Harness Loader inventory phases changed; review the Minke plugin lifecycle adapter.",
  );
  requireSourceSeam(
    webAppBundlePatchSource,
    "name: '@deepseek-ai/dsh-host-plugin-inventory'",
    "Harness Web bundle no longer mounts the Loader inventory required by Minke.",
  );

  const productBundle = await verifyProductBundle(
    projectRoot,
    harnessRoot,
    contract,
  );
  return {
    contract,
    contractPath,
    harnessRoot,
    cliRoot,
    actualCommit,
    productBundle,
    runtimePatches,
    relativeHarnessRoot: relative(projectRoot, harnessRoot),
  };
}
