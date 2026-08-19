/** Shared desktop/renderer contract for the host-backed Files tab. */
export const TABS_FILES_LIST_CHANNEL = "minke:tabs:files:list";
export const TABS_FILES_OPEN_CHANNEL = "minke:tabs:files:open";
export const TABS_FILES_PREVIEW_CHANNEL =
  "minke:tabs:files:preview";
export const TABS_FILES_WRITE_CHANNEL =
  "minke:tabs:files:write";
export const TABS_FILES_DIFF_CHANNEL =
  "minke:tabs:files:diff";
export const TABS_FILES_WATCH_CHANNEL =
  "minke:tabs:files:watch";
export const TABS_FILES_UNWATCH_CHANNEL =
  "minke:tabs:files:unwatch";
export const TABS_FILES_CHANGE_CHANNEL =
  "minke:tabs:files:change";

export const FILES_MAX_ENTRIES = 2_000;
export const FILES_MAX_WATCH_PATHS = 128;
export const FILES_TEXT_PREVIEW_MAX_BYTES = 8 * 1_024 * 1_024;
export const FILES_IMAGE_PREVIEW_MAX_BYTES = 32 * 1_024 * 1_024;
const FILES_MAX_PATH_LENGTH = 32_768;
const FILES_MAX_NAME_LENGTH = 1_024;
const FILES_MAX_GIT_BRANCH_LENGTH = 1_024;
const FILES_MAX_WATCH_ID_LENGTH = 128;

export type FileManagerEntryKind =
  | "directory"
  | "file"
  | "symlink"
  | "other";

export interface FileManagerListRequest {
  readonly path?: string;
  readonly includeRepository?: boolean;
}

export interface FileManagerOpenRequest {
  readonly path: string;
}

export interface FileManagerPreviewRequest {
  readonly path: string;
}

export interface FileManagerWriteRequest {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion: string;
}

export interface FileManagerDiffRequest {
  readonly path: string;
}

export interface FileManagerWriteResult {
  readonly path: string;
  readonly size: number;
  readonly version: string;
}

export interface FileManagerWatchRequest {
  readonly id: string;
  readonly paths: readonly string[];
}

export interface FileManagerUnwatchRequest {
  readonly id: string;
}

export interface FileManagerChangeEvent {
  readonly id: string;
  readonly paths: readonly string[];
}

export type FileManagerDiffResult =
  | {
    readonly kind: "text";
    readonly path: string;
    readonly original: string;
  }
  | {
    readonly kind: "unavailable";
    readonly path: string;
    readonly reason:
      | "binary"
      | "git-unavailable"
      | "not-repository"
      | "too-large";
  };

export interface FileManagerEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: FileManagerEntryKind;
  readonly targetKind?: Exclude<FileManagerEntryKind, "symlink">;
}

export interface FileManagerRepository {
  readonly root: string;
  readonly branch: string;
}

export interface FileManagerListResult {
  readonly path: string;
  readonly parent?: string;
  readonly entries: readonly FileManagerEntry[];
  readonly truncated: boolean;
  readonly repository?: FileManagerRepository;
}

interface FileManagerPreviewBase {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

export interface FileManagerTextPreview
  extends FileManagerPreviewBase {
  readonly kind: "text";
  readonly content: string;
  readonly truncated: boolean;
  readonly version: string;
}

export interface FileManagerImagePreview
  extends FileManagerPreviewBase {
  readonly kind: "image";
  readonly mimeType:
    | "image/avif"
    | "image/gif"
    | "image/jpeg"
    | "image/png"
    | "image/webp";
  readonly dataUrl: string;
}

export interface FileManagerUnsupportedPreview
  extends FileManagerPreviewBase {
  readonly kind: "unsupported";
  readonly reason: "binary" | "too-large";
}

export type FileManagerPreviewResult =
  | FileManagerTextPreview
  | FileManagerImagePreview
  | FileManagerUnsupportedPreview;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function pathText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FILES_MAX_PATH_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a valid path`);
  }
  return value;
}

function entryName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FILES_MAX_NAME_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError("file entry name must be valid");
  }
  return value;
}

function entryKind(value: unknown): FileManagerEntryKind {
  if (
    value !== "directory" &&
    value !== "file" &&
    value !== "symlink" &&
    value !== "other"
  ) {
    throw new TypeError("file entry kind is invalid");
  }
  return value;
}

function fileVersion(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a valid content version`);
  }
  return value;
}

