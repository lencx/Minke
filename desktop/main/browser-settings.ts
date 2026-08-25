import {
  BROWSER_SETTINGS_READ_CHANNEL,
  BROWSER_SETTINGS_WRITE_CHANNEL,
  parseBrowserSettings,
  type BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface BrowserSettingsStore {
  read(): Promise<BrowserSettings>;
  write(value: unknown): Promise<void>;
}

export interface BrowserSettingsBinding {
  dispose(): void;
}

/** Bind validated browser identities and apply them after durable storage. */
export function bindBrowserSettingsIpc(
  ipcMain: IpcMainLike,
  store: BrowserSettingsStore,
  apply: (settings: BrowserSettings) => void,
  authorize: (event: unknown) => boolean,
): BrowserSettingsBinding {
  const read = async (
    event: unknown,
  ): Promise<BrowserSettings> => {
    assertAuthorized(authorize, event);
    return parseBrowserSettings(await store.read());
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    const settings = parseBrowserSettings(value);
    await store.write(settings);
    apply(settings);
  };
  ipcMain.handle(BROWSER_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(BROWSER_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(BROWSER_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(BROWSER_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized browser settings request");
  }
}
