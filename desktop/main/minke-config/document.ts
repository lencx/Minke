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
import {
  DEFAULT_APP_UPDATE_SETTINGS,
  parseAppUpdateSettings,
  type AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import {
  DEFAULT_BROWSER_SETTINGS,
  parseBrowserSettings,
  type BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  parseWebSearchSettings,
  type WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import {
  DEFAULT_DISCORD_NETWORK_SETTINGS,
  DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  parseDiscordNetworkSettings,
  parseTelegramNetworkSettings,
  type DiscordNetworkSettings,
  type TelegramNetworkSettings,
} from "@minke/harness-overlay/remote-hub-contract.ts";

/** Current schema version of the unified Minke desktop configuration. */
export const MINKE_CONFIG_VERSION = 5;
const LEGACY_MINKE_CONFIG_VERSIONS = new Set([1, 2, 3, 4]);

/** Complete Minke-owned desktop configuration stored on disk. */
export interface MinkeConfigDocument {
  version: typeof MINKE_CONFIG_VERSION;
  shortcuts: ShortcutBindings;
  terminal: TerminalSettings;
  modelRuntime: ModelRuntimeSettings;
  remote: RemoteSettings;
  plugins: PluginManagementSettings;
  webSearch: WebSearchSettings;
  telegramNetwork: TelegramNetworkSettings;
  discordNetwork: DiscordNetworkSettings;
  appUpdate: AppUpdateSettings;
  browser: BrowserSettings;
  dshHome?: string;
}

const CONFIG_KEYS = new Set([
  "version",
  "shortcuts",
  "terminal",
  "modelRuntime",
  "remote",
  "plugins",
  "webSearch",
  "telegramNetwork",
  "discordNetwork",
  "appUpdate",
  "browser",
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
    webSearch: {
      ...DEFAULT_WEB_SEARCH_SETTINGS,
    },
    telegramNetwork: {
      ...DEFAULT_TELEGRAM_NETWORK_SETTINGS,
    },
    discordNetwork: {
      ...DEFAULT_DISCORD_NETWORK_SETTINGS,
    },
    appUpdate: {
      ...DEFAULT_APP_UPDATE_SETTINGS,
    },
    browser: {
      ...DEFAULT_BROWSER_SETTINGS,
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
      !LEGACY_MINKE_CONFIG_VERSIONS.has(
        record.version as number,
      )
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
    webSearch:
      record.webSearch === undefined
        ? { ...DEFAULT_WEB_SEARCH_SETTINGS }
        : parseWebSearchSettings(record.webSearch),
    telegramNetwork:
      record.telegramNetwork === undefined
        ? { ...DEFAULT_TELEGRAM_NETWORK_SETTINGS }
        : parseTelegramNetworkSettings(
            record.telegramNetwork,
          ),
    discordNetwork:
      record.discordNetwork === undefined
        ? { ...DEFAULT_DISCORD_NETWORK_SETTINGS }
        : parseDiscordNetworkSettings(
            record.discordNetwork,
          ),
    appUpdate:
      record.appUpdate === undefined
        ? { ...DEFAULT_APP_UPDATE_SETTINGS }
        : parseAppUpdateSettings(record.appUpdate),
    browser:
      record.browser === undefined
        ? { ...DEFAULT_BROWSER_SETTINGS }
        : parseBrowserSettings(record.browser),
    ...(record.dshHome === undefined
      ? {}
      : { dshHome: parseDataHomePath(record.dshHome) }),
  };
}
