import {
  contextBridge,
  ipcRenderer,
  webFrame,
  webUtils,
} from "electron";
import appManifest from "../../package.json";
import { createDesktopBrowserBridge } from "./browser.ts";
import { createDesktopUpdatesBridge } from "./updates.ts";
import { DIRECTORY_PICK_CHANNEL } from "@minke/desktop/directory-picker-contract.ts";
import { WINDOW_FULLSCREEN_CHANNEL } from "@minke/desktop/window-fullscreen-contract.ts";
import macOSSurfaceCss from "../../resources/desktop-style-extension/early.css?raw";
import {
  PLUGIN_SETTINGS_READ_CHANNEL,
  PLUGIN_SAFE_MODE_SET_CHANNEL,
  parsePluginManagementSettings,
  parsePluginSafeModeSetRequest,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";
import {
  MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
  MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  MODEL_RUNTIME_STATUS_READ_CHANNEL,
  parseLocalModelRuntimeId,
  parseModelRuntimeSettings,
  parseModelRuntimeServiceState,
  type LocalModelRuntimeId,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import { SHORTCUT_IPC } from "@minke/harness-overlay/shared-shortcuts-contract.ts";
import type { DesktopKeyboardApi, DesktopShortcutsApi, DesktopShortcutInput } from "@deepseek-ai/dsh-client-shortcuts/protocol";
import {
  parseTerminalSettings,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  APP_UPDATE_SETTINGS_READ_CHANNEL,
  APP_UPDATE_SETTINGS_WRITE_CHANNEL,
  parseAppUpdateSettings,
  type AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import {
  BROWSER_SETTINGS_READ_CHANNEL,
  BROWSER_SETTINGS_WRITE_CHANNEL,
  parseBrowserSettings,
  type BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import {
  parseWebSearchSettings,
  WEB_SEARCH_SETTINGS_READ_CHANNEL,
  WEB_SEARCH_SETTINGS_WRITE_CHANNEL,
  type WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import {
  DATA_HOME_MIGRATION_PLAN_CHANNEL,
  DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
  DATA_HOME_SETTINGS_READ_CHANNEL,
  parseDataHomeMigrationPlan,
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  parseDataHomeMigrationScheduleResult,
  parseDataHomeSettingsSnapshot,
  type DataHomeMigrationPlanRequest,
  type DataHomeMigrationScheduleRequest,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  normalizeWebTabUrl,
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
  TABS_LAYOUT_STATE_READ_CHANNEL,
  TABS_LAYOUT_STATE_WRITE_CHANNEL,
  TABS_OPEN_EXTERNAL_CHANNEL,
  type TabsLayoutStateUpdate,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  fileUrlToAbsoluteLocalPath,
  normalizeAbsoluteLocalPath,
} from "@minke/harness-overlay/tabs/web-link-contract.ts";
import {
  parseDesktopFileManagerListResult,
  parseFileManagerChangeEvent,
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerUnwatchRequest,
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
  parseFileManagerWatchRequest,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  TABS_FILES_DIFF_CHANNEL,
  TABS_FILES_CHANGE_CHANNEL,
  TABS_FILES_LIST_CHANNEL,
  TABS_FILES_PREVIEW_CHANNEL,
  TABS_FILES_UNWATCH_CHANNEL,
  TABS_FILES_VIEW_STATE_READ_CHANNEL,
  TABS_FILES_VIEW_STATE_WRITE_CHANNEL,
  TABS_FILES_WATCH_CHANNEL,
  TABS_FILES_WRITE_CHANNEL,
  type FileManagerChangeEvent,
  type FileManagerDiffRequest,
  type FileManagerListRequest,
  type FileManagerPreviewRequest,
  type FileManagerViewStateUpdate,
  type FileManagerWriteRequest,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  isDesktopLocale,
  WINDOW_LOCALE_BOOTSTRAP_CHANNEL,
  WINDOW_LOCALE_CHANNEL,
} from "@minke/desktop/locale-contract.ts";
import {
  isWindowThemeSource,
  WINDOW_THEME_CHANNEL,
  WINDOW_THEME_SOURCE_ATTRIBUTE,
  type WindowThemeSource,
} from "@minke/desktop/window-theme-contract.ts";
import {
  parseRemoteSettings,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettingsSnapshot,
  REMOTE_RUNTIME_CHANGED_CHANNEL,
  REMOTE_SETTINGS_READ_CHANNEL,
  REMOTE_SETTINGS_WRITE_CHANNEL,
  type RemoteSettings,
  type RemoteRuntimeSnapshot,
} from "@lencx/minke-remote-access/contract";
import {
  AGENT_BROWSER_CLOSE_CHANNEL,
  AGENT_BROWSER_CONTROL_CHANNEL,
  AGENT_BROWSER_NAVIGATION_CHANNEL,
  AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
  AGENT_BROWSER_SESSIONS_READ_CHANNEL,
  parseAgentBrowserControlRequest,
  parseAgentBrowserNavigationRequest,
  parseAgentBrowserProjection,
  parseAgentBrowserProjections,
  parseAgentBrowserSessionId,
  type AgentBrowserOwner,
  type AgentBrowserNavigationCommand,
  type AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
  AGENT_BROWSER_HISTORY_DELETE_CHANNEL,
  AGENT_BROWSER_HISTORY_READ_CHANNEL,
  parseAgentBrowserHistoryClearRequest,
  parseAgentBrowserHistoryDeleteRequest,
  parseAgentBrowserHistoryReadRequest,
  parseAgentBrowserHistorySnapshot,
  type AgentBrowserHistoryClearRequest,
  type AgentBrowserHistoryDeleteRequest,
  type AgentBrowserHistoryReadRequest,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import {
  AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
  AGENT_BROWSER_ANNOTATION_START_CHANNEL,
  AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
  parseAgentBrowserAnnotationCommitRequest,
  parseAgentBrowserAnnotationCommitResult,
  parseAgentBrowserAnnotationEvent,
  parseAgentBrowserAnnotationRefreshRequest,
  parseAgentBrowserAnnotationRefreshResult,
  parseAgentBrowserAnnotationSession,
  parseAgentBrowserAnnotationStartRequest,
  parseAgentBrowserAnnotationStopRequest,
  type AgentBrowserAnnotationEvent,
  type AgentBrowserAnnotationRefreshRequest,
  type AgentBrowserAnnotationStopRequest,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  REMOTE_HUB_CHANGED_CHANNEL,
  REMOTE_HUB_COMMAND_CHANNEL,
  REMOTE_HUB_READ_CHANNEL,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";

let observer: MutationObserver | undefined;
let lastThemeSource: WindowThemeSource | undefined;
const shortcutUnsubscribers = new Set<() => void>();
const fileWatchUnsubscribers = new Set<() => void>();
const remoteRuntimeUnsubscribers = new Set<() => void>();
const agentBrowserUnsubscribers = new Set<() => void>();
const remoteHubUnsubscribers = new Set<() => void>();
let nextFileWatchId = 0;

if (process.platform === "darwin") {
  webFrame.insertCSS(macOSSurfaceCss);
}

function syncWindowFullscreen(_event: unknown, fullscreen: unknown): void {
  const root = document.documentElement;
  if (root === null || typeof fullscreen !== "boolean") return;
  if (fullscreen) root.dataset.fullscreen = "true";
  else delete root.dataset.fullscreen;
}

if (process.platform === "darwin" || process.platform === "win32") {
  ipcRenderer.on(WINDOW_FULLSCREEN_CHANNEL, syncWindowFullscreen);
}

function publishWindowThemeSource(): void {
  const source = document.documentElement.getAttribute(WINDOW_THEME_SOURCE_ATTRIBUTE);
  if (!isWindowThemeSource(source) || source === lastThemeSource) return;
  lastThemeSource = source;
  ipcRenderer.send(WINDOW_THEME_CHANNEL, source);
}

function observeWindowTheme(): void {
  if (document.documentElement === null) {
    observer?.observe(document, {
      childList: true,
      subtree: true,
    });
    return;
  }

  observer?.disconnect();
  document.documentElement.dataset.platform = process.platform;
  publishWindowThemeSource();
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [WINDOW_THEME_SOURCE_ATTRIBUTE],
  });
}

function subscribeShortcut<T>(channel: string, listener: (value: T) => void): () => void {
  const handle = (_event: unknown, value: T): void => listener(value);
  ipcRenderer.on(channel, handle);
  const off = (): void => { ipcRenderer.off(channel, handle); shortcutUnsubscribers.delete(off); };
  shortcutUnsubscribers.add(off);
  return off;
}
const shortcuts = Object.freeze<DesktopShortcutsApi>({
  get: definitions => ipcRenderer.invoke(SHORTCUT_IPC.get, definitions),
  edit: (edit, revision) => ipcRenderer.invoke(SHORTCUT_IPC.edit, edit, revision),
  recording: active => ipcRenderer.invoke(SHORTCUT_IPC.recording, active),
  subscribe: listener => subscribeShortcut(SHORTCUT_IPC.changed, listener),
});
const keyboard = Object.freeze<DesktopKeyboardApi>({
  closeWindow: revision => ipcRenderer.invoke(SHORTCUT_IPC.close, revision),
  subscribe: listener => subscribeShortcut<DesktopShortcutInput>(SHORTCUT_IPC.input, input => {
    const element = document.activeElement;
    if (input.kind === "iframe" && (!(element instanceof HTMLIFrameElement) || !element.isConnected
      || !element.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')
      || input.frameName === "" || element.name !== input.frameName)) return;
    if (input.kind === "webview" && (element?.matches('webview[data-sidebar-browser-frame]') !== true
      || !element.isConnected || input.frameName === "" || element.getAttribute("name") !== input.frameName)) return;
    listener(input);
  }),
});
const desktopBrowser = createDesktopBrowserBridge(ipcRenderer);
const desktopUpdates = createDesktopUpdatesBridge(ipcRenderer);
contextBridge.exposeInMainWorld("dshDesktop", Object.freeze({ protocolVersion: 1, shortcuts, keyboard, browser: desktopBrowser.browser,
  updates: desktopUpdates.updates,
  shortcutsAccepted: (revision: string): void => { ipcRenderer.send(SHORTCUT_IPC.accepted, revision); },
}));

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("__DSH_LOCALE__", Object.freeze({
    read: (): Promise<unknown> => ipcRenderer.invoke(WINDOW_LOCALE_BOOTSTRAP_CHANNEL),
    onChange(active: string): void {
      if (isDesktopLocale(active)) ipcRenderer.send(WINDOW_LOCALE_CHANNEL, active);
    },
  }));
  // DSH chooses references for disk files/folders and uploads for images or
  // pasted bytes. Electron alone resolves the path of the actual File object.
  contextBridge.exposeInMainWorld("__DSH_HOST_PATHS__", Object.freeze({
    pathFor: (file: File): string => webUtils.getPathForFile(file),
  }));
}

const tabs = Object.freeze({
  async readLayoutState(): Promise<unknown> {
    return parseTabsLayoutState(
      await ipcRenderer.invoke(TABS_LAYOUT_STATE_READ_CHANNEL),
    );
  },
  async writeLayoutState(
    update: TabsLayoutStateUpdate,
  ): Promise<void> {
    await ipcRenderer.invoke(
      TABS_LAYOUT_STATE_WRITE_CHANNEL,
      parseTabsLayoutStateUpdate(update),
    );
  },
  resolveLocalPath(candidate: string): string | undefined {
    return (
      normalizeAbsoluteLocalPath(candidate) ??
      fileUrlToAbsoluteLocalPath(candidate, process.platform)
    );
  },
  openExternal(candidate: string): void {
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) {
      throw new TypeError("invalid Minke Web tab URL");
    }
    ipcRenderer.send(TABS_OPEN_EXTERNAL_CHANNEL, url);
  },
});

const agentBrowser = Object.freeze({
  async read(): Promise<unknown> {
    return parseAgentBrowserProjections(
      await ipcRenderer.invoke(
        AGENT_BROWSER_SESSIONS_READ_CHANNEL,
      ),
    );
  },
  async setControl(
    sessionId: string,
    owner: AgentBrowserOwner,
  ): Promise<unknown> {
    const request = parseAgentBrowserControlRequest({
      sessionId,
      owner,
    });
    return parseAgentBrowserProjection(
      await ipcRenderer.invoke(
        AGENT_BROWSER_CONTROL_CHANNEL,
        request,
      ),
    );
  },
  async navigate(
    sessionId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<unknown> {
    const request = parseAgentBrowserNavigationRequest({
      sessionId,
      command,
    });
    return parseAgentBrowserProjection(
      await ipcRenderer.invoke(
        AGENT_BROWSER_NAVIGATION_CHANNEL,
        request,
      ),
    );
  },
  async readHistory(
    request: AgentBrowserHistoryReadRequest,
  ): Promise<unknown> {
    return parseAgentBrowserHistorySnapshot(
      await ipcRenderer.invoke(
        AGENT_BROWSER_HISTORY_READ_CHANNEL,
        parseAgentBrowserHistoryReadRequest(request),
      ),
    );
  },
  async clearHistory(
    request: AgentBrowserHistoryClearRequest,
  ): Promise<unknown> {
    return parseAgentBrowserHistorySnapshot(
      await ipcRenderer.invoke(
        AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
        parseAgentBrowserHistoryClearRequest(request),
      ),
    );
  },
  async deleteHistory(
    request: AgentBrowserHistoryDeleteRequest,
  ): Promise<void> {
    await ipcRenderer.invoke(
      AGENT_BROWSER_HISTORY_DELETE_CHANNEL,
      parseAgentBrowserHistoryDeleteRequest(request),
    );
  },
  async startAnnotation(sessionId: string): Promise<unknown> {
    const request = parseAgentBrowserAnnotationStartRequest({
      sessionId,
    });
    return parseAgentBrowserAnnotationSession(
      await ipcRenderer.invoke(
        AGENT_BROWSER_ANNOTATION_START_CHANNEL,
        request,
      ),
    );
  },
  async stopAnnotation(
    request: AgentBrowserAnnotationStopRequest,
  ): Promise<void> {
    await ipcRenderer.invoke(
      AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
      parseAgentBrowserAnnotationStopRequest(request),
    );
  },
  async refreshAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<unknown> {
    return parseAgentBrowserAnnotationRefreshResult(
      await ipcRenderer.invoke(
        AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
        parseAgentBrowserAnnotationRefreshRequest(request),
      ),
    );
  },
  async commitAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<unknown> {
    const parsed = parseAgentBrowserAnnotationCommitRequest(request);
    return parseAgentBrowserAnnotationCommitResult(
      await ipcRenderer.invoke(
        AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
        parsed,
      ),
    );
  },
  close(sessionId: string): void {
    ipcRenderer.send(
      AGENT_BROWSER_CLOSE_CHANNEL,
      parseAgentBrowserSessionId(sessionId),
    );
  },
  subscribe(
    listener: (
      projections: readonly AgentBrowserProjection[],
    ) => void,
  ): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseAgentBrowserProjections(value));
      } catch {
        // Only validated main-process projections are delivered.
      }
    };
    ipcRenderer.on(
      AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
      wrapped,
    );
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      agentBrowserUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(
        AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
        wrapped,
      );
    };
    agentBrowserUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
  subscribeAnnotationEvents(
    listener: (event: AgentBrowserAnnotationEvent) => void,
  ): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseAgentBrowserAnnotationEvent(value));
      } catch {
        // Only validated main-process annotation events are delivered.
      }
    };
    ipcRenderer.on(
      AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
      wrapped,
    );
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      agentBrowserUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(
        AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
        wrapped,
      );
    };
    agentBrowserUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const files = Object.freeze({
  async diff(request: FileManagerDiffRequest): Promise<unknown> {
    return parseFileManagerDiffResult(
      await ipcRenderer.invoke(
        TABS_FILES_DIFF_CHANNEL,
        parseFileManagerDiffRequest(request),
      ),
    );
  },
  async list(request: FileManagerListRequest): Promise<unknown> {
    return parseDesktopFileManagerListResult(
      await ipcRenderer.invoke(
        TABS_FILES_LIST_CHANNEL,
        parseFileManagerListRequest(request),
      ),
    );
  },
  async preview(
    request: FileManagerPreviewRequest,
  ): Promise<unknown> {
    return parseFileManagerPreviewResult(
      await ipcRenderer.invoke(
        TABS_FILES_PREVIEW_CHANNEL,
        parseFileManagerPreviewRequest(request),
      ),
    );
  },
  async write(request: FileManagerWriteRequest): Promise<unknown> {
    return parseFileManagerWriteResult(
      await ipcRenderer.invoke(
        TABS_FILES_WRITE_CHANNEL,
        parseFileManagerWriteRequest(request),
      ),
    );
  },
  async readViewState(): Promise<unknown> {
    return parseFileManagerViewState(
      await ipcRenderer.invoke(
        TABS_FILES_VIEW_STATE_READ_CHANNEL,
      ),
    );
  },
  async writeViewState(
    update: FileManagerViewStateUpdate,
  ): Promise<void> {
    await ipcRenderer.invoke(
      TABS_FILES_VIEW_STATE_WRITE_CHANNEL,
      parseFileManagerViewStateUpdate(update),
    );
  },
  watch(
    paths: readonly string[],
    listener: (event: FileManagerChangeEvent) => void,
  ): () => void {
    const id = `files:${++nextFileWatchId}`;
    const request = parseFileManagerWatchRequest({ id, paths });
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        const change = parseFileManagerChangeEvent(value);
        if (change.id === id) listener(change);
      } catch {
        // Only main-process events matching the shared contract are delivered.
      }
    };
    ipcRenderer.on(TABS_FILES_CHANGE_CHANNEL, wrapped);
    ipcRenderer.send(TABS_FILES_WATCH_CHANNEL, request);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      fileWatchUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(TABS_FILES_CHANGE_CHANNEL, wrapped);
      ipcRenderer.send(
        TABS_FILES_UNWATCH_CHANNEL,
        parseFileManagerUnwatchRequest({ id }),
      );
    };
    fileWatchUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const terminal = Object.freeze({
  async readSettings(): Promise<unknown> {
    return await ipcRenderer.invoke(TERMINAL_SETTINGS_READ_CHANNEL);
  },
  async writeSettings(settings: TerminalSettings): Promise<void> {
    await ipcRenderer.invoke(
      TERMINAL_SETTINGS_WRITE_CHANNEL,
      parseTerminalSettings(settings),
    );
  },
});

