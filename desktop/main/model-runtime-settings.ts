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
  type ModelRuntimeReconfigureMode,
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

/**
 * Desktop-side transaction phases. Only apply/rollback cross the Harness IPC
 * boundary; finalize advances the crash-recovery launch snapshot after disk
 * persistence has committed.
 */
export type ModelRuntimeSettingsTransactionPhase =
  | ModelRuntimeReconfigureMode
  | "finalize";

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
  reconfigure: (
    settings: ModelRuntimeSettings,
    mode: ModelRuntimeSettingsTransactionPhase,
  ) => Promise<void>,
): ModelRuntimeSettingsBinding {
  const available = parseModelRuntimeAvailability(
    availabilityValue,
  );
  let writeTail: Promise<void> = Promise.resolve();
  const read = async (
    event: unknown,
  ): Promise<ModelRuntimeSettingsSnapshot> => {
    assertAuthorized(authorize, event);
    await writeTail;
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
    const operation = writeTail.then(async () => {
      const previous = parseModelRuntimeSettings(
        await store.read(),
      );
      try {
        await reconfigure(settings, "apply");
      } catch (error) {
        await rollbackRuntime(
          reconfigure,
          previous,
          error,
          "model runtime reconciliation failed and rollback also failed",
        );
        throw error;
      }
      try {
        await store.write(settings);
      } catch (error) {
        await rollbackRuntime(
          reconfigure,
          previous,
          error,
          "model runtime persistence failed and live rollback also failed",
        );
        throw error;
      }
      await reconfigure(settings, "finalize");
    });
    writeTail = operation.catch(() => undefined);
    await operation;
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

async function rollbackRuntime(
  reconfigure: (
    settings: ModelRuntimeSettings,
    mode: ModelRuntimeSettingsTransactionPhase,
  ) => Promise<void>,
  previous: ModelRuntimeSettings,
  primaryError: unknown,
  message: string,
): Promise<void> {
  try {
    await reconfigure(previous, "rollback");
  } catch (rollbackError) {
    throw new AggregateError(
      [primaryError, rollbackError],
      `${message}: ${
        primaryError instanceof Error
          ? primaryError.message
          : String(primaryError)
      }`,
    );
  }
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized model runtime settings request");
  }
}
