import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

const WEB_PROFILE_MANIFEST = join(
  "profiles",
  "web",
  "package.json",
);
const SESSION_PROJECTION_CACHE = join(
  "storages",
  "session_projcache.json",
);
const WORKSPACE_STORAGE = join(
  "storages",
  "workspace.json",
);

interface WorkspaceRecord {
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceDocument {
  document: Record<string, unknown>;
  unit: Record<string, unknown>;
  global: Record<string, unknown>;
  workspaceIds: string[];
  archivedSessionIds: string[];
  tables: Record<string, unknown>;
  workspaces: Map<string, WorkspaceRecord>;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function parseJsonRecord(
  content: Buffer,
  label: string,
): Record<string, unknown> {
  return parseRecord(
    JSON.parse(content.toString("utf8")) as unknown,
    label,
  );
}

function parseStringArray(
  value: unknown,
  label: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new TypeError(`${label} must be a string array`);
  }
  return [...new Set(value as string[])];
}

function parseStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  if (value === undefined) return {};
  const record = parseRecord(value, label);
  if (
    Object.values(record).some(
      (entry) => typeof entry !== "string",
    )
  ) {
    throw new TypeError(`${label} values must be strings`);
  }
  return record as Record<string, string>;
}

function mergeRecords(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries([
    ...Object.entries(source),
    ...Object.entries(target),
  ]);
}

function mergeStringRecords(
  source: Record<string, string>,
  target: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(source),
    ...Object.entries(target),
  ]);
}

function stableUnion(
  target: readonly string[],
  source: readonly string[],
): string[] {
  return [...new Set([...target, ...source])];
}

function formatJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function mergeWebProfileManifest(
  targetContent: Buffer,
  sourceContent: Buffer,
): Buffer {
  const target = parseJsonRecord(
    targetContent,
    "target web profile manifest",
  );
  const source = parseJsonRecord(
    sourceContent,
    "source web profile manifest",
  );
  const targetDependencies = parseStringRecord(
    target.dependencies,
    "target web profile dependencies",
  );
  const sourceDependencies = parseStringRecord(
    source.dependencies,
    "source web profile dependencies",
  );
  const targetDsh = target.dsh === undefined
    ? {}
    : parseRecord(target.dsh, "target web profile dsh");
  const sourceDsh = source.dsh === undefined
    ? {}
    : parseRecord(source.dsh, "source web profile dsh");
  const targetProfile = targetDsh.profile === undefined
    ? {}
    : parseRecord(
      targetDsh.profile,
      "target web profile settings",
    );
  const sourceProfile = sourceDsh.profile === undefined
    ? {}
    : parseRecord(
      sourceDsh.profile,
      "source web profile settings",
    );
  const targetBundles = targetProfile.bundles === undefined
    ? []
    : parseStringArray(
      targetProfile.bundles,
      "target web profile bundles",
    );
  const sourceBundles = sourceProfile.bundles === undefined
    ? []
    : parseStringArray(
      sourceProfile.bundles,
      "source web profile bundles",
    );

  return formatJson({
    ...source,
    ...target,
    dependencies: mergeStringRecords(
      sourceDependencies,
      targetDependencies,
    ),
    dsh: {
      ...sourceDsh,
      ...targetDsh,
      profile: {
        ...sourceProfile,
        ...targetProfile,
        bundles: stableUnion(targetBundles, sourceBundles),
      },
    },
  });
}

function compatibleUnit(
  value: unknown,
  name: string,
  version: number,
  label: string,
): Record<string, unknown> {
  const unit = parseRecord(value, label);
  if (unit.name !== name || unit.version !== version) {
    throw new TypeError(`${label} is incompatible`);
  }
  return unit;
}

function mergeProjectionCache(
  targetContent: Buffer,
  sourceContent: Buffer,
): Buffer {
  const target = parseJsonRecord(
    targetContent,
    "target session projection cache",
  );
  const source = parseJsonRecord(
    sourceContent,
    "source session projection cache",
  );
  const targetUnit = compatibleUnit(
    target.unit,
    "session_projcache",
    3,
    "target session projection cache unit",
  );
  compatibleUnit(
    source.unit,
    "session_projcache",
    3,
    "source session projection cache unit",
  );
  const targetTables = parseRecord(
    target.tables,
    "target session projection cache tables",
  );
  const sourceTables = parseRecord(
    source.tables,
    "source session projection cache tables",
  );
  const targetSessions = parseRecord(
    targetTables.sessions,
    "target session projection cache sessions",
  );
  const sourceSessions = parseRecord(
    sourceTables.sessions,
    "source session projection cache sessions",
  );

  return formatJson({
    ...source,
    ...target,
    unit: targetUnit,
    global: target.global,
    tables: {
      ...sourceTables,
      ...targetTables,
      sessions: mergeRecords(sourceSessions, targetSessions),
    },
  });
}

