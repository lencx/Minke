/** Renderer-safe settings contracts for the model-runtime module. */
export const MODEL_RUNTIME_SETTINGS_READ_CHANNEL =
  "minke:model-runtime-settings:read";
export const MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL =
  "minke:model-runtime-settings:write";

export const LOCAL_MODEL_RUNTIMES = [
  {
    id: "lmStudio",
    providerId: "lm-studio",
    displayName: "LM Studio",
    defaultBaseURL: "http://127.0.0.1:1234/v1",
  },
  {
    id: "ollama",
    providerId: "ollama",
    displayName: "Ollama",
    defaultBaseURL: "http://127.0.0.1:11434/v1",
  },
] as const;

export type LocalModelRuntimeId =
  (typeof LOCAL_MODEL_RUNTIMES)[number]["id"];

export const LOCAL_MODEL_RUNTIME_IDS: readonly LocalModelRuntimeId[] =
  LOCAL_MODEL_RUNTIMES.map(({ id }) => id);

export interface LocalModelRuntimePreference {
  enabled: boolean;
}

export type ModelRuntimeSettings = Record<
  LocalModelRuntimeId,
  LocalModelRuntimePreference
>;

export type ModelRuntimeAvailability = Record<
  LocalModelRuntimeId,
  boolean
>;

export type ModelRuntimeSettingsReadError = "read";

export interface ModelRuntimeSettingsSnapshot {
  available: ModelRuntimeAvailability;
  settings: ModelRuntimeSettings;
  error?: ModelRuntimeSettingsReadError;
}

export const DEFAULT_MODEL_RUNTIME_SETTINGS: Readonly<
  ModelRuntimeSettings
> = Object.freeze({
  lmStudio: Object.freeze({ enabled: false }),
  ollama: Object.freeze({ enabled: false }),
});

export const NO_MODEL_RUNTIME_AVAILABILITY: Readonly<
  ModelRuntimeAvailability
> = Object.freeze({
  lmStudio: false,
  ollama: false,
});

function exactRuntimeRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== LOCAL_MODEL_RUNTIME_IDS.length ||
    keys.some(
      (key) =>
        !LOCAL_MODEL_RUNTIME_IDS.includes(
          key as LocalModelRuntimeId,
        ),
    )
  ) {
    throw new TypeError(
      `${label} must contain exactly lmStudio and ollama`,
    );
  }
  return record;
}

/** Validate one runtime's exact auto-start preference. */
export function parseLocalModelRuntimePreference(
  value: unknown,
): LocalModelRuntimePreference {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "local model runtime preference must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.enabled !== "boolean"
  ) {
    throw new TypeError(
      "local model runtime preference must contain exactly one boolean enabled field",
    );
  }
  return {
    enabled: record.enabled,
  };
}

/** Validate the fixed two-runtime Minke configuration section. */
export function parseModelRuntimeSettings(
  value: unknown,
): ModelRuntimeSettings {
  const record = exactRuntimeRecord(
    value,
    "model runtime settings",
  );
  try {
    return {
      lmStudio: parseLocalModelRuntimePreference(
        record.lmStudio,
      ),
      ollama: parseLocalModelRuntimePreference(record.ollama),
    };
  } catch (error) {
    throw new TypeError("invalid model runtime settings", {
      cause: error,
    });
  }
}

/** Validate the command availability map supplied by Electron main. */
export function parseModelRuntimeAvailability(
  value: unknown,
): ModelRuntimeAvailability {
  const record = exactRuntimeRecord(
    value,
    "model runtime availability",
  );
  if (
    typeof record.lmStudio !== "boolean" ||
    typeof record.ollama !== "boolean"
  ) {
    throw new TypeError(
      "model runtime availability values must be booleans",
    );
  }
  return {
    lmStudio: record.lmStudio,
    ollama: record.ollama,
  };
}

/** Validate one main-to-renderer availability and settings snapshot. */
export function parseModelRuntimeSettingsSnapshot(
  value: unknown,
): ModelRuntimeSettingsSnapshot {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "model runtime settings snapshot must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(
      (key) =>
        key !== "available" &&
        key !== "settings" &&
        key !== "error",
    ) ||
    (
      record.error !== undefined &&
      record.error !== "read"
    )
  ) {
    throw new TypeError("invalid model runtime settings snapshot");
  }
  return {
    available: parseModelRuntimeAvailability(record.available),
    settings: parseModelRuntimeSettings(record.settings),
    ...(record.error === undefined
      ? {}
      : { error: record.error }),
  };
}
