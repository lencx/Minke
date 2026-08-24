import {
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export const MINKE_REMOTE_PREVIEW_ROUTE = "/minke-preview";

const PREVIEW_STORE_VERSION = 1;
const PREVIEW_SECRET_BYTES = 32;
const PREVIEW_TOKEN_BYTES = 16;
const PREVIEW_TOKEN_PATTERN = "[A-Za-z0-9_-]{22}";
const PREVIEW_FILE_PATTERN =
  new RegExp(`^(${PREVIEW_TOKEN_PATTERN})\\.json$`, "u");
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_HTML_PREVIEWS_PER_TURN = 4;
const MAX_OPERATION_ID_LENGTH = 512;
const MAX_PRODUCED_PATHS = 128;
const MAX_TITLE_LENGTH = 256;
const MAX_JSON_STRING_EXPANSION = 6;
const STORED_PREVIEW_METADATA_BYTES = 4 * 1024;

const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "media-src data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "sandbox",
].join("; ");

interface RemotePreviewRoute {
  readonly kind: "prefix";
  readonly path: string;
  readonly handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>;
}

export interface RemotePreviewWebServer {
  register(route: RemotePreviewRoute): () => void;
}

export interface RemotePreviewRef {
  readonly title: string;
  readonly route: string;
}

export interface RemotePreviewRuntimeOptions {
  readonly rootPath: string;
  readonly storePath: string;
  readonly webServer: RemotePreviewWebServer;
  readonly maxEntries?: number;
  readonly maxHtmlBytes?: number;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

interface StoredPreview {
  readonly version: typeof PREVIEW_STORE_VERSION;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly title: string;
  readonly html: string;
}

interface PreviewStoreState {
  readonly rootPath: string;
  readonly secret: Buffer;
}

function positiveSafeInteger(
  value: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function absolutePath(value: string, label: string): string {
  if (value.length === 0 || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return resolve(value);
}

function pathWithinRoot(
  rootPath: string,
  candidate: string,
): boolean {
  const offset = relative(rootPath, candidate);
  return (
    offset === "" ||
    (!offset.startsWith("..") && !isAbsolute(offset))
  );
}

function htmlPath(value: string): boolean {
  const extension = extname(value).toLowerCase();
  return extension === ".html" || extension === ".htm";
}

function operationId(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_OPERATION_ID_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("invalid preview operation id");
  }
  return value;
}

function previewTitle(value: string): string {
  const title = basename(value)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .slice(0, MAX_TITLE_LENGTH);
  return title === "" ? "preview.html" : title;
}

function tokenFor(
  secret: Buffer,
  id: string,
  logicalPath: string,
): string {
  return createHmac("sha256", secret)
    .update(id)
    .update("\0")
    .update(logicalPath)
    .digest()
    .subarray(0, PREVIEW_TOKEN_BYTES)
    .toString("base64url");
}

function storedPreview(value: unknown): StoredPreview | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 5 ||
    candidate.version !== PREVIEW_STORE_VERSION ||
    !Number.isSafeInteger(candidate.createdAt) ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    Number(candidate.expiresAt) <= Number(candidate.createdAt) ||
    typeof candidate.title !== "string" ||
    candidate.title.length === 0 ||
    candidate.title.length > MAX_TITLE_LENGTH ||
    typeof candidate.html !== "string"
  ) {
    return undefined;
  }
  return {
    version: PREVIEW_STORE_VERSION,
    createdAt: Number(candidate.createdAt),
    expiresAt: Number(candidate.expiresAt),
    title: candidate.title,
    html: candidate.html,
  };
}

