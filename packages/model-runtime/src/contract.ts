/** Renderer-safe settings contracts for the model-runtime module. */
export const MODEL_RUNTIME_SETTINGS_READ_CHANNEL =
  "minke:model-runtime-settings:read";
export const MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL =
  "minke:model-runtime-settings:write";
export const MINKE_MODEL_RUNTIME_CONTROL_CHANNEL =
  "minke:model-runtime-control";
export const MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION = 1;

const MAX_MODEL_RUNTIME_CONTROL_ERROR_LENGTH = 1_024;

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

export interface ReconfigureModelRuntimesRequest {
  readonly channel: typeof MINKE_MODEL_RUNTIME_CONTROL_CHANNEL;
  readonly protocolVersion:
    typeof MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "model-runtimes/reconfigure";
  readonly mode: ModelRuntimeReconfigureMode;
  readonly settings: ModelRuntimeSettings;
}

export type ModelRuntimeReconfigureMode =
  | "apply"
  | "rollback";

export type ModelRuntimeControlResponse =
  | {
      readonly channel: typeof MINKE_MODEL_RUNTIME_CONTROL_CHANNEL;
      readonly protocolVersion:
        typeof MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly type: "model-runtimes/reconfigured";
    }
  | {
      readonly channel: typeof MINKE_MODEL_RUNTIME_CONTROL_CHANNEL;
      readonly protocolVersion:
        typeof MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly type: "model-runtimes/error";
      readonly message: string;
    };

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

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function parseControlRequestId(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) <= 0
  ) {
    throw new TypeError(
      "model runtime control requestId must be a positive safe integer",
    );
  }
  return Number(value);
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

/** Build one validated desktop-to-Harness live reconciliation request. */
export function createReconfigureModelRuntimesRequest(
  requestId: number,
  settings: unknown,
  mode: ModelRuntimeReconfigureMode = "apply",
): ReconfigureModelRuntimesRequest {
  if (mode !== "apply" && mode !== "rollback") {
    throw new TypeError(
      "invalid model runtime reconciliation mode",
    );
  }
  return {
    channel: MINKE_MODEL_RUNTIME_CONTROL_CHANNEL,
    protocolVersion:
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION,
    requestId: parseControlRequestId(requestId),
    type: "model-runtimes/reconfigure",
    mode,
    settings: parseModelRuntimeSettings(settings),
  };
}

/** Whether a process message belongs to the model-runtime control channel. */
export function isMinkeModelRuntimeControlMessage(
  value: unknown,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "channel") ===
      MINKE_MODEL_RUNTIME_CONTROL_CHANNEL
  );
}

/** Validate one live reconciliation request inside Harness. */
export function parseReconfigureModelRuntimesRequest(
  value: unknown,
): ReconfigureModelRuntimesRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "model runtime control request must be an object",
    );
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "mode",
      "settings",
    ]) ||
    request.channel !== MINKE_MODEL_RUNTIME_CONTROL_CHANNEL ||
    request.protocolVersion !==
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION ||
    request.type !== "model-runtimes/reconfigure" ||
    (
      request.mode !== "apply" &&
      request.mode !== "rollback"
    )
  ) {
    throw new TypeError("invalid model runtime control request");
  }
  return createReconfigureModelRuntimesRequest(
    parseControlRequestId(request.requestId),
    request.settings,
    request.mode,
  );
}

/** Build the acknowledgement sent after provider reconciliation commits. */
export function modelRuntimesReconfiguredResponse(
  requestId: number,
): ModelRuntimeControlResponse {
  return {
    channel: MINKE_MODEL_RUNTIME_CONTROL_CHANNEL,
    protocolVersion:
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION,
    requestId: parseControlRequestId(requestId),
    type: "model-runtimes/reconfigured",
  };
}

/** Build a bounded reconciliation failure response. */
export function modelRuntimeReconfigureErrorResponse(
  requestId: number,
  error: unknown,
): ModelRuntimeControlResponse {
  const raw =
    error instanceof Error ? error.message : String(error);
  const message =
    raw === ""
      ? "model runtime reconciliation failed"
      : raw;
  return {
    channel: MINKE_MODEL_RUNTIME_CONTROL_CHANNEL,
    protocolVersion:
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION,
    requestId: parseControlRequestId(requestId),
    type: "model-runtimes/error",
    message: message.slice(
      0,
      MAX_MODEL_RUNTIME_CONTROL_ERROR_LENGTH,
    ),
  };
}

/** Validate one live reconciliation response in Electron main. */
export function parseModelRuntimeControlResponse(
  value: unknown,
): ModelRuntimeControlResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "model runtime control response must be an object",
    );
  }
  const response = value as Record<string, unknown>;
  const common =
    response.channel === MINKE_MODEL_RUNTIME_CONTROL_CHANNEL &&
    response.protocolVersion ===
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION;
  if (
    !common ||
    (
      response.type !== "model-runtimes/reconfigured" &&
      response.type !== "model-runtimes/error"
    )
  ) {
    throw new TypeError("invalid model runtime control response");
  }
  const requestId = parseControlRequestId(response.requestId);
  if (response.type === "model-runtimes/reconfigured") {
    if (
      !exactKeys(response, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
      ])
    ) {
      throw new TypeError(
        "invalid model runtime control response",
      );
    }
    return modelRuntimesReconfiguredResponse(requestId);
  }
  if (
    !exactKeys(response, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "message",
    ]) ||
    typeof response.message !== "string" ||
    response.message === "" ||
    response.message.length >
      MAX_MODEL_RUNTIME_CONTROL_ERROR_LENGTH
  ) {
    throw new TypeError("invalid model runtime control response");
  }
  return {
    channel: MINKE_MODEL_RUNTIME_CONTROL_CHANNEL,
    protocolVersion:
      MINKE_MODEL_RUNTIME_CONTROL_PROTOCOL_VERSION,
    requestId,
    type: "model-runtimes/error",
    message: response.message,
  };
}
