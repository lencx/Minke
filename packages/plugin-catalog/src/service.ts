import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  PLUGIN_CATALOG_SNAPSHOT_VERSION,
  type PluginCatalogEntry,
  type PluginCatalogSnapshot,
  type PluginInstallVerification,
} from "./contract.ts";
import {
  GitHubCatalogSource,
  GitHubResponseError,
  type GitHubRepository,
  type GitHubTree,
  type GitHubTreeEntry,
} from "./github.ts";

const CACHE_VERSION = 1 as const;
const DEFAULT_TOPIC = "dsh-plugin";
const AUTHENTICATED_REFRESH_INTERVAL_MS = 30 * 60_000;
const ANONYMOUS_REFRESH_INTERVAL_MS = 60 * 60_000;
const DEFAULT_FULL_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_VALIDATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_RETRY_INTERVAL_MS = 30 * 60_000;
const DISCOVERY_OVERLAP_MS = 5 * 60_000;
const AUTHENTICATED_SEARCH_PACE_MS = 2_100;
const ANONYMOUS_SEARCH_PACE_MS = 6_100;
const AUTHENTICATED_REPOSITORY_BUDGET = 100;
const ANONYMOUS_REPOSITORY_BUDGET = 20;
const AUTHENTICATED_MANIFEST_BUDGET = 240;
const ANONYMOUS_MANIFEST_BUDGET = 35;
const CORE_RATE_RESERVE = 5;
const MAX_PLUGIN_ID_LENGTH = 201;
const MAX_ERROR_LENGTH = 4_096;
const PLUGIN_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/u;

type RepositoryValidationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "error";

interface CachedPlugin {
  id: string;
  packagePath: string;
  packageName: string;
  version: string | null;
  description: string;
  patchPath: string;
  installSpec: string;
  installVerification: PluginInstallVerification;
  requiresBuildAllowance: boolean;
  seenRevision: string;
}

interface CachedValidation {
  status: RepositoryValidationStatus;
  checkedAt: string | null;
  checkedRevision: string | null;
  lastAttemptAt: string | null;
  cursor: string | null;
  sweepRevision: string | null;
  failure: string | null;
}

interface CachedRepository {
  githubId: number;
  fullName: string;
  repositoryUrl: string;
  description: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushedAt: string | null;
  defaultBranch: string;
  present: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  validation: CachedValidation;
  plugins: CachedPlugin[];
  sweepPlugins: CachedPlugin[];
}

interface CatalogCacheDocument {
  version: typeof CACHE_VERSION;
  savedAt: string | null;
  state: {
    watermark: string | null;
    lastRefreshAt: string | null;
    lastFullScanAt: string | null;
  };
  repositories: CachedRepository[];
}

export interface PluginCatalogLogger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
}

export interface PluginCatalogServiceOptions {
  userDataPath: string;
  fetcher?: (
    input: string,
    init?: RequestInit,
  ) => Promise<Response>;
  token?: string;
  topic?: string;
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
  refreshIntervalMs?: number;
  fullScanIntervalMs?: number;
  validationMaxAgeMs?: number;
  retryIntervalMs?: number;
  repositoryBudget?: number;
  manifestBudget?: number;
  searchPaceMs?: number;
  requestTimeoutMs?: number;
  logger?: PluginCatalogLogger;
}

export interface PluginCatalogModule {
  start(): Promise<void>;
  read(): Promise<PluginCatalogSnapshot>;
  refresh(): Promise<PluginCatalogSnapshot>;
  cancelRefresh(): Promise<PluginCatalogSnapshot>;
  dispose(): void;
}

interface ManifestInspection {
  plugin: Omit<CachedPlugin, "seenRevision"> | null;
}

class PluginCatalogRefreshCancelledError extends Error {
  constructor() {
    super("Plugin catalog refresh cancelled");
    this.name = "PluginCatalogRefreshCancelledError";
  }
}

function emptyCache(): CatalogCacheDocument {
  return {
    version: CACHE_VERSION,
    savedAt: null,
    state: {
      watermark: null,
      lastRefreshAt: null,
      lastFullScanAt: null,
    },
    repositories: [],
  };
}

