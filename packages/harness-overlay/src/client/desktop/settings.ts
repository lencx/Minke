import {
  parseDataHomeMigrationPlan,
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  parseDataHomeMigrationScheduleResult,
  parseDataHomePath,
  parseDataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  NO_MODEL_RUNTIME_AVAILABILITY,
  parseModelRuntimeSettings,
  parseModelRuntimeSettingsSnapshot,
} from "@lencx/minke-model-runtime/contract";
import {
  parseTerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  DEFAULT_APP_UPDATE_SETTINGS,
  parseAppUpdateCheckResult,
  parseAppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import type {
  AppUpdatePort,
  AppUpdateSettingsStore,
  DataHomeSettingsPort,
  DesktopBridgeWindow,
  ModelRuntimeSettingsStore,
  RemoteSettingsStore,
  TerminalSettingsStore,
} from "./contracts.ts";
import {
  DEFAULT_REMOTE_SETTINGS,
  NO_REMOTE_AVAILABILITY,
  parseRemoteSettings,
  parseRemoteSettingsSnapshot,
} from "@lencx/minke-remote-access/contract";

/** Adapt the isolated preload bridge for update checks and preferences. */
export function desktopAppUpdatePort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): AppUpdatePort {
  const bridge = source.minkeDesktop?.appUpdate;
  if (bridge === undefined) {
    return {
      available: false,
      async check() {
        return "unavailable";
      },
      async read() {
        return { ...DEFAULT_APP_UPDATE_SETTINGS };
      },
      async write() {
        throw new Error(
          "Minke desktop app update settings bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async check() {
      if (typeof bridge.check !== "function") {
        return "unavailable";
      }
      return parseAppUpdateCheckResult(await bridge.check());
    },
    async read() {
      return parseAppUpdateSettings(await bridge.read());
    },
    async write(settings) {
      await bridge.write(parseAppUpdateSettings(settings));
    },
  };
}

/** Adapt only the update preference surface used by Settings. */
export function desktopAppUpdateSettingsStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): AppUpdateSettingsStore {
  return desktopAppUpdatePort(source);
}

/**
 * Keep desktop-owned Settings entries discoverable across preload upgrades.
 *
 * An older preload can expose the Minke desktop namespace without a newly
 * added capability. The Settings section should render its unavailable state
 * instead of disappearing without explanation.
 */
export function shouldExposeDesktopDataHomeSettings(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): boolean {
  return source.minkeDesktop !== undefined;
}

/** Adapt the isolated preload bridge for DSH data-directory migration. */
export function desktopDataHomeSettingsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DataHomeSettingsPort {
  const bridge = source.minkeDesktop?.dataHome;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        throw new Error(
          "Minke desktop data-home bridge is unavailable",
        );
      },
      async chooseDirectory() {
        throw new Error(
          "Minke desktop data-home bridge is unavailable",
        );
      },
      async plan() {
        throw new Error(
          "Minke desktop data-home bridge is unavailable",
        );
      },
      async schedule() {
        throw new Error(
          "Minke desktop data-home bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseDataHomeSettingsSnapshot(await bridge.read());
    },
    async chooseDirectory() {
      const selected = await bridge.chooseDirectory();
      return selected === undefined
        ? undefined
        : parseDataHomePath(selected);
    },
    async plan(request) {
      return parseDataHomeMigrationPlan(
        await bridge.plan(
          parseDataHomeMigrationPlanRequest(request),
        ),
      );
    },
    async schedule(request) {
      return parseDataHomeMigrationScheduleResult(
        await bridge.schedule(
          parseDataHomeMigrationScheduleRequest(request),
        ),
      );
    },
  };
}

/** Adapt the fixed two-runtime lifecycle settings bridge. */
export function desktopModelRuntimeSettingsStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): ModelRuntimeSettingsStore {
  const bridge = source.minkeDesktop?.modelRuntime;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return {
          available: { ...NO_MODEL_RUNTIME_AVAILABILITY },
          settings: {
            lmStudio: {
              ...DEFAULT_MODEL_RUNTIME_SETTINGS.lmStudio,
            },
            ollama: {
              ...DEFAULT_MODEL_RUNTIME_SETTINGS.ollama,
            },
          },
        };
      },
      async write() {
        throw new Error(
          "Minke desktop model runtime bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseModelRuntimeSettingsSnapshot(
        await bridge.read(),
      );
    },
    async write(settings) {
      await bridge.write(parseModelRuntimeSettings(settings));
    },
  };
}

/** Adapt the isolated preload bridge for remote-access lifecycle settings. */
export function desktopRemoteSettingsStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): RemoteSettingsStore {
  const bridge = source.minkeDesktop?.remote;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return {
          available: { ...NO_REMOTE_AVAILABILITY },
          settings: {
            enabled: DEFAULT_REMOTE_SETTINGS.enabled,
            method: DEFAULT_REMOTE_SETTINGS.method,
            tailscale: { ...DEFAULT_REMOTE_SETTINGS.tailscale },
            cloudflare: {
              ...DEFAULT_REMOTE_SETTINGS.cloudflare,
            },
          },
          runtime: {
            method: "tailscale",
            transport: "serve",
            state: "unavailable",
          },
        };
      },
      async restart() {
        throw new Error(
          "Minke desktop remote settings bridge is unavailable",
        );
      },
      async write() {
        throw new Error(
          "Minke desktop remote settings bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseRemoteSettingsSnapshot(await bridge.read());
    },
    async restart() {
      await bridge.restart();
    },
    async write(settings) {
      await bridge.write(parseRemoteSettings(settings));
    },
  };
}

/** Adapt the Terminal bridge's durable rendering-settings verbs. */
export function desktopTerminalSettingsStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): TerminalSettingsStore {
  const bridge = source.minkeDesktop?.terminal;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        throw new Error(
          "Minke desktop Terminal settings bridge is unavailable",
        );
      },
      async write() {
        throw new Error(
          "Minke desktop Terminal settings bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseTerminalSettings(await bridge.readSettings());
    },
    async write(settings) {
      await bridge.writeSettings(parseTerminalSettings(settings));
    },
  };
}
