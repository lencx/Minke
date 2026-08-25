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
} from "@lencx/minke-model-runtime/contract";
import type {
  InstalledPluginsSnapshot,
} from "@minke/harness-overlay/plugin-install-contract.ts";
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
  AppUpdateCheckResult,
  AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import type {
  BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import type {
  WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import type {
  AgentBrowserOwner,
  AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import type {
  AgentBrowserAnnotationCommitResult,
  AgentBrowserAnnotationEvent,
  AgentBrowserAnnotationRefreshRequest,
  AgentBrowserAnnotationRefreshResult,
  AgentBrowserAnnotationSession,
  AgentBrowserAnnotationStopRequest,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  RemoteRuntimeSnapshot,
  RemoteSettings,
  RemoteSettingsSnapshot,
} from "@lencx/minke-remote-access/contract";
import type {
  RemoteHubCommand,
  RemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
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

export interface AppUpdateSettingsStore {
  readonly available: boolean;
  read(): Promise<AppUpdateSettings>;
  write(settings: AppUpdateSettings): Promise<void>;
}

export interface WebSearchSettingsStore {
  readonly available: boolean;
  read(): Promise<WebSearchSettings>;
  write(settings: WebSearchSettings): Promise<void>;
}

export interface BrowserSettingsStore {
  readonly available: boolean;
  read(): Promise<BrowserSettings>;
  write(settings: BrowserSettings): Promise<void>;
}

export interface AppUpdatePort extends AppUpdateSettingsStore {
  check(): Promise<AppUpdateCheckResult>;
}

export interface ModelRuntimeSettingsStore {
  readonly available: boolean;
  read(): Promise<ModelRuntimeSettingsSnapshot>;
  write(settings: ModelRuntimeSettings): Promise<void>;
}

export interface RemoteSettingsStore {
  readonly available: boolean;
  read(): Promise<RemoteSettingsSnapshot>;
  subscribe?(
    listener: (snapshot: RemoteRuntimeSnapshot) => void,
  ): () => void;
  write(settings: RemoteSettings): Promise<void>;
}

export interface DesktopRemoteHubPort {
  readonly available: boolean;
  read(): Promise<RemoteHubSnapshot>;
  dispatch(command: RemoteHubCommand): Promise<RemoteHubSnapshot>;
  subscribe(
    listener: (snapshot: RemoteHubSnapshot) => void,
  ): () => void;
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
  /** Whether this renderer can host Electron's isolated `<webview>` tabs. */
  readonly embeddedWebAvailable: boolean;
  readLayoutState(): Promise<TabsLayoutState>;
  writeLayoutState(update: TabsLayoutStateUpdate): Promise<void>;
  resolveLocalPath?(candidate: string): string | undefined;
  openExternal(url: string): void;
}

export interface DesktopAgentBrowserPort {
  readonly available: boolean;
  read(): Promise<readonly AgentBrowserProjection[]>;
  setControl(
    sessionId: string,
    owner: AgentBrowserOwner,
  ): Promise<AgentBrowserProjection>;
  startAnnotation(
    sessionId: string,
  ): Promise<AgentBrowserAnnotationSession>;
  stopAnnotation(
    request: AgentBrowserAnnotationStopRequest,
  ): Promise<void>;
  refreshAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<AgentBrowserAnnotationRefreshResult>;
  commitAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<AgentBrowserAnnotationCommitResult>;
  close(sessionId: string): void;
  subscribe(
    listener: (
      projections: readonly AgentBrowserProjection[],
    ) => void,
  ): () => void;
  subscribeAnnotationEvents(
    listener: (event: AgentBrowserAnnotationEvent) => void,
  ): () => void;
}

export interface DesktopFilesPort {
  readonly available: boolean;
  /** Whether paths can be handed to the host operating system. */
  readonly nativeOpenAvailable: boolean;
  /** Whether the port can publish external filesystem changes. */
  readonly watchAvailable: boolean;
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

export interface PluginInstallerPort {
  readonly available: boolean;
  install(command: string): Promise<void>;
  restart(): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  uninstall(name: string): Promise<void>;
  readInstalled(): Promise<InstalledPluginsSnapshot>;
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
  resolveLocalPath?(
    candidate: string,
  ): string | undefined;
  openExternal(url: string): void;
}

export interface DesktopAgentBrowserBridge {
  read(): Promise<unknown>;
  setControl(
    sessionId: string,
    owner: AgentBrowserOwner,
  ): Promise<unknown>;
  startAnnotation(sessionId: string): Promise<unknown>;
  stopAnnotation(
    request: AgentBrowserAnnotationStopRequest,
  ): Promise<void>;
  refreshAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<unknown>;
  commitAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<unknown>;
  close(sessionId: string): void;
  subscribe(
    listener: (projections: readonly AgentBrowserProjection[]) => void,
  ): () => void;
  subscribeAnnotationEvents(
    listener: (event: AgentBrowserAnnotationEvent) => void,
  ): () => void;
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

export interface DesktopAppUpdateBridge {
  check?(): Promise<unknown>;
  read(): Promise<unknown>;
  write(settings: AppUpdateSettings): Promise<void>;
}

export interface DesktopWebSearchBridge {
  read(): Promise<unknown>;
  write(settings: WebSearchSettings): Promise<void>;
}

export interface DesktopBrowserBridge {
  read(): Promise<unknown>;
  write(settings: BrowserSettings): Promise<void>;
}

export interface DesktopModelRuntimeBridge {
  read(): Promise<unknown>;
  write(settings: ModelRuntimeSettings): Promise<void>;
}

export interface DesktopRemoteBridge {
  read(): Promise<unknown>;
  subscribe?(
    listener: (snapshot: RemoteRuntimeSnapshot) => void,
  ): () => void;
  write(settings: RemoteSettings): Promise<void>;
}

export interface DesktopRemoteHubBridge {
  read(): Promise<unknown>;
  dispatch(command: RemoteHubCommand): Promise<unknown>;
  subscribe(
    listener: (snapshot: RemoteHubSnapshot) => void,
  ): () => void;
}

export interface DesktopPluginInstallerBridge {
  install(command: string): Promise<void>;
  restart(): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  uninstall(name: string): Promise<void>;
  readInstalled(): Promise<unknown>;
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
    agentBrowser?: DesktopAgentBrowserBridge;
    appUpdate?: DesktopAppUpdateBridge;
    about?: DesktopAboutBridge;
    browser?: DesktopBrowserBridge;
    dataHome?: DesktopDataHomeBridge;
    files?: DesktopFilesBridge;
    locale?: DesktopWindowLocaleBridge;
    modelRuntime?: DesktopModelRuntimeBridge;
    pluginInstaller?: DesktopPluginInstallerBridge;
    remote?: DesktopRemoteBridge;
    remoteHub?: DesktopRemoteHubBridge;
    sessionLogs?: DesktopSessionLogsBridge;
    tabs?: DesktopTabsBridge;
    terminal?: DesktopTerminalBridge;
    webSearch?: DesktopWebSearchBridge;
    shortcuts?: DesktopShortcutBridge;
    surface?: DesktopSurfaceBridge;
    windowTheme?: DesktopWindowThemeBridge;
  };
}