function object(
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

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
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

function nonnegativeInteger(
  value: unknown,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
  return Number(value);
}

function parseCachedPlugin(value: unknown): CachedPlugin {
  const plugin = object(value, "cached plugin");
  if (
    ![
      "verified",
      "build-required",
      "unverified",
    ].includes(String(plugin.installVerification)) ||
    typeof plugin.requiresBuildAllowance !== "boolean"
  ) {
    throw new TypeError("invalid cached plugin");
  }
  return {
    id: string(plugin.id, "cached plugin id"),
    packagePath: string(
      plugin.packagePath,
      "cached plugin packagePath",
    ),
    packageName: string(
      plugin.packageName,
      "cached plugin packageName",
    ),
    version: nullableString(
      plugin.version,
      "cached plugin version",
    ),
    description: string(
      plugin.description,
      "cached plugin description",
    ),
    patchPath: string(
      plugin.patchPath,
      "cached plugin patchPath",
    ),
    installSpec: string(
      plugin.installSpec,
      "cached plugin installSpec",
    ),
    installVerification:
      plugin.installVerification as PluginInstallVerification,
    requiresBuildAllowance: plugin.requiresBuildAllowance,
    seenRevision: string(
      plugin.seenRevision,
      "cached plugin revision",
    ),
  };
}

function parseCachedValidation(
  value: unknown,
): CachedValidation {
  const validation = object(value, "cached validation");
  if (
    ![
      "pending",
      "accepted",
      "rejected",
      "error",
    ].includes(String(validation.status))
  ) {
    throw new TypeError("invalid cached validation status");
  }
  return {
    status: validation.status as RepositoryValidationStatus,
    checkedAt: nullableString(
      validation.checkedAt,
      "cached validation checkedAt",
    ),
    checkedRevision: nullableString(
      validation.checkedRevision,
      "cached validation checkedRevision",
    ),
    lastAttemptAt: nullableString(
      validation.lastAttemptAt,
      "cached validation lastAttemptAt",
    ),
    cursor: nullableString(
      validation.cursor,
      "cached validation cursor",
    ),
    sweepRevision: nullableString(
      validation.sweepRevision,
      "cached validation sweepRevision",
    ),
    failure: nullableString(
      validation.failure,
      "cached validation failure",
    ),
  };
}

function parseCachedRepository(
  value: unknown,
): CachedRepository {
  const repository = object(value, "cached repository");
  if (
    typeof repository.present !== "boolean" ||
    !Array.isArray(repository.topics) ||
    repository.topics.some(
      (topic) => typeof topic !== "string",
    ) ||
    !Array.isArray(repository.plugins) ||
    !Array.isArray(repository.sweepPlugins)
  ) {
    throw new TypeError("invalid cached repository");
  }
  return {
    githubId: nonnegativeInteger(
      repository.githubId,
      "cached repository id",
    ),
    fullName: string(
      repository.fullName,
      "cached repository fullName",
    ),
    repositoryUrl: string(
      repository.repositoryUrl,
      "cached repository URL",
    ),
    description: string(
      repository.description,
      "cached repository description",
    ),
    topics: [...repository.topics] as string[],
    language: nullableString(
      repository.language,
      "cached repository language",
    ),
    stars: nonnegativeInteger(
      repository.stars,
      "cached repository stars",
    ),
    pushedAt: nullableString(
      repository.pushedAt,
      "cached repository pushedAt",
    ),
    defaultBranch: string(
      repository.defaultBranch,
      "cached repository defaultBranch",
    ),
    present: repository.present,
    firstSeenAt: string(
      repository.firstSeenAt,
      "cached repository firstSeenAt",
    ),
    lastSeenAt: string(
      repository.lastSeenAt,
      "cached repository lastSeenAt",
    ),
    validation: parseCachedValidation(repository.validation),
    plugins: repository.plugins.map(parseCachedPlugin),
    sweepPlugins: repository.sweepPlugins.map(parseCachedPlugin),
  };
}

function parseCacheDocument(value: unknown): CatalogCacheDocument {
  const cache = object(value, "plugin catalog cache");
  const state = object(cache.state, "plugin catalog state");
  if (
    cache.version !== CACHE_VERSION ||
    !Array.isArray(cache.repositories)
  ) {
    throw new TypeError("unsupported plugin catalog cache");
  }
  return {
    version: CACHE_VERSION,
    savedAt: nullableString(
      cache.savedAt,
      "plugin catalog savedAt",
    ),
    state: {
      watermark: nullableString(
        state.watermark,
        "plugin catalog watermark",
      ),
      lastRefreshAt: nullableString(
        state.lastRefreshAt,
        "plugin catalog lastRefreshAt",
      ),
      lastFullScanAt: nullableString(
        state.lastFullScanAt,
        "plugin catalog lastFullScanAt",
      ),
    },
    repositories: cache.repositories.map(parseCachedRepository),
  };
}

function errorMessage(error: unknown): string {
  return (
    error instanceof Error ? error.message : String(error)
  ).slice(0, MAX_ERROR_LENGTH) || "Unknown catalog failure";
}

function elapsedSince(
  timestamp: string | null,
  now: Date,
): number {
  if (timestamp === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed)
    ? Math.max(0, now.getTime() - parsed)
    : Number.POSITIVE_INFINITY;
}

function compareManifestPath(
  left: string,
  right: string,
): number {
  const leftDepth = left.split("/").length;
  const rightDepth = right.split("/").length;
  return leftDepth - rightDepth || left.localeCompare(right, "en");
}

function manifestEntries(tree: GitHubTree): GitHubTreeEntry[] {
  return tree.entries
    .filter(
      ({ path, type, mode }) =>
        type === "blob" &&
        (mode === "100644" || mode === "100755") &&
        (path === "package.json" ||
          path.endsWith("/package.json")) &&
        !path.split("/").includes("node_modules"),
    )
    .sort((left, right) =>
      compareManifestPath(left.path, right.path)
    );
}

function relativeRepositoryPath(
  base: string,
  relative: string,
): string | null {
  if (
    relative.length === 0 ||
    relative.includes("\\") ||
    posix.isAbsolute(relative)
  ) {
    return null;
  }
  const resolved = posix.normalize(posix.join(base, relative));
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    posix.isAbsolute(resolved)
  ) {
    return null;
  }
  return resolved.replace(/^\.\//u, "");
}

function packageDirectory(manifestPath: string): string {
  const directory = posix.dirname(manifestPath);
  return directory === "." ? "" : directory;
}

function validPluginPath(path: string): boolean {
  return (
    path === "" ||
    path
      .split("/")
      .every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          PLUGIN_PATH_SEGMENT.test(segment),
      )
  );
}

