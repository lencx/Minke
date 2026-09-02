import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
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
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract";
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
import { requestDesktopRestart } from "./app-restart";
import {
  prepareDesktopApplication,
} from "./application-entry";
import {
  detectAppUpdateTarget,
} from "./app-update";
import { AppUpdateRuntime } from "./app-update-runtime";
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
  buildDshChildEnvironment,
  DataHomeManager,
} from "./data-home";
import { HarnessLifecycle } from "./harness-lifecycle";
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
  bindPluginInstallIpc,
  type PluginInstallBinding,
} from "./plugin-install";
import {
  PluginInstallationRuntime,
} from "./plugin-installation";
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
  bindShortcutSettingsIpc,
  type ShortcutSettingsBinding,
} from "./shortcut-settings";
import {
  bindTerminalSettingsIpc,
  type TerminalSettingsBinding,
} from "./terminal-settings";
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
  #activeDshEnvironment: NodeJS.ProcessEnv | undefined;
  #shortcutMenuBinding: ShortcutMenuBinding | undefined;
  #shortcutSettingsBinding: ShortcutSettingsBinding | undefined;
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
  #pluginInstallBinding: PluginInstallBinding | undefined;
  #dataHomeSettingsBinding: DataHomeSettingsBinding | undefined;
  #requestedExitCode: number | undefined;
  #quitting = false;
  #shutdownStarted = false;
  #recovering = false;
  #revealWindowWhenReady = false;

  async start(): Promise<void> {
    if (!prepareDesktopApplication(app)) return;
    app.on("second-instance", () => this.#showMainWindow());

    await app.whenReady();
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
      environment: () => this.#dshEnvironment(),
      harnessUrl: () => this.#harnessLifecycle?.url,
      attachHarness: async (window) => {
        await this.#harnessLifecycle?.attach(window);
      },
      refreshMenu: () =>
        this.#shortcutMenuBinding?.refreshBaseMenu(),
    });
    this.#windows = windows;
    windows.installPermissionPolicy();

    const minkeConfig = new MinkeConfigStore(
      app.getPath("userData"),
    );
    const shortcutStore = minkeConfig.shortcuts;
    const terminalSettingsStore = minkeConfig.terminal;
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
      chooseDirectory: async (defaultPath) => {
        const options = this.#dataHomeOpenDialogOptions(
          defaultPath,
        );
        const window = windows.current;
        const result = window === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(window, options);
        return result.canceled
          ? undefined
          : result.filePaths[0];
      },
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
    const activeDshEnvironment = buildDshChildEnvironment(
      activeDshHome,
      process.env,
    );
    this.#activeDshEnvironment = activeDshEnvironment;
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
    if (this.#revealWindowWhenReady) windows.show();

    const pluginInstallation = new PluginInstallationRuntime({
      runtimeRoot: this.#runtimeRoot(),
      dshHome: activeDshHome,
      electronExecutable: process.execPath,
      environment: activeDshEnvironment,
      settings: pluginSettingsStore,
    });
    const localModelCommands = await discoverLocalModelCommands({
      homeDirectory: app.getPath("home"),
      pathValue: process.env.PATH,
      platform: process.platform,
      ...(process.env.LOCALAPPDATA === undefined
        ? {}
        : { localAppData: process.env.LOCALAPPDATA }),
    });
    const discoverRemote = () =>
      discoverRemoteCommands({
        homeDirectory: app.getPath("home"),
        pathValue: process.env.PATH,
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
    let shortcutBindings: ShortcutBindings = {};
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
      shortcutBindings = await shortcutStore.read();
    } catch (error) {
      console.error(
        "Unable to read native shortcut menu settings:",
        error,
      );
    }
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
    try {
      pluginManagement = await pluginSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read plugin management settings:",
        error,
      );
    }
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

    this.#shortcutMenuBinding = bindShortcutMenu(
      Menu,
      locale,
      shortcutBindings,
      (id) => {
        void windows.invokeShortcut(id);
      },
    );
    this.#shortcutSettingsBinding = bindShortcutSettingsIpc(
      ipcMain,
      shortcutStore,
      (candidate) =>
        windows.authorize(
          candidate as IpcMainInvokeEvent,
        ),
      (bindings) =>
        this.#shortcutMenuBinding?.updateBindings(bindings),
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
    this.#pluginInstallBinding = bindPluginInstallIpc(
      ipcMain,
      pluginInstallation,
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
        async () =>
          (await this.#appUpdate?.checkNow()) ?? "unavailable",
        (candidate) =>
          windows.authorize(
            candidate as IpcMainInvokeEvent,
          ),
      );

    const runtime = new HarnessRuntime({
      runtimeRoot: this.#runtimeRoot(),
      dshHome: activeDshHome,
      electronExecutable: process.execPath,
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
        async (settings, mode) => {
          await runtime.reconfigureModelRuntimes(
            settings,
            mode,
          );
        },
      );
    const remoteAccess = new RemoteAccessRuntime({
      settings: remoteSettings,
      discoverCommands: discoverRemote,
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
    });
    await this.#startHarness();
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
    this.#quitting = true;
    this.#disposeApplicationBindings();
    if (this.#shutdownStarted) return;
    if (
      this.#runtime === undefined &&
      this.#remoteAccess === undefined &&
      this.#remoteHub === undefined
    ) {
      this.#agentBrowser?.dispose();
      this.#agentBrowser = undefined;
      if (this.#requestedExitCode !== undefined) {
        event.preventDefault();
        app.exit(this.#requestedExitCode);
      }
      return;
    }
    event.preventDefault();
    this.#shutdownStarted = true;
    const activeRuntime = this.#runtime;
    const activeRemote = this.#remoteAccess;
    const activeRemoteHub = this.#remoteHub;
    this.#remoteHub = undefined;
    void (async () => {
      try {
        await activeRemoteHub?.dispose();
      } finally {
        try {
          await activeRemote?.stop();
        } finally {
          try {
            await activeRuntime?.stop();
          } finally {
            this.#agentBrowser?.dispose();
            this.#agentBrowser = undefined;
          }
        }
      }
    })().finally(() => {
      if (this.#requestedExitCode === undefined) {
        app.quit();
      } else {
        app.exit(this.#requestedExitCode);
      }
    });
  }

  windowAllClosed(): void {
    if (process.platform !== "darwin") app.quit();
  }

  reportStartupFailure(error: unknown): void {
    if (this.#quitting) return;
    console.error("Minke startup failed:", error);
    dialog.showErrorBox(
      this.#desktopText("runtime.startupFailedTitle"),
      error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    );
    app.quit();
  }

  #desktopText(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string {
    return this.#desktopLocale?.t(key, params) ??
      translateDesktop("en", key, params);
  }

  #dataHomeOpenDialogOptions(
    defaultPath: string,
  ): OpenDialogOptions {
    return {
      title: this.#desktopText(
        "dataHome.chooseDirectoryTitle",
      ),
      defaultPath,
      buttonLabel: this.#desktopText(
        "dataHome.chooseDirectoryButton",
      ),
      properties: ["openDirectory", "createDirectory"],
    };
  }

  #dshEnvironment(): NodeJS.ProcessEnv {
    if (this.#activeDshEnvironment === undefined) {
      throw new Error("DSH environment was not initialized");
    }
    return this.#activeDshEnvironment;
  }

  #runtimeRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "host")
      : join(app.getAppPath(), "runtime", "host");
  }

  #scheduleDesktopRestart(): void {
    setTimeout(() => {
      requestDesktopRestart(app, (exitCode) => {
        this.#requestedExitCode = exitCode;
      });
    }, 100);
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
    await this.#harnessLifecycle?.start(
      this.#windows?.current,
    );
  }

  async #handleUnexpectedExit(
    exit: HarnessRuntimeExit,
  ): Promise<void> {
    if (this.#quitting || this.#recovering) return;
    this.#recovering = true;
    this.#harnessLifecycle?.clear();
    console.error(
      "Harness runtime exited unexpectedly:",
      exit,
    );

    try {
      try {
        await this.#remoteAccess?.detach();
      } catch (error) {
        console.error(
          "Remote access failed to detach:",
          error,
        );
      }
      await this.#windows?.loadBootstrap();
      const detail = [
        this.#desktopText("runtime.exitCode", {
          value: String(exit.code),
        }),
        this.#desktopText("runtime.signal", {
          value: String(exit.signal),
        }),
        "",
        exit.output.slice(-4_000),
      ].join("\n");
      const result = await dialog.showMessageBox({
        type: "error",
        title: this.#desktopText("runtime.stoppedTitle"),
        message: this.#desktopText("runtime.stoppedMessage"),
        detail,
        buttons: [
          this.#desktopText("runtime.restart"),
          this.#desktopText("runtime.quit"),
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        await this.#startHarness();
      } else {
        app.quit();
      }
    } catch (error) {
      dialog.showErrorBox(
        this.#desktopText("runtime.restartFailedTitle"),
        error instanceof Error
          ? error.stack ?? error.message
          : String(error),
      );
      app.quit();
    } finally {
      this.#recovering = false;
    }
  }

  #disposeApplicationBindings(): void {
    this.#appUpdate?.dispose();
    this.#appUpdate = undefined;
    this.#appUpdateSettingsBinding?.dispose();
    this.#appUpdateSettingsBinding = undefined;
    this.#shortcutMenuBinding?.dispose();
    this.#shortcutMenuBinding = undefined;
    this.#shortcutSettingsBinding?.dispose();
    this.#shortcutSettingsBinding = undefined;
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
    this.#pluginInstallBinding?.dispose();
    this.#pluginInstallBinding = undefined;
    this.#dataHomeSettingsBinding?.dispose();
    this.#dataHomeSettingsBinding = undefined;
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