function watchId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > FILES_MAX_WATCH_ID_LENGTH ||
    !/^[A-Za-z0-9:_-]+$/u.test(value)
  ) {
    throw new TypeError("file watch id must be valid");
  }
  return value;
}

function watchPaths(
  value: unknown,
  label: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > FILES_MAX_WATCH_PATHS
  ) {
    throw new TypeError(
      `${label} must contain between 1 and ${FILES_MAX_WATCH_PATHS} paths`,
    );
  }
  return [...new Set(
    value.map((path) => pathText(path, `${label} entry`)),
  )];
}

export function parseFileManagerListRequest(
  value: unknown,
): FileManagerListRequest {
  const candidate = record(value, "file list request");
  if (
    candidate.includeRepository !== undefined &&
    typeof candidate.includeRepository !== "boolean"
  ) {
    throw new TypeError(
      "file list include repository must be boolean",
    );
  }
  return {
    ...(candidate.path === undefined
      ? {}
      : {
          path: pathText(candidate.path, "file list path"),
        }),
    ...(candidate.includeRepository === undefined
      ? {}
      : {
          includeRepository: candidate.includeRepository,
        }),
  };
}

export function parseFileManagerOpenRequest(
  value: unknown,
): FileManagerOpenRequest {
  const candidate = record(value, "file open request");
  return { path: pathText(candidate.path, "file open path") };
}

export function parseFileManagerPreviewRequest(
  value: unknown,
): FileManagerPreviewRequest {
  const candidate = record(value, "file preview request");
  return {
    path: pathText(candidate.path, "file preview path"),
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
    if (bytes > FILES_TEXT_PREVIEW_MAX_BYTES) break;
  }
  return bytes;
}

export function parseFileManagerDiffRequest(
  value: unknown,
): FileManagerDiffRequest {
  const candidate = record(value, "file diff request");
  return {
    path: pathText(candidate.path, "file diff path"),
  };
}

export function parseFileManagerDiffResult(
  value: unknown,
): FileManagerDiffResult {
  const candidate = record(value, "file diff result");
  const path = pathText(candidate.path, "file diff result path");
  if (candidate.kind === "text") {
    if (
      typeof candidate.original !== "string" ||
      utf8ByteLength(candidate.original) >
        FILES_TEXT_PREVIEW_MAX_BYTES
    ) {
      throw new TypeError("file diff original text is invalid");
    }
    return {
      kind: "text",
      path,
      original: candidate.original,
    };
  }
  if (
    candidate.kind === "unavailable" &&
    (
      candidate.reason === "binary" ||
      candidate.reason === "git-unavailable" ||
      candidate.reason === "not-repository" ||
      candidate.reason === "too-large"
    )
  ) {
    return {
      kind: "unavailable",
      path,
      reason: candidate.reason,
    };
  }
  throw new TypeError("file diff result is invalid");
}

export function parseFileManagerWriteRequest(
  value: unknown,
): FileManagerWriteRequest {
  const candidate = record(value, "file write request");
  if (
    typeof candidate.content !== "string" ||
    utf8ByteLength(candidate.content) >
      FILES_TEXT_PREVIEW_MAX_BYTES
  ) {
    throw new TypeError(
      "file write content must be UTF-8 text within the size limit",
    );
  }
  return {
    path: pathText(candidate.path, "file write path"),
    content: candidate.content,
    expectedVersion: fileVersion(
      candidate.expectedVersion,
      "file write expected version",
    ),
  };
}

export function parseFileManagerWatchRequest(
  value: unknown,
): FileManagerWatchRequest {
  const candidate = record(value, "file watch request");
  return {
    id: watchId(candidate.id),
    paths: watchPaths(
      candidate.paths,
      "file watch request paths",
    ),
  };
}

export function parseFileManagerUnwatchRequest(
  value: unknown,
): FileManagerUnwatchRequest {
  const candidate = record(value, "file unwatch request");
  return { id: watchId(candidate.id) };
}

export function parseFileManagerChangeEvent(
  value: unknown,
): FileManagerChangeEvent {
  const candidate = record(value, "file change event");
  return {
    id: watchId(candidate.id),
    paths: watchPaths(
      candidate.paths,
      "file change event paths",
    ),
  };
}

export function parseFileManagerWriteResult(
  value: unknown,
): FileManagerWriteResult {
  const candidate = record(value, "file write result");
  return {
    path: pathText(candidate.path, "file write result path"),
    size: previewSize(candidate.size),
    version: fileVersion(
      candidate.version,
      "file write result version",
    ),
  };
}