const appUpdate = Object.freeze({
  async read(): Promise<unknown> {
    return parseAppUpdateSettings(
      await ipcRenderer.invoke(APP_UPDATE_SETTINGS_READ_CHANNEL),
    );
  },
  async write(settings: AppUpdateSettings): Promise<void> {
    await ipcRenderer.invoke(
      APP_UPDATE_SETTINGS_WRITE_CHANNEL,
      parseAppUpdateSettings(settings),
    );
  },
});

const webSearch = Object.freeze({
  async read(): Promise<unknown> {
    return parseWebSearchSettings(
      await ipcRenderer.invoke(WEB_SEARCH_SETTINGS_READ_CHANNEL),
    );
  },
  async write(settings: WebSearchSettings): Promise<void> {
    await ipcRenderer.invoke(
      WEB_SEARCH_SETTINGS_WRITE_CHANNEL,
      parseWebSearchSettings(settings),
    );
  },
});

const browser = Object.freeze({
  async read(): Promise<unknown> {
    return parseBrowserSettings(
      await ipcRenderer.invoke(BROWSER_SETTINGS_READ_CHANNEL),
    );
  },
  async write(settings: BrowserSettings): Promise<void> {
    await ipcRenderer.invoke(
      BROWSER_SETTINGS_WRITE_CHANNEL,
      parseBrowserSettings(settings),
    );
  },
});

