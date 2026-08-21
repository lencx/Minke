import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import {
  join,
  parse,
  resolve,
  sep,
} from "node:path";
import {
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  parseDataHomePath,
  type DataHomeCandidateOrigin,
  type DataHomeCandidateSnapshot,
  type DataHomeMigrationMode,
  type DataHomeMigrationPlan,
  type DataHomeMigrationPlanRequest,
  type DataHomeMigrationScheduleRequest,
  type DataHomeMigrationScheduleResult,
  type DataHomeMigrationState,
  type DataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  activateFreshDataHome,
  DataHomeMigrationJournal,
  inspectDataHome,
  mergeDataHomes,
  planDataHomeMerge,
  planFreshDataHome,
} from "./data-home-migration.ts";
import type {
  MinkeConfigSection,
} from "./minke-config.ts";

export interface DataHomeManagerOptions {
  userDataPath: string;
  configuration: MinkeConfigSection<string | undefined>;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  chooseDirectory?: (
    defaultPath: string,
  ) => Promise<string | undefined>;
  restart?: () => void;
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

function failedMigrationState(
  targetPath: string,
  error: unknown,
  mode: DataHomeMigrationMode = "merge",
): DataHomeMigrationState {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 4_096) || "Unknown migration failure";
  return {
    mode,
    status: "failed",
    targetPath,
    copiedFiles: 0,
    copiedBytes: 0,
    identicalFiles: 0,
    conflictFiles: 0,
    conflicts: [],
    updatedAt: new Date().toISOString(),
    error: message,
  };
}

function migrationStateWithError(
  state: DataHomeMigrationState,
  error: unknown,
): DataHomeMigrationState {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 4_096) || "Unknown migration failure";
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    error: message,
  };
}

function expandHomePath(
  path: string,
  homeDirectory: string,
): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homeDirectory, path.slice(2));
  }
  return path;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** Mirror DSH's public explicit path > DSH_HOME > ~/.dsh contract. */
export function resolveDshHomePath(
  configured?: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  const fromEnvironment = environment.DSH_HOME;
  const selected =
    configured ??
    (
      fromEnvironment !== undefined &&
        fromEnvironment.trim().length > 0
        ? fromEnvironment
        : join(homeDirectory, ".dsh")
    );
  return resolve(
    expandHomePath(parseDataHomePath(selected), homeDirectory),
  );
}

/** Minke's recommended explicit DSH home below its own user-data root. */
export function recommendedMinkeDshHome(
  userDataPath: string,
): string {
  return resolve(userDataPath, "harness");
}

/** Give every Minke-owned DSH process the same authoritative home. */
export function buildDshChildEnvironment(
  activeDshHome: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    DSH_HOME: resolve(activeDshHome),
  };
}

