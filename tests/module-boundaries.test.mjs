import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = [
  "desktop",
  "packages/harness-overlay/src",
  "packages/im-discord/src",
  "packages/im-gateway/src",
  "packages/im-telegram/src",
  "packages/im-weixin/src",
  "packages/model-runtime/src",
  "packages/remote-access/src",
  "src",
].map((path) => resolve(projectRoot, path)).filter(existsSync);
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const desktopOverlayContracts = new Set([
  "@minke/harness-overlay/agent-browser-annotation-contract",
  "@minke/harness-overlay/agent-browser-contract",
  "@minke/harness-overlay/agent-browser-history-contract",
  "@minke/harness-overlay/agent-turn-contract",
  "@minke/harness-overlay/app-update-contract",
  "@minke/harness-overlay/browser-settings-contract",
  "@minke/harness-overlay/host/file-manager",
  "@minke/harness-overlay/session-export-contract",
  "@minke/harness-overlay/data-home-contract",
  "@minke/harness-overlay/plugin-install-contract",
  "@minke/harness-overlay/remote-hub-contract",
  "@minke/harness-overlay/shortcut-contract",
  "@minke/harness-overlay/tabs/contract",
  "@minke/harness-overlay/tabs/files-contract",
  "@minke/harness-overlay/tabs/terminal-contract",
  "@minke/harness-overlay/tabs/web-link-contract",
  "@minke/harness-overlay/terminal-settings-contract",
  "@minke/harness-overlay/trusted-host-control-contract",
  "@minke/harness-overlay/web-search-settings-contract",
]);
const privateDesktopMainModules = [
  {
    facade: resolve(projectRoot, "desktop/main/minke-config.ts"),
    root: resolve(projectRoot, "desktop/main/minke-config"),
  },
  {
    facade: resolve(
      projectRoot,
      "desktop/main/plugin-installation.ts",
    ),
    root: resolve(
      projectRoot,
      "desktop/main/plugin-installation",
    ),
  },
];

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function importSpecifiers(path) {
  const source = readFileSync(path, "utf8");
  return [
    ...source.matchAll(
      /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu,
    ),
  ].map((match) => match[1]);
}

const productionFiles = sourceRoots.flatMap(sourceFiles);
const productionImports = productionFiles.flatMap((path) =>
  importSpecifiers(path).map((specifier) => ({ path, specifier })),
);

function resolveProductionImport(path, specifier) {
  let target;
  if (specifier.startsWith(".")) {
    target = resolve(dirname(path), specifier);
  } else {
    const desktopAlias = "@minke/desktop/";
    if (!specifier.startsWith(desktopAlias)) return undefined;
    target = resolve(
      projectRoot,
      "desktop",
      specifier.slice(desktopAlias.length),
    );
  }
  for (const extension of sourceExtensions) {
    const file = `${target}${extension}`;
    if (existsSync(file)) return file;
  }
  return target;
}

function privateDesktopMainImportViolations(imports) {
  return imports.filter(({ path, specifier }) => {
    const target = resolveProductionImport(path, specifier);
    if (target === undefined) return false;
    const owner = privateDesktopMainModules.find(
      ({ root }) =>
        target === root || target.startsWith(`${root}${sep}`),
    );
    if (owner === undefined) return false;
    return (
      path !== owner.facade &&
      !path.startsWith(`${owner.root}${sep}`)
    );
  });
}