const modelRuntime = Object.freeze({
  async read(): Promise<unknown> {
    return await ipcRenderer.invoke(
      MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
    );
  },
  async readStatus(runtimeId: LocalModelRuntimeId) {
    return parseModelRuntimeServiceState(await ipcRenderer.invoke(
      MODEL_RUNTIME_STATUS_READ_CHANNEL,
      parseLocalModelRuntimeId(runtimeId),
    ));
  },
  async write(
    settings: ModelRuntimeSettings,
    runtimeId?: LocalModelRuntimeId,
  ): Promise<void> {
    await ipcRenderer.invoke(
      MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
      parseModelRuntimeSettings(settings),
      ...(runtimeId === undefined ? [] : [parseLocalModelRuntimeId(runtimeId)]),
    );
  },
});

const remote = Object.freeze({
  async read(): Promise<unknown> {
    return parseRemoteSettingsSnapshot(
      await ipcRenderer.invoke(REMOTE_SETTINGS_READ_CHANNEL),
    );
  },
  async write(settings: RemoteSettings): Promise<void> {
    await ipcRenderer.invoke(
      REMOTE_SETTINGS_WRITE_CHANNEL,
      parseRemoteSettings(settings),
    );
  },
  subscribe(
    listener: (snapshot: RemoteRuntimeSnapshot) => void,
  ): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseRemoteRuntimeSnapshot(value));
      } catch {
        // Only validated main-process runtime snapshots are delivered.
      }
    };
    ipcRenderer.on(REMOTE_RUNTIME_CHANGED_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      remoteRuntimeUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(REMOTE_RUNTIME_CHANGED_CHANNEL, wrapped);
    };
    remoteRuntimeUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const remoteHub = Object.freeze({
  async read(): Promise<unknown> {
    return parseRemoteHubSnapshot(
      await ipcRenderer.invoke(REMOTE_HUB_READ_CHANNEL),
    );
  },
  async dispatch(command: RemoteHubCommand): Promise<unknown> {
    return parseRemoteHubSnapshot(
      await ipcRenderer.invoke(
        REMOTE_HUB_COMMAND_CHANNEL,
        parseRemoteHubCommand(command),
      ),
    );
  },
  subscribe(
    listener: (snapshot: RemoteHubSnapshot) => void,
  ): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseRemoteHubSnapshot(value));
      } catch {
        // Only validated, secret-free main-process projections are delivered.
      }
    };
    ipcRenderer.on(REMOTE_HUB_CHANGED_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      remoteHubUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(REMOTE_HUB_CHANGED_CHANNEL, wrapped);
    };
    remoteHubUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const pluginRecovery = Object.freeze({
  async setSafeMode(enabled: boolean): Promise<void> {
    await ipcRenderer.invoke(PLUGIN_SAFE_MODE_SET_CHANNEL, parsePluginSafeModeSetRequest({ enabled }));
  },
  async readSettings(): Promise<unknown> {
    return parsePluginManagementSettings(await ipcRenderer.invoke(PLUGIN_SETTINGS_READ_CHANNEL));
  },
});

