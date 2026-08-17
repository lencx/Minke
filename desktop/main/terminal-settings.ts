import {
  parseTerminalSettings,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

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

/** Terminal section supplied by the unified Minke configuration store. */
export interface TerminalSettingsStore {
  read(): Promise<TerminalSettings>;
  write(value: unknown): Promise<void>;
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
