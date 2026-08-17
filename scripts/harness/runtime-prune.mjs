import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export const RUNTIME_PRUNE_POLICY_VERSION = 7;

const DOCUMENTATION_FILE =
  /^(?:readme|changelog|changes|history)(?:\.(?:md|markdown|txt))?$/iu;
const DUPLICATE_PNPM_ARTIFACTS_DIRECTORY =
  "node_modules/pnpm/artifacts";
const MISTRAL_PACKAGE_DIRECTORY =
  "node_modules/@earendil-works/pi-ai/node_modules/@mistralai/mistralai";
const PUBLISHED_PACKAGE_BAGGAGE_DIRECTORIES = Object.freeze([
  "node_modules/@mixmark-io/domino/.yarn",
  "node_modules/@mixmark-io/domino/test",
  `${MISTRAL_PACKAGE_DIRECTORY}/examples`,
  `${MISTRAL_PACKAGE_DIRECTORY}/packages`,
  `${MISTRAL_PACKAGE_DIRECTORY}/src`,
  `${MISTRAL_PACKAGE_DIRECTORY}/tests`,
]);
const NODE_PTY_WINDOWS_ONLY_DIRECTORIES = Object.freeze([
  "node_modules/node-pty/deps/winpty",
  "node_modules/node-pty/third_party/conpty",
]);
const PNPM_FASTLIST_WINDOWS_EXECUTABLE =
  /^node_modules\/pnpm\/dist\/vendor\/fastlist-[^/]+\.exe$/u;
const PNPM_REFLINK_PLATFORM_PACKAGE =
  /^(node_modules\/pnpm\/dist\/node_modules\/@reflink\/(reflink-[^/]+))(?:\/|$)/u;
const ESBUILD_LAUNCHER_PATH = "node_modules/esbuild/bin/esbuild";
const ESBUILD_NATIVE_BINARY_MIN_BYTES = 64 * 1024;

function runtimeTarget(target = {}) {
  return {
    arch: target.arch ?? process.arch,
    platform: target.platform ?? process.platform,
  };
}

function pathInDirectory(path, directory) {
  return path === directory || path.startsWith(`${directory}/`);
}

function isCompatibleReflinkPackage(packageName, target) {
  if (
    target.platform === "darwin" &&
    packageName === "reflink-darwin-universal"
  ) {
    return true;
  }
  const targetPrefix = `reflink-${target.platform}-${target.arch}`;
  return (
    packageName === targetPrefix || packageName.startsWith(`${targetPrefix}-`)
  );
}

function prunableRuntimeDirectory(path, target = {}) {
  const normalizedPath = path.replaceAll("\\", "/");
  for (const directory of PUBLISHED_PACKAGE_BAGGAGE_DIRECTORIES) {
    if (pathInDirectory(normalizedPath, directory)) {
      return { category: "publishedPackageBaggage", path: directory };
    }
  }
  if (
    pathInDirectory(
      normalizedPath,
      DUPLICATE_PNPM_ARTIFACTS_DIRECTORY,
    )
  ) {
    return {
      category: "duplicateTooling",
      path: DUPLICATE_PNPM_ARTIFACTS_DIRECTORY,
    };
  }

  const resolvedTarget = runtimeTarget(target);
  if (resolvedTarget.platform !== "win32") {
    for (const directory of NODE_PTY_WINDOWS_ONLY_DIRECTORIES) {
      if (pathInDirectory(normalizedPath, directory)) {
        return { category: "incompatiblePlatformAssets", path: directory };
      }
    }
  }

  const reflinkMatch = PNPM_REFLINK_PLATFORM_PACKAGE.exec(normalizedPath);
  if (
    reflinkMatch !== null &&
    !isCompatibleReflinkPackage(reflinkMatch[2], resolvedTarget)
  ) {
    return {
      category: "incompatiblePlatformAssets",
      path: reflinkMatch[1],
    };
  }
  return undefined;
}

export function runtimeArtifactCategory(path, target = {}) {
  const normalizedPath = path.replaceAll("\\", "/");
  const directory = prunableRuntimeDirectory(normalizedPath, target);
  if (directory !== undefined) return directory.category;
  if (
    runtimeTarget(target).platform !== "win32" &&
    PNPM_FASTLIST_WINDOWS_EXECUTABLE.test(normalizedPath)
  ) {
    return "incompatiblePlatformAssets";
  }
  const name = basename(path);
  if (/\.map$/iu.test(name)) return "sourceMaps";
  if (/\.d\.(?:ts|mts|cts)$/iu.test(name)) return "typeDeclarations";
  if (/\.tsbuildinfo$/iu.test(name)) return "buildCaches";
  if (DOCUMENTATION_FILE.test(name)) return "documentation";
  return undefined;
}

