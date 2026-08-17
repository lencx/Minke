import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseShortcutBindings,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

/** Current schema version of the unified Minke desktop configuration. */
export const MINKE_CONFIG_VERSION = 1;

/** Complete Minke-owned desktop configuration stored on disk. */
export interface MinkeConfigDocument {
  version: typeof MINKE_CONFIG_VERSION;
  shortcuts: ShortcutBindings;
  terminal: TerminalSettings;
}

/** One validated section of the unified desktop configuration. */
export interface MinkeConfigSection<T> {
  read(): Promise<T>;
  write(value: unknown): Promise<void>;
}

const CONFIG_KEYS = new Set([
  "version",
  "shortcuts",
  "terminal",
]);

function defaultDocument(): MinkeConfigDocument {
  return {
    version: MINKE_CONFIG_VERSION,
    shortcuts: {},
    terminal: { ...DEFAULT_TERMINAL_SETTINGS },
  };
}

/** Validate and copy one unified Minke desktop configuration document. */
export function parseMinkeConfigDocument(
  value: unknown,
): MinkeConfigDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Minke config document must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== CONFIG_KEYS.size ||
    Object.keys(record).some((key) => !CONFIG_KEYS.has(key)) ||
    record.version !== MINKE_CONFIG_VERSION
  ) {
    throw new TypeError("unsupported Minke config document");
  }
  return {
    version: MINKE_CONFIG_VERSION,
    shortcuts: parseShortcutBindings(record.shortcuts),
    terminal: parseTerminalSettings(record.terminal),
  };
}

/**
 * Owns the single Minke desktop configuration document and serializes section
 * updates so independent settings surfaces cannot overwrite one another.
 */
export class MinkeConfigStore {
  readonly path: string;
  readonly shortcuts: MinkeConfigSection<ShortcutBindings>;
  readonly terminal: MinkeConfigSection<TerminalSettings>;

  #document: MinkeConfigDocument | undefined;
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();
  #writeSequence = 0;

  constructor(userDataPath: string) {
    this.path = join(
      userDataPath,
      "desktop",
      "minke.config.json",
    );
    this.shortcuts = Object.freeze({
      read: () => this.#readShortcuts(),
      write: (value: unknown) => this.#writeShortcuts(value),
    });
    this.terminal = Object.freeze({
      read: () => this.#readTerminal(),
      write: (value: unknown) => this.#writeTerminal(value),
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

  async #load(): Promise<MinkeConfigDocument> {
    if (this.#loaded) return this.#document as MinkeConfigDocument;
    let document: MinkeConfigDocument;
    try {
      document = parseMinkeConfigDocument(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      document = defaultDocument();
    }
    this.#document = document;
    this.#loaded = true;
    return document;
  }

  #readShortcuts(): Promise<ShortcutBindings> {
    return this.#runExclusive(async () => ({
      ...(await this.#load()).shortcuts,
    }));
  }

  #readTerminal(): Promise<TerminalSettings> {
    return this.#runExclusive(async () => ({
      ...(await this.#load()).terminal,
    }));
  }

  #writeShortcuts(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const shortcuts = parseShortcutBindings(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        shortcuts,
      };
      await this.#persist(next);
      this.#document = next;
    });
  }

  #writeTerminal(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const terminal = parseTerminalSettings(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        terminal,
      };
      await this.#persist(next);
      this.#document = next;
    });
  }

  async #persist(document: MinkeConfigDocument): Promise<void> {
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
