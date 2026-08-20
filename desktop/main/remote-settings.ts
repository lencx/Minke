import {
  DEFAULT_REMOTE_SETTINGS,
  parseRemoteAvailability,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  REMOTE_RESTART_CHANNEL,
  REMOTE_SETTINGS_READ_CHANNEL,
  REMOTE_SETTINGS_WRITE_CHANNEL,
  type RemoteAvailability,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
  type RemoteSettingsSnapshot,
} from "@lencx/minke-remote-access/contract";
import {
  parseCloudflareAccessConfig,
} from "@lencx/minke-remote-access";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface RemoteSettingsBinding {
  dispose(): void;
}

export interface RemoteSettingsStore {
  read(): Promise<RemoteSettings>;
  write(value: unknown): Promise<void>;
}

/** Bind validated remote preferences and the current foreground runtime state. */
export function bindRemoteSettingsIpc(
  ipcMain: IpcMainLike,
  store: RemoteSettingsStore,
  availabilityValue: RemoteAvailability,
  runtime: () => RemoteRuntimeSnapshot,
  restartDesktop: () => void,
  authorize: (event: unknown) => boolean,
): RemoteSettingsBinding {
  const available = parseRemoteAvailability(availabilityValue);
  const read = async (
    event: unknown,
  ): Promise<RemoteSettingsSnapshot> => {
    assertAuthorized(authorize, event);
    const currentRuntime = parseRemoteRuntimeSnapshot(runtime());
    try {
      return {
        available,
        settings: parseRemoteSettings(await store.read()),
        runtime: currentRuntime,
      };
    } catch {
      return {
        available,
        settings: {
          enabled: DEFAULT_REMOTE_SETTINGS.enabled,
          method: DEFAULT_REMOTE_SETTINGS.method,
          tailscale: { ...DEFAULT_REMOTE_SETTINGS.tailscale },
          cloudflare: {
            ...DEFAULT_REMOTE_SETTINGS.cloudflare,
          },
        },
        runtime: currentRuntime,
        error: "read",
      };
    }
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    const settings = parseRemoteSettings(value);
    if (settings.enabled && !available[settings.method]) {
      throw new Error(
        `${settings.method} remote command is unavailable`,
      );
    }
    if (
      settings.enabled &&
      settings.method === "cloudflare"
    ) {
      parseCloudflareAccessConfig(settings);
    }
    await store.write(settings);
  };
  const restart = (event: unknown): void => {
    assertAuthorized(authorize, event);
    restartDesktop();
  };
  ipcMain.handle(REMOTE_RESTART_CHANNEL, restart);
  ipcMain.handle(REMOTE_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(REMOTE_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(REMOTE_RESTART_CHANNEL);
      ipcMain.removeHandler(REMOTE_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(REMOTE_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized remote settings request");
  }
}