const dataHome = Object.freeze({
  async read(): Promise<unknown> {
    return parseDataHomeSettingsSnapshot(
      await ipcRenderer.invoke(DATA_HOME_SETTINGS_READ_CHANNEL),
    );
  },
  async plan(
    request: DataHomeMigrationPlanRequest,
  ): Promise<unknown> {
    return parseDataHomeMigrationPlan(
      await ipcRenderer.invoke(
        DATA_HOME_MIGRATION_PLAN_CHANNEL,
        parseDataHomeMigrationPlanRequest(request),
      ),
    );
  },
  async schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<unknown> {
    return parseDataHomeMigrationScheduleResult(
      await ipcRenderer.invoke(
        DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
        parseDataHomeMigrationScheduleRequest(request),
      ),
    );
  },
});

const about = Object.freeze({
  productName: appManifest.productName,
  version: appManifest.version,
  platform: process.platform,
  arch: process.arch,
});

const surface = Object.freeze({
  kind: process.platform === "darwin" ? "macos" : "standard",
});

contextBridge.exposeInMainWorld("__DSH_DIRECTORY_PICKER__", Object.freeze({
  pick: (): Promise<string | null> => ipcRenderer.invoke(DIRECTORY_PICK_CHANNEL),
}));

contextBridge.exposeInMainWorld(
  "minkeDesktop",
  Object.freeze({
    agentBrowser,
    appUpdate,
    about,
    browser,
    dataHome,
    files,
    modelRuntime,
    pluginRecovery,
    remote,
    remoteHub,
    tabs,
    terminal,
    webSearch,
    surface,
  }),
);

observer = new MutationObserver(observeWindowTheme);
observeWindowTheme();

window.addEventListener(
  "unload",
  () => {
    ipcRenderer.off(WINDOW_FULLSCREEN_CHANNEL, syncWindowFullscreen);
    desktopBrowser.dispose();
    desktopUpdates.dispose();
    for (const unsubscribe of [...shortcutUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...fileWatchUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...remoteRuntimeUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...agentBrowserUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...remoteHubUnsubscribers]) {
      unsubscribe();
    }
    observer?.disconnect();
    observer = undefined;
  },
  { once: true },
);
