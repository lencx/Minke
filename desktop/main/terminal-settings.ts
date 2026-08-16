import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  parseTerminalSettingsDocument,
  TERMINAL_SETTINGS_DOCUMENT_VERSION,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
  type TerminalSettings,
  type TerminalSettingsDocument,
} from "../../packages/harness-overlay/src/terminal-settings-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface TerminalSettingsBinding {
  dispose(): void;
}

/** Durable, validated Terminal rendering preferences owned by Minke. */
export class TerminalSettingsStore {
  readonly path: string;
  #writeSequence = 0;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<TerminalSettings> {
    let source: string;
    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_TERMINAL_SETTINGS };
      }
      throw error;
    }
    const document = parseTerminalSettingsDocument(JSON.parse(source));
    return { ...document.settings };
  }

  async write(value: unknown): Promise<void> {
    const settings = parseTerminalSettings(value);
    const document: TerminalSettingsDocument = {
      version: TERMINAL_SETTINGS_DOCUMENT_VERSION,
      settings,
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

/** Bind the two authorized Terminal settings IPC verbs. */
export function bindTerminalSettingsIpc(
  ipcMain: IpcMainLike,
  store: TerminalSettingsStore,
  authorize: (event: unknown) => boolean,
): TerminalSettingsBinding {
  const read = async (event: unknown): Promise<TerminalSettings> => {
    assertAuthorized(authorize, event);
    return await store.read();
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    await store.write(parseTerminalSettings(value));
  };
  ipcMain.handle(TERMINAL_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(TERMINAL_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(TERMINAL_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(TERMINAL_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized terminal settings request");
  }
}
