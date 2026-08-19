/** Shared desktop/client contract for the authoritative DSH data directory. */

export const DATA_HOME_SETTINGS_READ_CHANNEL =
  "minke:data-home:read";
export const DATA_HOME_CHOOSE_DIRECTORY_CHANNEL =
  "minke:data-home:choose-directory";
export const DATA_HOME_MIGRATION_PLAN_CHANNEL =
  "minke:data-home:plan-migration";
export const DATA_HOME_MIGRATION_SCHEDULE_CHANNEL =
  "minke:data-home:schedule-migration";

export const DATA_HOME_PATH_MAX_LENGTH = 4_096;
export const DATA_HOME_CONFLICT_LIMIT = 100;

export type DataHomeCandidateOrigin =
  | "active"
  | "configured"
  | "minke"
  | "environment"
  | "default";

export interface DataHomeCandidateSnapshot {
  path: string;
  origins: DataHomeCandidateOrigin[];
  fileCount: number;
  byteCount: number;
}

export type DataHomeMigrationMode = "merge" | "fresh";

export interface DataHomeMigrationPlanRequest {
  mode: DataHomeMigrationMode;
  targetPath: string;
}

export interface DataHomeMigrationScheduleRequest {
  mode: DataHomeMigrationMode;
  targetPath: string;
  riskAccepted: boolean;
}

export interface DataHomeMigrationPlan {
  mode: DataHomeMigrationMode;
  targetPath: string;
  sourcePaths: string[];
  copyFiles: number;
  copyBytes: number;
  identicalFiles: number;
  conflictFiles: number;
  conflicts: string[];
}

export interface DataHomeMigrationScheduleResult {
  scheduled: true;
  targetPath: string;
}

export type DataHomeMigrationStatus =
  | "pending"
  | "completed"
  | "failed";

export interface DataHomeMigrationState {
  mode: DataHomeMigrationMode;
  status: DataHomeMigrationStatus;
  targetPath: string;
  copiedFiles: number;
  copiedBytes: number;
  identicalFiles: number;
  conflictFiles: number;
  conflicts: string[];
  updatedAt: string;
  error?: string;
}