function firstExportPath(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const exports = value as Record<string, unknown>;
  if (Object.hasOwn(exports, ".")) {
    return firstExportPath(exports["."]);
  }
  for (
    const condition of [
      "default",
      "import",
      "require",
      "node",
      "browser",
    ]
  ) {
    const path = firstExportPath(exports[condition]);
    if (path !== null) return path;
  }
  return null;
}

function installFacts(
  manifest: Record<string, unknown>,
  directory: string,
  treePaths: ReadonlySet<string>,
): {
  verification: PluginInstallVerification;
  requiresBuildAllowance: boolean;
} {
  const scripts =
    typeof manifest.scripts === "object" &&
    manifest.scripts !== null &&
    !Array.isArray(manifest.scripts)
      ? manifest.scripts as Record<string, unknown>
      : {};
  const hasPrepare =
    typeof scripts.prepare === "string" &&
    scripts.prepare.trim().length > 0;
  const declared =
    firstExportPath(manifest.exports) ??
    (
      typeof manifest.main === "string" &&
      manifest.main.length > 0
        ? manifest.main
        : null
    );
  if (declared === null) {
    return {
      verification: "verified",
      requiresBuildAllowance: hasPrepare,
    };
  }
  const entryPath = relativeRepositoryPath(directory, declared);
  if (entryPath === null) {
    return {
      verification: "unverified",
      requiresBuildAllowance: hasPrepare,
    };
  }
  if (treePaths.has(entryPath)) {
    return {
      verification: "verified",
      requiresBuildAllowance: hasPrepare,
    };
  }
  return {
    verification: hasPrepare
      ? "build-required"
      : "unverified",
    requiresBuildAllowance: hasPrepare,
  };
}

