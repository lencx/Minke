import type {
  DataHomeMigrationPlan,
  DataHomeMigrationPlanRequest,
  DataHomeMigrationScheduleRequest,
  DataHomeMigrationScheduleResult,
  DataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import type {
  ModelRuntimeSettings,
  ModelRuntimeSettingsSnapshot,
} from "@minke/harness-overlay/model-runtime-settings-contract.ts";
import type {
  ProductShortcutActionId,
  ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import type {
  TabsLayoutState,
  TabsLayoutStateUpdate,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  FileManagerChangeEvent,
  FileManagerDiffRequest,
  FileManagerDiffResult,
  FileManagerListRequest,
  FileManagerListResult,
  FileManagerOpenRequest,
  FileManagerPreviewRequest,
  FileManagerPreviewResult,
  FileManagerViewState,
  FileManagerViewStateUpdate,
  FileManagerWriteRequest,
  FileManagerWriteResult,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import type {
  TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import type {
  HarnessColorScheme,
  HarnessLocale,
  HarnessThemePreference,
} from "../core/context.ts";

export interface ShortcutStore {
  readonly available: boolean;
  read(): Promise<ShortcutBindings>;
  write(bindings: ShortcutBindings): Promise<void>;
}

export interface DesktopShortcutPort extends ShortcutStore {
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
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

export interface DesktopTabsPort {
  readonly available: boolean;
  readLayoutState(): Promise<TabsLayoutState>;
  writeLayoutState(update: TabsLayoutStateUpdate): Promise<void>;
  openExternal(url: string): void;
}

export interface DesktopFilesPort {
  readonly available: boolean;
  diff(
    request: FileManagerDiffRequest,
  ): Promise<FileManagerDiffResult>;
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
  readViewState?(): Promise<FileManagerViewState>;
  writeViewState?(
    update: FileManagerViewStateUpdate,
  ): Promise<void>;
  watch(
    paths: readonly string[],
    listener: (event: FileManagerChangeEvent) => void,
  ): () => void;
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

export interface DesktopShortcutBridge {
  read(): Promise<unknown>;
  write(bindings: ShortcutBindings): Promise<void>;
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
}

export interface DesktopWindowThemeBridge {
  publish(
    preference: HarnessThemePreference,
    colorScheme: HarnessColorScheme,
  ): void;
}

export interface DesktopWindowLocaleBridge {
  publish(locale: HarnessLocale): void;
}

export interface DesktopTabsBridge {
  readLayoutState?(): Promise<unknown>;
  writeLayoutState?(
    update: TabsLayoutStateUpdate,
  ): Promise<void>;
  openExternal(url: string): void;
}

export interface DesktopFilesBridge {
  diff(request: FileManagerDiffRequest): Promise<unknown>;
  list(request: FileManagerListRequest): Promise<unknown>;
  open(request: FileManagerOpenRequest): Promise<void>;
  preview(request: FileManagerPreviewRequest): Promise<unknown>;
  write(request: FileManagerWriteRequest): Promise<unknown>;
  readViewState?(): Promise<unknown>;
  writeViewState?(
    update: FileManagerViewStateUpdate,
  ): Promise<void>;
  watch?(
    paths: readonly string[],
    listener: (event: FileManagerChangeEvent) => void,
  ): () => void;
}

export interface DesktopTerminalBridge {
  create(request: TerminalCreateRequest): Promise<unknown>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  close(sessionId: string): void;
  subscribe(listener: (event: unknown) => void): () => void;
  readSettings(): Promise<unknown>;
  writeSettings(settings: TerminalSettings): Promise<void>;
}

export interface DesktopModelRuntimeBridge {
  read(): Promise<unknown>;
  write(settings: ModelRuntimeSettings): Promise<void>;
}

export interface DesktopDataHomeBridge {
  read(): Promise<unknown>;
  chooseDirectory(): Promise<string | undefined>;
  plan(request: DataHomeMigrationPlanRequest): Promise<unknown>;
  schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<unknown>;
}

export interface DesktopSessionLogsBridge {
  export(sessionId: string): Promise<void>;
}

export interface DesktopSurfaceBridge {
  readonly kind: "macos" | "standard";
}

export interface DesktopAboutBridge {
  readonly productName: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

/** Shape exposed by the isolated Electron preload. */
export interface DesktopBridgeWindow {
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
