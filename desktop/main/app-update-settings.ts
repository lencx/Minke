import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_SETTINGS_READ_CHANNEL,
  APP_UPDATE_SETTINGS_WRITE_CHANNEL,
  parseAppUpdateCheckResult,
  parseAppUpdateSettings,
  type AppUpdateCheckResult,
  type AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface AppUpdateSettingsStore {
  read(): Promise<AppUpdateSettings>;
  write(value: unknown): Promise<void>;
}

export interface AppUpdateSettingsBinding {
  dispose(): void;
}

/** Bind the authorized application-update preference to the main process. */
export function bindAppUpdateSettingsIpc(
  ipcMain: IpcMainLike,
  store: AppUpdateSettingsStore,
  apply: (settings: AppUpdateSettings) => void,
  check: () => Promise<AppUpdateCheckResult>,
  authorize: (event: unknown) => boolean,
): AppUpdateSettingsBinding {
  const read = async (
    event: unknown,
  ): Promise<AppUpdateSettings> => {
    assertAuthorized(authorize, event);
    return parseAppUpdateSettings(await store.read());
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    const settings = parseAppUpdateSettings(value);
    apply(settings);
    await store.write(settings);
  };
  const checkNow = async (
    event: unknown,
  ): Promise<AppUpdateCheckResult> => {
    assertAuthorized(authorize, event);
    return parseAppUpdateCheckResult(await check());
  };
  ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, checkNow);
  ipcMain.handle(APP_UPDATE_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(APP_UPDATE_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(APP_UPDATE_CHECK_CHANNEL);
      ipcMain.removeHandler(APP_UPDATE_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(APP_UPDATE_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized app update request");
  }
}