function parseWorkspaceRecord(
  value: unknown,
  label: string,
): WorkspaceRecord {
  const record = parseRecord(value, label);
  if (
    typeof record.path !== "string" ||
    typeof record.title !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    Number.isNaN(Date.parse(record.updatedAt))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return {
    path: record.path,
    title: record.title,
    sessionIds: parseStringArray(
      record.sessionIds,
      `${label} session ids`,
    ),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseWorkspaceDocument(
  content: Buffer,
  label: string,
): WorkspaceDocument {
  const document = parseJsonRecord(content, label);
  const unit = compatibleUnit(
    document.unit,
    "workspace",
    2,
    `${label} unit`,
  );
  const global = parseRecord(
    document.global,
    `${label} global state`,
  );
  if (
    typeof global.initialized !== "boolean" ||
    global.pendingMutation !== undefined
  ) {
    throw new TypeError(`${label} global state is not settled`);
  }
  const workspaceIds = parseStringArray(
    global.workspaceIds,
    `${label} workspace ids`,
  );
  const archivedSessionIds = parseStringArray(
    global.archivedSessionIds ?? [],
    `${label} archived session ids`,
  );
  const tables = parseRecord(
    document.tables,
    `${label} tables`,
  );
  const workspaceTable = parseRecord(
    tables.workspaces,
    `${label} workspace table`,
  );
  const workspaces = new Map(
    Object.entries(workspaceTable).map(([id, record]) => [
      id,
      parseWorkspaceRecord(record, `${label} workspace ${id}`),
    ]),
  );
  if (
    workspaceIds.length !== workspaces.size ||
    workspaceIds.some((id) => !workspaces.has(id))
  ) {
    throw new TypeError(
      `${label} workspace order does not match its table`,
    );
  }
  const sessionOwners = new Set<string>();
  for (const workspace of workspaces.values()) {
    for (const sessionId of workspace.sessionIds) {
      if (sessionOwners.has(sessionId)) {
        throw new TypeError(
          `${label} assigns a session to multiple workspaces`,
        );
      }
      sessionOwners.add(sessionId);
    }
  }
  return {
    document,
    unit,
    global,
    workspaceIds,
    archivedSessionIds,
    tables,
    workspaces,
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
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

function laterTimestamp(
  left: string,
  right: string,
): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

async function mergeWorkspaceStorage(
  targetContent: Buffer,
  sourceContent: Buffer,
): Promise<Buffer> {
  const target = parseWorkspaceDocument(
    targetContent,
    "target workspace storage",
  );
  const source = parseWorkspaceDocument(
    sourceContent,
    "source workspace storage",
  );
  const workspaces = new Map(target.workspaces);
  const workspaceIds = [...target.workspaceIds];
  const pathOwners = new Map<string, string>();
  const sessionOwners = new Map<string, string>();

  for (const [id, workspace] of workspaces) {
    const path = await canonicalizePath(workspace.path);
    if (pathOwners.has(path)) {
      throw new TypeError(
        "target workspace storage contains duplicate paths",
      );
    }
    pathOwners.set(path, id);
    for (const sessionId of workspace.sessionIds) {
      sessionOwners.set(sessionId, id);
    }
  }

  for (const sourceId of source.workspaceIds) {
    const sourceWorkspace = source.workspaces.get(sourceId) as
      WorkspaceRecord;
    const path = await canonicalizePath(sourceWorkspace.path);
    const targetId = pathOwners.get(path);
    if (targetId !== undefined) {
      const targetWorkspace = workspaces.get(targetId) as
        WorkspaceRecord;
      const acceptedSourceSessions =
        sourceWorkspace.sessionIds.filter((sessionId) => {
          const owner = sessionOwners.get(sessionId);
          return owner === undefined || owner === targetId;
        });
      const sessionIds = stableUnion(
        targetWorkspace.sessionIds,
        acceptedSourceSessions,
      );
      for (const sessionId of sessionIds) {
        sessionOwners.set(sessionId, targetId);
      }
      workspaces.set(targetId, {
        ...targetWorkspace,
        sessionIds,
        updatedAt: laterTimestamp(
          targetWorkspace.updatedAt,
          sourceWorkspace.updatedAt,
        ),
      });
      continue;
    }
    if (workspaces.has(sourceId)) {
      throw new TypeError(
        "source workspace id collides with a target workspace",
      );
    }
    const sessionIds = sourceWorkspace.sessionIds.filter(
      (sessionId) => !sessionOwners.has(sessionId),
    );
    workspaces.set(sourceId, {
      ...sourceWorkspace,
      sessionIds,
    });
    workspaceIds.push(sourceId);
    pathOwners.set(path, sourceId);
    for (const sessionId of sessionIds) {
      sessionOwners.set(sessionId, sourceId);
    }
  }

  return formatJson({
    ...source.document,
    ...target.document,
    unit: target.unit,
    global: {
      ...source.global,
      ...target.global,
      initialized:
        target.global.initialized || source.global.initialized,
      workspaceIds,
      archivedSessionIds: stableUnion(
        target.archivedSessionIds,
        source.archivedSessionIds,
      ),
    },
    tables: {
      ...source.tables,
      ...target.tables,
      workspaces: Object.fromEntries(
        workspaceIds.map((id) => [
          id,
          workspaces.get(id) as WorkspaceRecord,
        ]),
      ),
    },
  });
}

/**
 * Resolve known DSH metadata conflicts without exposing format-specific
 * behavior through the data-home migration interface.
 */
export async function mergeStructuredDataHomeFile(
  relativePath: string,
  targetContent: Buffer,
  sourceContent: Buffer,
): Promise<Buffer | undefined> {
  try {
    if (relativePath === WEB_PROFILE_MANIFEST) {
      return mergeWebProfileManifest(targetContent, sourceContent);
    }
    if (relativePath === SESSION_PROJECTION_CACHE) {
      return mergeProjectionCache(targetContent, sourceContent);
    }
    if (relativePath === WORKSPACE_STORAGE) {
      return await mergeWorkspaceStorage(
        targetContent,
        sourceContent,
      );
    }
  } catch {
    return undefined;
  }
  return undefined;
}
