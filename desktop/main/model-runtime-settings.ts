import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  LOCAL_MODEL_RUNTIME_IDS,
  LOCAL_MODEL_RUNTIMES,
  MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
  MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  parseModelRuntimeAvailability,
  parseModelRuntimeSettings,
  type LocalModelRuntimeId,
  type ModelRuntimeAvailability,
  type ModelRuntimeSettings,
  type ModelRuntimeSettingsSnapshot,
} from "@lencx/minke-model-runtime/contract";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface ModelRuntimeSettingsBinding {
  dispose(): void;
}

export interface ModelRuntimeSettingsStore {
  read(): Promise<ModelRuntimeSettings>;
  write(value: unknown): Promise<void>;
}

const RUNTIME_NAMES = Object.fromEntries(
  LOCAL_MODEL_RUNTIMES.map(({ id, displayName }) => [
    id,
    displayName,
  ]),
) as Record<LocalModelRuntimeId, string>;

function copyDefaults(): ModelRuntimeSettings {
  return {
    lmStudio: {
      ...DEFAULT_MODEL_RUNTIME_SETTINGS.lmStudio,
    },
    ollama: {
      ...DEFAULT_MODEL_RUNTIME_SETTINGS.ollama,
    },
  };
}

/** Bind the shared, command-gated local-runtime lifecycle preferences. */
export function bindModelRuntimeSettingsIpc(
  ipcMain: IpcMainLike,
  store: ModelRuntimeSettingsStore,
  availabilityValue: ModelRuntimeAvailability,
  authorize: (event: unknown) => boolean,
): ModelRuntimeSettingsBinding {
  const available = parseModelRuntimeAvailability(
    availabilityValue,
  );
  const read = async (
    event: unknown,
  ): Promise<ModelRuntimeSettingsSnapshot> => {
    assertAuthorized(authorize, event);
    try {
      return {
        available,
        settings: parseModelRuntimeSettings(await store.read()),
      };
    } catch {
      return {
        available,
        settings: copyDefaults(),
        error: "read",
      };
    }
  };
  const write = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    assertAuthorized(authorize, event);
    const settings = parseModelRuntimeSettings(value);
    for (const id of LOCAL_MODEL_RUNTIME_IDS) {
      if (settings[id].enabled && !available[id]) {
        throw new Error(
          `${RUNTIME_NAMES[id]} command is unavailable`,
        );
      }
    }
    await store.write(settings);
  };
  ipcMain.handle(MODEL_RUNTIME_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL, write);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(MODEL_RUNTIME_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized model runtime settings request");
  }
}