function fileErrorCode(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return undefined;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

/**
 * Persist immutable, self-contained HTML snapshots behind unguessable routes.
 *
 * One logical `(operationId, produced path)` always derives the same token,
 * so an Agent/Gateway replay returns a byte-identical route after restart.
 */
export class RemotePreviewRuntime {
  readonly #rootPath: string;
  readonly #storePath: string;
  readonly #maxEntries: number;
  readonly #maxHtmlBytes: number;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #disposeRoute: () => void;
  readonly #publications =
    new Map<string, Promise<StoredPreview | undefined>>();
  #storeState: Promise<PreviewStoreState> | undefined;
  #disposed = false;

  constructor(options: RemotePreviewRuntimeOptions) {
    this.#rootPath = absolutePath(
      options.rootPath,
      "preview rootPath",
    );
    this.#storePath = absolutePath(
      options.storePath,
      "preview storePath",
    );
    this.#maxEntries = positiveSafeInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "preview maxEntries",
    );
    this.#maxHtmlBytes = positiveSafeInteger(
      options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES,
      "preview maxHtmlBytes",
    );
    this.#ttlMs = positiveSafeInteger(
      options.ttlMs ?? DEFAULT_TTL_MS,
      "preview ttlMs",
    );
    this.#now = options.now ?? Date.now;
    this.#disposeRoute = options.webServer.register({
      kind: "prefix",
      path: MINKE_REMOTE_PREVIEW_ROUTE,
      handler: this.#handleRequest,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposeRoute();
    this.#publications.clear();
  }

  async publish(input: {
    readonly cwd: string;
    readonly operationId: string;
    readonly paths: readonly string[];
  }): Promise<readonly RemotePreviewRef[]> {
    if (this.#disposed) {
      throw new Error("remote preview runtime is disposed");
    }
    const id = operationId(input.operationId);
    const cwd = absolutePath(input.cwd, "preview cwd");
    if (
      !Array.isArray(input.paths) ||
      input.paths.length > MAX_PRODUCED_PATHS
    ) {
      throw new TypeError("invalid produced preview paths");
    }
    const state = await this.#initializeStore();
    const logicalPaths = [
      ...new Set(
        input.paths.flatMap((value) => {
          if (
            typeof value !== "string" ||
            value.length === 0 ||
            !htmlPath(value)
          ) {
            return [];
          }
          return [
            isAbsolute(value)
              ? resolve(value)
              : resolve(cwd, value),
          ];
        }),
      ),
    ].slice(0, MAX_HTML_PREVIEWS_PER_TURN);
    const previews: RemotePreviewRef[] = [];
    for (const logicalPath of logicalPaths) {
      const token = tokenFor(state.secret, id, logicalPath);
      let publication = this.#publications.get(token);
      if (publication === undefined) {
        publication = this.#loadOrCreatePreview(
          state,
          token,
          logicalPath,
        ).finally(() => {
          this.#publications.delete(token);
        });
        this.#publications.set(token, publication);
      }
      const snapshot = await publication;
      if (snapshot === undefined) continue;
      previews.push({
        title: snapshot.title,
        route: `${MINKE_REMOTE_PREVIEW_ROUTE}/${token}/`,
      });
    }
    return previews;
  }

  async #initializeStore(): Promise<PreviewStoreState> {
    this.#storeState ??= (async () => {
      await mkdir(this.#storePath, {
        recursive: true,
        mode: 0o700,
      });
      await chmod(this.#storePath, 0o700);
      const [rootPath, secret] = await Promise.all([
        realpath(this.#rootPath),
        this.#loadSecret(),
      ]);
      await this.#cleanupStore();
      return { rootPath, secret };
    })();
    return await this.#storeState;
  }

  async #loadSecret(): Promise<Buffer> {
    const path = join(this.#storePath, ".preview-secret");
    try {
      const existing = await readFile(path);
      if (existing.length !== PREVIEW_SECRET_BYTES) {
        throw new Error("remote preview secret is invalid");
      }
      await chmod(path, 0o600);
      return existing;
    } catch (error) {
      if (fileErrorCode(error) !== "ENOENT") throw error;
    }
    const secret = randomBytes(PREVIEW_SECRET_BYTES);
    let file;
    try {
      file = await open(path, "wx", 0o600);
      await file.writeFile(secret);
      await file.sync();
    } catch (error) {
      if (fileErrorCode(error) !== "EEXIST") throw error;
      const existing = await readFile(path);
      if (existing.length !== PREVIEW_SECRET_BYTES) {
        throw new Error("remote preview secret is invalid");
      }
      return existing;
    } finally {
      await file?.close();
    }
    await chmod(path, 0o600);
    return secret;
  }

  async #loadOrCreatePreview(
    state: PreviewStoreState,
    token: string,
    logicalPath: string,
  ): Promise<StoredPreview | undefined> {
    const storedPath = join(this.#storePath, `${token}.json`);
    const existing = await this.#readStoredPreview(storedPath);
    if (
      existing !== undefined &&
      existing.expiresAt > this.#now()
    ) {
      return existing;
    }
    if (existing !== undefined) {
      await rm(storedPath, { force: true });
    }

    let resolvedPath: string;
    try {
      resolvedPath = await realpath(logicalPath);
    } catch {
      return undefined;
    }
    if (!pathWithinRoot(state.rootPath, resolvedPath)) {
      return undefined;
    }
    const metadata = await stat(resolvedPath);
    if (
      !metadata.isFile() ||
      metadata.size > this.#maxHtmlBytes
    ) {
      return undefined;
    }
    const bytes = await readFile(resolvedPath);
    if (bytes.length > this.#maxHtmlBytes) return undefined;
    let html: string;
    try {
      html = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes);
    } catch {
      return undefined;
    }
    const createdAt = this.#now();
    const snapshot: StoredPreview = {
      version: PREVIEW_STORE_VERSION,
      createdAt,
      expiresAt: createdAt + this.#ttlMs,
      title: previewTitle(logicalPath),
      html,
    };
    await this.#writeStoredPreview(storedPath, token, snapshot);
    return snapshot;
  }

  async #readStoredPreview(
    path: string,
  ): Promise<StoredPreview | undefined> {
    try {
      const bytes = await readFile(path);
      // One UTF-8 source byte can become six JSON bytes (`\u0000`).
      // Bound the serialized envelope before parsing, then re-check the
      // decoded HTML against the public source-byte limit below.
      const maxStoredBytes = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.#maxHtmlBytes * MAX_JSON_STRING_EXPANSION +
          STORED_PREVIEW_METADATA_BYTES,
      );
      if (
        bytes.length > maxStoredBytes
      ) {
        return undefined;
      }
      const snapshot = storedPreview(
        JSON.parse(bytes.toString("utf8")),
      );
      if (
        snapshot === undefined ||
        Buffer.byteLength(snapshot.html, "utf8") >
          this.#maxHtmlBytes
      ) {
        return undefined;
      }
      return snapshot;
    } catch (error) {
      if (fileErrorCode(error) === "ENOENT") return undefined;
      return undefined;
    }
  }

  async #writeStoredPreview(
    path: string,
    token: string,
    snapshot: StoredPreview,
  ): Promise<void> {
    const temporaryPath = join(
      this.#storePath,
      `.${token}.${randomBytes(6).toString("base64url")}.tmp`,
    );
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(snapshot)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async #cleanupStore(): Promise<void> {
    const entries = await readdir(this.#storePath, {
      withFileTypes: true,
    });
    const retained: {
      readonly path: string;
      readonly createdAt: number;
    }[] = [];
    for (const entry of entries) {
      const path = join(this.#storePath, entry.name);
      if (
        entry.isFile() &&
        entry.name.startsWith(".") &&
        entry.name.endsWith(".tmp")
      ) {
        await rm(path, { force: true });
        continue;
      }
      const match = PREVIEW_FILE_PATTERN.exec(entry.name);
      if (!entry.isFile() || match === null) continue;
      const snapshot = await this.#readStoredPreview(path);
      if (
        snapshot === undefined ||
        snapshot.expiresAt <= this.#now()
      ) {
        await rm(path, { force: true });
        continue;
      }
      retained.push({
        path,
        createdAt: snapshot.createdAt,
      });
    }
    retained.sort(
      (left, right) => right.createdAt - left.createdAt,
    );
    for (const stale of retained.slice(this.#maxEntries)) {
      await rm(stale.path, { force: true });
    }
  }

  readonly #handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }
    let token: string | undefined;
    try {
      const pathname = new URL(
        request.url ?? "/",
        "http://minke.invalid",
      ).pathname;
      const match = new RegExp(
        `^${MINKE_REMOTE_PREVIEW_ROUTE}/(${PREVIEW_TOKEN_PATTERN})/?$`,
        "u",
      ).exec(pathname);
      token = match?.[1];
    } catch {
      token = undefined;
    }
    if (token === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    await this.#initializeStore();
    const storedPath = join(this.#storePath, `${token}.json`);
    const snapshot = await this.#readStoredPreview(storedPath);
    if (
      snapshot === undefined ||
      snapshot.expiresAt <= this.#now()
    ) {
      if (snapshot !== undefined) {
        await rm(storedPath, { force: true });
      }
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy":
        PREVIEW_CONTENT_SECURITY_POLICY,
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy":
        "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    response.end(
      request.method === "HEAD" ? undefined : snapshot.html,
    );
  };
}