function inspectManifest(
  source: string,
  repository: CachedRepository,
  manifestPath: string,
  treePaths: ReadonlySet<string>,
): ManifestInspection {
  let manifest: Record<string, unknown>;
  try {
    manifest = object(
      JSON.parse(source),
      "plugin package manifest",
    );
  } catch {
    return { plugin: null };
  }
  const packageName =
    typeof manifest.name === "string"
      ? manifest.name.trim()
      : "";
  if (packageName.length === 0 || packageName === "__NAME__") {
    return { plugin: null };
  }
  const dsh =
    typeof manifest.dsh === "object" &&
    manifest.dsh !== null &&
    !Array.isArray(manifest.dsh)
      ? manifest.dsh as Record<string, unknown>
      : null;
  const bundle =
    dsh !== null &&
    typeof dsh.bundle === "object" &&
    dsh.bundle !== null &&
    !Array.isArray(dsh.bundle)
      ? dsh.bundle as Record<string, unknown>
      : null;
  const patch =
    bundle !== null && typeof bundle.patch === "string"
      ? bundle.patch.trim()
      : "";
  const directory = packageDirectory(manifestPath);
  const patchPath = relativeRepositoryPath(directory, patch);
  if (
    patchPath === null ||
    !treePaths.has(patchPath) ||
    !validPluginPath(directory)
  ) {
    return { plugin: null };
  }
  const id = directory === ""
    ? repository.fullName
    : `${repository.fullName}/${directory}`;
  if (id.length > MAX_PLUGIN_ID_LENGTH) {
    return { plugin: null };
  }
  const install = installFacts(manifest, directory, treePaths);
  return {
    plugin: {
      id,
      packagePath: directory,
      packageName,
      version:
        typeof manifest.version === "string" &&
        manifest.version.trim().length > 0
          ? manifest.version.trim()
          : null,
      description:
        typeof manifest.description === "string"
          ? manifest.description.trim()
          : "",
      patchPath,
      installSpec: directory === ""
        ? `github:${repository.fullName}`
        : `github:${repository.fullName}#path:${directory}`,
      installVerification: install.verification,
      requiresBuildAllowance: install.requiresBuildAllowance,
    },
  };
}

function toGitHubRepository(
  repository: CachedRepository,
): GitHubRepository {
  return {
    id: repository.githubId,
    fullName: repository.fullName,
    repositoryUrl: repository.repositoryUrl,
    description: repository.description,
    topics: [...repository.topics],
    language: repository.language,
    stars: repository.stars,
    pushedAt: repository.pushedAt,
    defaultBranch: repository.defaultBranch,
  };
}

function newValidation(): CachedValidation {
  return {
    status: "pending",
    checkedAt: null,
    checkedRevision: null,
    lastAttemptAt: null,
    cursor: null,
    sweepRevision: null,
    failure: null,
  };
}

function repositoryNeedsValidation(
  repository: CachedRepository,
  now: Date,
  validationMaxAgeMs: number,
  retryIntervalMs: number,
): boolean {
  if (!repository.present) return false;
  const validation = repository.validation;
  if (validation.cursor !== null) return true;
  if (validation.status === "pending") return true;
  if (validation.checkedAt === null) {
    return (
      validation.lastAttemptAt === null ||
      elapsedSince(validation.lastAttemptAt, now) >=
        retryIntervalMs
    );
  }
  if (
    repository.pushedAt !== null &&
    Date.parse(repository.pushedAt) >
      Date.parse(validation.checkedAt)
  ) {
    return true;
  }
  return (
    elapsedSince(validation.checkedAt, now) >=
    validationMaxAgeMs
  );
}

function validationPriority(
  repository: CachedRepository,
): number {
  if (repository.validation.cursor !== null) return 0;
  if (repository.validation.checkedAt === null) return 1;
  return 2;
}

class CatalogCacheStore {
  readonly path: string;
  #writeSequence = 0;

  constructor(userDataPath: string) {
    this.path = pluginCatalogCacheFilePath(userDataPath);
  }

  async read(): Promise<CatalogCacheDocument> {
    try {
      return parseCacheDocument(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyCache();
      }
      throw error;
    }
  }

