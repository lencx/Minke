import {
  app,
  dialog,
  ipcMain,
  Menu,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { join } from "node:path";
import {
  DEFAULT_REMOTE_SETTINGS,
  discoverRemoteCommands,
  RemoteAccessService,
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
import { requestDesktopRestart } from "./app-restart";
import {
  prepareDesktopApplication,
} from "./application-entry";
import {
  detectAppUpdateTarget,
} from "./app-update";
import { AppUpdateRuntime } from "./app-update-runtime";
import {
  bindAppUpdateSettingsIpc,
  type AppUpdateSettingsBinding,
} from "./app-update-settings";
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

interface BeforeQuitEvent {
  preventDefault(): void;
}

/** Coordinates process-wide startup, recovery, and ordered shutdown. */
class DesktopApplication {
  #appUpdate: AppUpdateRuntime | undefined;
  #appUpdateSettingsBinding:
    | AppUpdateSettingsBinding
    | undefined;
  #runtime: HarnessRuntime | undefined;
  #harnessLifecycle: HarnessLifecycle | undefined;
  #remoteAccess: RemoteAccessService | undefined;
  #windows: MainWindowRuntime | undefined;
  #desktopLocale: DesktopLocaleRuntime | undefined;
  #activeDshEnvironment: NodeJS.ProcessEnv | undefined;
  #shortcutMenuBinding: ShortcutMenuBinding | undefined;
  #shortcutSettingsBinding: ShortcutSettingsBinding | undefined;
  #terminalSettingsBinding: TerminalSettingsBinding | undefined;
  #modelRuntimeSettingsBinding:
    | ModelRuntimeSettingsBinding
    | undefined;
  #remoteSettingsBinding: RemoteSettingsBinding | undefined;
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
    this.#desktopLocale = locale;
    const windows = new MainWindowRuntime({
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
    await windows.installSurfaceBootstrap();
    windows.installPermissionPolicy();

    const minkeConfig = new MinkeConfigStore(
      app.getPath("userData"),
    );
    const shortcutStore = minkeConfig.shortcuts;
    const terminalSettingsStore = minkeConfig.terminal;
    const modelRuntimeSettingsStore = minkeConfig.modelRuntime;
    const remoteSettingsStore = minkeConfig.remote;
    const pluginSettingsStore = minkeConfig.plugins;
    const appUpdateSettingsStore = minkeConfig.appUpdate;
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
    const remoteCommands = await discoverRemoteCommands({
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
    let appUpdateSettings = {
      ...DEFAULT_APP_UPDATE_SETTINGS,
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
      appUpdateSettings = await appUpdateSettingsStore.read();
    } catch (error) {
      console.error(
        "Unable to read app update settings:",
        error,
      );
    }

    const remoteAccess = new RemoteAccessService({
      settings: remoteSettings,
      commands: remoteCommands,
    });
    this.#remoteAccess = remoteAccess;
    let remoteTrustedHosts: readonly string[] = [];
    try {
      remoteTrustedHosts = (
        await remoteAccess.prepare()
      ).trustedHosts;
    } catch (error) {
      console.error("Remote access preparation failed:", error);
    }

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
    this.#modelRuntimeSettingsBinding =
      bindModelRuntimeSettingsIpc(
        ipcMain,
        modelRuntimeSettingsStore,
        modelRuntimeAvailability,
        (candidate) =>
          windows.authorize(
            candidate as IpcMainInvokeEvent,
          ),
      );
    this.#remoteSettingsBinding = bindRemoteSettingsIpc(
      ipcMain,
      remoteSettingsStore,
      {
        tailscale: remoteCommands.tailscale !== undefined,
        cloudflare: remoteCommands.cloudflared !== undefined,
      },
      () =>
        this.#remoteAccess?.read() ?? {
          method: remoteSettings.method,
          transport:
            remoteSettings.method === "cloudflare"
              ? "access"
              : remoteSettings.tailscale.transport,
          state: "unavailable",
        },
      () => this.#scheduleDesktopRestart(),
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
      trustedHosts: remoteTrustedHosts,
      onUnexpectedExit: (exit) => {
        void this.#handleUnexpectedExit(exit);
      },
    });
    this.#runtime = runtime;
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
      this.#remoteAccess === undefined
    ) {
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
    void (async () => {
      try {
        await activeRemote?.stop();
      } finally {
        await activeRuntime?.stop();
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
        await this.#remoteAccess?.stop();
      } catch (error) {
        console.error(
          "Remote access failed to stop:",
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
    this.#modelRuntimeSettingsBinding?.dispose();
    this.#modelRuntimeSettingsBinding = undefined;
    this.#remoteSettingsBinding?.dispose();
    this.#remoteSettingsBinding = undefined;
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
