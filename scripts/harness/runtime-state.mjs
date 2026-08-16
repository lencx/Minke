import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function updateHash(hash, kind, path, value = "") {
  hash.update(kind);
  hash.update("\0");
  hash.update(path);
  hash.update("\0");
  hash.update(value);
  hash.update("\0");
}

async function hashEntry(hash, root, path, shouldIgnore) {
  const relativePath = relative(root, path);
  if (shouldIgnore?.(relativePath) === true) return;
  if (!existsSync(path)) {
    updateHash(hash, "missing", relativePath);
    return;
  }
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`runtime fingerprint refuses symbolic link ${path}`);
  }
  if (info.isDirectory()) {
    updateHash(hash, "directory", relativePath);
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await hashEntry(
        hash,
        root,
        join(path, entry.name),
        shouldIgnore,
      );
    }
    return;
  }
  if (!info.isFile()) {
    throw new Error(`runtime fingerprint refuses special file ${path}`);
  }
  updateHash(hash, "file", relativePath);
  hash.update(await readFile(path));
  hash.update("\0");
}

/** Hash a deterministic set of regular files and directories below one root. */
export async function fingerprintPaths(
  root,
  paths,
  { shouldIgnore } = {},
) {
  const absoluteRoot = resolve(root);
  const hash = createHash("sha256");
  hash.update("minke-runtime-fingerprint-v1\0");
  for (const entry of [...paths].sort()) {
    const path = resolve(absoluteRoot, entry);
    if (!isInside(absoluteRoot, path)) {
      throw new Error(`runtime fingerprint path escapes root: ${entry}`);
    }
    await hashEntry(hash, absoluteRoot, path, shouldIgnore);
  }
  return hash.digest("hex");
}

/** Hash structured runtime facts without relying on object insertion order. */
export function fingerprintRecord(value) {
  const hash = createHash("sha256");
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      hash.update("[");
      for (const item of entry) visit(item);
      hash.update("]");
      return;
    }
    if (entry !== null && typeof entry === "object") {
      hash.update("{");
      for (const key of Object.keys(entry).sort()) {
        hash.update(key);
        hash.update("\0");
        visit(entry[key]);
      }
      hash.update("}");
      return;
    }
    hash.update(`${typeof entry}:${String(entry)}\0`);
  };
  visit(value);
  return hash.digest("hex");
}

/** Replace a file through a same-directory temporary path. */
export async function writeFileAtomic(path, contents, options = {}) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents);
    if (options.mode !== undefined) {
      await chmod(temporary, options.mode);
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Publish one fully prepared directory with rollback if the final rename fails.
 * Candidate and destination must share the destination's parent filesystem.
 */
export async function publishDirectory(candidate, destination) {
  const absoluteCandidate = resolve(candidate);
  const absoluteDestination = resolve(destination);
  const parent = dirname(absoluteDestination);
  if (
    absoluteCandidate === absoluteDestination ||
    !isInside(parent, absoluteCandidate)
  ) {
    throw new Error(
      `runtime candidate must live below ${parent}: ${absoluteCandidate}`,
    );
  }
  const candidateInfo = await lstat(absoluteCandidate);
  if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) {
    throw new Error(`runtime candidate is not a directory: ${absoluteCandidate}`);
  }

  const backup = join(
    parent,
    `.${basename(absoluteDestination)}.backup.${randomUUID()}`,
  );
  const hadDestination = existsSync(absoluteDestination);
  if (hadDestination) {
    await rename(absoluteDestination, backup);
  }
  try {
    await rename(absoluteCandidate, absoluteDestination);
  } catch (error) {
    if (hadDestination && existsSync(backup)) {
      await rename(backup, absoluteDestination);
    }
    throw error;
  }
  if (hadDestination) {
    await rm(backup, { recursive: true, force: true });
  }
}

/** Validate a candidate completely before making it visible as the active tree. */
export async function publishValidatedDirectory(
  candidate,
  destination,
  validate,
) {
  await validate(candidate);
  await publishDirectory(candidate, destination);
}
