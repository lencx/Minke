import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  NO_MODEL_RUNTIME_AVAILABILITY,
  parseModelRuntimeSettings,
  parseModelRuntimeSettingsSnapshot,
  type ModelRuntimeSettings,
  type ModelRuntimeSettingsSnapshot,
} from "@minke/harness-overlay/model-runtime-settings-contract.ts";
import {
  isProductShortcutActionId,
  parseShortcutBindings,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  parseDataHomeMigrationPlan,
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  parseDataHomeMigrationScheduleResult,
  parseDataHomePath,
  parseDataHomeSettingsSnapshot,
  type DataHomeMigrationPlan,
  type DataHomeMigrationPlanRequest,
  type DataHomeMigrationScheduleRequest,
  type DataHomeMigrationScheduleResult,
  type DataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  parseSessionLogExportId,
} from "@minke/harness-overlay/session-export-contract.ts";
import {
  parseFileManagerListRequest,
  parseFileManagerListResult,
  parseFileManagerOpenRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  type FileManagerListRequest,
  type FileManagerListResult,
  type FileManagerOpenRequest,
  type FileManagerPreviewRequest,
  type FileManagerPreviewResult,
  type FileManagerWriteRequest,
  type FileManagerWriteResult,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalEvent,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalEvent,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";

export interface ShortcutStore {
  readonly available: boolean;
  read(): Promise<ShortcutBindings>;
  write(bindings: ShortcutBindings): Promise<void>;
}

export interface TerminalSettingsStore {
  readonly available: boolean;
  read(): Promise<TerminalSettings>;
  write(settings: TerminalSettings): Promise<void>;
}

export interface ModelRuntimeSettingsStore {
  readonly available: boolean;
  read(): Promise<ModelRuntimeSettingsSnapshot>;
  write(settings: ModelRuntimeSettings): Promise<void>;
}

export interface DataHomeSettingsPort {
  readonly available: boolean;
  read(): Promise<DataHomeSettingsSnapshot>;
  chooseDirectory(): Promise<string | undefined>;
  plan(
    request: DataHomeMigrationPlanRequest,
  ): Promise<DataHomeMigrationPlan>;
  schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<DataHomeMigrationScheduleResult>;
}

export interface DesktopShortcutPort extends ShortcutStore {
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
}

export type HarnessThemePreference = "light" | "dark" | "system";
export type HarnessColorScheme = "light" | "dark";
export type HarnessLocale = "zh" | "en";

export interface DesktopAboutInfo {
  readonly available: boolean;
  readonly productName: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

export interface DesktopWindowThemePort {
  readonly available: boolean;
  publish(
    preference: HarnessThemePreference,
    colorScheme: HarnessColorScheme,
  ): void;
}

export interface DesktopWindowLocalePort {
  readonly available: boolean;
  publish(locale: HarnessLocale): void;
}

interface DesktopShortcutBridge {
  read(): Promise<unknown>;
  write(bindings: ShortcutBindings): Promise<void>;
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
}

interface DesktopWindowThemeBridge {
  publish(
    preference: HarnessThemePreference,
    colorScheme: HarnessColorScheme,
  ): void;
}

interface DesktopWindowLocaleBridge {
  publish(locale: HarnessLocale): void;
}

interface DesktopTabsBridge {
  openExternal(url: string): void;
}

interface DesktopFilesBridge {
  list(request: FileManagerListRequest): Promise<unknown>;
  open(request: FileManagerOpenRequest): Promise<void>;
  preview(request: FileManagerPreviewRequest): Promise<unknown>;
  write(request: FileManagerWriteRequest): Promise<unknown>;
}

interface DesktopTerminalBridge {
  create(request: TerminalCreateRequest): Promise<unknown>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  close(sessionId: string): void;
  subscribe(listener: (event: unknown) => void): () => void;
  readSettings(): Promise<unknown>;
  writeSettings(settings: TerminalSettings): Promise<void>;
}

interface DesktopModelRuntimeBridge {
  read(): Promise<unknown>;
  write(settings: ModelRuntimeSettings): Promise<void>;
}

interface DesktopDataHomeBridge {
  read(): Promise<unknown>;
  chooseDirectory(): Promise<string | undefined>;
  plan(request: DataHomeMigrationPlanRequest): Promise<unknown>;
  schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<unknown>;
}

interface DesktopSessionLogsBridge {
  export(sessionId: string): Promise<void>;
}

interface DesktopSurfaceBridge {
  readonly kind: "macos" | "standard";
}

interface DesktopAboutBridge {
  readonly productName: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

interface DesktopBridgeWindow {
  minkeDesktop?: {
    about?: DesktopAboutBridge;
    dataHome?: DesktopDataHomeBridge;
    files?: DesktopFilesBridge;
    locale?: DesktopWindowLocaleBridge;
    modelRuntime?: DesktopModelRuntimeBridge;
    sessionLogs?: DesktopSessionLogsBridge;
    tabs?: DesktopTabsBridge;
    terminal?: DesktopTerminalBridge;
    shortcuts?: DesktopShortcutBridge;
    surface?: DesktopSurfaceBridge;
    windowTheme?: DesktopWindowThemeBridge;
  };
}

/**
 * Keep desktop-owned Settings entries discoverable across preload upgrades.
 *
 * An older preload can expose the Minke desktop namespace without a newly
 * added capability. The Settings section should still render its explicit
 * unavailable state instead of disappearing without explanation.
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Read immutable product metadata projected by the isolated preload. */
export function desktopAboutInfo(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopAboutInfo {
  const about = source.minkeDesktop?.about;
  if (
    about === undefined ||
    !isNonEmptyString(about.productName) ||
    !isNonEmptyString(about.version) ||
    !isNonEmptyString(about.platform) ||
    !isNonEmptyString(about.arch)
  ) {
    return {
      available: false,
      productName: "Minke",
      version: "",
      platform: "",
      arch: "",
    };
  }
  return {
    available: true,
    productName: about.productName,
    version: about.version,
    platform: about.platform,
    arch: about.arch,
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

/** True only inside the native macOS window that supplies the early surface. */
export function hasMacOSDesktopSurface(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): boolean {
  return source.minkeDesktop?.surface?.kind === "macos";
}

/** Adapt the isolated preload API to the shortcut runtime's small store port. */
export function desktopShortcutStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopShortcutPort {
  const bridge = source.minkeDesktop?.shortcuts;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return {};
      },
      async write() {
        throw new Error("Minke desktop shortcut bridge is unavailable");
      },
      subscribe() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseShortcutBindings(await bridge.read());
    },
    async write(bindings) {
      await bridge.write(parseShortcutBindings(bindings));
    },
    subscribe(listener) {
      return bridge.subscribe((id) => {
        if (isProductShortcutActionId(id)) listener(id);
      });
    },
  };
}

/** Adapt the preload bridge used to keep Electron native chrome on ctx.theme. */
export function desktopWindowThemePort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopWindowThemePort {
  const bridge = source.minkeDesktop?.windowTheme;
  if (bridge === undefined) {
    return {
      available: false,
      publish() {},
    };
  }
  return {
    available: true,
    publish(preference, colorScheme) {
      bridge.publish(preference, colorScheme);
    },
  };
}

/** Adapt the preload bridge that projects Harness's active locale to Electron. */
export function desktopWindowLocalePort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopWindowLocalePort {
  const bridge = source.minkeDesktop?.locale;
  if (bridge === undefined) {
    return {
      available: false,
      publish() {},
    };
  }
  return {
    available: true,
    publish(locale) {
      bridge.publish(locale);
    },
  };
}

export interface DesktopTabsPort {
  readonly available: boolean;
  openExternal(url: string): void;
}

export interface DesktopFilesPort {
  readonly available: boolean;
  list(
    request: FileManagerListRequest,
  ): Promise<FileManagerListResult>;
  open(request: FileManagerOpenRequest): Promise<void>;
  preview(
    request: FileManagerPreviewRequest,
  ): Promise<FileManagerPreviewResult>;
  write(
    request: FileManagerWriteRequest,
  ): Promise<FileManagerWriteResult>;
}

export interface DesktopTerminalPort {
  readonly available: boolean;
  create(
    request: TerminalCreateRequest,
  ): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  close(sessionId: string): void;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
}

export interface DesktopSessionLogsPort {
  readonly available: boolean;
  export(sessionId: string): Promise<void>;
}

/** Adapt the native save/reveal workflow exposed by the isolated preload. */
export function desktopSessionLogsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopSessionLogsPort {
  const bridge = source.minkeDesktop?.sessionLogs;
  if (bridge === undefined) {
    return {
      available: false,
      async export() {
        throw new Error(
          "Minke desktop Session export bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async export(sessionId) {
      await bridge.export(parseSessionLogExportId(sessionId));
    },
  };
}

/** Adapt the isolated preload bridge used by host-backed tab actions. */
export function desktopTabsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTabsPort {
  const bridge = source.minkeDesktop?.tabs;
  if (bridge === undefined) {
    return {
      available: false,
      openExternal() {},
    };
  }
  return {
    available: true,
    openExternal(url) {
      bridge.openExternal(url);
    },
  };
}

/** Adapt the isolated preload bridge used by host-backed Files tabs. */
export function desktopFilesPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopFilesPort {
  const bridge = source.minkeDesktop?.files;
  if (bridge === undefined) {
    return {
      available: false,
      async list() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async open() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async preview() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async write() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async list(request) {
      return parseFileManagerListResult(
        await bridge.list(
          parseFileManagerListRequest(request),
        ),
      );
    },
    async open(request) {
      await bridge.open(parseFileManagerOpenRequest(request));
    },
    async preview(request) {
      return parseFileManagerPreviewResult(
        await bridge.preview(
          parseFileManagerPreviewRequest(request),
        ),
      );
    },
    async write(request) {
      return parseFileManagerWriteResult(
        await bridge.write(
          parseFileManagerWriteRequest(request),
        ),
      );
    },
  };
}

/** Adapt the isolated preload bridge used by interactive Terminal tabs. */
export function desktopTerminalPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTerminalPort {
  const bridge = source.minkeDesktop?.terminal;
  if (bridge === undefined) {
    return {
      available: false,
      async create() {
        throw new Error(
          "Minke desktop Terminal bridge is unavailable",
        );
      },
      write() {},
      resize() {},
      close() {},
      subscribe() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async create(request) {
      return parseTerminalCreateResult(
        await bridge.create(parseTerminalCreateRequest(request)),
      );
    },
    write(request) {
      bridge.write(parseTerminalWriteRequest(request));
    },
    resize(request) {
      bridge.resize(parseTerminalResizeRequest(request));
    },
    close(sessionId) {
      bridge.close(parseTerminalSessionId(sessionId));
    },
    subscribe(listener) {
      return bridge.subscribe((event) => {
        listener(parseTerminalEvent(event));
      });
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