export function parseFileManagerListResult(
  value: unknown,
): FileManagerListResult {
  const candidate = record(value, "file list result");
  if (!Array.isArray(candidate.entries)) {
    throw new TypeError("file list entries must be an array");
  }
  if (candidate.entries.length > FILES_MAX_ENTRIES) {
    throw new TypeError("file list contains too many entries");
  }
  if (typeof candidate.truncated !== "boolean") {
    throw new TypeError("file list truncated state must be boolean");
  }
  const entries = candidate.entries.map((value) => {
    const item = record(value, "file list entry");
    const kind = entryKind(item.kind);
    const targetKind =
      item.targetKind === undefined
        ? undefined
        : entryKind(item.targetKind);
    if (
      targetKind === "symlink" ||
      (kind !== "symlink" && targetKind !== undefined)
    ) {
      throw new TypeError("file entry target kind is invalid");
    }
    return {
      name: entryName(item.name),
      path: pathText(item.path, "file entry path"),
      kind,
      ...(targetKind === undefined ? {} : { targetKind }),
    };
  });
  const repository =
    candidate.repository === undefined
      ? undefined
      : record(candidate.repository, "file repository");
  let parsedRepository: FileManagerRepository | undefined;
  if (repository !== undefined) {
    if (
      typeof repository.branch !== "string" ||
      repository.branch.length === 0 ||
      repository.branch.length > FILES_MAX_GIT_BRANCH_LENGTH ||
      repository.branch.includes("\0")
    ) {
      throw new TypeError("file repository branch is invalid");
    }
    parsedRepository = {
      root: pathText(repository.root, "file repository root"),
      branch: repository.branch,
    };
  }
  return {
    path: pathText(candidate.path, "file list result path"),
    ...(candidate.parent === undefined
      ? {}
      : {
          parent: pathText(
            candidate.parent,
            "file list parent path",
          ),
        }),
    entries,
    truncated: candidate.truncated,
    ...(parsedRepository === undefined
      ? {}
      : { repository: parsedRepository }),
  };
}

function previewSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError("file preview size must be valid");
  }
  return value;
}

function previewBase(
  candidate: Record<string, unknown>,
): FileManagerPreviewBase {
  return {
    path: pathText(candidate.path, "file preview result path"),
    name: entryName(candidate.name),
    size: previewSize(candidate.size),
  };
}

function imageMimeType(
  value: unknown,
): FileManagerImagePreview["mimeType"] {
  if (
    value !== "image/avif" &&
    value !== "image/gif" &&
    value !== "image/jpeg" &&
    value !== "image/png" &&
    value !== "image/webp"
  ) {
    throw new TypeError("file preview image type is invalid");
  }
  return value;
}

export function parseFileManagerPreviewResult(
  value: unknown,
): FileManagerPreviewResult {
  const candidate = record(value, "file preview result");
  const base = previewBase(candidate);
  if (candidate.kind === "text") {
    if (
      typeof candidate.content !== "string" ||
      candidate.content.length > FILES_TEXT_PREVIEW_MAX_BYTES ||
      typeof candidate.truncated !== "boolean"
    ) {
      throw new TypeError("file text preview is invalid");
    }
    return {
      ...base,
      kind: "text",
      content: candidate.content,
      truncated: candidate.truncated,
      version: fileVersion(
        candidate.version,
        "file preview content version",
      ),
    };
  }
  if (candidate.kind === "image") {
    const mimeType = imageMimeType(candidate.mimeType);
    if (
      typeof candidate.dataUrl !== "string" ||
      !candidate.dataUrl.startsWith(`data:${mimeType};base64,`) ||
      candidate.dataUrl.length >
        Math.ceil(FILES_IMAGE_PREVIEW_MAX_BYTES * 4 / 3) + 128
    ) {
      throw new TypeError("file image preview is invalid");
    }
    return {
      ...base,
      kind: "image",
      mimeType,
      dataUrl: candidate.dataUrl,
    };
  }
  if (candidate.kind === "unsupported") {
    if (
      candidate.reason !== "binary" &&
      candidate.reason !== "too-large"
    ) {
      throw new TypeError("file preview reason is invalid");
    }
    return {
      ...base,
      kind: "unsupported",
      reason: candidate.reason,
    };
  }
  throw new TypeError("file preview kind is invalid");
}
