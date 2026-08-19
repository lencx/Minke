export const PLUGIN_CATALOG_SNAPSHOT_VERSION = 2 as const;
export const PLUGIN_CATALOG_VISIBLE_CANDIDATE_LIMIT = 200;

export type PluginInstallVerification =
  | "verified"
  | "build-required"
  | "unverified";

export type PluginCatalogCandidateStatus =
  | "pending"
  | "error";

export type PluginCatalogCredentialSource =
  | "environment"
  | "secure-storage";

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
  installed: boolean;
}

export interface PluginCatalogCandidate {
  id: string;
  repository: string;
  repositoryUrl: string;
  description: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushedAt: string | null;
  status: PluginCatalogCandidateStatus;
}

export interface PluginCatalogCredentialState {
  configured: boolean;
  writable: boolean;
  source?: PluginCatalogCredentialSource;
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
  candidates: PluginCatalogCandidate[];
  credential: PluginCatalogCredentialState;
  error?: string;
}

/** Validate a credential literal without exposing it through a read model. */
export function parsePluginCatalogGitHubToken(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new TypeError("GitHub token must be a string");
  }
  const token = value.trim();
  if (
    token !== value ||
    !/^[\x21-\x7E]{1,512}$/u.test(token) ||
    /^[A-Z][A-Z0-9_]*=[^=]/u.test(token) ||
    (
      token.length > 1 &&
      (
        (token.startsWith("\"") && token.endsWith("\"")) ||
        (token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith("`") && token.endsWith("`"))
      )
    )
  ) {
    throw new TypeError("invalid GitHub token");
  }
  return token;
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
  "installed",
]);

const EXACT_CANDIDATE_KEYS = new Set([
  "id",
  "repository",
  "repositoryUrl",
  "description",
  "topics",
  "language",
  "stars",
  "pushedAt",
  "status",
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
    typeof entry.requiresBuildAllowance !== "boolean" ||
    typeof entry.installed !== "boolean"
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
    installed: entry.installed,
  };
}

function parseCandidate(
  value: unknown,
): PluginCatalogCandidate {
  const candidate = record(
    value,
    "plugin catalog candidate",
  );
  if (
    Object.keys(candidate).length !==
      EXACT_CANDIDATE_KEYS.size ||
    Object.keys(candidate).some(
      (key) => !EXACT_CANDIDATE_KEYS.has(key),
    ) ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.repository !== "string" ||
    candidate.repository.length === 0 ||
    candidate.id !== candidate.repository ||
    typeof candidate.repositoryUrl !== "string" ||
    typeof candidate.description !== "string" ||
    !Array.isArray(candidate.topics) ||
    candidate.topics.some(
      (topic) => typeof topic !== "string",
    ) ||
    !Number.isSafeInteger(candidate.stars) ||
    Number(candidate.stars) < 0 ||
    (
      candidate.status !== "pending" &&
      candidate.status !== "error"
    )
  ) {
    throw new TypeError("invalid plugin catalog candidate");
  }
  return {
    id: candidate.id,
    repository: candidate.repository,
    repositoryUrl: candidate.repositoryUrl,
    description: candidate.description,
    topics: [...candidate.topics],
    language: nullableString(
      candidate.language,
      "candidate language",
    ),
    stars: Number(candidate.stars),
    pushedAt: nullableString(
      candidate.pushedAt,
      "candidate pushedAt",
    ),
    status: candidate.status,
  };
}

export function parsePluginCatalogCredentialState(
  value: unknown,
): PluginCatalogCredentialState {
  const credential = record(
    value,
    "plugin catalog credential",
  );
  const keys = Object.keys(credential);
  if (
    keys.some(
      (key) =>
        key !== "configured" &&
        key !== "writable" &&
        key !== "source",
    ) ||
    typeof credential.configured !== "boolean" ||
    typeof credential.writable !== "boolean" ||
    (
      credential.source !== undefined &&
      credential.source !== "environment" &&
      credential.source !== "secure-storage"
    ) ||
    (
      credential.configured !==
      (credential.source !== undefined)
    ) ||
    (
      credential.source === "environment" &&
      credential.writable
    )
  ) {
    throw new TypeError(
      "invalid plugin catalog credential state",
    );
  }
  return {
    configured: credential.configured,
    writable: credential.writable,
    ...(credential.source === undefined
      ? {}
      : { source: credential.source }),
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
        key !== "candidates" &&
        key !== "credential" &&
        key !== "error",
    ) ||
    snapshot.version !== PLUGIN_CATALOG_SNAPSHOT_VERSION ||
    typeof snapshot.refreshing !== "boolean" ||
    !Array.isArray(snapshot.plugins) ||
    !Array.isArray(snapshot.candidates) ||
    (
      snapshot.error !== undefined &&
      typeof snapshot.error !== "string"
    )
  ) {
    throw new TypeError("invalid plugin catalog snapshot");
  }
  const plugins = snapshot.plugins.map(parseEntry);
  const candidates = snapshot.candidates.map(parseCandidate);
  const counts = parseCounts(snapshot.counts);
  if (counts.plugins !== plugins.length) {
    throw new TypeError("plugin catalog count does not match entries");
  }
  if (
    candidates.length >
      PLUGIN_CATALOG_VISIBLE_CANDIDATE_LIMIT ||
    candidates.length > counts.pendingRepositories
  ) {
    throw new TypeError(
      "plugin catalog candidate count is invalid",
    );
  }
  const pluginIds = new Set<string>();
  const pluginRepositories = new Set<string>();
  for (const plugin of plugins) {
    if (pluginIds.has(plugin.id)) {
      throw new TypeError("duplicate plugin catalog entry");
    }
    pluginIds.add(plugin.id);
    pluginRepositories.add(plugin.repository);
  }
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      candidateIds.has(candidate.id) ||
      pluginRepositories.has(candidate.repository)
    ) {
      throw new TypeError(
        "duplicate plugin catalog candidate",
      );
    }
    candidateIds.add(candidate.id);
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
    candidates,
    credential: parsePluginCatalogCredentialState(
      snapshot.credential,
    ),
    ...(snapshot.error === undefined
      ? {}
      : { error: snapshot.error }),
  };
}
