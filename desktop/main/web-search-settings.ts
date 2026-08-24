import {
  parseWebSearchSettings,
  WEB_SEARCH_SETTINGS_READ_CHANNEL,
  WEB_SEARCH_SETTINGS_WRITE_CHANNEL,
  type WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface WebSearchSettingsStore {
  read(): Promise<WebSearchSettings>;
  write(value: unknown): Promise<void>;
}

export interface WebSearchSettingsBinding {
  dispose(): void;
}

/** Bind the authorized, restart-bound web-search preference. */
export function bindWebSearchSettingsIpc(
  ipcMain: IpcMainLike,
  store: WebSearchSettingsStore,
  authorize: (event: unknown) => boolean,
): WebSearchSettingsBinding {
  const read = async (
    event: unknown,
  ): Promise<WebSearchSettings> => {
    assertAuthorized(authorize, event);
    return parseWebSearchSettings(await store.read());
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    await store.write(parseWebSearchSettings(value));
  };
  ipcMain.handle(WEB_SEARCH_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(WEB_SEARCH_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(WEB_SEARCH_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(WEB_SEARCH_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized web search settings request");
  }
}
