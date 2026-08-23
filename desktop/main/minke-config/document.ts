import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  parseModelRuntimeSettings,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import {
  createDefaultRemoteSettings,
  migrateLegacyRemoteSettings,
  parseRemoteSettings,
  type RemoteSettings,
} from "@lencx/minke-remote-access/contract";
import {
  parseDataHomePath,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  DEFAULT_PLUGIN_MANAGEMENT_SETTINGS,
  parsePluginManagementSettings,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  parseShortcutBindings,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

/** Current schema version of the unified Minke desktop configuration. */
export const MINKE_CONFIG_VERSION = 2;
const LEGACY_MINKE_CONFIG_VERSION = 1;

/** Complete Minke-owned desktop configuration stored on disk. */
export interface MinkeConfigDocument {
  version: typeof MINKE_CONFIG_VERSION;
  shortcuts: ShortcutBindings;
  terminal: TerminalSettings;
  modelRuntime: ModelRuntimeSettings;
  remote: RemoteSettings;
  plugins: PluginManagementSettings;
  dshHome?: string;
}

const CONFIG_KEYS = new Set([
  "version",
  "shortcuts",
  "terminal",
  "modelRuntime",
  "remote",
  "plugins",
  "dshHome",
]);

export function createDefaultMinkeConfigDocument():
  MinkeConfigDocument {
  return {
    version: MINKE_CONFIG_VERSION,
    shortcuts: {},
    terminal: { ...DEFAULT_TERMINAL_SETTINGS },
    modelRuntime: {
      lmStudio: {
        ...DEFAULT_MODEL_RUNTIME_SETTINGS.lmStudio,
      },
      ollama: {
        ...DEFAULT_MODEL_RUNTIME_SETTINGS.ollama,
      },
    },
    remote: createDefaultRemoteSettings(),
    plugins: {
      safeMode: DEFAULT_PLUGIN_MANAGEMENT_SETTINGS.safeMode,
      disabledPlugins: [
        ...DEFAULT_PLUGIN_MANAGEMENT_SETTINGS.disabledPlugins,
      ],
    },
  };
}

function parseStoredRemoteSettings(
  value: unknown,
): RemoteSettings {
  try {
    return parseRemoteSettings(value);
  } catch (currentError) {
    try {
      return migrateLegacyRemoteSettings(value);
    } catch {
      throw currentError;
    }
  }
}

/** Validate and copy one unified Minke desktop configuration document. */
export function parseMinkeConfigDocument(
  value: unknown,
): MinkeConfigDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Minke config document must be an object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !CONFIG_KEYS.has(key)) ||
    !Object.hasOwn(record, "version") ||
    !Object.hasOwn(record, "shortcuts") ||
    !Object.hasOwn(record, "terminal") ||
    (
      record.version !== MINKE_CONFIG_VERSION &&
      record.version !== LEGACY_MINKE_CONFIG_VERSION
    )
  ) {
    throw new TypeError("unsupported Minke config document");
  }
  return {
    version: MINKE_CONFIG_VERSION,
    shortcuts: parseShortcutBindings(record.shortcuts),
    terminal: parseTerminalSettings(record.terminal),
    modelRuntime:
      record.modelRuntime === undefined
        ? {
            lmStudio: {
              ...DEFAULT_MODEL_RUNTIME_SETTINGS.lmStudio,
            },
            ollama: {
              ...DEFAULT_MODEL_RUNTIME_SETTINGS.ollama,
            },
          }
        : parseModelRuntimeSettings(record.modelRuntime),
    remote:
      record.remote === undefined
        ? createDefaultRemoteSettings()
        : parseStoredRemoteSettings(record.remote),
    plugins:
      record.plugins === undefined
        ? {
            safeMode:
              DEFAULT_PLUGIN_MANAGEMENT_SETTINGS.safeMode,
            disabledPlugins: [
              ...DEFAULT_PLUGIN_MANAGEMENT_SETTINGS.disabledPlugins,
            ],
          }
        : parsePluginManagementSettings(record.plugins),
    ...(record.dshHome === undefined
      ? {}
      : { dshHome: parseDataHomePath(record.dshHome) }),
  };
}