test("production sources do not cross the root or vendored-source aliases", () => {
  const violations = productionImports.filter(
    ({ specifier }) =>
      specifier.startsWith("@@/") ||
      specifier.startsWith("@vendor/deepseek-harness/") ||
      specifier.includes("vendor/deepseek-harness") ||
      specifier.includes("packages/harness-overlay/src"),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("desktop imports only the overlay's explicit shared modules", () => {
  const desktopRoot = resolve(projectRoot, "desktop");
  const violations = productionImports.filter(({ path, specifier }) => {
    if (
      !path.startsWith(`${desktopRoot}${sep}`) ||
      !specifier.startsWith("@minke/harness-overlay/")
    ) {
      return false;
    }
    return !desktopOverlayContracts.has(specifier.replace(/\.ts$/u, ""));
  });
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("desktop main implementation modules stay behind their facades", () => {
  const knownViolation = {
    path: resolve(projectRoot, "desktop/main/main.ts"),
    specifier: "./plugin-installation/profile.ts",
  };
  assert.deepEqual(
    privateDesktopMainImportViolations([knownViolation]),
    [knownViolation],
  );

  assert.deepEqual(
    privateDesktopMainImportViolations(productionImports).map(
      ({ path, specifier }) => [
        relative(projectRoot, path),
        specifier,
      ],
    ),
    [],
  );
});

test("the desktop entry remains a composition root", () => {
  const expectedImports = [
    "./application",
    "./credential-storage-helper",
    "electron",
    "electron-squirrel-startup",
  ];
  const rejectUnexpected = (specifiers) =>
    specifiers.filter(
      (specifier) => !expectedImports.includes(specifier),
    );
  assert.deepEqual(
    rejectUnexpected([...expectedImports, "./main-window"]),
    ["./main-window"],
  );

  assert.deepEqual(
    productionImports
      .filter(
        ({ path }) =>
          path === resolve(projectRoot, "desktop/main/main.ts"),
      )
      .map(({ specifier }) => specifier)
      .sort(),
    expectedImports,
  );
});

test("the remote-access package stays independent of desktop transports", () => {
  const remoteRoot = resolve(
    projectRoot,
    "packages/remote-access/src",
  );
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      path.startsWith(`${remoteRoot}${sep}`) &&
      (
        specifier === "electron" ||
        specifier.startsWith("@minke/desktop/") ||
        specifier.startsWith("@minke/harness-overlay/")
      ),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("the Weixin transport stays independent of host runtimes", () => {
  const weixinRoot = resolve(
    projectRoot,
    "packages/im-weixin/src",
  );
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      path.startsWith(`${weixinRoot}${sep}`) &&
      (
        specifier === "electron" ||
        specifier === "openclaw" ||
        specifier.startsWith("openclaw/") ||
        specifier.startsWith("@deepseek-ai/") ||
        specifier.startsWith("@minke/desktop/") ||
        specifier.startsWith("@minke/harness-overlay/")
      ),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("Telegram and Discord transports stay independent of host runtimes", () => {
  const transportRoots = [
    "packages/im-telegram/src",
    "packages/im-discord/src",
  ].map((path) => resolve(projectRoot, path));
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      transportRoots.some((root) =>
        path.startsWith(`${root}${sep}`)
      ) &&
      (
        specifier === "electron" ||
        specifier === "openclaw" ||
        specifier.startsWith("openclaw/") ||
        specifier.startsWith("@deepseek-ai/") ||
        specifier.startsWith("@minke/desktop/") ||
        specifier.startsWith("@minke/harness-overlay/")
      ),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("the IM Gateway core stays independent of desktop and Host runtimes", () => {
  const gatewayRoot = resolve(
    projectRoot,
    "packages/im-gateway/src",
  );
  const weixinAdapter = resolve(gatewayRoot, "weixin.ts");
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      path.startsWith(`${gatewayRoot}${sep}`) &&
      (
        specifier === "electron" ||
        specifier === "openclaw" ||
        specifier.startsWith("openclaw/") ||
        specifier.startsWith("@deepseek-ai/") ||
        specifier.startsWith("@minke/desktop/") ||
        specifier.startsWith("@minke/harness-overlay/") ||
        (
          specifier === "@lencx/minke-im-weixin" &&
          path !== weixinAdapter
        )
      ),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("the IM Gateway root entry does not re-export provider adapters", () => {
  const gatewayEntry = resolve(
    projectRoot,
    "packages/im-gateway/src/index.ts",
  );
  assert.deepEqual(
    importSpecifiers(gatewayEntry).filter((specifier) =>
      /(?:^|\/)(?:weixin|telegram|discord)(?:\.ts)?$/u.test(
        specifier,
      ),
    ),
    [],
  );
});

test("the model-runtime package stays independent of desktop and overlay transports", () => {
  const modelRuntimeRoot = resolve(
    projectRoot,
    "packages/model-runtime/src",
  );
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      path.startsWith(`${modelRuntimeRoot}${sep}`) &&
      (
        specifier === "electron" ||
        specifier.startsWith("@minke/desktop/") ||
        specifier.startsWith("@minke/harness-overlay/")
      ),
  );
  assert.deepEqual(
    violations.map(({ path, specifier }) => [
      relative(projectRoot, path),
      specifier,
    ]),
    [],
  );
});

test("production sources do not restore retired model environment seams", () => {
  const violations = productionFiles.filter((path) =>
    /MINKE_LM_STUDIO_PROVIDERS|MINKE_LM_STUDIO_API_KEY/u.test(
      readFileSync(path, "utf8"),
    ),
  );
  assert.deepEqual(violations.map((path) => relative(projectRoot, path)), []);
});

test("overlay styles cross one lifecycle seam instead of living in TS templates", () => {
  const overlayClientRoot = resolve(
    projectRoot,
    "packages/harness-overlay/src/client",
  );
  const styleRuntime = resolve(
    overlayClientRoot,
    "shared",
    "style-runtime.ts",
  );
  const violations = productionFiles
    .filter(
      (path) =>
        path.startsWith(`${overlayClientRoot}${sep}`) &&
        path !== styleRuntime,
    )
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        /(?:export\s+)?const\s+[A-Z][A-Z0-9_]*_STYLES\s*=\s*`/u.test(
          source,
        ) ||
        /createElement\(\s*["']style["']\s*\)/u.test(source)
      );
    });

  assert.deepEqual(
    violations.map((path) => relative(projectRoot, path)),
    [],
  );
});
