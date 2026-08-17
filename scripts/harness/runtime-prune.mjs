import { lstat, readdir, rm } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export const RUNTIME_PRUNE_POLICY_VERSION = 1;

const DOCUMENTATION_FILE =
  /^(?:readme|changelog|changes|history)(?:\.(?:md|markdown|txt))?$/iu;

export function runtimeArtifactCategory(path) {
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
      const category = runtimeArtifactCategory(entry.name);
      if (category !== undefined) {
        candidates.push({
          bytes: info.size,
          category,
          path,
          relativePath: relative(absoluteRoot, path),
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
  const collected = await collectRuntimeArtifacts(runtimeRoot);
  for (const candidate of collected.candidates) {
    await rm(candidate.path, { force: true });
  }
  const removed = summarizeCandidates(collected.candidates);
  return {
    afterBytes: collected.bytes - removed.bytes,
    afterFiles: collected.files - removed.files,
    beforeBytes: collected.bytes,
    beforeFiles: collected.files,
    removed,
  };
}

export function assertRuntimeSizeBudget(bytes, budgetBytes) {
  if (
    !Number.isSafeInteger(budgetBytes) ||
    budgetBytes <= 0
  ) {
    throw new Error(`invalid Harness runtime size budget ${String(budgetBytes)}`);
  }
  if (bytes > budgetBytes) {
    const actualMiB = (bytes / 1024 / 1024).toFixed(1);
    const budgetMiB = (budgetBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      `Harness runtime is ${actualMiB} MiB, above the ${budgetMiB} MiB budget`,
    );
  }
}
