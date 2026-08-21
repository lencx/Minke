import { createHash } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  DATA_HOME_CONFLICT_LIMIT,
  parseDataHomeMigrationMode,
  parseDataHomeMigrationState,
  parseDataHomePath,
  type DataHomeMigrationPlan,
  type DataHomeMigrationMode,
  type DataHomeMigrationState,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  mergeStructuredDataHomeFile,
} from "./data-home-structured-merge.ts";

const MIGRATION_JOURNAL_VERSION = 3;
const LEGACY_MIGRATION_JOURNAL_VERSIONS = new Set([1, 2]);
const HARD_LINK_UNSUPPORTED = new Set([
  "EACCES",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
]);

type EntryKind = "directory" | "file" | "symlink";

interface TreeEntry {
  absolutePath?: string;
  content?: Buffer;
  kind: EntryKind;
  mode: number;
  size: number;
  linkTarget?: string;
  hash?: Promise<string>;
}

interface CreateAction {
  kind: "create";
  entry: TreeEntry;
  relativePath: string;
}

interface ReplaceAction {
  kind: "replace";
  entry: TreeEntry;
  original: TreeEntry;
  relativePath: string;
}

type MergeAction = CreateAction | ReplaceAction;

interface PreparedMerge {
  actions: MergeAction[];
  plan: DataHomeMigrationPlan;
}

interface MigrationRequest {
  mode: DataHomeMigrationMode;
  targetPath: string;
  sourcePaths: string[];
}

export type DataHomeMigrationPhase =
  | "pending"
  | "copied"
  | "completed"
  | "failed";

interface MigrationJournalDocument {
  version: typeof MIGRATION_JOURNAL_VERSION;
  phase: DataHomeMigrationPhase;
  request: MigrationRequest;
  state: DataHomeMigrationState;
}

export interface DataHomeInspection {
  fileCount: number;
  byteCount: number;
}

