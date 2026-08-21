import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
  type FileManagerViewState,
} from "@minke/harness-overlay/tabs/files-contract.ts";

export const FILES_VIEW_STATE_VERSION = 1;

interface FilesViewStateDocument extends FileManagerViewState {
  readonly version: typeof FILES_VIEW_STATE_VERSION;
}

/** Resolve the Files UI state sidecar beside minke.config.json. */
export function filesViewStateFilePath(
  minkeConfigPath: string,
): string {
  return join(dirname(minkeConfigPath), "files-view-state.json");
}

function defaultDocument(): FilesViewStateDocument {
  return { version: FILES_VIEW_STATE_VERSION };
}

function parseLegacyCodeTheme(value: unknown) {
  const update = parseFileManagerViewStateUpdate({
    colorScheme: "light",
    codeTheme: value,
  });
  if (!("codeTheme" in update)) {
    throw new TypeError("legacy code theme is invalid");
  }
  return update.codeTheme;
}

function parseDocument(value: unknown): FilesViewStateDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Files view state document must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== FILES_VIEW_STATE_VERSION ||
    Object.keys(candidate).some(
      (key) =>
        key !== "version" &&
        key !== "codeTheme" &&
        key !== "codeThemes" &&
        key !== "right" &&
        key !== "bottom",
    )
  ) {
    throw new TypeError("unsupported Files view state document");
  }
  if (
    candidate.codeTheme !== undefined &&
    candidate.codeThemes !== undefined
  ) {
    throw new TypeError(
      "Files view state document contains ambiguous code themes",
    );
  }
  const legacyTheme =
    candidate.codeTheme === undefined
      ? undefined
      : parseLegacyCodeTheme(candidate.codeTheme);
  const state = parseFileManagerViewState({
    ...(candidate.codeThemes === undefined &&
    legacyTheme === undefined
      ? {}
      : {
          codeThemes:
            candidate.codeThemes ??
            {
              light: legacyTheme,
              dark: legacyTheme,
            },
        }),
    ...(candidate.right === undefined
      ? {}
      : { right: candidate.right }),
    ...(candidate.bottom === undefined
      ? {}
      : { bottom: candidate.bottom }),
  });
  return {
    version: FILES_VIEW_STATE_VERSION,
    ...state,
  };
}

function stateSnapshot(
  document: FilesViewStateDocument,
): FileManagerViewState {
  return {
    ...(document.codeThemes === undefined
      ? {}
      : { codeThemes: { ...document.codeThemes } }),
    ...(document.right === undefined
      ? {}
      : { right: { ...document.right } }),
    ...(document.bottom === undefined
      ? {}
      : { bottom: { ...document.bottom } }),
  };
}

function isMissingOrInvalid(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException).code === "ENOENT" ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  );
}

/**
 * Owns Files-only UI state and serializes placement updates so the independent
 * right and bottom panel runtimes cannot overwrite one another.
 */
export class FilesViewStateStore {
  readonly path: string;

  #document: FilesViewStateDocument | undefined;
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();
  #writeSequence = 0;

  constructor(minkeConfigPath: string) {
    this.path = filesViewStateFilePath(minkeConfigPath);
  }

  read(): Promise<FileManagerViewState> {
    return this.#runExclusive(async () => {
      return stateSnapshot(await this.#load());
    });
  }

  write(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const update = parseFileManagerViewStateUpdate(value);
      const current = await this.#load();
      const next: FilesViewStateDocument =
        "codeTheme" in update
          ? {
              ...current,
              codeThemes: {
                ...current.codeThemes,
                [update.colorScheme]: update.codeTheme,
              },
            }
          : {
              ...current,
              [update.placement]: {
                ...current[update.placement],
                ...(update.explorerPosition === undefined
                  ? {}
                  : {
                      explorerPosition:
                        update.explorerPosition,
                    }),
                ...(update.previewWidth === undefined
                  ? {}
                  : { previewWidth: update.previewWidth }),
                ...(update.viewMode === undefined
                  ? {}
                  : { viewMode: update.viewMode }),
              },
            };
      await this.#persist(next);
      this.#document = next;
    });
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #load(): Promise<FilesViewStateDocument> {
    if (this.#loaded) {
      return this.#document as FilesViewStateDocument;
    }
    let document: FilesViewStateDocument;
    try {
      document = parseDocument(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if (!isMissingOrInvalid(error)) throw error;
      document = defaultDocument();
    }
    this.#document = document;
    this.#loaded = true;
    return document;
  }

  async #persist(document: FilesViewStateDocument): Promise<void> {
    await mkdir(dirname(this.path), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryPath = `${this.path}.${String(process.pid)}.${String(
      ++this.#writeSequence,
    )}.tmp`;
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
