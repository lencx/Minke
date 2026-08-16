import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseShortcutBindings,
  parseShortcutSettingsDocument,
  SHORTCUT_DOCUMENT_VERSION,
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
  type ShortcutBindings,
  type ShortcutSettingsDocument,
} from "../../packages/harness-overlay/src/shortcut-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface ShortcutSettingsBinding {
  dispose(): void;
}

/**
 * Durable Minke-owned shortcut document. Harness sees only the small preload
 * port, so its settings namespaces and source tree remain untouched.
 */
export class ShortcutSettingsStore {
  readonly path: string;
  #writeSequence = 0;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<ShortcutBindings> {
    let source: string;
    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const document = parseShortcutSettingsDocument(JSON.parse(source));
    return { ...document.bindings };
  }

  async write(value: unknown): Promise<void> {
    const bindings = parseShortcutBindings(value);
    const document: ShortcutSettingsDocument = {
      version: SHORTCUT_DOCUMENT_VERSION,
      bindings,
    };
    await mkdir(dirname(this.path), { recursive: true });
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

/** Bind the two validated IPC verbs and keep their lifecycle explicit. */
export function bindShortcutSettingsIpc(
  ipcMain: IpcMainLike,
  store: ShortcutSettingsStore,
  authorize: (event: unknown) => boolean,
): ShortcutSettingsBinding {
  const read = async (event: unknown): Promise<ShortcutBindings> => {
    assertAuthorized(authorize, event);
    return await store.read();
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    await store.write(value);
  };
  ipcMain.handle(SHORTCUT_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(SHORTCUT_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(SHORTCUT_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(SHORTCUT_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized shortcut settings request");
  }
}
