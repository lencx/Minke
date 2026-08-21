/** Shared trusted-host filesystem runtime for Electron IPC and Minke Host. */
import {
  chmod,
  open as openFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  execFile,
} from "node:child_process";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  FILES_IMAGE_PREVIEW_MAX_BYTES,
  FILES_MAX_ENTRIES,
  FILES_TEXT_PREVIEW_MAX_BYTES,
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerListResult,
  parseFileManagerOpenRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  type FileManagerDiffRequest,
  type FileManagerDiffResult,
  type FileManagerEntry,
  type FileManagerEntryKind,
  type FileManagerListRequest,
  type FileManagerListResult,
  type FileManagerOpenRequest,
  type FileManagerPreviewRequest,
  type FileManagerPreviewResult,
  type FileManagerRepository,
  type FileManagerWriteRequest,
  type FileManagerWriteResult,
} from "@minke/harness-overlay/tabs/files-contract.ts";

export interface DirectoryEntryLike {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface PathDetailsLike {
  isDirectory(): boolean;
  isFile(): boolean;
  readonly size?: number;
}

export interface FileManagerRuntimeOptions {
  readonly rootPath: string;
  readonly canonicalizePath?: (
    path: string,
  ) => Promise<string>;
  readonly readDirectory?: (
    path: string,
  ) => Promise<readonly DirectoryEntryLike[]>;
  readonly inspectPath?: (
    path: string,
  ) => Promise<PathDetailsLike>;
  readonly readBytes?: (
    path: string,
    limit: number,
  ) => Promise<Buffer>;
  readonly writeText?: (
    path: string,
    content: string,
  ) => Promise<void>;
  readonly readOriginal?: (
    path: string,
  ) => Promise<
    | {
      readonly kind: "text";
      readonly original: string;
    }
    | {
      readonly kind: "unavailable";
      readonly reason:
        | "binary"
        | "git-unavailable"
        | "not-repository"
        | "too-large";
    }
  >;
  readonly readRepository?: (
    path: string,
  ) => Promise<FileManagerRepository | undefined>;
  readonly openPath: (path: string) => Promise<string>;
}

async function readHostDirectory(
  path: string,
): Promise<readonly DirectoryEntryLike[]> {
  return await readdir(path, { withFileTypes: true });
}

async function inspectHostPath(
  path: string,
): Promise<PathDetailsLike> {
  return await stat(path);
}

async function readHostBytes(
  path: string,
  limit: number,
): Promise<Buffer> {
  const handle = await openFile(path, "r");
  try {
    const buffer = Buffer.alloc(limit);
    let offset = 0;
    while (offset < limit) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        limit - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function writeHostText(
  path: string,
  content: string,
): Promise<void> {
  const target = await realpath(path);
  const details = await stat(target);
  const permissions = details.mode & 0o7777;
  const temporary = join(
    dirname(target),
    `.${basename(target)}.minke-${randomUUID()}.tmp`,
  );
  let handle:
    | Awaited<ReturnType<typeof openFile>>
    | undefined;
  try {
    handle = await openFile(temporary, "wx", permissions);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, permissions);
    await rename(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function normalizedAbsolutePath(candidate: string): string {
  if (!isAbsolute(candidate)) {
    throw new TypeError("file manager path must be absolute");
  }
  return resolve(candidate);
}

function pathWithinRoot(rootPath: string, candidate: string): boolean {
  const offset = relative(rootPath, candidate);
  return (
    offset === "" ||
    (
      !isAbsolute(offset) &&
      offset !== ".." &&
      !offset.startsWith(`..${sep}`)
    )
  );
}

function contentVersion(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function kindRank(kind: FileManagerEntryKind): number {
  if (kind === "directory") return 0;
  if (kind === "file") return 1;
  if (kind === "symlink") return 2;
  return 3;
}

function compareEntries(
  left: FileManagerEntry,
  right: FileManagerEntry,
): number {
  const rank = kindRank(left.kind) - kindRank(right.kind);
  if (rank !== 0) return rank;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const imageMimeTypes = new Map<
  string,
  | "image/avif"
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
>([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const binaryExtensions = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".class",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".gz",
  ".ico",
  ".jar",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".ppt",
  ".pptx",
  ".so",
  ".tar",
  ".ttf",
  ".wav",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
]);

function looksBinary(path: string, content: Buffer): boolean {
  if (binaryExtensions.has(extname(path).toLowerCase())) {
    return true;
  }
  const sampleLength = Math.min(content.length, 8_192);
  if (sampleLength === 0) return false;
  let controlBytes = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = content[index] ?? 0;
    if (byte === 0) return true;
    if (
      byte < 32 &&
      byte !== 9 &&
      byte !== 10 &&
      byte !== 13
    ) {
      controlBytes += 1;
    }
  }
  return controlBytes / sampleLength > 0.1;
}

function gitOutput(
  args: readonly string[],
  maxBuffer: number,
): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      args,
      {
        encoding: "buffer",
        maxBuffer,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
}

function processErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

async function readGitRepository(
  path: string,
): Promise<FileManagerRepository | undefined> {
  try {
    const [root, branch] = (
      await gitOutput(
        [
          "-C",
          path,
          "rev-parse",
          "--show-toplevel",
          "--abbrev-ref",
          "HEAD",
        ],
        128 * 1_024,
      )
    ).toString("utf8").trim().split(/\r?\n/u);
    if (
      root === undefined ||
      branch === undefined ||
      !isAbsolute(root) ||
      branch === ""
    ) {
      return undefined;
    }
    return {
      root: resolve(root),
      branch,
    };
  } catch {
    return undefined;
  }
}

async function readGitOriginal(
  path: string,
): Promise<
  | {
    readonly kind: "text";
    readonly original: string;
  }
  | {
    readonly kind: "unavailable";
    readonly reason:
      | "binary"
      | "git-unavailable"
      | "not-repository"
      | "too-large";
  }
> {
  let repositoryRoot: string;
  try {
    repositoryRoot = (
      await gitOutput(
        ["-C", dirname(path), "rev-parse", "--show-toplevel"],
        64 * 1_024,
      )
    ).toString("utf8").trim();
  } catch (error) {
    return {
      kind: "unavailable",
      reason:
        processErrorCode(error) === "ENOENT"
          ? "git-unavailable"
          : "not-repository",
    };
  }
  const repositoryPath = relative(repositoryRoot, path);
  if (
    repositoryPath === "" ||
    isAbsolute(repositoryPath) ||
    repositoryPath === ".." ||
    repositoryPath.startsWith(`..${sep}`)
  ) {
    return {
      kind: "unavailable",
      reason: "not-repository",
    };
  }
  const objectName =
    `HEAD:${repositoryPath.split(sep).join("/")}`;
  try {
    await gitOutput(
      ["-C", repositoryRoot, "cat-file", "-e", objectName],
      64 * 1_024,
    );
  } catch {
    return { kind: "text", original: "" };
  }
  let original: Buffer;
  try {
    original = await gitOutput(
      ["-C", repositoryRoot, "show", objectName],
      FILES_TEXT_PREVIEW_MAX_BYTES + 1,
    );
  } catch (error) {
    if (
      processErrorCode(error) ===
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    ) {
      return { kind: "unavailable", reason: "too-large" };
    }
    throw error;
  }
  if (looksBinary(path, original)) {
    return { kind: "unavailable", reason: "binary" };
  }
  return {
    kind: "text",
    original: original.toString("utf8"),
  };
}

/** Trusted host filesystem adapter for Files tabs. */
export class FileManagerRuntime {
  readonly #rootPath: string;
  readonly #canonicalizePath: NonNullable<
    FileManagerRuntimeOptions["canonicalizePath"]
  >;
  readonly #canonicalRoot: Promise<string>;
  readonly #readDirectory: NonNullable<
    FileManagerRuntimeOptions["readDirectory"]
  >;
  readonly #inspectPath: NonNullable<
    FileManagerRuntimeOptions["inspectPath"]
  >;
  readonly #readBytes: NonNullable<
    FileManagerRuntimeOptions["readBytes"]
  >;
  readonly #writeText: NonNullable<
    FileManagerRuntimeOptions["writeText"]
  >;
  readonly #readOriginal: NonNullable<
    FileManagerRuntimeOptions["readOriginal"]
  >;
  readonly #readRepository: NonNullable<
    FileManagerRuntimeOptions["readRepository"]
  >;
  readonly #openPath: FileManagerRuntimeOptions["openPath"];

  constructor(options: FileManagerRuntimeOptions) {
    this.#rootPath = normalizedAbsolutePath(options.rootPath);
    this.#canonicalizePath = options.canonicalizePath ?? realpath;
    this.#canonicalRoot = this.#canonicalizePath(
      this.#rootPath,
    ).then(normalizedAbsolutePath);
    this.#readDirectory =
      options.readDirectory ?? readHostDirectory;
    this.#inspectPath = options.inspectPath ?? inspectHostPath;
    this.#readBytes = options.readBytes ?? readHostBytes;
    this.#writeText = options.writeText ?? writeHostText;
    this.#readOriginal =
      options.readOriginal ?? readGitOriginal;
    this.#readRepository =
      options.readRepository ?? readGitRepository;
    this.#openPath = options.openPath;
  }

  async list(
    request: FileManagerListRequest,
  ): Promise<FileManagerListResult> {
    const parsed = parseFileManagerListRequest(request);
    const [path, rootPath] = await Promise.all([
      this.#resolvePath(parsed.path ?? this.#rootPath),
      this.#canonicalRoot,
    ]);
    const [source, repository] = await Promise.all([
      this.#readDirectory(path),
      parsed.includeRepository === true
        ? this.#readRepository(path)
        : Promise.resolve(undefined),
    ]);
    const entries = await Promise.all(
      source.map(async (entry): Promise<FileManagerEntry> => {
        const entryPath = join(path, entry.name);
        let kind: FileManagerEntryKind;
        let targetKind:
          | Exclude<FileManagerEntryKind, "symlink">
          | undefined;
        if (entry.isSymbolicLink()) {
          kind = "symlink";
          try {
            await this.#resolvePath(entryPath);
            const details = await this.#inspectPath(entryPath);
            targetKind = details.isDirectory()
              ? "directory"
              : details.isFile()
                ? "file"
                : "other";
          } catch {
            // Broken links remain symlinks with no target classification.
          }
        } else if (entry.isDirectory()) kind = "directory";
        else if (entry.isFile()) kind = "file";
        else kind = "other";
        return {
          name: entry.name,
          path: entryPath,
          kind,
          ...(targetKind === undefined ? {} : { targetKind }),
        };
      }),
    );
    entries.sort(compareEntries);
    const parent = dirname(path);
    const boundedRepository =
      repository !== undefined &&
        pathWithinRoot(rootPath, repository.root)
        ? repository
        : undefined;
    return parseFileManagerListResult({
      path,
      ...(path === rootPath || parent === path ? {} : { parent }),
      entries: entries.slice(0, FILES_MAX_ENTRIES),
      truncated: entries.length > FILES_MAX_ENTRIES,
      ...(boundedRepository === undefined
        ? {}
        : { repository: boundedRepository }),
    });
  }

  async open(request: FileManagerOpenRequest): Promise<void> {
    const parsed = parseFileManagerOpenRequest(request);
    const path = await this.#resolvePath(parsed.path);
    const error = await this.#openPath(path);
    if (error !== "") {
      throw new Error(error);
    }
  }

  async diff(
    request: FileManagerDiffRequest,
  ): Promise<FileManagerDiffResult> {
    const parsed = parseFileManagerDiffRequest(request);
    const path = await this.#resolvePath(parsed.path);
    return parseFileManagerDiffResult({
      path,
      ...await this.#readOriginal(path),
    });
  }

  async preview(
    request: FileManagerPreviewRequest,
  ): Promise<FileManagerPreviewResult> {
    const parsed = parseFileManagerPreviewRequest(request);
    const path = await this.#resolvePath(parsed.path);
    const details = await this.#inspectPath(path);
    if (!details.isFile()) {
      throw new TypeError("file preview path must be a file");
    }
    const size = details.size;
    if (
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw new TypeError("file preview size is unavailable");
    }
    const name = basename(path);
    const mimeType = imageMimeTypes.get(
      extname(path).toLowerCase(),
    );
    if (mimeType !== undefined) {
      if (size > FILES_IMAGE_PREVIEW_MAX_BYTES) {
        return parseFileManagerPreviewResult({
          kind: "unsupported",
          path,
          name,
          size,
          reason: "too-large",
        });
      }
      const content = await this.#readBytes(
        path,
        FILES_IMAGE_PREVIEW_MAX_BYTES + 1,
      );
      if (content.length > FILES_IMAGE_PREVIEW_MAX_BYTES) {
        return parseFileManagerPreviewResult({
          kind: "unsupported",
          path,
          name,
          size,
          reason: "too-large",
        });
      }
      return parseFileManagerPreviewResult({
        kind: "image",
        path,
        name,
        size,
        mimeType,
        dataUrl: `data:${mimeType};base64,${content.toString("base64")}`,
      });
    }

    const content = await this.#readBytes(
      path,
      FILES_TEXT_PREVIEW_MAX_BYTES + 1,
    );
    if (looksBinary(path, content)) {
      return parseFileManagerPreviewResult({
        kind: "unsupported",
        path,
        name,
        size,
        reason: "binary",
      });
    }
    const truncated =
      content.length > FILES_TEXT_PREVIEW_MAX_BYTES;
    return parseFileManagerPreviewResult({
      kind: "text",
      path,
      name,
      size,
      content: content
        .subarray(0, FILES_TEXT_PREVIEW_MAX_BYTES)
        .toString("utf8"),
      truncated,
      version: contentVersion(content),
    });
  }

  async write(
    request: FileManagerWriteRequest,
  ): Promise<FileManagerWriteResult> {
    const parsed = parseFileManagerWriteRequest(request);
    const path = await this.#resolvePath(parsed.path);
    const details = await this.#inspectPath(path);
    if (!details.isFile()) {
      throw new TypeError("file write path must be a file");
    }
    const current = await this.#readBytes(
      path,
      FILES_TEXT_PREVIEW_MAX_BYTES + 1,
    );
    if (
      current.length > FILES_TEXT_PREVIEW_MAX_BYTES ||
      looksBinary(path, current)
    ) {
      throw new Error(
        "file changed on disk and is no longer writable as text",
      );
    }
    if (contentVersion(current) !== parsed.expectedVersion) {
      throw new Error(
        "file changed on disk; reload it before saving",
      );
    }
    const size = Buffer.byteLength(parsed.content, "utf8");
    if (size > FILES_TEXT_PREVIEW_MAX_BYTES) {
      throw new TypeError("file write content exceeds the size limit");
    }
    await this.#writeText(path, parsed.content);
    return parseFileManagerWriteResult({
      path,
      size,
      version: contentVersion(Buffer.from(parsed.content, "utf8")),
    });
  }

  async #resolvePath(candidate: string): Promise<string> {
    const normalized = normalizedAbsolutePath(candidate);
    const [rootPath, path] = await Promise.all([
      this.#canonicalRoot,
      this.#canonicalizePath(normalized).then(
        normalizedAbsolutePath,
      ),
    ]);
    if (!pathWithinRoot(rootPath, path)) {
      throw new TypeError(
        `file manager path is outside its root: ${normalized}`,
      );
    }
    return path;
  }
}