  async write(document: CatalogCacheDocument): Promise<void> {
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
        `${JSON.stringify(document)}\n`,
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

/** Resolve the durable local catalog file below Minke's user-data root. */
export function pluginCatalogCacheFilePath(
  userDataPath: string,
): string {
  return join(
    userDataPath,
    "plugins",
    "catalog-v1.json",
  );
}

/**
 * Owns plugin discovery, static validation, resumable progress, and the local
 * snapshot. Callers only read a snapshot or request a refresh.
 */
export class PluginCatalogService
implements PluginCatalogModule {
  readonly #store: CatalogCacheStore;
  readonly #fetcher: NonNullable<
    PluginCatalogServiceOptions["fetcher"]
  >;
  readonly #token: string | undefined;
  readonly #topic: string;
  readonly #now: () => Date;
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #refreshIntervalMs: number;
  readonly #fullScanIntervalMs: number;
  readonly #validationMaxAgeMs: number;
  readonly #retryIntervalMs: number;
  readonly #repositoryBudget: number;
  readonly #manifestBudget: number;
  readonly #searchPaceMs: number;
  readonly #requestTimeoutMs: number | undefined;
  readonly #logger: PluginCatalogLogger;
  readonly #lifetimeAbort = new AbortController();

  #cache: CatalogCacheDocument = emptyCache();
  #loaded = false;
  #disposed = false;
  #timer: NodeJS.Timeout | undefined;
  #refreshPromise: Promise<PluginCatalogSnapshot> | undefined;
  #refreshAbort: AbortController | undefined;
  #lastError: string | undefined;

  constructor(options: PluginCatalogServiceOptions) {
    const token = options.token === undefined
      ? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
      : options.token;
    const authenticated =
      token !== undefined && token.trim().length > 0;
    const topic = options.topic ?? DEFAULT_TOPIC;
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/u.test(topic)) {
      throw new TypeError("invalid plugin discovery topic");
    }
    this.#store = new CatalogCacheStore(options.userDataPath);
    this.#fetcher = options.fetcher ?? fetch;
    this.#token = authenticated ? token.trim() : undefined;
    this.#topic = topic;
    this.#now = options.now ?? (() => new Date());
    this.#delay =
      options.delay ??
      (async (milliseconds) => await new Promise<void>(
        (resolve) => setTimeout(resolve, milliseconds),
      ));
    this.#refreshIntervalMs =
      options.refreshIntervalMs ??
      (
        authenticated
          ? AUTHENTICATED_REFRESH_INTERVAL_MS
          : ANONYMOUS_REFRESH_INTERVAL_MS
      );
    this.#fullScanIntervalMs =
      options.fullScanIntervalMs ?? DEFAULT_FULL_SCAN_INTERVAL_MS;
    this.#validationMaxAgeMs =
      options.validationMaxAgeMs ??
      DEFAULT_VALIDATION_MAX_AGE_MS;
    this.#retryIntervalMs =
      options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.#repositoryBudget =
      options.repositoryBudget ??
      (
        authenticated
          ? AUTHENTICATED_REPOSITORY_BUDGET
          : ANONYMOUS_REPOSITORY_BUDGET
      );
    this.#manifestBudget =
      options.manifestBudget ??
      (
        authenticated
          ? AUTHENTICATED_MANIFEST_BUDGET
          : ANONYMOUS_MANIFEST_BUDGET
      );
    this.#searchPaceMs =
      options.searchPaceMs ??
      (
        authenticated
          ? AUTHENTICATED_SEARCH_PACE_MS
          : ANONYMOUS_SEARCH_PACE_MS
      );
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#logger = options.logger ?? console;
  }

  async start(): Promise<void> {
    this.#assertActive();
    await this.#load();
    if (this.#timer !== undefined) return;
    if (
      elapsedSince(
        this.#cache.state.lastRefreshAt,
        this.#now(),
      ) >= this.#refreshIntervalMs
    ) {
      void this.refresh();
    }
    this.#timer = setInterval(() => {
      void this.refresh();
    }, this.#refreshIntervalMs);
    this.#timer.unref();
  }

  async read(): Promise<PluginCatalogSnapshot> {
    await this.#load();
    return this.#snapshot();
  }

  refresh(): Promise<PluginCatalogSnapshot> {
    this.#assertActive();
    if (this.#refreshPromise !== undefined) {
      return this.#refreshPromise;
    }
    const refreshAbort = new AbortController();
    this.#refreshAbort = refreshAbort;
    const signal = AbortSignal.any([
      this.#lifetimeAbort.signal,
      refreshAbort.signal,
    ]);
    const task = (async () => {
      try {
        await this.#load();
        await this.#refresh(signal);
        this.#lastError = undefined;
      } catch (error) {
        const cancelled =
          refreshAbort.signal.aborted &&
          refreshAbort.signal.reason instanceof
            PluginCatalogRefreshCancelledError;
        if (!this.#disposed && !cancelled) {
          this.#lastError = errorMessage(error);
          this.#logger.error(
            "Plugin catalog refresh failed:",
            error,
          );
        }
      } finally {
        this.#refreshPromise = undefined;
        if (this.#refreshAbort === refreshAbort) {
          this.#refreshAbort = undefined;
        }
      }
      return this.#snapshot();
    })();
    this.#refreshPromise = task;
    return task;
  }

