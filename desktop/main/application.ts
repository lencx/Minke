import { existsSync } from "node:fs";
import { installDesktopShortcuts } from "./desktop-shortcuts.ts";
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import {
  DEFAULT_REMOTE_SETTINGS,
  discoverRemoteCommands,
  RemoteAccessRuntime,
  REMOTE_RUNTIME_CHANGED_CHANNEL,
  type RemoteSettings,
} from "@lencx/minke-remote-access";
import {
  DesktopLocaleRuntime,
  translateDesktop,
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "@minke/desktop/i18n";
import {
  resolveDesktopLocale,
} from "@minke/desktop/locale-contract";
import {
  DEFAULT_APP_UPDATE_SETTINGS,
} from "@minke/harness-overlay/app-update-contract";
import {
  DEFAULT_BROWSER_SETTINGS,
  parseBrowserSettings,
  resolveBrowserUserAgent,
  type BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
} from "@minke/harness-overlay/web-search-settings-contract";
import { DesktopQuitConfirmation } from "./quit-confirmation.ts";
import { DesktopFatalRecovery } from "./fatal-recovery.ts";
import { RendererConsoleTail, writeDesktopCrashReport, type DesktopFailureSource } from "./crash-report.ts";
import { requestDesktopRestart } from "./app-restart";
import { applyLinuxPasswordStore } from "./linux-password-store.ts";
import { createLocalModelStatusProbe } from "./local-model-status.ts";
import { readLoginShellEnvironment, resolveLoginShellTimeout } from "./login-shell-environment.ts";
import {
  prepareDesktopApplication,
} from "./application-entry";
import {
  detectAppUpdateTarget,
} from "./app-update";
import { AppUpdateRuntime } from "./app-update-runtime";
import { bindDesktopUpdates } from "./desktop-updates.ts";
import { DESKTOP_UPDATE_IPC } from "@minke/harness-overlay/shared-updates-contract.ts";
import {
  AgentBrowserRuntime,
  SqliteAgentBrowserHistory,
  agentBrowserHistoryFilePath,
} from "./agent-browser";
import {
  bindAppUpdateSettingsIpc,
  type AppUpdateSettingsBinding,
} from "./app-update-settings";
import {
  bindBrowserSettingsIpc,
  type BrowserSettingsBinding,
} from "./browser-settings";
import {
  bindDataHomeSettingsIpc,
  type DataHomeSettingsBinding,
} from "./data-home-settings";
import {
  bindDirectoryPickerIpc,
  type DirectoryPickerBinding,
} from "./directory-picker";
import {
  buildDshChildEnvironment,
  DataHomeManager,
} from "./data-home";
import {
  HarnessLifecycle,
  type HarnessNavigationError,
} from "./harness-lifecycle";
import {
  HarnessRuntime,
  type HarnessRuntimeExit,
} from "./harness-runtime";
import {
  discoverLocalModelCommands,
} from "./local-model-command";
import {
  MainWindowRuntime,
} from "./main-window";
import {
  MinkeConfigStore,
} from "./minke-config";
import {
  bindModelRuntimeSettingsIpc,
  type ModelRuntimeSettingsBinding,
} from "./model-runtime-settings";
import {
  clearLegacyPluginCatalogCache,
} from "./plugin-cache";
import {
  bindPluginRecoveryIpc,
  type PluginRecoveryBinding,
} from "./plugin-recovery-ipc";
import {
  PluginRecoveryRuntime,
} from "./plugin-recovery";
import {
  bindRemoteSettingsIpc,
  type RemoteSettingsBinding,
} from "./remote-settings";
import {
  createCredentialStorage,
  createMacOSCredentialStorageHelper,
} from "./credential-storage";
import {
  bindRemoteHubIpc,
  createDiscordNetworkWebSocketPort,
  DiscordNetworkRuntime,
  type RemoteHubBinding,
  RemoteHubCapabilityRuntime,
  RemoteHubCredentialVault,
  TelegramNetworkRuntime,
} from "./remote-hub";
import {
  REMOTE_HUB_CHANGED_CHANNEL,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  externalizeAgentTurnPreviews,
} from "./remote-hub/agent-preview";
import {
  bindShortcutMenu,
  type ShortcutMenuBinding,
} from "./shortcut-menu";
import {
  bindTerminalSettingsIpc,
  type TerminalSettingsBinding,
} from "./terminal-settings";
import { migrateTerminalFontProfile } from "./profile-migration";
import {
  bindWebSearchSettingsIpc,
  type WebSearchSettingsBinding,
} from "./web-search-settings";

interface BeforeQuitEvent {
  preventDefault(): void;
}

/** Coordinates process-wide startup, recovery, and ordered shutdown. */
class DesktopApplication {
  #appUpdate: AppUpdateRuntime | undefined;
  #desktopUpdatesBinding: ReturnType<typeof bindDesktopUpdates> | undefined;
  #appUpdateSettingsBinding:
    | AppUpdateSettingsBinding
    | undefined;
  #agentBrowser: AgentBrowserRuntime | undefined;
  #browserSettingsBinding: BrowserSettingsBinding | undefined;
  #runtime: HarnessRuntime | undefined;
  #harnessLifecycle: HarnessLifecycle | undefined;
  #remoteAccess: RemoteAccessRuntime | undefined;
  #windows: MainWindowRuntime | undefined;
  #desktopLocale: DesktopLocaleRuntime | undefined;
  #shortcutMenuBinding: ShortcutMenuBinding | undefined;
  #desktopShortcuts: ReturnType<typeof installDesktopShortcuts> | undefined;
  #terminalSettingsBinding: TerminalSettingsBinding | undefined;
  #webSearchSettingsBinding:
    | WebSearchSettingsBinding
    | undefined;
  #modelRuntimeSettingsBinding:
    | ModelRuntimeSettingsBinding
    | undefined;
  #remoteSettingsBinding: RemoteSettingsBinding | undefined;
  #remoteHubBinding: RemoteHubBinding | undefined;
  #remoteHub: RemoteHubCapabilityRuntime | undefined;
  #pluginRecoveryBinding: PluginRecoveryBinding | undefined;
  #dataHomeSettingsBinding: DataHomeSettingsBinding | undefined;
  #directoryPickerBinding: DirectoryPickerBinding | undefined;
  #requestedExitCode: number | undefined;
  #quitting = false;
  #shutdownStarted = false;
  #quitAuthorized = false;
  #sessionEnding = false;
  #shutdownComplete = false;
  #stopPromise: Promise<void> | undefined;
  #restartPending = false;
  #pluginRecovery: PluginRecoveryRuntime | undefined;
  readonly #diagnostics = new Set<Promise<string>>();
  readonly #rendererConsole = new RendererConsoleTail();
  readonly #quitConfirmation = new DesktopQuitConfirmation({
    inspect: () => this.#runtime?.inspectQuit(),
    text: key => this.#desktopText(key),
    show: options => dialog.showMessageBox(options),
    focus: () => { if (process.platform === "darwin") app.focus({ steal: true }); },
  });
  readonly #recovery = new DesktopFatalRecovery({
    text: (key, params) => this.#desktopText(key, params),
    show: options => dialog.showMessageBox(options),
    writeReport: (error, source) => this.#writeDiagnostic(error, source),
    stop: () => this.#stopOwnedProcesses(),
    canEnableSafeMode: () => this.#pluginRecovery !== undefined,
    enableSafeMode: async () => {
      if (this.#pluginRecovery === undefined) throw new Error("Plugin settings are unavailable");
      await this.#pluginRecovery.setSafeMode(true);
    },
    restart: () => this.#restartApplication(),
    exit: () => { this.#quitAuthorized = true; app.quit(); },
  });
  #revealWindowWhenReady = false;
  #loginShellRead = new AbortController();

  async start(): Promise<void> {
    if (!prepareDesktopApplication(app)) return;
    applyLinuxPasswordStore(app);
    app.on("second-instance", () => this.#showMainWindow());

    await app.whenReady();
    powerMonitor.on("shutdown", () => this.#endSystemSession());
    const loginShellEnvironment = readLoginShellEnvironment(process.env, {
      homeDirectory: app.getPath("home"),
      timeoutMs: resolveLoginShellTimeout(process.env),
      signal: this.#loginShellRead.signal,
    });
    const locale = new DesktopLocaleRuntime(
      resolveDesktopLocale(app.getLocale()),
    );
    let browserHistory:
      | SqliteAgentBrowserHistory
      | undefined;
    try {
      browserHistory = new SqliteAgentBrowserHistory({
        path: agentBrowserHistoryFilePath(
          app.getPath("userData"),
        ),
      });
    } catch (error) {
      console.warn(
        "Minke Agent Browser history is unavailable:",
        error instanceof Error ? error.message : String(error),
      );
    }
    this.#desktopLocale = locale;
    const agentBrowser = new AgentBrowserRuntime({
      sessionFromPartition: (partition, options) =>
        session.fromPartition(partition, options),
      history: browserHistory,
    });
    this.#agentBrowser = agentBrowser;
    const windows = new MainWindowRuntime({
      agentBrowser,
      locale,
      attachShortcuts: window => this.#desktopShortcuts?.attach(window),
      attachGuestShortcuts: (window, guest, name) => this.#desktopShortcuts?.attachGuest(window, guest, name),
      harnessUrl: () => this.#harnessLifecycle?.url,
      attachHarness: async (window) => {
        await this.#harnessLifecycle?.attach(window);
      },
      refreshMenu: () =>
        this.#shortcutMenuBinding?.refreshBaseMenu(),
      reportFailure: error => this.#reportFailure(error, "renderer"),
      consoleError: message => this.#rendererConsole.append(message),
      canClose: () => this.#quitting || this.#sessionEnding,
      requestQuit: () => app.quit(),
      sessionEnding: () => this.#endSystemSession(),
      sessionContinuing: () => { this.#sessionEnding = false; },
    });
    this.#windows = windows;
    windows.installPermissionPolicy();

    const minkeConfig = new MinkeConfigStore(
      app.getPath("userData"),
    );
    const shortcutStore = minkeConfig.shortcuts;
    this.#desktopShortcuts = installDesktopShortcuts(
      () => windows.current, app.getPath("userData"),
      process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
      bindings => this.#shortcutMenuBinding?.updateBindings(bindings),
      event => windows.authorize(event),
      existsSync(minkeConfig.path) ? () => shortcutStore.read() : undefined,
      undefined,
      bindings => { void dialog.showMessageBox({ type: "info",
        title: this.#desktopText("shortcuts.migrationTitle"),
        message: this.#desktopText("shortcuts.migrationTitle"),
        detail: this.#desktopText("shortcuts.migrationDetail", { bindings: bindings.join("\n"), path: minkeConfig.path }),
      }).catch(error => console.error("Unable to show shortcut migration notice", error)); },
    );
    const terminalSettingsStore = minkeConfig.terminal;
    const hasLegacyTerminalSettings = existsSync(minkeConfig.path);
    const modelRuntimeSettingsStore = minkeConfig.modelRuntime;
    const remoteSettingsStore = minkeConfig.remote;
    const pluginSettingsStore = minkeConfig.plugins;
    const webSearchSettingsStore = minkeConfig.webSearch;
    const appUpdateSettingsStore = minkeConfig.appUpdate;
    const browserSettingsStore = minkeConfig.browser;
    const dataHomeManager = new DataHomeManager({
      userDataPath: app.getPath("userData"),
      homeDirectory: app.getPath("home"),
      environment: process.env,
      configuration: minkeConfig.dshHome,
      restart: () => this.#scheduleDesktopRestart(),
    });
    const migrationState =
      await dataHomeManager.completePendingMigration();
    if (migrationState?.error !== undefined) {
      console.error(
        migrationState.status === "failed"
          ? "DSH data-directory migration failed:"
          : "DSH data-directory activation remains pending:",
        migrationState.error,
      );
    }
    const activeDshHome = await dataHomeManager.activePath();
    try {
      await clearLegacyPluginCatalogCache(
        app.getPath("userData"),
      );
    } catch (error) {
      console.error(
        "Unable to clear the retired plugin catalog cache:",
        error,
      );
    }

    await windows.create();
    if (this.#recovery.active || this.#quitting) return;
    if (this.#revealWindowWhenReady) windows.show();

    const loginShell = await loginShellEnvironment;
    if (this.#quitting || this.#recovery.active) return;
    for (const failure of loginShell.failures) {
      console.warn(`Minke login shell: ${failure.shell} failed (${failure.reason})`);
    }
    const launchEnvironment = loginShell.environment;
    const activeDshEnvironment = buildDshChildEnvironment(activeDshHome, launchEnvironment);

    const pluginRecovery = new PluginRecoveryRuntime({
      runtimeRoot: this.#runtimeRoot(),
      dshHome: activeDshHome,
      electronExecutable: process.execPath,
      environment: activeDshEnvironment,
      settings: pluginSettingsStore,
    });
    this.#pluginRecovery = pluginRecovery;
    const localModelCommands = await discoverLocalModelCommands({
      homeDirectory: app.getPath("home"),
      pathValue: launchEnvironment.PATH,
      platform: process.platform,
      ...(process.env.LOCALAPPDATA === undefined
        ? {}
        : { localAppData: process.env.LOCALAPPDATA }),
    });
    const discoverRemote = () =>
      discoverRemoteCommands({
        homeDirectory: app.getPath("home"),
        pathValue: launchEnvironment.PATH,
        platform: process.platform,
        ...(process.env.LOCALAPPDATA === undefined
          ? {}
          : { localAppData: process.env.LOCALAPPDATA }),
        ...(process.env.ProgramFiles === undefined
          ? {}
          : { programFiles: process.env.ProgramFiles }),
      });
    const modelRuntimeAvailability = {
      lmStudio: localModelCommands.lmStudio !== undefined,
      ollama: localModelCommands.ollama !== undefined,
    };
    let modelRuntimeSettings = {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    };
    let remoteSettings: RemoteSettings = {
      enabled: DEFAULT_REMOTE_SETTINGS.enabled,
      method: DEFAULT_REMOTE_SETTINGS.method,
      tailscale: { ...DEFAULT_REMOTE_SETTINGS.tailscale },
      cloudflare: { ...DEFAULT_REMOTE_SETTINGS.cloudflare },
    };
    let pluginManagement = {
      safeMode: false,
      disabledPlugins: [] as readonly string[],
    };
    let webSearchSettings = {
      ...DEFAULT_WEB_SEARCH_SETTINGS,
    };
    let appUpdateSettings = {
      ...DEFAULT_APP_UPDATE_SETTINGS,
    };
    let browserSettings: BrowserSettings = {
      ...DEFAULT_BROWSER_SETTINGS,
    };
    try {
      modelRuntimeSettings =
        await modelRuntimeSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read model runtime settings:",
        error,
      );
    }
    try {
      remoteSettings = await remoteSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read remote access settings:",
        error,
      );
    }
    // Complete migration before composing the Profile; a failure must not
    // start previously disabled third-party code.
    pluginManagement = await pluginRecovery.migrateLegacyProfile();
    await migrateTerminalFontProfile({
      runtimeRoot: this.#runtimeRoot(),
      dshHome: activeDshHome,
      electronExecutable: process.execPath,
      environment: activeDshEnvironment,
    }, hasLegacyTerminalSettings ? await terminalSettingsStore.read() : undefined);
    try {
      webSearchSettings = await webSearchSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read web search settings:",
        error,
      );
    }
    try {
      appUpdateSettings = await appUpdateSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read app update settings:",
        error,
      );
    }
    try {
      browserSettings = await browserSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read browser identity settings:",
        error,
      );
    }

    const sourceUserAgent = windows.getUserAgent();
    const applyBrowserSettings = (
      value: BrowserSettings,
    ): void => {
      const settings = parseBrowserSettings(value);
      windows.setWebUserAgent(
        resolveBrowserUserAgent(
          settings.webUserAgent,
          sourceUserAgent,
        ),
      );
      agentBrowser.setUserAgent(
        resolveBrowserUserAgent(
          settings.agentUserAgent,
          sourceUserAgent,
        ),
      );
      browserSettings = settings;
    };
    applyBrowserSettings(browserSettings);

    this.#directoryPickerBinding = bindDirectoryPickerIpc(ipcMain, {
      currentWindow: () => windows.current,
      authorize: (candidate) => windows.authorize(candidate as IpcMainInvokeEvent),
      showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
    });
    this.#shortcutMenuBinding = bindShortcutMenu(
      Menu,
      locale,
      {},
      (id) => {
        windows.show();
        this.#desktopShortcuts?.invoke(id);
      },
      process.platform,
      label => (this.#desktopShortcuts!.fileMenu({ fileMenu: "", closePage: label }).submenu as Electron.MenuItemConstructorOptions[])[0]!,
    );
    this.#terminalSettingsBinding = bindTerminalSettingsIpc(
      ipcMain,
      terminalSettingsStore,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    this.#webSearchSettingsBinding = bindWebSearchSettingsIpc(
      ipcMain,
      webSearchSettingsStore,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    this.#browserSettingsBinding = bindBrowserSettingsIpc(
      ipcMain,
      browserSettingsStore,
      applyBrowserSettings,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    this.#pluginRecoveryBinding = bindPluginRecoveryIpc(
      ipcMain,
      pluginRecovery,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
      () => this.#scheduleDesktopRestart(),
    );
    this.#dataHomeSettingsBinding = bindDataHomeSettingsIpc(
      ipcMain,
      dataHomeManager,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    this.#appUpdateSettingsBinding =
      bindAppUpdateSettingsIpc(
        ipcMain,
        appUpdateSettingsStore,
        (settings) => {
          appUpdateSettings = settings;
          this.#appUpdate?.setAutoDownload(
            settings.autoDownload,
          );
        },
        (candidate) =>
          windows.authorize(
            candidate as IpcMainInvokeEvent,
          ),
      );

    this.#desktopUpdatesBinding = bindDesktopUpdates(ipcMain, {
      status: () => this.#appUpdate?.status() ?? { phase: "idle" },
      open: async () => {
        if (this.#appUpdate !== undefined) await this.#appUpdate.open();
        else {
          const options = { type: "info" as const, title: this.#desktopText("update.availableTitle"),
            message: this.#desktopText("update.unavailable") };
          const owner = windows.current;
          if (owner === undefined || owner.isDestroyed()) await dialog.showMessageBox(options);
          else await dialog.showMessageBox(owner, options);
        }
      },
    }, event => windows.authorize(event));

    if (this.#quitting || this.#recovery.active) return;
    const runtime = new HarnessRuntime({
      runtimeRoot: this.#runtimeRoot(),
      dshHome: activeDshHome,
      electronExecutable: process.execPath,
      environment: activeDshEnvironment,
      modelRuntimes: {
        lmStudio: {
          enabled:
            modelRuntimeSettings.lmStudio.enabled &&
            modelRuntimeAvailability.lmStudio,
          ...(localModelCommands.lmStudio === undefined
            ? {}
            : { command: localModelCommands.lmStudio }),
        },
        ollama: {
          enabled:
            modelRuntimeSettings.ollama.enabled &&
            modelRuntimeAvailability.ollama,
          ...(localModelCommands.ollama === undefined
            ? {}
            : { command: localModelCommands.ollama }),
        },
      },
      pluginManagement,
      webSearch: webSearchSettings,
      agentBrowser,
      onShutdownDiagnostic: error => this.#reportFailure(error, "host"),
      onUnexpectedExit: (exit) => {
        void this.#handleUnexpectedExit(exit);
      },
    });
    this.#runtime = runtime;
    this.#modelRuntimeSettingsBinding =
      bindModelRuntimeSettingsIpc(
        ipcMain,
        modelRuntimeSettingsStore,
        modelRuntimeAvailability,
        (candidate) =>
          windows.authorize(
            candidate as IpcMainInvokeEvent,
          ),
        async (settings, mode, runtimeId) => {
          await runtime.reconfigureModelRuntimes(
            settings,
            mode,
            runtimeId,
          );
        },
        createLocalModelStatusProbe(localModelCommands, { environment: launchEnvironment }),
      );
    const remoteAccess = new RemoteAccessRuntime({
      settings: remoteSettings,
      discoverCommands: discoverRemote,
      environment: launchEnvironment,
      replaceTrustedHosts: (trustedHosts) =>
        runtime.replaceTrustedHosts(trustedHosts),
    });
    this.#remoteAccess = remoteAccess;
    this.#remoteSettingsBinding = bindRemoteSettingsIpc(
      ipcMain,
      remoteSettingsStore,
      remoteAccess,
      (snapshot) => {
        const window = windows.current;
        if (
          window === undefined ||
          window.isDestroyed() ||
          window.webContents.isDestroyed()
        ) {
          return;
        }
        window.webContents.send(
          REMOTE_RUNTIME_CHANGED_CHANNEL,
          snapshot,
        );
      },
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    const telegramNetworkSession = session.fromPartition(
      "minke:telegram-bot-api",
      { cache: false },
    );
    const telegramNetwork = new TelegramNetworkRuntime({
      store: minkeConfig.telegramNetwork,
      session: {
        fetch: (input, init) =>
          telegramNetworkSession.fetch(
            input instanceof URL ? input.href : input,
            {
              ...init,
              bypassCustomProtocolHandlers: true,
            },
          ),
        setProxy: (config) =>
          telegramNetworkSession.setProxy(config),
        closeAllConnections: () =>
          telegramNetworkSession.closeAllConnections(),
      },
    });
    const discordNetworkSession = session.fromPartition(
      "minke:discord-bot-api",
      { cache: false },
    );
    const discordNetwork = new DiscordNetworkRuntime({
      fallbackProxyUrl: () =>
        telegramNetwork.getSnapshot().httpProxyUrl,
      store: minkeConfig.discordNetwork,
      webSocket: createDiscordNetworkWebSocketPort(),
      session: {
        fetch: (input, init) =>
          discordNetworkSession.fetch(
            input instanceof URL ? input.href : input,
            {
              ...init,
              bypassCustomProtocolHandlers: true,
            },
          ),
        setProxy: (config) =>
          discordNetworkSession.setProxy(config),
        closeAllConnections: () =>
          discordNetworkSession.closeAllConnections(),
        resolveProxy: (url) =>
          discordNetworkSession.resolveProxy(url),
      },
    });
    const remoteHub = new RemoteHubCapabilityRuntime({
      dataHome: activeDshHome,
      credentialAccessMode:
        process.platform === "win32"
          ? "automatic"
          : "explicit",
      vault: new RemoteHubCredentialVault(
        app.getPath("userData"),
        createCredentialStorage(() => safeStorage, {
          macOSHelper:
            process.platform === "darwin"
              ? createMacOSCredentialStorageHelper({
                  appPath: app.getAppPath(),
                  defaultApp:
                    process.defaultApp === true,
                  executablePath: process.execPath,
                })
              : undefined,
        }),
      ),
      credentialClipboard: {
        writeText: (value) => clipboard.writeText(value),
      },
      telegramFetch: telegramNetwork.fetch,
      telegramNetwork,
      discordFetch: discordNetwork.fetch,
      discordNetwork,
      discordWebSocketFactory:
        discordNetwork.webSocketFactory,
      agentRoute: {
        runAgentTurn: async (input, options) =>
          externalizeAgentTurnPreviews(
            await runtime.runAgentTurn(input, options),
            remoteAccess.read(),
          ),
      },
    });
    this.#remoteHub = remoteHub;
    this.#remoteHubBinding = bindRemoteHubIpc(
      ipcMain,
      remoteHub,
      (snapshot) => {
        const window = windows.current;
        if (
          window === undefined ||
          window.isDestroyed() ||
          window.webContents.isDestroyed()
        ) {
          return;
        }
        window.webContents.send(
          REMOTE_HUB_CHANGED_CHANNEL,
          snapshot,
        );
      },
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
    );
    void remoteHub.initialize();
    this.#harnessLifecycle = new HarnessLifecycle({
      runtime,
      remote: remoteAccess,
      requestNavigationRetry: (error) => this.#requestNavigationRetry(error),
    });
    await this.#startHarness();
    if (this.#quitting || this.#recovery.active) return;
    if (app.isPackaged) {
      try {
        const target = await detectAppUpdateTarget(
          process.platform,
          process.arch,
        );
        const appUpdate = new AppUpdateRuntime({
          target,
          autoDownload: appUpdateSettings.autoDownload,
          currentVersion: app.getVersion(),
          userDataPath: app.getPath("userData"),
          window: () => this.#windows?.current,
          changed: state => {
            const owner = this.#windows?.current;
            if (owner !== undefined && !owner.isDestroyed()) owner.webContents.send(DESKTOP_UPDATE_IPC.changed, state);
          },
          text: (key, params) =>
            this.#desktopText(key, params),
        });
        this.#appUpdate = appUpdate;
        appUpdate.start();
      } catch (error) {
        console.warn(
          "Minke application updates are unavailable:",
          error instanceof Error
            ? error.message
            : String(error),
        );
      }
    }

    app.on("activate", () => this.#showMainWindow());
  }

  beforeQuit(event: BeforeQuitEvent): void {
    if (this.#shutdownComplete) return;
    event.preventDefault();
    if (!this.#quitAuthorized && !this.#sessionEnding && !this.#recovery.active) {
      void this.#quitConfirmation.confirm().then(confirmed => {
        if (confirmed && !this.#quitting) {
          this.#quitAuthorized = true;
          app.quit();
        }
      }).catch(error => console.error("Unable to confirm quit", error));
      return;
    }
    this.#quitConfirmation.dispose();
    this.#recovery.dispose();
    if (this.#shutdownStarted) return;
    this.#shutdownStarted = true;
    void this.#stopOwnedProcesses().catch(error => {
      this.#reportFailure(error, "shutdown");
    }).finally(async () => {
      await this.#flushDiagnostics();
      this.#shutdownComplete = true;
      if (this.#requestedExitCode === undefined) app.quit();
      else app.exit(this.#requestedExitCode);
    });
  }

  #stopOwnedProcesses(): Promise<void> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    this.#quitting = true;
    this.#loginShellRead.abort();
    this.#disposeApplicationBindings();
    const operation = (async () => {
      try {
        await this.#remoteHub?.dispose();
      } finally {
        try {
          await this.#remoteAccess?.stop();
        } finally {
          try {
            await this.#runtime?.stop();
          } finally {
            this.#agentBrowser?.dispose();
            this.#agentBrowser = undefined;
          }
        }
      }
    })();
    this.#stopPromise = operation;
    void operation.catch(() => {
      if (this.#stopPromise === operation) this.#stopPromise = undefined;
    });
    return operation;
  }

  #endSystemSession(): void {
    this.#sessionEnding = true;
    this.#quitConfirmation.cancelPending();
  }

  windowAllClosed(): void {
    if (process.platform !== "darwin") app.quit();
  }

  reportStartupFailure(error: unknown): void {
    this.#reportFailure(error, "startup");
  }

  #reportFailure(error: unknown, source: DesktopFailureSource): void {
    if (this.#quitting || this.#sessionEnding) {
      void this.#writeDiagnostic(error, source).catch(failure => console.error("Unable to write shutdown diagnostics", failure));
      return;
    }
    if (this.#recovery.active) return;
    this.#quitConfirmation.dispose();
    const reporting = app.isReady()
      ? this.#recovery.report(error, source)
      : app.whenReady().then(() => this.#recovery.report(error, source));
    void reporting.catch(failure => {
      console.error("Minke recovery failed", failure);
      this.#quitAuthorized = true;
      app.quit();
    });
  }

  #writeDiagnostic(error: unknown, source: DesktopFailureSource): Promise<string> {
    const phase = this.#quitting || this.#sessionEnding ? "shutdown"
      : this.#harnessLifecycle?.url === undefined ? "startup" : "running";
    const report = writeDesktopCrashReport(join(app.getPath("userData"), "logs"), error, source,
      this.#rendererConsole.snapshot(), app.getVersion(), new Date(), phase);
    this.#diagnostics.add(report);
    void report.then(() => this.#diagnostics.delete(report), () => this.#diagnostics.delete(report));
    return report;
  }

  async #flushDiagnostics(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.allSettled([...this.#diagnostics]),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); })]);
    } finally { clearTimeout(timer); }
  }

  #desktopText(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string {
    return this.#desktopLocale?.t(key, params) ??
      translateDesktop("en", key, params);
  }

  #runtimeRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "host")
      : join(app.getAppPath(), "runtime", "host");
  }

  #scheduleDesktopRestart(): void {
    if (this.#restartPending || this.#quitting) return;
    this.#restartPending = true;
    setTimeout(() => {
      void this.#quitConfirmation.confirm("restart").then(confirmed => {
        if (confirmed && !this.#quitting) this.#restartApplication();
      }).catch(error => console.error("Unable to confirm restart", error))
        .finally(() => { this.#restartPending = false; });
    }, 100);
  }

  #restartApplication(): void {
    this.#quitAuthorized = true;
    requestDesktopRestart(app, exitCode => { this.#requestedExitCode = exitCode; });
  }

  #showMainWindow(): void {
    const windows = this.#windows;
    if (windows === undefined) {
      this.#revealWindowWhenReady = true;
      return;
    }
    windows.show();
  }

  async #startHarness(): Promise<void> {
    if (this.#quitting || this.#recovery.active) return;
    await this.#harnessLifecycle?.start(
      this.#windows?.current,
    );
  }

  async #requestNavigationRetry(error: HarnessNavigationError): Promise<boolean> {
    if (this.#recovery.active || this.#quitting) return false;
    const window = this.#windows?.current;
    if (this.#quitting || window === undefined || window.isDestroyed()) {
      return false;
    }
    const result = await dialog.showMessageBox(window, {
      type: "error",
      title: this.#desktopText("runtime.navigationFailedTitle"),
      message: this.#desktopText("runtime.navigationFailedMessage"),
      detail: error.message,
      buttons: [
        this.#desktopText("runtime.retryNavigation"),
        this.#desktopText("runtime.quit"),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (this.#quitting || this.#recovery.active) return false;
    if (result.response === 0 && !window.isDestroyed()) return true;
    // This dialog already obtained the quit decision.
    this.#quitAuthorized = true;
    app.quit();
    return false;
  }

  #handleUnexpectedExit(exit: HarnessRuntimeExit): void {
    this.#harnessLifecycle?.clear();
    this.#reportFailure(new Error(
      `Harness exited (code ${String(exit.code)}, signal ${String(exit.signal)})\n${exit.output}`,
    ), "host");
  }

  #disposeApplicationBindings(): void {
    this.#appUpdate?.dispose();
    this.#appUpdate = undefined;
    this.#desktopUpdatesBinding?.dispose();
    this.#desktopUpdatesBinding = undefined;
    this.#appUpdateSettingsBinding?.dispose();
    this.#appUpdateSettingsBinding = undefined;
    this.#shortcutMenuBinding?.dispose();
    this.#shortcutMenuBinding = undefined;
    this.#desktopShortcuts?.dispose();
    this.#desktopShortcuts = undefined;
    this.#terminalSettingsBinding?.dispose();
    this.#terminalSettingsBinding = undefined;
    this.#webSearchSettingsBinding?.dispose();
    this.#webSearchSettingsBinding = undefined;
    this.#browserSettingsBinding?.dispose();
    this.#browserSettingsBinding = undefined;
    this.#modelRuntimeSettingsBinding?.dispose();
    this.#modelRuntimeSettingsBinding = undefined;
    this.#remoteSettingsBinding?.dispose();
    this.#remoteSettingsBinding = undefined;
    this.#remoteHubBinding?.dispose();
    this.#remoteHubBinding = undefined;
    this.#pluginRecoveryBinding?.dispose();
    this.#pluginRecoveryBinding = undefined;
    this.#dataHomeSettingsBinding?.dispose();
    this.#dataHomeSettingsBinding = undefined;
    this.#directoryPickerBinding?.dispose();
    this.#directoryPickerBinding = undefined;
  }
}

export function runDesktopApplication(): void {
  const application = new DesktopApplication();
  app.on(
    "before-quit",
    (event) => application.beforeQuit(event),
  );
  app.on(
    "window-all-closed",
    () => application.windowAllClosed(),
  );
  void application.start().catch((error: unknown) => {
    application.reportStartupFailure(error);
  });
}
