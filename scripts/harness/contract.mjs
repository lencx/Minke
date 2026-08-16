import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

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
  return { bundle, packageRoot, manifest };
}

/**
 * Verify the pinned upstream interface and the hard no-source-modification
 * boundary. Every build and explicit verification crosses this same gate.
 */
export async function verifyHarnessContract(projectRoot) {
  const contractPath = join(projectRoot, "config", "harness-runtime.json");
  const contract = await readJson(contractPath);
  if (Object.hasOwn(contract, "patches")) {
    throw new Error(
      "DeepSeek Harness source patches are forbidden; use productBundle or a desktop adapter.",
    );
  }

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
    settingsSlotsSource,
    settingsRootSource,
    sidebarSource,
    localeRuntimeSource,
    slotRendererSource,
    themeRuntimeSource,
    themePresenterSource,
    appFrameSource,
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
        "web-react",
        "src",
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
    settingsSlotsSource,
    "'settings.section'",
    "Harness settings.section extension slot changed.",
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
    relativeHarnessRoot: relative(projectRoot, harnessRoot),
  };
}
