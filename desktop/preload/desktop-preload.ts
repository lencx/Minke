import { contextBridge, ipcRenderer } from "electron";
import appManifest from "../../package.json";
import {
  PLUGIN_INSTALLED_READ_CHANNEL,
  PLUGIN_INSTALL_CHANNEL,
  PLUGIN_RESTART_CHANNEL,
  PLUGIN_SAFE_MODE_SET_CHANNEL,
  PLUGIN_SET_ENABLED_CHANNEL,
  PLUGIN_UNINSTALL_CHANNEL,
  parseInstalledPluginsSnapshot,
  parsePluginInstallRequest,
  parsePluginSafeModeSetRequest,
  parsePluginSetEnabledRequest,
  parsePluginUninstallRequest,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
  MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  parseModelRuntimeSettings,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import {
  isProductShortcutActionId,
  parseShortcutBindings,
  SHORTCUT_INVOKE_CHANNEL,
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  parseTerminalSettings,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_SETTINGS_READ_CHANNEL,
  APP_UPDATE_SETTINGS_WRITE_CHANNEL,
  parseAppUpdateCheckResult,
  parseAppUpdateSettings,
  type AppUpdateCheckResult,
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
  DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
  DATA_HOME_MIGRATION_PLAN_CHANNEL,
  DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
  DATA_HOME_SETTINGS_READ_CHANNEL,
  parseDataHomeMigrationPlan,
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  parseDataHomeMigrationScheduleResult,
  parseDataHomePath,
  parseDataHomeSettingsSnapshot,
  type DataHomeMigrationPlanRequest,
  type DataHomeMigrationScheduleRequest,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  parseSessionLogExportId,
  SESSION_LOG_EXPORT_CHANNEL,
} from "@minke/harness-overlay/session-export-contract.ts";
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
  parseFileManagerChangeEvent,
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerListResult,
  parseFileManagerOpenRequest,
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
  TABS_FILES_OPEN_CHANNEL,
  TABS_FILES_PREVIEW_CHANNEL,
  TABS_FILES_UNWATCH_CHANNEL,
  TABS_FILES_VIEW_STATE_READ_CHANNEL,
  TABS_FILES_VIEW_STATE_WRITE_CHANNEL,
  TABS_FILES_WATCH_CHANNEL,
  TABS_FILES_WRITE_CHANNEL,
  type FileManagerChangeEvent,
  type FileManagerDiffRequest,
  type FileManagerListRequest,
  type FileManagerOpenRequest,
  type FileManagerPreviewRequest,
  type FileManagerViewStateUpdate,
  type FileManagerWriteRequest,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalEvent,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  TABS_TERMINAL_CLOSE_CHANNEL,
  TABS_TERMINAL_CREATE_CHANNEL,
  TABS_TERMINAL_EVENT_CHANNEL,
  TABS_TERMINAL_RESIZE_CHANNEL,
  TABS_TERMINAL_WRITE_CHANNEL,
  type TerminalCreateRequest,
  type TerminalEvent,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import {
  isDesktopLocale,
  WINDOW_LOCALE_CHANNEL,
  type DesktopLocale,
} from "@minke/desktop/locale-contract.ts";
import {
  isWindowThemeMessage,
  WINDOW_THEME_CHANNEL,
  type WindowColorScheme,
  type WindowThemePreference,
  type WindowThemeMessage,
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
  AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
  AGENT_BROWSER_SESSIONS_READ_CHANNEL,
  parseAgentBrowserControlRequest,
  parseAgentBrowserProjection,
  parseAgentBrowserProjections,
  parseAgentBrowserSessionId,
  type AgentBrowserOwner,
  type AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
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
let lastMessage: WindowThemeMessage | undefined;
let hasAuthoritativeTheme = false;
const shortcutUnsubscribers = new Set<() => void>();
const fileWatchUnsubscribers = new Set<() => void>();
const terminalUnsubscribers = new Set<() => void>();
const remoteRuntimeUnsubscribers = new Set<() => void>();
const agentBrowserUnsubscribers = new Set<() => void>();
const remoteHubUnsubscribers = new Set<() => void>();
let nextFileWatchId = 0;

function currentColorScheme(): WindowColorScheme | undefined {
  const colorScheme = document.documentElement.style.colorScheme;
  return colorScheme === "light" || colorScheme === "dark"
    ? colorScheme
    : undefined;
}

function sameWindowThemeMessage(
  left: WindowThemeMessage | undefined,
  right: WindowThemeMessage,
): boolean {
  const leftPreference =
    left !== undefined && "preference" in left
      ? left.preference
      : undefined;
  return (
    left?.colorScheme === right.colorScheme &&
    leftPreference ===
      ("preference" in right ? right.preference : undefined)
  );
}

function sendWindowTheme(message: WindowThemeMessage): void {
  if (sameWindowThemeMessage(lastMessage, message)) return;
  lastMessage = message;
  ipcRenderer.send(WINDOW_THEME_CHANNEL, message);
}

function publishResolvedWindowTheme(): void {
  if (hasAuthoritativeTheme) return;
  const colorScheme = currentColorScheme();
  if (colorScheme === undefined) return;
  sendWindowTheme({ colorScheme });
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
  publishResolvedWindowTheme();
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
}

const shortcuts = Object.freeze({
  async read(): Promise<unknown> {
    return await ipcRenderer.invoke(SHORTCUT_SETTINGS_READ_CHANNEL);
  },
  async write(bindings: ShortcutBindings): Promise<void> {
    await ipcRenderer.invoke(
      SHORTCUT_SETTINGS_WRITE_CHANNEL,
      parseShortcutBindings(bindings),
    );
  },
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void {
    const wrapped = (_event: unknown, id: unknown): void => {
      if (isProductShortcutActionId(id)) listener(id);
    };
    ipcRenderer.on(SHORTCUT_INVOKE_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      shortcutUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(SHORTCUT_INVOKE_CHANNEL, wrapped);
    };
    shortcutUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const locale = Object.freeze({
  publish(active: DesktopLocale): void {
    if (!isDesktopLocale(active)) return;
    ipcRenderer.send(WINDOW_LOCALE_CHANNEL, active);
  },
});

const sessionLogs = Object.freeze({
  async export(sessionId: string): Promise<void> {
    await ipcRenderer.invoke(
      SESSION_LOG_EXPORT_CHANNEL,
      parseSessionLogExportId(sessionId),
    );
  },
});

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
    return parseFileManagerListResult(
      await ipcRenderer.invoke(
        TABS_FILES_LIST_CHANNEL,
        parseFileManagerListRequest(request),
      ),
    );
  },
  async open(request: FileManagerOpenRequest): Promise<void> {
    await ipcRenderer.invoke(
      TABS_FILES_OPEN_CHANNEL,
      parseFileManagerOpenRequest(request),
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
  async create(request: TerminalCreateRequest): Promise<unknown> {
    return parseTerminalCreateResult(
      await ipcRenderer.invoke(
        TABS_TERMINAL_CREATE_CHANNEL,
        parseTerminalCreateRequest(request),
      ),
    );
  },
  write(request: TerminalWriteRequest): void {
    ipcRenderer.send(
      TABS_TERMINAL_WRITE_CHANNEL,
      parseTerminalWriteRequest(request),
    );
  },
  resize(request: TerminalResizeRequest): void {
    ipcRenderer.send(
      TABS_TERMINAL_RESIZE_CHANNEL,
      parseTerminalResizeRequest(request),
    );
  },
  close(sessionId: string): void {
    ipcRenderer.send(
      TABS_TERMINAL_CLOSE_CHANNEL,
      parseTerminalSessionId(sessionId),
    );
  },
  subscribe(listener: (event: TerminalEvent) => void): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseTerminalEvent(value));
      } catch {
        // Only main-process events matching the shared contract are delivered.
      }
    };
    ipcRenderer.on(TABS_TERMINAL_EVENT_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      terminalUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(TABS_TERMINAL_EVENT_CHANNEL, wrapped);
    };
    terminalUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const appUpdate = Object.freeze({
  async check(): Promise<AppUpdateCheckResult> {
    return parseAppUpdateCheckResult(
      await ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL),
    );
  },
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
  async write(settings: ModelRuntimeSettings): Promise<void> {
    await ipcRenderer.invoke(
      MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
      parseModelRuntimeSettings(settings),
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

const pluginInstaller = Object.freeze({
  async install(command: string): Promise<void> {
    await ipcRenderer.invoke(
      PLUGIN_INSTALL_CHANNEL,
      parsePluginInstallRequest({ command }),
    );
  },
  async uninstall(name: string): Promise<void> {
    await ipcRenderer.invoke(
      PLUGIN_UNINSTALL_CHANNEL,
      parsePluginUninstallRequest({ name }),
    );
  },
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await ipcRenderer.invoke(
      PLUGIN_SET_ENABLED_CHANNEL,
      parsePluginSetEnabledRequest({ name, enabled }),
    );
  },
  async setSafeMode(enabled: boolean): Promise<void> {
    await ipcRenderer.invoke(
      PLUGIN_SAFE_MODE_SET_CHANNEL,
      parsePluginSafeModeSetRequest({ enabled }),
    );
  },
  async restart(): Promise<void> {
    await ipcRenderer.invoke(PLUGIN_RESTART_CHANNEL);
  },
  async readInstalled(): Promise<unknown> {
    return parseInstalledPluginsSnapshot(
      await ipcRenderer.invoke(
        PLUGIN_INSTALLED_READ_CHANNEL,
      ),
    );
  },
});

const dataHome = Object.freeze({
  async read(): Promise<unknown> {
    return parseDataHomeSettingsSnapshot(
      await ipcRenderer.invoke(DATA_HOME_SETTINGS_READ_CHANNEL),
    );
  },
  async chooseDirectory(): Promise<string | undefined> {
    const selected = await ipcRenderer.invoke(
      DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
    );
    return selected === undefined
      ? undefined
      : parseDataHomePath(selected);
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

const windowTheme = Object.freeze({
  publish(
    preference: WindowThemePreference,
    colorScheme: WindowColorScheme,
  ): void {
    const message = { preference, colorScheme };
    if (!isWindowThemeMessage(message) || !("preference" in message)) {
      throw new TypeError("invalid Harness window theme snapshot");
    }
    hasAuthoritativeTheme = true;
    sendWindowTheme(message);
  },
});

contextBridge.exposeInMainWorld(
  "minkeDesktop",
  Object.freeze({
    agentBrowser,
    appUpdate,
    about,
    browser,
    dataHome,
    files,
    locale,
    modelRuntime,
    pluginInstaller,
    remote,
    remoteHub,
    sessionLogs,
    tabs,
    terminal,
    webSearch,
    shortcuts,
    surface,
    windowTheme,
  }),
);

observer = new MutationObserver(observeWindowTheme);
observeWindowTheme();

window.addEventListener(
  "unload",
  () => {
    for (const unsubscribe of [...shortcutUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...fileWatchUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...terminalUnsubscribers]) {
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