export interface DataHomeMigrationReport {
  mode: DataHomeMigrationMode;
  targetPath: string;
  sourcePaths: string[];
  copiedFiles: number;
  copiedBytes: number;
  identicalFiles: number;
  conflictFiles: number;
  conflicts: string[];
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function containsPath(parent: string, child: string): boolean {
  const parentKey = pathKey(parent);
  const childKey = pathKey(child);
  return (
    childKey === parentKey ||
    childKey.startsWith(`${parentKey}${sep}`)
  );
}

function distinctPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const path = resolve(parseDataHomePath(candidate));
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

async function readTreeEntry(path: string): Promise<TreeEntry> {
  const details = await lstat(path);
  if (details.isDirectory()) {
    return {
      absolutePath: path,
      kind: "directory",
      mode: details.mode,
      size: 0,
    };
  }
  if (details.isFile()) {
    return {
      absolutePath: path,
      kind: "file",
      mode: details.mode,
      size: details.size,
    };
  }
  if (details.isSymbolicLink()) {
    return {
      absolutePath: path,
      kind: "symlink",
      linkTarget: await readlink(path),
      mode: details.mode,
      size: 0,
    };
  }
  throw new TypeError(`unsupported data-home entry: ${path}`);
}

async function entryHash(entry: TreeEntry): Promise<string> {
  entry.hash ??= (async () => {
    const hash = createHash("sha256");
    if (entry.content !== undefined) {
      hash.update(entry.content);
    } else {
      if (entry.absolutePath === undefined) {
        throw new TypeError("data-home file entry has no content");
      }
      for await (const chunk of createReadStream(entry.absolutePath)) {
        hash.update(chunk);
      }
    }
    return hash.digest("hex");
  })();
  return await entry.hash;
}

async function entryContent(entry: TreeEntry): Promise<Buffer> {
  if (entry.kind !== "file") {
    throw new TypeError("data-home entry is not a file");
  }
  if (entry.content !== undefined) return entry.content;
  if (entry.absolutePath === undefined) {
    throw new TypeError("data-home file entry has no source");
  }
  return await readFile(entry.absolutePath);
}

async function sameEntry(
  left: TreeEntry,
  right: TreeEntry,
): Promise<boolean> {
  if (left.kind !== right.kind) return false;
  if (left.kind === "directory") return true;
  if (left.kind === "symlink") {
    return left.linkTarget === right.linkTarget;
  }
  if (left.size !== right.size) return false;
  return await entryHash(left) === await entryHash(right);
}

async function publishStagedFile(
  stagedPath: string,
  destination: string,
): Promise<void> {
  try {
    await link(stagedPath, destination);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined || !HARD_LINK_UNSUPPORTED.has(code)) {
      throw error;
    }
  }
  try {
    await lstat(destination);
    throw new Error(
      `data-home migration target changed during merge: ${destination}`,
    );
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await rename(stagedPath, destination);
}

async function stageFile(
  entry: TreeEntry,
  stagedPath: string,
): Promise<void> {
  if (entry.kind !== "file") {
    throw new TypeError("only files can be staged");
  }
  if (entry.content !== undefined) {
    await writeFile(stagedPath, entry.content, {
      flag: "wx",
      mode: entry.mode & 0o777,
    });
  } else {
    if (entry.absolutePath === undefined) {
      throw new TypeError("data-home file entry has no source");
    }
    await copyFile(
      entry.absolutePath,
      stagedPath,
      fsConstants.COPYFILE_EXCL,
    );
  }
  await chmod(stagedPath, entry.mode & 0o777);
}

async function replaceStagedFile(
  stagedPath: string,
  destination: string,
  original: TreeEntry,
): Promise<void> {
  let current: TreeEntry;
  try {
    current = await readTreeEntry(destination);
  } catch (error) {
    throw new Error(
      `data-home migration target changed during merge: ${destination}`,
      { cause: error },
    );
  }
  if (!(await sameEntry(original, current))) {
    throw new Error(
      `data-home migration target changed during merge: ${destination}`,
    );
  }
  await rename(stagedPath, destination);
}

async function sortedChildren(path: string): Promise<string[]> {
  return (await readdir(path))
    .sort((left, right) => left.localeCompare(right));
}

async function addTargetTree(
  root: string,
  directory: string,
  manifest: Map<string, TreeEntry>,
): Promise<void> {
  for (const name of await sortedChildren(directory)) {
    const absolutePath = join(directory, name);
    const relativePath = relative(root, absolutePath);
    const entry = await readTreeEntry(absolutePath);
    manifest.set(relativePath, entry);
    if (entry.kind === "directory") {
      await addTargetTree(root, absolutePath, manifest);
    }
  }
}

function recordConflict(
  conflicts: string[],
  relativePath: string,
): void {
  if (conflicts.length < DATA_HOME_CONFLICT_LIMIT) {
    conflicts.push(relativePath);
  }
}

async function addSourceTree(
  sourceRoot: string,
  directory: string,
  manifest: Map<string, TreeEntry>,
  totals: {
    identicalFiles: number;
    conflictFiles: number;
    conflicts: string[];
  },
): Promise<void> {
  for (const name of await sortedChildren(directory)) {
    const absolutePath = join(directory, name);
    const relativePath = relative(sourceRoot, absolutePath);
    const entry = await readTreeEntry(absolutePath);
    const existing = manifest.get(relativePath);

    if (entry.kind === "directory") {
      if (existing === undefined) {
        manifest.set(relativePath, entry);
      } else if (existing.kind !== "directory") {
        totals.conflictFiles += 1;
        recordConflict(totals.conflicts, absolutePath);
        continue;
      }
      await addSourceTree(
        sourceRoot,
        absolutePath,
        manifest,
        totals,
      );
      continue;
    }

    if (existing === undefined) {
      manifest.set(relativePath, entry);
      continue;
    }
    if (await sameEntry(existing, entry)) {
      totals.identicalFiles += 1;
      continue;
    }
    if (existing.kind === "file" && entry.kind === "file") {
      const decision = await mergeStructuredDataHomeFile(
        relativePath,
        await entryContent(existing),
        await entryContent(entry),
      );
      if (decision.kind === "merged") {
        const { content } = decision;
        const merged: TreeEntry = {
          content,
          kind: "file",
          mode: existing.mode,
          size: content.byteLength,
        };
        if (await sameEntry(existing, merged)) {
          totals.identicalFiles += 1;
        } else {
          manifest.set(relativePath, merged);
        }
        continue;
      }
    }
    totals.conflictFiles += 1;
    recordConflict(totals.conflicts, absolutePath);
  }
}

async function buildMergeActions(
  targetManifest: ReadonlyMap<string, TreeEntry>,
  manifest: ReadonlyMap<string, TreeEntry>,
): Promise<{
  actions: MergeAction[];
  copyFiles: number;
  copyBytes: number;
}> {
  const actions: MergeAction[] = [];
  let copyFiles = 0;
  let copyBytes = 0;
  for (const [relativePath, entry] of manifest) {
    const original = targetManifest.get(relativePath);
    if (original === undefined) {
      actions.push({
        kind: "create",
        entry,
        relativePath,
      });
      if (entry.kind !== "directory") {
        copyFiles += 1;
        copyBytes += entry.size;
      }
      continue;
    }
    if (await sameEntry(original, entry)) continue;
    if (entry.kind !== "file" || entry.content === undefined) {
      throw new TypeError(
        `unsupported data-home replacement: ${relativePath}`,
      );
    }
    actions.push({
      kind: "replace",
      entry,
      original,
      relativePath,
    });
    copyFiles += 1;
    copyBytes += entry.size;
  }
  actions.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "create" ? -1 : 1;
    }
    if (
      left.entry.kind === "directory" &&
      right.entry.kind !== "directory"
    ) {
      return -1;
    }
    if (
      left.entry.kind !== "directory" &&
      right.entry.kind === "directory"
    ) {
      return 1;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
  return { actions, copyFiles, copyBytes };
}

async function canonicalizePath(path: string): Promise<string> {
  let current = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      return join(
        await realpath(current),
        ...missing.reverse(),
      );
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

async function validateMergePaths(
  sourcePaths: readonly string[],
  targetPath: string,
): Promise<{ sourcePaths: string[]; targetPath: string }> {
  const target = resolve(parseDataHomePath(targetPath));
  const canonicalTarget = await canonicalizePath(target);
  const canonicalSources = new Set<string>();
  const sources: string[] = [];
  for (const source of distinctPaths(sourcePaths)) {
    const canonicalSource = await canonicalizePath(source);
    const canonicalKey = pathKey(canonicalSource);
    if (
      canonicalKey === pathKey(canonicalTarget) ||
      canonicalSources.has(canonicalKey)
    ) {
      continue;
    }
    if (
      containsPath(canonicalSource, canonicalTarget) ||
      containsPath(canonicalTarget, canonicalSource)
    ) {
      throw new RangeError(
        `data-home migration paths must not contain one another: ${source} and ${target}`,
      );
    }
    canonicalSources.add(canonicalKey);
    sources.push(source);
  }
  return { sourcePaths: sources, targetPath: target };
}

async function prepareMerge(
  sourcePathsValue: readonly string[],
  targetPathValue: string,
): Promise<PreparedMerge> {
  const { sourcePaths, targetPath } = await validateMergePaths(
    sourcePathsValue,
    targetPathValue,
  );
  const manifest = new Map<string, TreeEntry>();
  try {
    if (!(await stat(targetPath)).isDirectory()) {
      throw new TypeError("data-home migration target must be a directory");
    }
    await addTargetTree(targetPath, targetPath, manifest);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const targetManifest = new Map(manifest);

  const totals = {
    identicalFiles: 0,
    conflictFiles: 0,
    conflicts: [] as string[],
  };
  for (const sourcePath of sourcePaths) {
    try {
      if (!(await stat(sourcePath)).isDirectory()) {
        throw new TypeError(
          `data-home migration source must be a directory: ${sourcePath}`,
        );
      }
      await addSourceTree(
        sourcePath,
        sourcePath,
        manifest,
        totals,
      );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const actionPlan = await buildMergeActions(
    targetManifest,
    manifest,
  );

  return {
    actions: actionPlan.actions,
    plan: {
      mode: "merge",
      targetPath,
      sourcePaths,
      copyFiles: actionPlan.copyFiles,
      copyBytes: actionPlan.copyBytes,
      ...totals,
    },
  };
}

/** Count regular files and symlinks without following links. */
export async function inspectDataHome(
  root: string,
): Promise<DataHomeInspection> {
  let fileCount = 0;
  let byteCount = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const name of await sortedChildren(directory)) {
      const path = join(directory, name);
      const entry = await readTreeEntry(path);
      if (entry.kind === "directory") {
        await visit(path);
      } else {
        fileCount += 1;
        byteCount += entry.size;
      }
    }
  };
  try {
    if (!(await stat(root)).isDirectory()) {
      throw new TypeError(`data-home path must be a directory: ${root}`);
    }
    await visit(root);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return { fileCount, byteCount };
}

/** Build a read-only, deterministic target-wins merge preview. */
export async function planDataHomeMerge(
  sourcePaths: readonly string[],
  targetPath: string,
): Promise<DataHomeMigrationPlan> {
  return (await prepareMerge(sourcePaths, targetPath)).plan;
}

async function assertFreshTargetEmpty(
  targetPathValue: string,
): Promise<string> {
  const targetPath = resolve(parseDataHomePath(targetPathValue));
  try {
    if (!(await stat(targetPath)).isDirectory()) {
      throw new TypeError(
        "fresh data-home target must be an empty directory",
      );
    }
    if ((await readdir(targetPath)).length !== 0) {
      throw new RangeError(
        "fresh data-home target must be empty",
      );
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return targetPath;
}

/** Confirm that a fresh target is absent or completely empty. */
export async function planFreshDataHome(
  targetPathValue: string,
): Promise<DataHomeMigrationPlan> {
  const targetPath = await assertFreshTargetEmpty(targetPathValue);
  return {
    mode: "fresh",
    targetPath,
    sourcePaths: [],
    copyFiles: 0,
    copyBytes: 0,
    identicalFiles: 0,
    conflictFiles: 0,
    conflicts: [],
  };
}

/** Merge unique data into the target while preserving every conflicting source. */
export async function mergeDataHomes(
  sourcePaths: readonly string[],
  targetPath: string,
): Promise<DataHomeMigrationReport> {
  const prepared = await prepareMerge(sourcePaths, targetPath);
  const targetParent = dirname(
    await canonicalizePath(prepared.plan.targetPath),
  );
  await mkdir(targetParent, {
    recursive: true,
    mode: 0o700,
  });
  const stagingRoot = await mkdtemp(
    join(targetParent, ".minke-data-home-migration-"),
  );
  let stagedFileSequence = 0;
  try {
    await mkdir(prepared.plan.targetPath, {
      recursive: true,
      mode: 0o700,
    });
    for (const action of prepared.actions) {
      const destination = join(
        prepared.plan.targetPath,
        action.relativePath,
      );
      if (action.entry.kind === "directory") {
        await mkdir(destination, {
          recursive: true,
          mode: action.entry.mode & 0o777,
        });
        continue;
      }
      await mkdir(dirname(destination), {
        recursive: true,
        mode: 0o700,
      });
      try {
        if (action.entry.kind === "file") {
          const stagedPath = join(
            stagingRoot,
            String(++stagedFileSequence),
          );
          await stageFile(action.entry, stagedPath);
          if (action.kind === "create") {
            await publishStagedFile(stagedPath, destination);
          } else {
            await replaceStagedFile(
              stagedPath,
              destination,
              action.original,
            );
          }
        } else {
          if (action.kind !== "create") {
            throw new TypeError(
              `unsupported data-home replacement: ${destination}`,
            );
          }
          await symlink(
            action.entry.linkTarget as string,
            destination,
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(
            `data-home migration target changed during merge: ${destination}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  return {
    mode: "merge",
    targetPath: prepared.plan.targetPath,
    sourcePaths: prepared.plan.sourcePaths,
    copiedFiles: prepared.plan.copyFiles,
    copiedBytes: prepared.plan.copyBytes,
    identicalFiles: prepared.plan.identicalFiles,
    conflictFiles: prepared.plan.conflictFiles,
    conflicts: prepared.plan.conflicts,
  };
}

/** Create and activate an empty target without copying existing data. */
export async function activateFreshDataHome(
  targetPathValue: string,
): Promise<DataHomeMigrationReport> {
  const plan = await planFreshDataHome(targetPathValue);
  await mkdir(plan.targetPath, {
    recursive: true,
    mode: 0o700,
  });
  await assertFreshTargetEmpty(plan.targetPath);
  return {
    mode: "fresh",
    targetPath: plan.targetPath,
    sourcePaths: [],
    copiedFiles: 0,
    copiedBytes: 0,
    identicalFiles: 0,
    conflictFiles: 0,
    conflicts: [],
  };
}

function migrationJournalPath(userDataPath: string): string {
  return join(
    userDataPath,
    "desktop",
    "data-home-migration.json",
  );
}

function parseMigrationRequest(value: unknown): MigrationRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("data-home migration request must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "mode" &&
        key !== "targetPath" &&
        key !== "sourcePaths",
    ) ||
    !Array.isArray(record.sourcePaths)
  ) {
    throw new TypeError("invalid data-home migration request");
  }
  return {
    mode: parseDataHomeMigrationMode(record.mode),
    targetPath: resolve(parseDataHomePath(record.targetPath)),
    sourcePaths: distinctPaths(
      record.sourcePaths.map(parseDataHomePath),
    ),
  };
}

function parseJournal(value: unknown): MigrationJournalDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("data-home migration journal must be an object");
  }
  const record = value as Record<string, unknown>;
  const version = record.version;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "version" &&
        key !== "phase" &&
        key !== "request" &&
        key !== "state",
    ) ||
    (
      version !== MIGRATION_JOURNAL_VERSION &&
      !LEGACY_MIGRATION_JOURNAL_VERSIONS.has(
        version as number,
      )
    ) ||
    (
      version !== MIGRATION_JOURNAL_VERSION &&
      record.phase !== undefined
    )
  ) {
    throw new TypeError("unsupported data-home migration journal");
  }
  const state = parseDataHomeMigrationState(record.state);
  const request = parseMigrationRequest(record.request);
  const phase = version === MIGRATION_JOURNAL_VERSION
    ? record.phase
    : state.status;
  if (
    (
      phase !== "pending" &&
      phase !== "copied" &&
      phase !== "completed" &&
      phase !== "failed"
    ) ||
    (
      (phase === "pending" || phase === "copied") &&
      state.status !== "pending"
    ) ||
    (
      (phase === "completed" || phase === "failed") &&
      state.status !== phase
    )
  ) {
    throw new TypeError("invalid data-home migration journal phase");
  }
  if (
    request.mode !== state.mode ||
    pathKey(request.targetPath) !== pathKey(state.targetPath)
  ) {
    throw new TypeError("inconsistent data-home migration journal");
  }
  return {
    version: MIGRATION_JOURNAL_VERSION,
    phase,
    request,
    state,
  };
}

/** Process-restart boundary for one resumable data-home migration. */
export class DataHomeMigrationJournal {
  readonly path: string;
  #writeSequence = 0;

  constructor(userDataPath: string) {
    this.path = migrationJournalPath(userDataPath);
  }

  async read(): Promise<MigrationJournalDocument | undefined> {
    try {
      return parseJournal(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async schedule(plan: DataHomeMigrationPlan): Promise<void> {
    await this.#write({
      version: MIGRATION_JOURNAL_VERSION,
      phase: "pending",
      request: {
        mode: plan.mode,
        targetPath: plan.targetPath,
        sourcePaths: plan.sourcePaths,
      },
      state: {
        mode: plan.mode,
        status: "pending",
        targetPath: plan.targetPath,
        copiedFiles: 0,
        copiedBytes: 0,
        identicalFiles: 0,
        conflictFiles: 0,
        conflicts: [],
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async markCopied(
    report: DataHomeMigrationReport,
  ): Promise<void> {
    await this.#write({
      version: MIGRATION_JOURNAL_VERSION,
      phase: "copied",
      request: {
        mode: report.mode,
        targetPath: report.targetPath,
        sourcePaths: report.sourcePaths,
      },
      state: {
        mode: report.mode,
        status: "pending",
        targetPath: report.targetPath,
        copiedFiles: report.copiedFiles,
        copiedBytes: report.copiedBytes,
        identicalFiles: report.identicalFiles,
        conflictFiles: report.conflictFiles,
        conflicts: report.conflicts,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async complete(): Promise<void> {
    const current = await this.read();
    if (current === undefined) {
      throw new Error("data-home migration journal is missing");
    }
    if (current.phase === "completed") return;
    if (current.phase !== "copied") {
      throw new Error(
        `data-home migration cannot complete from ${current.phase}`,
      );
    }
    await this.#write({
      ...current,
      phase: "completed",
      state: {
        ...current.state,
        status: "completed",
        error: undefined,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async defer(error: unknown): Promise<void> {
    const current = await this.read();
    if (current === undefined || current.phase !== "copied") {
      return;
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 4_096) || "Unknown migration failure";
    await this.#write({
      ...current,
      state: {
        ...current.state,
        status: "pending",
        error: message,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async fail(error: unknown): Promise<void> {
    const current = await this.read();
    if (current === undefined) return;
    if (current.phase === "copied") {
      await this.defer(error);
      return;
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 4_096) || "Unknown migration failure";
    await this.#write({
      ...current,
      phase: "failed",
      state: {
        ...current.state,
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async #write(document: MigrationJournalDocument): Promise<void> {
    await mkdir(dirname(this.path), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryPath = `${this.path}.${String(
      process.pid,
    )}.${String(++this.#writeSequence)}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(document, null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
