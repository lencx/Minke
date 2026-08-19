import {
  DEFAULT_REMOTE_SETTINGS,
  parseRemoteAvailability,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  REMOTE_SETTINGS_READ_CHANNEL,
  REMOTE_SETTINGS_WRITE_CHANNEL,
  type RemoteAvailability,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
  type RemoteSettingsSnapshot,
} from "@lencx/minke-remote-access/contract";

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
          tailscale: {
            ...DEFAULT_REMOTE_SETTINGS.tailscale,
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
    if (settings.tailscale.enabled && !available.tailscale) {
      throw new Error("Tailscale command is unavailable");
    }
    await store.write(settings);
  };
  ipcMain.handle(REMOTE_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(REMOTE_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
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