export function isPrunableRuntimePath(path, target = {}) {
  return runtimeArtifactCategory(path, target) !== undefined;
}

function normalizedRuntimePath(path) {
  return path.replaceAll("\\", "/");
}

function isUnoptimizedEsbuildLauncher(path, bytes) {
  return (
    normalizedRuntimePath(path) === ESBUILD_LAUNCHER_PATH &&
    bytes > ESBUILD_NATIVE_BINARY_MIN_BYTES
  );
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function withoutMistralSourceConditions(value, location = "exports") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { changes: 0, value };
  }

  const result = { ...value };
  let changes = 0;
  if (Object.hasOwn(result, "source")) {
    if (
      typeof result.source !== "string" ||
      !result.source.startsWith("./src/") ||
      typeof result.default !== "string" ||
      !result.default.startsWith("./esm/")
    ) {
      throw new Error(
        `cannot prune Mistral ${location}.source without a compiled esm default`,
      );
    }
    delete result.source;
    changes += 1;
  }
  for (const [key, child] of Object.entries(result)) {
    const normalized = withoutMistralSourceConditions(
      child,
      `${location}.${key}`,
    );
    result[key] = normalized.value;
    changes += normalized.changes;
  }
  return { changes, value: result };
}

async function normalizeMistralManifest(runtimeRoot) {
  const manifestPath = join(
    runtimeRoot,
    ...MISTRAL_PACKAGE_DIRECTORY.split("/"),
    "package.json",
  );
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { bytes: 0, files: 0 };
    throw error;
  }
  const manifest = JSON.parse(source);
  if (
    manifest.name !== "@mistralai/mistralai" ||
    manifest.main !== "./esm/index.js" ||
    manifest.exports === null ||
    typeof manifest.exports !== "object" ||
    Array.isArray(manifest.exports)
  ) {
    throw new Error(
      "cannot prune Mistral sources without its compiled esm export contract",
    );
  }
  const normalized = withoutMistralSourceConditions(manifest.exports);
  manifest.exports = normalized.value;
  const nextSource = `${JSON.stringify(manifest, null, 2)}\n`;
  if (nextSource === source) return { bytes: 0, files: 0 };
  await writeFile(manifestPath, nextSource);
  return {
    bytes: Math.max(
      Buffer.byteLength(source) - Buffer.byteLength(nextSource),
      0,
    ),
    files: normalized.changes > 0 ? 1 : 0,
  };
}

