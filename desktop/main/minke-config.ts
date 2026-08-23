import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseModelRuntimeSettings,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import {
  parseRemoteSettings,
  type RemoteSettings,
} from "@lencx/minke-remote-access/contract";
import {
  parseDataHomePath,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  parsePluginManagementSettings,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  parseShortcutBindings,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  createDefaultMinkeConfigDocument,
  parseMinkeConfigDocument,
  type MinkeConfigDocument,
} from "./minke-config/document.ts";

export {
  MINKE_CONFIG_VERSION,
  parseMinkeConfigDocument,
} from "./minke-config/document.ts";
export type {
  MinkeConfigDocument,
} from "./minke-config/document.ts";

/** Resolve the unified desktop config path below Minke's user-data root. */
export function minkeConfigFilePath(userDataPath: string): string {
  return join(
    userDataPath,
    "desktop",
    "minke.config.json",
  );
}

/** One validated section of the unified desktop configuration. */
export interface MinkeConfigSection<T> {
  read(): Promise<T>;
  write(value: unknown): Promise<void>;
}

/**
 * Owns the single Minke desktop configuration document and serializes section
 * updates so independent settings surfaces cannot overwrite one another.
 */
export class MinkeConfigStore {
  readonly path: string;
  readonly shortcuts: MinkeConfigSection<ShortcutBindings>;
  readonly terminal: MinkeConfigSection<TerminalSettings>;
  readonly modelRuntime: MinkeConfigSection<ModelRuntimeSettings>;
  readonly remote: MinkeConfigSection<RemoteSettings>;
  readonly plugins: MinkeConfigSection<PluginManagementSettings>;
  readonly dshHome: MinkeConfigSection<string | undefined>;

  #document: MinkeConfigDocument | undefined;
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();
  #writeSequence = 0;

  constructor(userDataPath: string) {
    this.path = minkeConfigFilePath(userDataPath);
    this.shortcuts = Object.freeze({
      read: () => this.#readShortcuts(),
      write: (value: unknown) => this.#writeShortcuts(value),
    });
    this.terminal = Object.freeze({
      read: () => this.#readTerminal(),
      write: (value: unknown) => this.#writeTerminal(value),
    });
    this.modelRuntime = Object.freeze({
      read: () => this.#readModelRuntime(),
      write: (value: unknown) => this.#writeModelRuntime(value),
    });
    this.remote = Object.freeze({
      read: () => this.#readRemote(),
      write: (value: unknown) => this.#writeRemote(value),
    });
    this.plugins = Object.freeze({
      read: () => this.#readPlugins(),
      write: (value: unknown) => this.#writePlugins(value),
    });
    this.dshHome = Object.freeze({
      read: () => this.#readDshHome(),
      write: (value: unknown) => this.#writeDshHome(value),
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
      document = createDefaultMinkeConfigDocument();
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

  #readModelRuntime(): Promise<ModelRuntimeSettings> {
    return this.#runExclusive(async () => {
      const settings = (await this.#load()).modelRuntime;
      return {
        lmStudio: { ...settings.lmStudio },
        ollama: { ...settings.ollama },
      };
    });
  }

  #readDshHome(): Promise<string | undefined> {
    return this.#runExclusive(async () => {
      return (await this.#load()).dshHome;
    });
  }

  #readRemote(): Promise<RemoteSettings> {
    return this.#runExclusive(async () => {
      const settings = (await this.#load()).remote;
      return {
        enabled: settings.enabled,
        method: settings.method,
        tailscale: { ...settings.tailscale },
        cloudflare: { ...settings.cloudflare },
      };
    });
  }

  #readPlugins(): Promise<PluginManagementSettings> {
    return this.#runExclusive(async () => {
      const settings = (await this.#load()).plugins;
      return {
        safeMode: settings.safeMode,
        disabledPlugins: [...settings.disabledPlugins],
      };
    });
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

  #writeModelRuntime(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const modelRuntime = parseModelRuntimeSettings(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        modelRuntime,
      };
      await this.#persist(next);
      this.#document = next;
    });
  }

  #writeDshHome(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const dshHome =
        value === undefined ? undefined : parseDataHomePath(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        ...(dshHome === undefined ? {} : { dshHome }),
      };
      if (dshHome === undefined) {
        Reflect.deleteProperty(next, "dshHome");
      }
      await this.#persist(next);
      this.#document = next;
    });
  }

  #writeRemote(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const remote = parseRemoteSettings(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        remote,
      };
      await this.#persist(next);
      this.#document = next;
    });
  }

  #writePlugins(value: unknown): Promise<void> {
    return this.#runExclusive(async () => {
      const plugins = parsePluginManagementSettings(value);
      const next: MinkeConfigDocument = {
        ...(await this.#load()),
        plugins,
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