export interface DataHomeSettingsSnapshot {
  activePath: string;
  recommendedPath: string;
  candidates: DataHomeCandidateSnapshot[];
  lastMigration?: DataHomeMigrationState;
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const CANDIDATE_ORIGINS = new Set<DataHomeCandidateOrigin>([
  "active",
  "configured",
  "minke",
  "environment",
  "default",
]);
const MIGRATION_STATUSES = new Set<DataHomeMigrationStatus>([
  "pending",
  "completed",
  "failed",
]);
const MIGRATION_MODES = new Set<DataHomeMigrationMode>([
  "merge",
  "fresh",
]);

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} contains unknown fields`);
  }
  return record;
}

function parseCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((entry) => parseDataHomePath(entry));
}

function parseConflicts(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > DATA_HOME_CONFLICT_LIMIT
  ) {
    throw new TypeError("data-home conflicts must be a bounded array");
  }
  return value.map((entry) => {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > DATA_HOME_PATH_MAX_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(entry)
    ) {
      throw new TypeError("invalid data-home conflict path");
    }
    return entry;
  });
}

/** Validate one configured or selected DSH home path. */
export function parseDataHomePath(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("data-home path must be a string");
  }
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > DATA_HOME_PATH_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(path)
  ) {
    throw new TypeError("invalid data-home path");
  }
  return path;
}

/** Validate the data handling mode, defaulting legacy requests to merge. */
export function parseDataHomeMigrationMode(
  value: unknown,
): DataHomeMigrationMode {
  if (value === undefined) return "merge";
  if (
    typeof value !== "string" ||
    !MIGRATION_MODES.has(value as DataHomeMigrationMode)
  ) {
    throw new TypeError("invalid data-home migration mode");
  }
  return value as DataHomeMigrationMode;
}

/** Validate a request to inspect a target before migration. */
export function parseDataHomeMigrationPlanRequest(
  value: unknown,
): DataHomeMigrationPlanRequest {
  const record = exactRecord(
    value,
    ["mode", "targetPath"],
    "data-home migration plan request",
  );
  return {
    mode: parseDataHomeMigrationMode(record.mode),
    targetPath: parseDataHomePath(record.targetPath),
  };
}

/** Validate the explicit risk acknowledgement required to schedule migration. */
export function parseDataHomeMigrationScheduleRequest(
  value: unknown,
): DataHomeMigrationScheduleRequest {
  const record = exactRecord(
    value,
    ["mode", "targetPath", "riskAccepted"],
    "data-home migration schedule request",
  );
  if (record.riskAccepted !== true) {
    throw new TypeError("data-home migration risk must be accepted");
  }
  return {
    mode: parseDataHomeMigrationMode(record.mode),
    targetPath: parseDataHomePath(record.targetPath),
    riskAccepted: true,
  };
}

/** Validate one discovered DSH data directory summary. */
export function parseDataHomeCandidateSnapshot(
  value: unknown,
): DataHomeCandidateSnapshot {
  const record = exactRecord(
    value,
    ["path", "origins", "fileCount", "byteCount"],
    "data-home candidate",
  );
  if (!Array.isArray(record.origins)) {
    throw new TypeError("data-home candidate origins must be an array");
  }
  const origins = record.origins.map((origin) => {
    if (
      typeof origin !== "string" ||
      !CANDIDATE_ORIGINS.has(
        origin as DataHomeCandidateOrigin,
      )
    ) {
      throw new TypeError("invalid data-home candidate origin");
    }
    return origin as DataHomeCandidateOrigin;
  });
  return {
    path: parseDataHomePath(record.path),
    origins: [...new Set(origins)],
    fileCount: parseCount(record.fileCount, "candidate file count"),
    byteCount: parseCount(record.byteCount, "candidate byte count"),
  };
}

/** Validate a dry-run migration plan returned by Electron main. */
export function parseDataHomeMigrationPlan(
  value: unknown,
): DataHomeMigrationPlan {
  const record = exactRecord(
    value,
    [
      "mode",
      "targetPath",
      "sourcePaths",
      "copyFiles",
      "copyBytes",
      "identicalFiles",
      "conflictFiles",
      "conflicts",
    ],
    "data-home migration plan",
  );
  return {
    mode: parseDataHomeMigrationMode(record.mode),
    targetPath: parseDataHomePath(record.targetPath),
    sourcePaths: parseStringList(
      record.sourcePaths,
      "migration source paths",
    ),
    copyFiles: parseCount(record.copyFiles, "copy file count"),
    copyBytes: parseCount(record.copyBytes, "copy byte count"),
    identicalFiles: parseCount(
      record.identicalFiles,
      "identical file count",
    ),
    conflictFiles: parseCount(
      record.conflictFiles,
      "conflict file count",
    ),
    conflicts: parseConflicts(record.conflicts),
  };
}

/** Validate a scheduled migration acknowledgement. */
export function parseDataHomeMigrationScheduleResult(
  value: unknown,
): DataHomeMigrationScheduleResult {
  const record = exactRecord(
    value,
    ["scheduled", "targetPath"],
    "data-home migration schedule result",
  );
  if (record.scheduled !== true) {
    throw new TypeError("data-home migration was not scheduled");
  }
  return {
    scheduled: true,
    targetPath: parseDataHomePath(record.targetPath),
  };
}

/** Validate one durable migration status projected into Settings. */
export function parseDataHomeMigrationState(
  value: unknown,
): DataHomeMigrationState {
  const record = exactRecord(
    value,
    [
      "mode",
      "status",
      "targetPath",
      "copiedFiles",
      "copiedBytes",
      "identicalFiles",
      "conflictFiles",
      "conflicts",
      "updatedAt",
      "error",
    ],
    "data-home migration state",
  );
  if (
    typeof record.status !== "string" ||
    !MIGRATION_STATUSES.has(
      record.status as DataHomeMigrationStatus,
    ) ||
    typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    (
      record.error !== undefined &&
      (
        typeof record.error !== "string" ||
        record.error.length === 0 ||
        record.error.length > 4_096
      )
    )
  ) {
    throw new TypeError("invalid data-home migration state");
  }
  return {
    mode: parseDataHomeMigrationMode(record.mode),
    status: record.status as DataHomeMigrationStatus,
    targetPath: parseDataHomePath(record.targetPath),
    copiedFiles: parseCount(record.copiedFiles, "copied file count"),
    copiedBytes: parseCount(record.copiedBytes, "copied byte count"),
    identicalFiles: parseCount(
      record.identicalFiles,
      "identical file count",
    ),
    conflictFiles: parseCount(
      record.conflictFiles,
      "conflict file count",
    ),
    conflicts: parseConflicts(record.conflicts),
    updatedAt: record.updatedAt,
    ...(record.error === undefined
      ? {}
      : { error: record.error }),
  };
}

/** Validate the complete data-directory Settings snapshot. */
export function parseDataHomeSettingsSnapshot(
  value: unknown,
): DataHomeSettingsSnapshot {
  const record = exactRecord(
    value,
    [
      "activePath",
      "recommendedPath",
      "candidates",
      "lastMigration",
    ],
    "data-home settings snapshot",
  );
  if (!Array.isArray(record.candidates)) {
    throw new TypeError("data-home candidates must be an array");
  }
  return {
    activePath: parseDataHomePath(record.activePath),
    recommendedPath: parseDataHomePath(record.recommendedPath),
    candidates: record.candidates.map(
      parseDataHomeCandidateSnapshot,
    ),
    ...(record.lastMigration === undefined
      ? {}
      : {
          lastMigration: parseDataHomeMigrationState(
            record.lastMigration,
          ),
        }),
  };
}
