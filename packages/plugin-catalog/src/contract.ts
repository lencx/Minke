export const PLUGIN_CATALOG_SNAPSHOT_VERSION = 1 as const;

export type PluginInstallVerification =
  | "verified"
  | "build-required"
  | "unverified";

export interface PluginCatalogEntry {
  id: string;
  repository: string;
  repositoryUrl: string;
  packagePath: string;
  packageName: string;
  version: string | null;
  description: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushedAt: string | null;
  installSpec: string;
  installVerification: PluginInstallVerification;
  requiresBuildAllowance: boolean;
}

export interface PluginCatalogCounts {
  repositories: number;
  pendingRepositories: number;
  plugins: number;
}

export interface PluginCatalogSnapshot {
  version: typeof PLUGIN_CATALOG_SNAPSHOT_VERSION;
  generatedAt: string | null;
  lastRefreshAt: string | null;
  lastFullScanAt: string | null;
  refreshing: boolean;
  counts: PluginCatalogCounts;
  plugins: PluginCatalogEntry[];
  error?: string;
}

const EXACT_ENTRY_KEYS = new Set([
  "id",
  "repository",
  "repositoryUrl",
  "packagePath",
  "packageName",
  "version",
  "description",
  "topics",
  "language",
  "stars",
  "pushedAt",
  "installSpec",
  "installVerification",
  "requiresBuildAllowance",
]);

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nullableString(
  value: unknown,
  label: string,
): string | null {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null`);
  }
  return value;
}

function parseEntry(value: unknown): PluginCatalogEntry {
  const entry = record(value, "plugin catalog entry");
  if (
    Object.keys(entry).length !== EXACT_ENTRY_KEYS.size ||
    Object.keys(entry).some((key) => !EXACT_ENTRY_KEYS.has(key)) ||
    typeof entry.id !== "string" ||
    entry.id.length === 0 ||
    typeof entry.repository !== "string" ||
    entry.repository.length === 0 ||
    typeof entry.repositoryUrl !== "string" ||
    typeof entry.packagePath !== "string" ||
    typeof entry.packageName !== "string" ||
    entry.packageName.length === 0 ||
    typeof entry.description !== "string" ||
    !Array.isArray(entry.topics) ||
    entry.topics.some((topic) => typeof topic !== "string") ||
    !Number.isSafeInteger(entry.stars) ||
    Number(entry.stars) < 0 ||
    typeof entry.installSpec !== "string" ||
    ![
      "verified",
      "build-required",
      "unverified",
    ].includes(String(entry.installVerification)) ||
    typeof entry.requiresBuildAllowance !== "boolean"
  ) {
    throw new TypeError("invalid plugin catalog entry");
  }
  return {
    id: entry.id,
    repository: entry.repository,
    repositoryUrl: entry.repositoryUrl,
    packagePath: entry.packagePath,
    packageName: entry.packageName,
    version: nullableString(entry.version, "plugin version"),
    description: entry.description,
    topics: [...entry.topics],
    language: nullableString(entry.language, "plugin language"),
    stars: Number(entry.stars),
    pushedAt: nullableString(entry.pushedAt, "plugin pushedAt"),
    installSpec: entry.installSpec,
    installVerification:
      entry.installVerification as PluginInstallVerification,
    requiresBuildAllowance: entry.requiresBuildAllowance,
  };
}

function parseCounts(value: unknown): PluginCatalogCounts {
  const counts = record(value, "plugin catalog counts");
  if (
    Object.keys(counts).length !== 3 ||
    Object.keys(counts).some(
      (key) =>
        key !== "repositories" &&
        key !== "pendingRepositories" &&
        key !== "plugins",
    ) ||
    !Number.isSafeInteger(counts.repositories) ||
    Number(counts.repositories) < 0 ||
    !Number.isSafeInteger(counts.pendingRepositories) ||
    Number(counts.pendingRepositories) < 0 ||
    !Number.isSafeInteger(counts.plugins) ||
    Number(counts.plugins) < 0
  ) {
    throw new TypeError("invalid plugin catalog counts");
  }
  return {
    repositories: Number(counts.repositories),
    pendingRepositories: Number(counts.pendingRepositories),
    plugins: Number(counts.plugins),
  };
}

/** Validate one cache-backed catalog snapshot crossing desktop IPC. */
export function parsePluginCatalogSnapshot(
  value: unknown,
): PluginCatalogSnapshot {
  const snapshot = record(value, "plugin catalog snapshot");
  const keys = Object.keys(snapshot);
  if (
    keys.some(
      (key) =>
        key !== "version" &&
        key !== "generatedAt" &&
        key !== "lastRefreshAt" &&
        key !== "lastFullScanAt" &&
        key !== "refreshing" &&
        key !== "counts" &&
        key !== "plugins" &&
        key !== "error",
    ) ||
    snapshot.version !== PLUGIN_CATALOG_SNAPSHOT_VERSION ||
    typeof snapshot.refreshing !== "boolean" ||
    !Array.isArray(snapshot.plugins) ||
    (
      snapshot.error !== undefined &&
      typeof snapshot.error !== "string"
    )
  ) {
    throw new TypeError("invalid plugin catalog snapshot");
  }
  const plugins = snapshot.plugins.map(parseEntry);
  const counts = parseCounts(snapshot.counts);
  if (counts.plugins !== plugins.length) {
    throw new TypeError("plugin catalog count does not match entries");
  }
  return {
    version: PLUGIN_CATALOG_SNAPSHOT_VERSION,
    generatedAt: nullableString(
      snapshot.generatedAt,
      "catalog generatedAt",
    ),
    lastRefreshAt: nullableString(
      snapshot.lastRefreshAt,
      "catalog lastRefreshAt",
    ),
    lastFullScanAt: nullableString(
      snapshot.lastFullScanAt,
      "catalog lastFullScanAt",
    ),
    refreshing: snapshot.refreshing,
    counts,
    plugins,
    ...(snapshot.error === undefined
      ? {}
      : { error: snapshot.error }),
  };
}