async function optimizeEsbuildLauncher(runtimeRoot) {
  const nodeModulesRoot = join(runtimeRoot, "node_modules");
  const esbuildRoot = join(nodeModulesRoot, "esbuild");
  const launcherPath = join(esbuildRoot, "bin", "esbuild");
  let launcherInfo;
  try {
    launcherInfo = await lstat(launcherPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { bytes: 0, files: 0 };
    throw error;
  }
  if (
    !launcherInfo.isFile() ||
    launcherInfo.size <= ESBUILD_NATIVE_BINARY_MIN_BYTES
  ) {
    return { bytes: 0, files: 0 };
  }

  const manifest = JSON.parse(
    await readFile(join(esbuildRoot, "package.json"), "utf8"),
  );
  const binaryHashes = manifest["esbuild.binaryHashes"];
  if (
    binaryHashes === null ||
    typeof binaryHashes !== "object" ||
    Array.isArray(binaryHashes)
  ) {
    throw new Error("cannot deduplicate esbuild without its binary hash map");
  }

  const launcherHash = await sha256(launcherPath);
  const matches = [];
  for (const [subpath, expectedHash] of Object.entries(binaryHashes)) {
    if (
      typeof expectedHash !== "string" ||
      !/^@esbuild\/[a-z0-9-]+\/(?:bin\/esbuild|esbuild\.exe)$/u.test(subpath)
    ) {
      continue;
    }
    const binaryPath = join(nodeModulesRoot, ...subpath.split("/"));
    try {
      const binaryInfo = await lstat(binaryPath);
      if (
        binaryInfo.isFile() &&
        expectedHash === launcherHash &&
        (await sha256(binaryPath)) === launcherHash
      ) {
        matches.push(subpath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `cannot identify esbuild's canonical platform binary (found ${String(matches.length)})`,
    );
  }

  const launcherSource = `#!/usr/bin/env node
"use strict";
require("node:child_process").execFileSync(
  require.resolve(${JSON.stringify(matches[0])}),
  process.argv.slice(2),
  { stdio: "inherit" },
);
`;
  await writeFile(launcherPath, launcherSource);
  await chmod(launcherPath, 0o755);
  return {
    bytes: launcherInfo.size - Buffer.byteLength(launcherSource),
    files: 1,
  };
}

async function collectRuntimeArtifacts(runtimeRoot, target = {}) {
  const absoluteRoot = resolve(runtimeRoot);
  const rootInfo = await lstat(absoluteRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`runtime root is not a directory: ${absoluteRoot}`);
  }

  const candidates = [];
  let files = 0;
  let bytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`runtime pruning refuses symbolic link ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`runtime pruning refuses special file ${path}`);
      }
      const info = await lstat(path);
      files += 1;
      bytes += info.size;
      const relativePath = relative(absoluteRoot, path);
      const category =
        runtimeArtifactCategory(relativePath, target) ??
        (isUnoptimizedEsbuildLauncher(relativePath, info.size)
          ? "duplicateTooling"
          : undefined);
      if (category !== undefined) {
        candidates.push({
          bytes: info.size,
          category,
          path,
          relativePath,
        });
      }
    }
  }
  await visit(absoluteRoot);
  return { absoluteRoot, bytes, candidates, files };
}

function summarizeCandidates(candidates) {
  const categories = {};
  let bytes = 0;
  for (const candidate of candidates) {
    const current = categories[candidate.category] ?? { bytes: 0, files: 0 };
    current.bytes += candidate.bytes;
    current.files += 1;
    categories[candidate.category] = current;
    bytes += candidate.bytes;
  }
  return { bytes, categories, files: candidates.length };
}

export async function inspectRuntimeArtifacts(runtimeRoot, target = {}) {
  const collected = await collectRuntimeArtifacts(runtimeRoot, target);
  return {
    bytes: collected.bytes,
    files: collected.files,
    prunable: summarizeCandidates(collected.candidates),
  };
}

export async function pruneRuntimeArtifacts(runtimeRoot, target = {}) {
  const absoluteRoot = resolve(runtimeRoot);
  const normalized = await normalizeMistralManifest(absoluteRoot);
  const optimized = await optimizeEsbuildLauncher(absoluteRoot);
  const collected = await collectRuntimeArtifacts(runtimeRoot, target);
  for (const candidate of collected.candidates) {
    await rm(candidate.path, { force: true });
  }
  const prunableDirectories = new Set(
    collected.candidates
      .map((candidate) =>
        prunableRuntimeDirectory(candidate.relativePath, target),
      )
      .filter((directory) => directory !== undefined)
      .map((directory) => directory.path),
  );
  for (const directory of prunableDirectories) {
    await rm(join(absoluteRoot, ...directory.split("/")), {
      force: true,
      recursive: true,
    });
  }
  const removed = summarizeCandidates(collected.candidates);
  return {
    afterBytes: collected.bytes - removed.bytes,
    afterFiles: collected.files - removed.files,
    beforeBytes: collected.bytes + optimized.bytes + normalized.bytes,
    beforeFiles: collected.files,
    normalized,
    optimized,
    removed,
  };
}

export function assertRuntimeSizeBudget(bytes, budgetBytes) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    throw new Error(
      `invalid Harness runtime size budget ${String(budgetBytes)}`,
    );
  }
  if (bytes > budgetBytes) {
    const actualMiB = (bytes / 1024 / 1024).toFixed(1);
    const budgetMiB = (budgetBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      `Harness runtime is ${actualMiB} MiB, above the ${budgetMiB} MiB budget`,
    );
  }
}

export function assertRuntimeFileBudget(files, budgetFiles) {
  if (!Number.isSafeInteger(budgetFiles) || budgetFiles <= 0) {
    throw new Error(
      `invalid Harness runtime file budget ${String(budgetFiles)}`,
    );
  }
  if (files > budgetFiles) {
    throw new Error(
      `Harness runtime contains ${String(files)} files, above the ${String(budgetFiles)} file budget`,
    );
  }
}
