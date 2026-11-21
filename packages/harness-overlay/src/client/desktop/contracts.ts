import type {
  DataHomeMigrationPlan,
  DataHomeMigrationPlanRequest,
  DataHomeMigrationScheduleRequest,
  DataHomeMigrationScheduleResult,
  DataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import type {
  LocalModelRuntimeId,
  ModelRuntimeSettings,
  ModelRuntimeSettingsSnapshot,
  ModelRuntimeServiceState,
} from "@lencx/minke-model-runtime/contract";
import type {
  PluginManagementSettings,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";
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
  FileManagerPreviewRequest,
  FileManagerPreviewResult,
  FileManagerViewState,
  FileManagerViewStateUpdate,
  FileManagerWriteRequest,
  FileManagerWriteResult,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import type {
  AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import type {
  BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import type {
  WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import type {
  AgentBrowserNavigationCommand,
  AgentBrowserOwner,
  AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import type {
  AgentBrowserHistoryClearRequest,
  AgentBrowserHistoryDeleteRequest,
  AgentBrowserHistoryReadRequest,
  AgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
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

export interface ModelRuntimeSettingsStore {
  readonly available: boolean;
  read(): Promise<ModelRuntimeSettingsSnapshot>;
  readStatus?(runtimeId: LocalModelRuntimeId): Promise<ModelRuntimeServiceState>;
  write(
    settings: ModelRuntimeSettings,
    runtimeId?: LocalModelRuntimeId,
  ): Promise<void>;
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
  navigate(
    sessionId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<AgentBrowserProjection>;
  readHistory(
    request: AgentBrowserHistoryReadRequest,
  ): Promise<AgentBrowserHistorySnapshot>;
  clearHistory(
    request: AgentBrowserHistoryClearRequest,
  ): Promise<AgentBrowserHistorySnapshot>;
  deleteHistory(
    request: AgentBrowserHistoryDeleteRequest,
  ): Promise<void>;
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
  /** Whether the port can publish external filesystem changes. */
  readonly watchAvailable: boolean;
  diff(
    request: FileManagerDiffRequest,
  ): Promise<FileManagerDiffResult>;
  list(
    request: FileManagerListRequest,
  ): Promise<FileManagerListResult>;
  chooseDirectory?(): Promise<string | undefined>;
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

/** Desktop recovery only. DSH's native page owns package management. */
export interface PluginRecoveryPort {
  readonly available: boolean;
  setSafeMode(enabled: boolean): Promise<void>;
  readSettings(): Promise<PluginManagementSettings>;
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
  navigate(
    sessionId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<unknown>;
  readHistory(
    request: AgentBrowserHistoryReadRequest,
  ): Promise<unknown>;
  clearHistory(
    request: AgentBrowserHistoryClearRequest,
  ): Promise<unknown>;
  deleteHistory(
    request: AgentBrowserHistoryDeleteRequest,
  ): Promise<void>;
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
  readSettings(): Promise<unknown>;
  writeSettings(settings: TerminalSettings): Promise<void>;
}

export interface DesktopAppUpdateBridge {
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
  readStatus?(runtimeId: LocalModelRuntimeId): Promise<unknown>;
  write(
    settings: ModelRuntimeSettings,
    runtimeId?: LocalModelRuntimeId,
  ): Promise<void>;
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

export interface DesktopPluginRecoveryBridge {
  setSafeMode(enabled: boolean): Promise<void>;
  readSettings(): Promise<unknown>;
}

export interface DesktopDataHomeBridge {
  read(): Promise<unknown>;
  plan(request: DataHomeMigrationPlanRequest): Promise<unknown>;
  schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<unknown>;
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
  __DSH_DIRECTORY_PICKER__?: {
    pick(): Promise<string | null>;
  };
  minkeDesktop?: {
    agentBrowser?: DesktopAgentBrowserBridge;
    appUpdate?: DesktopAppUpdateBridge;
    about?: DesktopAboutBridge;
    browser?: DesktopBrowserBridge;
    dataHome?: DesktopDataHomeBridge;
    files?: DesktopFilesBridge;
    modelRuntime?: DesktopModelRuntimeBridge;
    pluginRecovery?: DesktopPluginRecoveryBridge;
    remote?: DesktopRemoteBridge;
    remoteHub?: DesktopRemoteHubBridge;
    tabs?: DesktopTabsBridge;
    terminal?: DesktopTerminalBridge;
    webSearch?: DesktopWebSearchBridge;
    surface?: DesktopSurfaceBridge;
  };
}
