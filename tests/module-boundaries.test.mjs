import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = [
  "desktop",
  "packages/harness-overlay/src",
  "packages/model-runtime/src",
  "packages/plugin-catalog/src",
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
  "@minke/harness-overlay/session-export-contract",
  "@minke/harness-overlay/data-home-contract",
  "@minke/harness-overlay/shortcut-contract",
  "@minke/harness-overlay/tabs/contract",
  "@minke/harness-overlay/tabs/files-contract",
  "@minke/harness-overlay/tabs/terminal-contract",
  "@minke/harness-overlay/terminal-settings-contract",
]);

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

test("desktop imports only the overlay's explicit cross-process contracts", () => {
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

test("the plugin catalog package stays independent of desktop transports", () => {
  const catalogRoot = resolve(
    projectRoot,
    "packages/plugin-catalog/src",
  );
  const violations = productionImports.filter(
    ({ path, specifier }) =>
      path.startsWith(`${catalogRoot}${sep}`) &&
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
