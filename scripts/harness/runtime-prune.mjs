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

export const RUNTIME_PRUNE_POLICY_VERSION = 4;

const DOCUMENTATION_FILE =
  /^(?:readme|changelog|changes|history)(?:\.(?:md|markdown|txt))?$/iu;
const DUPLICATE_PNPM_EXECUTABLE =
  /(?:^|\/)node_modules\/pnpm\/artifacts(?:\/|$)/u;
const PUBLISHED_PACKAGE_BAGGAGE_DIRECTORIES = Object.freeze([
  "node_modules/@mixmark-io/domino/.yarn",
  "node_modules/@mixmark-io/domino/test",
  "node_modules/@earendil-works/pi-ai/node_modules/@mistralai/mistralai/examples",
  "node_modules/@earendil-works/pi-ai/node_modules/@mistralai/mistralai/packages",
  "node_modules/@earendil-works/pi-ai/node_modules/@mistralai/mistralai/tests",
]);
const ESBUILD_LAUNCHER_PATH = "node_modules/esbuild/bin/esbuild";
const ESBUILD_NATIVE_BINARY_MIN_BYTES = 64 * 1024;

export function runtimeArtifactCategory(path) {
  const normalizedPath = path.replaceAll("\\", "/");
  if (
    PUBLISHED_PACKAGE_BAGGAGE_DIRECTORIES.some(
      (directory) =>
        normalizedPath === directory ||
        normalizedPath.startsWith(`${directory}/`),
    )
  ) {
    return "publishedPackageBaggage";
  }
  if (DUPLICATE_PNPM_EXECUTABLE.test(normalizedPath)) {
    return "duplicateTooling";
  }
  const name = basename(path);
  if (/\.map$/iu.test(name)) return "sourceMaps";
  if (/\.d\.(?:ts|mts|cts)$/iu.test(name)) return "typeDeclarations";
  if (/\.tsbuildinfo$/iu.test(name)) return "buildCaches";
  if (DOCUMENTATION_FILE.test(name)) return "documentation";
  return undefined;
}

export function isPrunableRuntimePath(path) {
  return runtimeArtifactCategory(path) !== undefined;
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

async function collectRuntimeArtifacts(runtimeRoot) {
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
        runtimeArtifactCategory(relativePath) ??
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

export async function inspectRuntimeArtifacts(runtimeRoot) {
  const collected = await collectRuntimeArtifacts(runtimeRoot);
  return {
    bytes: collected.bytes,
    files: collected.files,
    prunable: summarizeCandidates(collected.candidates),
  };
}

export async function pruneRuntimeArtifacts(runtimeRoot) {
  const absoluteRoot = resolve(runtimeRoot);
  const optimized = await optimizeEsbuildLauncher(absoluteRoot);
  const collected = await collectRuntimeArtifacts(runtimeRoot);
  for (const candidate of collected.candidates) {
    await rm(candidate.path, { force: true });
  }
  for (const directory of PUBLISHED_PACKAGE_BAGGAGE_DIRECTORIES) {
    await rm(join(absoluteRoot, ...directory.split("/")), {
      force: true,
      recursive: true,
    });
  }
  const removed = summarizeCandidates(collected.candidates);
  return {
    afterBytes: collected.bytes - removed.bytes,
    afterFiles: collected.files - removed.files,
    beforeBytes: collected.bytes + optimized.bytes,
    beforeFiles: collected.files,
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
