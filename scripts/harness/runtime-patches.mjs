import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

const patchDirectory = "patches/deepseek-harness/";
const runtimePackagePrefix = "node_modules/@deepseek-ai/";
const forbiddenPatchOperations =
  /^(?:new file mode|deleted file mode|rename (?:from|to)|copy (?:from|to)|GIT binary patch|Binary files )/mu;

function resolveInside(root, relativePath, label) {
  const absolute = resolve(root, ...relativePath.split("/"));
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} escapes the Minke project: ${relativePath}`);
  }
  return absolute;
}

function validateRelativePatchPath(path) {
  if (
    typeof path !== "string" ||
    path === "" ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    !path.startsWith(patchDirectory) ||
    !path.endsWith(".patch")
  ) {
    throw new Error(
      `Harness runtime patch must live under ${patchDirectory} and use a .patch extension: ${String(path)}`,
    );
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Harness runtime patch path is unsafe: ${path}`);
  }
}

function validateRuntimeTarget(path, patchPath) {
  if (
    path.includes("\\") ||
    path.includes("//") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    !path.startsWith(runtimePackagePrefix) ||
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `Harness runtime patch ${patchPath} has an unsafe runtime path: ${path}`,
    );
  }
}

function validatePatchSource(source, patchPath) {
  if (source === "" || !source.endsWith("\n")) {
    throw new Error(
      `Harness runtime patch ${patchPath} must be non-empty and end with a newline`,
    );
  }
  if (forbiddenPatchOperations.test(source)) {
    throw new Error(
      `Harness runtime patch ${patchPath} may only modify existing text files`,
    );
  }

  const headers = [
    ...source.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gmu),
  ];
  if (headers.length === 0 || !source.startsWith("diff --git ")) {
    throw new Error(
      `Harness runtime patch ${patchPath} is not a git unified diff`,
    );
  }

  const targets = [];
  for (const [index, header] of headers.entries()) {
    const oldPath = header[1];
    const newPath = header[2];
    if (oldPath !== newPath) {
      throw new Error(
        `Harness runtime patch ${patchPath} cannot rename ${oldPath} to ${newPath}`,
      );
    }
    validateRuntimeTarget(oldPath, patchPath);
    const sectionStart = header.index;
    const sectionEnd =
      headers[index + 1]?.index ?? source.length;
    const section = source.slice(sectionStart, sectionEnd);
    if (
      !section.includes(`\n--- a/${oldPath}\n`) ||
      !section.includes(`\n+++ b/${newPath}\n`) ||
      !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/mu.test(section)
    ) {
      throw new Error(
        `Harness runtime patch ${patchPath} has an incomplete diff for ${oldPath}`,
      );
    }
    targets.push(oldPath);
  }
  return targets;
}

export async function resolveHarnessRuntimePatches(
  projectRoot,
  declarations,
) {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    throw new Error(
      "Harness contract must declare at least one local runtime patch",
    );
  }
  if (new Set(declarations).size !== declarations.length) {
    throw new Error("Harness runtime patch declarations must be unique");
  }

  const patches = [];
  for (const path of declarations) {
    validateRelativePatchPath(path);
    const absolutePath = resolveInside(projectRoot, path, "runtime patch");
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Harness runtime patch must be a regular file: ${path}`);
    }
    const source = await readFile(absolutePath, "utf8");
    patches.push({
      absolutePath,
      path,
      targets: validatePatchSource(source, path),
    });
  }
  return patches;
}

function runGitApply(runtimeRoot, patches, { check = false, reverse = false } = {}) {
  const args = [
    "apply",
    ...(check ? ["--check"] : []),
    ...(reverse ? ["--reverse"] : []),
    "--no-index",
    "--verbose",
    "--whitespace=error-all",
    ...patches.map((patch) => patch.absolutePath),
  ];
  const result = spawnSync("git", args, {
    cwd: runtimeRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      GIT_CEILING_DIRECTORIES: dirname(resolve(runtimeRoot)),
    },
  });
  if (result.error !== undefined) throw result.error;
  const detail = [result.stderr, result.stdout]
    .filter((value) => value !== "")
    .join("\n")
    .trim();
  if (result.status !== 0 || /Skipped patch /u.test(detail)) {
    throw new Error(
      `Harness runtime patch ${
        reverse ? "is not present in the staged runtime" : "does not apply cleanly"
      }${
        detail === "" ? "" : `:\n${detail}`
      }`,
    );
  }
}

export async function applyHarnessRuntimePatches(runtimeRoot, patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("no resolved Harness runtime patches were provided");
  }
  runGitApply(runtimeRoot, patches, { check: true });
  runGitApply(runtimeRoot, patches);
}

export async function verifyHarnessRuntimePatchesApplied(
  runtimeRoot,
  patches,
) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("no resolved Harness runtime patches were provided");
  }
  runGitApply(runtimeRoot, patches, { check: true, reverse: true });
}
