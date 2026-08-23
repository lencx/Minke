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

export interface RemoteSettingsHostRuntime {
  availability(): Promise<RemoteAvailability>;
  apply(settings: RemoteSettings): Promise<void>;
  read(): RemoteRuntimeSnapshot;
  subscribe(listener: () => void): () => void;
}

/** Bind validated remote preferences and the current foreground runtime state. */
export function bindRemoteSettingsIpc(
  ipcMain: IpcMainLike,
  store: RemoteSettingsStore,
  runtime: RemoteSettingsHostRuntime,
  publishRuntime: (snapshot: RemoteRuntimeSnapshot) => void,
  authorize: (event: unknown) => boolean,
): RemoteSettingsBinding {
  const read = async (
    event: unknown,
  ): Promise<RemoteSettingsSnapshot> => {
    assertAuthorized(authorize, event);
    const available = parseRemoteAvailability(
      await runtime.availability(),
    );
    try {
      return {
        available,
        settings: parseRemoteSettings(await store.read()),
        runtime: parseRemoteRuntimeSnapshot(runtime.read()),
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
        runtime: parseRemoteRuntimeSnapshot(runtime.read()),
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
    const available = parseRemoteAvailability(
      await runtime.availability(),
    );
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
    void runtime.apply(settings).catch((error: unknown) => {
      console.error(
        "Remote access settings could not be applied:",
        error,
      );
    });
  };
  ipcMain.handle(REMOTE_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(REMOTE_SETTINGS_WRITE_CHANNEL, write);
  const unsubscribeRuntime = runtime.subscribe(() => {
    publishRuntime(
      parseRemoteRuntimeSnapshot(runtime.read()),
    );
  });

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeRuntime();
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
