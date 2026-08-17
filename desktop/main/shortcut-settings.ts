import {
  parseShortcutBindings,
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";

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

/** Shortcut section supplied by the unified Minke configuration store. */
export interface ShortcutSettingsStore {
  read(): Promise<ShortcutBindings>;
  write(value: unknown): Promise<void>;
}

/** Bind the two validated IPC verbs and keep their lifecycle explicit. */
export function bindShortcutSettingsIpc(
  ipcMain: IpcMainLike,
  store: ShortcutSettingsStore,
  authorize: (event: unknown) => boolean,
  onWrite?: (bindings: ShortcutBindings) => void,
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
    const bindings = parseShortcutBindings(value);
    await store.write(bindings);
    onWrite?.(bindings);
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