  cancelRefresh(): Promise<PluginCatalogSnapshot> {
    this.#assertActive();
    const task = this.#refreshPromise;
    if (task === undefined) return this.read();
    this.#refreshAbort?.abort(
      new PluginCatalogRefreshCancelledError(),
    );
    return task;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#lifetimeAbort.abort();
    this.#refreshAbort?.abort();
    this.#refreshAbort = undefined;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    try {
      this.#cache = await this.#store.read();
    } catch (error) {
      this.#cache = emptyCache();
      this.#lastError = errorMessage(error);
      this.#logger.warn(
        `Plugin catalog cache could not be read: ${this.#lastError}`,
      );
    }
    this.#loaded = true;
  }

  async #refresh(signal: AbortSignal): Promise<void> {
    const now = this.#now();
    const full =
      this.#cache.state.lastFullScanAt === null ||
      elapsedSince(
        this.#cache.state.lastFullScanAt,
        now,
      ) >= this.#fullScanIntervalMs;
    const source = new GitHubCatalogSource({
      fetcher: this.#fetcher,
      token: this.#token,
      topic: this.#topic,
      signal,
      delay: this.#delay,
      searchPaceMs: this.#searchPaceMs,
      requestTimeoutMs: this.#requestTimeoutMs,
    });
    const repositories = full
      ? await source.discoverFull(now)
      : await source.discoverIncremental(
          this.#incrementalStart(now),
          now,
        );
    this.#mergeRepositories(repositories, full, now);
    await this.#persist(now);
    await this.#validateRepositories(source, now);

    const completedAt = now.toISOString();
    this.#cache.state.watermark = completedAt;
    this.#cache.state.lastRefreshAt = completedAt;
    if (full) this.#cache.state.lastFullScanAt = completedAt;
    await this.#persist(now);
  }

  #incrementalStart(now: Date): Date {
    const watermark = this.#cache.state.watermark;
    if (watermark === null) return new Date(0);
    const parsed = Date.parse(watermark);
    if (!Number.isFinite(parsed)) return new Date(0);
    return new Date(
      Math.min(now.getTime(), parsed) - DISCOVERY_OVERLAP_MS,
    );
  }

  #mergeRepositories(
    discovered: GitHubRepository[],
    full: boolean,
    now: Date,
  ): void {
    const timestamp = now.toISOString();
    if (full) {
      for (const repository of this.#cache.repositories) {
        repository.present = false;
      }
    }
    const byId = new Map(
      this.#cache.repositories.map((repository) => [
        repository.githubId,
        repository,
      ]),
    );
    for (const incoming of discovered) {
      const repository = byId.get(incoming.id);
      if (repository === undefined) {
        const created: CachedRepository = {
          githubId: incoming.id,
          fullName: incoming.fullName,
          repositoryUrl: incoming.repositoryUrl,
          description: incoming.description,
          topics: [...incoming.topics],
          language: incoming.language,
          stars: incoming.stars,
          pushedAt: incoming.pushedAt,
          defaultBranch: incoming.defaultBranch,
          present: true,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          validation: newValidation(),
          plugins: [],
          sweepPlugins: [],
        };
        this.#cache.repositories.push(created);
        byId.set(created.githubId, created);
        continue;
      }
      const sourceChanged =
        repository.fullName !== incoming.fullName ||
        repository.defaultBranch !== incoming.defaultBranch ||
        repository.pushedAt !== incoming.pushedAt;
      const repositoryRenamed =
        repository.fullName !== incoming.fullName;
      repository.fullName = incoming.fullName;
      repository.repositoryUrl = incoming.repositoryUrl;
      repository.description = incoming.description;
      repository.topics = [...incoming.topics];
      repository.language = incoming.language;
      repository.stars = incoming.stars;
      repository.pushedAt = incoming.pushedAt;
      repository.defaultBranch = incoming.defaultBranch;
      repository.present = true;
      repository.lastSeenAt = timestamp;
      if (repositoryRenamed) {
        for (
          const plugin of [
            ...repository.plugins,
            ...repository.sweepPlugins,
          ]
        ) {
          plugin.id =
            plugin.packagePath === ""
              ? incoming.fullName
              : `${incoming.fullName}/${plugin.packagePath}`;
          plugin.installSpec =
            plugin.packagePath === ""
              ? `github:${incoming.fullName}`
              : `github:${incoming.fullName}#path:${plugin.packagePath}`;
        }
      }
      if (sourceChanged) {
        repository.validation.status = "pending";
        repository.validation.cursor = null;
        repository.validation.sweepRevision = null;
        repository.validation.failure = null;
        repository.sweepPlugins = [];
      }
    }
    this.#cache.repositories.sort((left, right) =>
      left.fullName.localeCompare(right.fullName, "en", {
        sensitivity: "base",
      })
    );
  }

  async #validateRepositories(
    source: GitHubCatalogSource,
    now: Date,
  ): Promise<void> {
    const queue = this.#cache.repositories
      .filter((repository) =>
        repositoryNeedsValidation(
          repository,
          now,
          this.#validationMaxAgeMs,
          this.#retryIntervalMs,
        )
      )
      .sort((left, right) =>
        validationPriority(left) - validationPriority(right) ||
        right.stars - left.stars ||
        (
          left.validation.lastAttemptAt ?? ""
        ).localeCompare(
          right.validation.lastAttemptAt ?? "",
          "en",
        ) ||
        left.fullName.localeCompare(right.fullName, "en")
      );
    let manifestsRemaining = this.#manifestBudget;
    let repositoriesInspected = 0;

    for (const repository of queue) {
      if (
        repositoriesInspected >= this.#repositoryBudget ||
        manifestsRemaining <= 0 ||
        (
          source.coreRemaining !== undefined &&
          source.coreRemaining <= CORE_RATE_RESERVE
        )
      ) {
        break;
      }
      repositoriesInspected += 1;
      try {
        const consumed = await this.#inspectRepository(
          source,
          repository,
          manifestsRemaining,
          now,
        );
        manifestsRemaining -= consumed;
      } catch (error) {
        repository.validation.lastAttemptAt = now.toISOString();
        repository.validation.status = "error";
        repository.validation.failure = errorMessage(error);
        if (
          error instanceof GitHubResponseError &&
          (error.status === 404 || error.status === 410)
        ) {
          repository.present = false;
        } else if (
          error instanceof GitHubResponseError &&
          error.status === 409
        ) {
          repository.plugins = [];
          repository.sweepPlugins = [];
          repository.validation.status = "rejected";
          repository.validation.checkedAt = now.toISOString();
          repository.validation.cursor = null;
          repository.validation.sweepRevision = null;
        } else if (
          error instanceof GitHubResponseError &&
          (error.status === 403 || error.status === 429)
        ) {
          await this.#persist(now);
          throw error;
        }
      }
      await this.#persist(now);
    }
  }

  async #inspectRepository(
    source: GitHubCatalogSource,
    repository: CachedRepository,
    manifestBudget: number,
    now: Date,
  ): Promise<number> {
    const tree = await source.tree(
      toGitHubRepository(repository),
      repository.validation.sweepRevision ??
        repository.defaultBranch,
    );
    repository.validation.lastAttemptAt = now.toISOString();
    if (tree.truncated) {
      throw new Error("repository tree is too large to inspect");
    }
    const manifests = manifestEntries(tree);
    const treePaths = new Set(
      tree.entries
        .filter(
          ({ type, mode }) =>
            type === "blob" &&
            (mode === "100644" || mode === "100755"),
        )
        .map(({ path }) => path),
    );
    if (
      repository.validation.sweepRevision !== tree.sha
    ) {
      repository.validation.cursor = null;
      repository.validation.sweepRevision = tree.sha;
      repository.sweepPlugins = [];
    }
    const cursor = repository.validation.cursor;
    const nextIndex = cursor === null
      ? 0
      : manifests.findIndex(
          ({ path }) =>
            compareManifestPath(path, cursor) > 0,
        );
    const start = nextIndex < 0 ? manifests.length : nextIndex;
    const end = Math.min(
      manifests.length,
      start + manifestBudget,
    );
    let lastProcessed: string | null = null;

    for (const manifest of manifests.slice(start, end)) {
      const inspection = inspectManifest(
        await source.blob(
          toGitHubRepository(repository),
          manifest.sha,
        ),
        repository,
        manifest.path,
        treePaths,
      );
      lastProcessed = manifest.path;
      if (inspection.plugin === null) continue;
      const plugin = inspection.plugin;
      const normalizedId = plugin.id.toLocaleLowerCase("en-US");
      repository.sweepPlugins = repository.sweepPlugins.filter(
        (existing) =>
          existing.id.toLocaleLowerCase("en-US") !==
          normalizedId,
      );
      const duplicate = repository.sweepPlugins.some(
        (existing) =>
          existing.seenRevision === tree.sha &&
          (
            existing.packageName.toLocaleLowerCase("en-US") ===
              plugin.packageName.toLocaleLowerCase("en-US") ||
            existing.packagePath.toLocaleLowerCase("en-US") ===
              plugin.packagePath.toLocaleLowerCase("en-US")
          ),
      );
      if (!duplicate) {
        repository.sweepPlugins.push({
          ...plugin,
          seenRevision: tree.sha,
        });
      }
    }

    const complete = end >= manifests.length;
    if (complete) {
      repository.plugins = repository.sweepPlugins.filter(
        ({ seenRevision }) => seenRevision === tree.sha,
      );
      repository.sweepPlugins = [];
      repository.validation.status =
        repository.plugins.length > 0
          ? "accepted"
          : "rejected";
      repository.validation.checkedAt = now.toISOString();
      repository.validation.checkedRevision = tree.sha;
      repository.validation.cursor = null;
      repository.validation.sweepRevision = null;
    } else {
      repository.validation.status = "pending";
      repository.validation.cursor = lastProcessed;
    }
    repository.validation.failure = null;
    return end - start;
  }

  async #persist(now: Date): Promise<void> {
    this.#cache.savedAt = now.toISOString();
    await this.#store.write(this.#cache);
  }

  #snapshot(): PluginCatalogSnapshot {
    const now = this.#now();
    const present = this.#cache.repositories.filter(
      ({ present: isPresent }) => isPresent,
    );
    const plugins: PluginCatalogEntry[] = present.flatMap(
      (repository) =>
        repository.plugins.map((plugin) => ({
          id: plugin.id,
          repository: repository.fullName,
          repositoryUrl: repository.repositoryUrl,
          packagePath: plugin.packagePath,
          packageName: plugin.packageName,
          version: plugin.version,
          description:
            plugin.description || repository.description,
          topics: [...repository.topics],
          language: repository.language,
          stars: repository.stars,
          pushedAt: repository.pushedAt,
          installSpec: plugin.installSpec,
          installVerification: plugin.installVerification,
          requiresBuildAllowance:
            plugin.requiresBuildAllowance,
        })),
    );
    const verificationRank: Record<
      PluginInstallVerification,
      number
    > = {
      verified: 0,
      "build-required": 1,
      unverified: 2,
    };
    plugins.sort((left, right) =>
      verificationRank[left.installVerification] -
        verificationRank[right.installVerification] ||
      right.stars - left.stars ||
      left.id.localeCompare(right.id, "en", {
        sensitivity: "base",
      })
    );
    return {
      version: PLUGIN_CATALOG_SNAPSHOT_VERSION,
      generatedAt: this.#cache.savedAt,
      lastRefreshAt: this.#cache.state.lastRefreshAt,
      lastFullScanAt: this.#cache.state.lastFullScanAt,
      refreshing: this.#refreshPromise !== undefined,
      counts: {
        repositories: present.length,
        pendingRepositories: present.filter(
          (repository) =>
            repository.validation.status === "error" ||
            repositoryNeedsValidation(
              repository,
              now,
              this.#validationMaxAgeMs,
              this.#retryIntervalMs,
            ),
        ).length,
        plugins: plugins.length,
      },
      plugins,
      ...(this.#lastError === undefined
        ? {}
        : { error: this.#lastError }),
    };
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("plugin catalog service is disposed");
    }
  }
}
