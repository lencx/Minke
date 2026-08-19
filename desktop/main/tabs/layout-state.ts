import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
  type TabsLayoutState,
} from "@minke/harness-overlay/tabs/contract.ts";

export const TABS_LAYOUT_STATE_VERSION = 1;

interface TabsLayoutStateDocument extends TabsLayoutState {
  readonly version: typeof TABS_LAYOUT_STATE_VERSION;
}

/** Resolve the Tabs panel geometry sidecar beside minke.config.json. */
export function tabsLayoutStateFilePath(
  minkeConfigPath: string,
): string {
  return join(dirname(minkeConfigPath), "tabs-layout-state.json");
}

function defaultDocument(): TabsLayoutStateDocument {
  return { version: TABS_LAYOUT_STATE_VERSION };
}

function parseDocument(value: unknown): TabsLayoutStateDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Tabs layout state document must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== TABS_LAYOUT_STATE_VERSION ||
    Object.keys(candidate).some(
      (key) =>
        key !== "version" &&
        key !== "rightWidth" &&
        key !== "bottomHeight",
    )
  ) {
    throw new TypeError("unsupported Tabs layout state document");
  }
  return {
    version: TABS_LAYOUT_STATE_VERSION,
    ...parseTabsLayoutState({
      ...(candidate.rightWidth === undefined
        ? {}
        : { rightWidth: candidate.rightWidth }),
      ...(candidate.bottomHeight === undefined
        ? {}
        : { bottomHeight: candidate.bottomHeight }),
    }),
  };
}

function stateSnapshot(
  document: TabsLayoutStateDocument,
): TabsLayoutState {
  return {
    ...(document.rightWidth === undefined
      ? {}
      : { rightWidth: document.rightWidth }),
    ...(document.bottomHeight === undefined
      ? {}
      : { bottomHeight: document.bottomHeight }),
  };
}

function isMissingOrInvalid(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException).code === "ENOENT" ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  );
}

/** Serializes right and bottom panel updates without cross-panel loss. */
export class TabsLayoutStateStore {
  readonly path: string;

  #document: TabsLayoutStateDocument | undefined;
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();
  #writeSequence = 0;

  constructor(minkeConfigPath: string) {
    this.path = tabsLayoutStateFilePath(minkeConfigPath);
  }

  read(): Promise<TabsLayoutState> {
    return this.#runExclusive(async () => {
      return stateSnapshot(await this.#load());
    });
  }

  write(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const update = parseTabsLayoutStateUpdate(value);
      const current = await this.#load();
      const next: TabsLayoutStateDocument =
        update.placement === "right"
          ? { ...current, rightWidth: update.size }
          : { ...current, bottomHeight: update.size };
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

  async #load(): Promise<TabsLayoutStateDocument> {
    if (this.#loaded) {
      return this.#document as TabsLayoutStateDocument;
    }
    let document: TabsLayoutStateDocument;
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

  async #persist(document: TabsLayoutStateDocument): Promise<void> {
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