/** Resolve configured state, migration discovery, and restart-time cutover. */
export class DataHomeManager {
  readonly #userDataPath: string;
  readonly #configuration: MinkeConfigSection<string | undefined>;
  readonly #homeDirectory: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #chooseDirectory: (
    defaultPath: string,
  ) => Promise<string | undefined>;
  readonly #restart: () => void;
  readonly #journal: DataHomeMigrationJournal;

  constructor(options: DataHomeManagerOptions) {
    this.#userDataPath = resolve(options.userDataPath);
    this.#configuration = options.configuration;
    this.#homeDirectory = resolve(
      options.homeDirectory ?? homedir(),
    );
    this.#environment = { ...(options.environment ?? process.env) };
    this.#chooseDirectory =
      options.chooseDirectory ?? (async () => undefined);
    this.#restart = options.restart ?? (() => {});
    this.#journal = new DataHomeMigrationJournal(
      this.#userDataPath,
    );
  }

  async activePath(): Promise<string> {
    const configured = await this.#configuration.read();
    return await this.#resolveActivePath(configured);
  }

  async read(): Promise<DataHomeSettingsSnapshot> {
    const activePath = await this.activePath();
    const candidates = await this.#candidates();
    let lastMigration: DataHomeMigrationState | undefined;
    try {
      lastMigration = (await this.#journal.read())?.state;
    } catch (error) {
      lastMigration = failedMigrationState(activePath, error);
    }
    return {
      activePath,
      recommendedPath: recommendedMinkeDshHome(
        this.#userDataPath,
      ),
      candidates,
      ...(lastMigration === undefined
        ? {}
        : { lastMigration }),
    };
  }

  async chooseDirectory(): Promise<string | undefined> {
    const selected = await this.#chooseDirectory(
      await this.activePath(),
    );
    return selected === undefined
      ? undefined
      : this.#targetPath(selected);
  }

  async plan(
    value: DataHomeMigrationPlanRequest,
  ): Promise<DataHomeMigrationPlan> {
    const request = parseDataHomeMigrationPlanRequest(value);
    const targetPath = this.#targetPath(request.targetPath);
    if (request.mode === "fresh") {
      if (pathKey(targetPath) === pathKey(await this.activePath())) {
        throw new RangeError(
          "fresh data-home target must differ from the current directory",
        );
      }
      return await planFreshDataHome(targetPath);
    }
    const candidates = await this.#candidates();
    return await planDataHomeMerge(
      candidates
        .filter(({ path }) =>
          pathKey(path) !== pathKey(targetPath)
        )
        .map(({ path }) => path),
      targetPath,
    );
  }

  async schedule(
    value: DataHomeMigrationScheduleRequest,
  ): Promise<DataHomeMigrationScheduleResult> {
    const request = parseDataHomeMigrationScheduleRequest(value);
    const plan = await this.plan({
      mode: request.mode,
      targetPath: request.targetPath,
    });
    await this.#journal.schedule(plan);
    this.#restart();
    return {
      scheduled: true,
      targetPath: plan.targetPath,
    };
  }

  async completePendingMigration(): Promise<
    DataHomeMigrationState | undefined
  > {
    let journal;
    try {
      journal = await this.#journal.read();
    } catch (error) {
      return failedMigrationState(await this.activePath(), error);
    }
    if (journal === undefined || journal.state.status !== "pending") {
      return journal?.state;
    }

    if (journal.phase === "pending") {
      try {
        const report =
          journal.request.mode === "fresh"
            ? await activateFreshDataHome(
                journal.request.targetPath,
              )
            : await mergeDataHomes(
                journal.request.sourcePaths,
                journal.request.targetPath,
              );
        await this.#journal.markCopied(report);
        const copied = await this.#journal.read();
        if (copied === undefined || copied.phase !== "copied") {
          throw new Error(
            "data-home migration copy receipt was not persisted",
          );
        }
        journal = copied;
      } catch (error) {
        try {
          await this.#journal.fail(error);
        } catch (journalError) {
          return failedMigrationState(
            journal.request.targetPath,
            new AggregateError(
              [error, journalError],
              "data-home migration and status recording failed",
            ),
            journal.request.mode,
          );
        }
        try {
          return (await this.#journal.read())?.state;
        } catch (readError) {
          return failedMigrationState(
            journal.request.targetPath,
            readError,
            journal.request.mode,
          );
        }
      }
    }

    if (journal.phase !== "copied") return journal.state;

    try {
      const configured = await this.#configuration.read();
      const targetIsConfigured =
        configured !== undefined &&
        pathKey(
          resolveDshHomePath(
            configured,
            this.#environment,
            this.#homeDirectory,
          ),
        ) === pathKey(journal.request.targetPath);
      if (!targetIsConfigured) {
        await this.#configuration.write(
          journal.request.targetPath,
        );
      }
      await this.#journal.complete();
    } catch (error) {
      try {
        await this.#journal.defer(error);
        return (await this.#journal.read())?.state ??
          migrationStateWithError(journal.state, error);
      } catch (journalError) {
        return migrationStateWithError(
          journal.state,
          new AggregateError(
            [error, journalError],
            "data-home activation remains pending",
          ),
        );
      }
    }
    try {
      return (await this.#journal.read())?.state ?? {
        ...journal.state,
        status: "completed",
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return {
        ...journal.state,
        status: "completed",
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async #candidates(): Promise<DataHomeCandidateSnapshot[]> {
    const configured = await this.#configuration.read();
    const activePath = await this.#resolveActivePath(configured);
    const recommendedPath = recommendedMinkeDshHome(
      this.#userDataPath,
    );
    const configuredEnvironment =
      this.#environment.DSH_HOME !== undefined &&
      this.#environment.DSH_HOME.trim().length > 0;
    const environmentPath = configuredEnvironment
      ? resolveDshHomePath(
          undefined,
          this.#environment,
          this.#homeDirectory,
        )
      : undefined;
    const defaultPath = resolveDshHomePath(
      undefined,
      {},
      this.#homeDirectory,
    );
    const paths = new Map<
      string,
      { path: string; origins: Set<DataHomeCandidateOrigin> }
    >();
    const add = (
      path: string,
      origin: DataHomeCandidateOrigin,
    ): void => {
      const key = pathKey(path);
      const existing = paths.get(key);
      if (existing === undefined) {
        paths.set(key, {
          path,
          origins: new Set([origin]),
        });
      } else {
        existing.origins.add(origin);
      }
    };
    add(activePath, "active");
    if (configured !== undefined) add(activePath, "configured");
    add(recommendedPath, "minke");
    if (environmentPath !== undefined) {
      add(environmentPath, "environment");
    }
    add(defaultPath, "default");

    return await Promise.all(
      [...paths.values()].map(async ({ path, origins }) => ({
        path,
        origins: [...origins],
        ...(await inspectDataHome(path)),
      })),
    );
  }

  async #resolveActivePath(
    configured: string | undefined,
  ): Promise<string> {
    if (configured !== undefined) {
      return resolveDshHomePath(
        configured,
        this.#environment,
        this.#homeDirectory,
      );
    }
    if (
      this.#environment.DSH_HOME !== undefined &&
      this.#environment.DSH_HOME.trim().length > 0
    ) {
      return resolveDshHomePath(
        undefined,
        this.#environment,
        this.#homeDirectory,
      );
    }
    const legacyMinkePath = recommendedMinkeDshHome(
      this.#userDataPath,
    );
    if (await isDirectory(legacyMinkePath)) {
      return legacyMinkePath;
    }
    return resolveDshHomePath(
      undefined,
      {},
      this.#homeDirectory,
    );
  }

  #targetPath(value: string): string {
    const target = resolveDshHomePath(
      parseDataHomePath(value),
      this.#environment,
      this.#homeDirectory,
    );
    const root = parse(target).root;
    if (
      pathKey(target) === pathKey(root) ||
      pathKey(target) === pathKey(this.#homeDirectory) ||
      pathKey(target) === pathKey(this.#userDataPath) ||
      (
        containsPath(target, this.#userDataPath) &&
        pathKey(target) !== pathKey(this.#userDataPath)
      )
    ) {
      throw new RangeError(
        "data-home target must be a dedicated directory",
      );
    }
    return target;
  }
}
