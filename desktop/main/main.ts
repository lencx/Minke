import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  // nativeImage,
  nativeTheme,
  session,
  shell,
  // Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type WebContents,
} from "electron";
import started from "electron-squirrel-startup";
import { join, parse } from "node:path";
import {
  DesktopLocaleRuntime,
  translateDesktop,
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "@minke/desktop/i18n";
import {
  resolveDesktopLocale,
  type DesktopLocale,
} from "@minke/desktop/locale-contract";
import {
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract";
import {
  SHORTCUT_INVOKE_CHANNEL,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract";
import { configureAppDataPaths } from "./app-data-paths";
import {
  HarnessRuntime,
  type HarnessRuntimeExit,
} from "./harness-runtime";
import { createStatefulMainWindow } from "./main-window-state";
import {
  minkeConfigFilePath,
  MinkeConfigStore,
} from "./minke-config";
import {
  discoverLocalModelCommands,
} from "./local-model-command";
import {
  bindModelRuntimeSettingsIpc,
  type ModelRuntimeSettingsBinding,
} from "./model-runtime-settings";
import {
  macOSWindowOptions,
} from "./macos-window";
import { bindMacOSWindowButtonSpacing } from "./macos-window-controls";
import { bindMainWindowDevToolsShortcut } from "./main-window-devtools";
import { isInternalNavigation } from "./navigation-policy";
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
  buildDshChildEnvironment,
  DataHomeManager,
} from "./data-home";
import { requestDesktopRestart } from "./app-restart";
import {
  bindDataHomeSettingsIpc,
  type DataHomeSettingsBinding,
} from "./data-home-settings";
import {
  bindSessionLogExport,
  type SessionLogExportBinding,
} from "./session-export";
import {
  bindTabs,
  type TabsBinding,
} from "./tabs";
import { bindWindowLocale } from "./window-locale";
import { bindWindowTheme } from "./window-theme";

const PRODUCT_NAME = "Minke";
const BACKGROUND_COLOR = "#0b1220";

let mainWindow: BrowserWindow | undefined;
let runtime: HarnessRuntime | undefined;
let harnessUrl: string | undefined;
let quitting = false;
let shutdownStarted = false;
let recovering = false;
let shortcutMenuBinding: ShortcutMenuBinding | undefined;
let shortcutSettingsBinding: ShortcutSettingsBinding | undefined;
let terminalSettingsBinding: TerminalSettingsBinding | undefined;
let modelRuntimeSettingsBinding:
  | ModelRuntimeSettingsBinding
  | undefined;
let dataHomeSettingsBinding: DataHomeSettingsBinding | undefined;
let sessionLogExportBinding: SessionLogExportBinding | undefined;
let tabsBinding: TabsBinding | undefined;
let desktopLocale: DesktopLocaleRuntime | undefined;
let activeDshEnvironment: NodeJS.ProcessEnv | undefined;
let requestedExitCode: number | undefined;
// let appTray: Tray | undefined;

function activeDesktopLocale(): DesktopLocale {
  return desktopLocale?.getSnapshot().active ?? "en";
}

function desktopText(
  key: DesktopMessageKey,
  params?: DesktopTranslateParams,
): string {
  return desktopLocale?.t(key, params) ??
    translateDesktop("en", key, params);
}

function sessionExportSaveDialogOptions(
  suggestedFilename: string,
): SaveDialogOptions {
  return {
    title: desktopText("sessionExport.saveDialogTitle"),
    defaultPath: join(
      app.getPath("downloads"),
      suggestedFilename,
    ),
    filters: [
      {
        name: desktopText("sessionExport.zipFilter"),
        extensions: ["zip"],
      },
    ],
    properties: [
      "createDirectory",
      "showOverwriteConfirmation",
    ],
  };
}

function dataHomeOpenDialogOptions(
  defaultPath: string,
): OpenDialogOptions {
  return {
    title: desktopText("dataHome.chooseDirectoryTitle"),
    defaultPath,
    buttonLabel: desktopText("dataHome.chooseDirectoryButton"),
    properties: ["openDirectory", "createDirectory"],
  };
}

function dshEnvironment(): NodeJS.ProcessEnv {
  if (activeDshEnvironment === undefined) {
    throw new Error("DSH environment was not initialized");
  }
  return activeDshEnvironment;
}

function runtimeRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "host")
    : join(app.getAppPath(), "runtime", "host");
}

function bootstrapUrl(): string | undefined {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
}

function macOSSurfaceBootstrapRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "desktop-style-extension")
    : join(app.getAppPath(), "resources", "desktop-style-extension");
}

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "resources", "icons", "icon.png");
}

// function trayIconPath(): string {
//   return app.isPackaged
//     ? join(process.resourcesPath, "trayTemplate.png")
//     : join(app.getAppPath(), "resources", "icons", "trayTemplate.png");
// }

function showMainWindow(): void {
  if (mainWindow === undefined) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function invokeShortcutAction(
  id: ProductShortcutActionId,
): Promise<void> {
  const window = mainWindow ?? await createWindow();
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (
    harnessUrl !== undefined &&
    !isHarnessUrl(window.webContents.getURL())
  ) {
    await window.loadURL(harnessUrl);
  }
  if (!isHarnessUrl(window.webContents.getURL())) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(SHORTCUT_INVOKE_CHANNEL, id);
}

// function installMacOSTray(): void {
//   if (process.platform !== "darwin") return;
//   const image = nativeImage.createFromPath(trayIconPath());
//   if (image.isEmpty()) {
//     throw new Error(`Tray image is missing at ${trayIconPath()}`);
//   }
//   image.setTemplateImage(true);
//   appTray = new Tray(image);
//   appTray.setToolTip(PRODUCT_NAME);
//   appTray.on("click", showMainWindow);
// }

async function installMacOSSurfaceBootstrap(): Promise<void> {
  if (process.platform !== "darwin") return;
  await session.defaultSession.extensions.loadExtension(
    macOSSurfaceBootstrapRoot(),
  );
}

async function loadBootstrap(window: BrowserWindow): Promise<void> {
  const developmentUrl = bootstrapUrl();
  if (developmentUrl !== undefined) {
    const url = new URL(developmentUrl);
    url.searchParams.set("locale", activeDesktopLocale());
    await window.loadURL(url.toString());
    return;
  }
  await window.loadFile(
    join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    {
      query: { locale: activeDesktopLocale() },
    },
  );
}

function isHarnessUrl(value: string): boolean {
  if (harnessUrl === undefined) return false;
  try {
    return new URL(value).origin === harnessUrl;
  } catch {
    return false;
  }
}

function canOpenExternally(value: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function protectNavigation(webContents: WebContents): void {
  webContents.on("will-navigate", (details) => {
    if (
      isInternalNavigation(
        details.url,
        [bootstrapUrl(), harnessUrl],
      )
    ) {
      return;
    }
    details.preventDefault();
    if (canOpenExternally(details.url)) {
      void shell.openExternal(details.url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isHarnessUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: BACKGROUND_COLOR,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    if (canOpenExternally(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const window = createStatefulMainWindow(
    minkeConfigFilePath(app.getPath("userData")),
    (bounds) => new BrowserWindow({
      title: PRODUCT_NAME,
      icon: appIconPath(),
      ...bounds,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: BACKGROUND_COLOR,
      ...macOSWindowOptions(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "desktop-preload.js"),
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
        transparent: process.platform === "darwin",
      },
    }),
  );
  const windowButtonSpacing = process.platform === "darwin"
    ? bindMacOSWindowButtonSpacing(window, { platform: process.platform })
    : undefined;
  bindMainWindowDevToolsShortcut(Menu);
  const windowTheme = bindWindowTheme(window, nativeTheme);
  const localeRuntime = desktopLocale;
  if (localeRuntime === undefined) {
    throw new Error("desktop locale was not initialized");
  }
  const windowLocale = bindWindowLocale(
    window,
    localeRuntime,
    (candidate) => {
      const event = candidate as IpcMainEvent;
      return (
        event.sender === window.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );
  mainWindow = window;
  shortcutMenuBinding?.refreshBaseMenu();
  protectNavigation(window.webContents);
  tabsBinding = bindTabs(
    ipcMain,
    window.webContents,
    shell,
    (candidate) => (
      candidate.sender === window.webContents &&
      candidate.senderFrame !== null &&
      isHarnessUrl(candidate.senderFrame.url)
    ),
    {
      runtimeRoot: runtimeRoot(),
      electronExecutable: process.execPath,
      defaultCwd: app.getPath("home"),
      fileSystemRoot: parse(app.getPath("home")).root,
      environment: dshEnvironment(),
    },
  );
  sessionLogExportBinding = bindSessionLogExport(
    ipcMain,
    window.webContents.session,
    window.webContents,
    shell,
    {
      authorize: (candidate) => (
        candidate.sender === window.webContents &&
        candidate.senderFrame !== null &&
        isHarnessUrl(candidate.senderFrame.url)
      ),
      harnessUrl: () => harnessUrl,
      async chooseDestination(suggestedFilename) {
        const result = await dialog.showSaveDialog(
          window,
          sessionExportSaveDialogOptions(suggestedFilename),
        );
        return result.canceled || result.filePath === ""
          ? undefined
          : result.filePath;
      },
      saveDialogOptions: sessionExportSaveDialogOptions,
      reportError(error) {
        void dialog
          .showMessageBox(window, {
            type: "error",
            title: desktopText("sessionExport.failedTitle"),
            message: desktopText("sessionExport.failedMessage"),
            detail: error.message,
            buttons: [desktopText("sessionExport.ok")],
            defaultId: 0,
            noLink: true,
          })
          .catch((dialogError: unknown) => {
            console.error(
              "Unable to show Session export error:",
              dialogError,
            );
          });
      },
    },
  );
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    windowButtonSpacing?.dispose();
    sessionLogExportBinding?.dispose();
    sessionLogExportBinding = undefined;
    tabsBinding?.dispose();
    tabsBinding = undefined;
    windowLocale.dispose();
    windowTheme.dispose();
    if (mainWindow === window) mainWindow = undefined;
  });

  await loadBootstrap(window);
  if (harnessUrl !== undefined) await window.loadURL(harnessUrl);
  return window;
}

function installPermissionPolicy(): void {
  const allows = (value: string | undefined) =>
    value !== undefined && isHarnessUrl(value);

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, _permission, requestingOrigin, details) =>
      allows(details.requestingUrl ?? requestingOrigin),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback, details) =>
      callback(allows(details.requestingUrl)),
  );

  const tabsWebSession = session.fromPartition(
    TABS_WEB_PARTITION,
  );
  tabsWebSession.setPermissionCheckHandler(() => false);
  tabsWebSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

async function startHarness(): Promise<void> {
  const activeRuntime = runtime;
  const window = mainWindow;
  if (activeRuntime === undefined || window === undefined) return;
  harnessUrl = await activeRuntime.start();
  await window.loadURL(harnessUrl);
}

async function handleUnexpectedExit(exit: HarnessRuntimeExit): Promise<void> {
  if (quitting || recovering) return;
  recovering = true;
  harnessUrl = undefined;
  console.error("Harness runtime exited unexpectedly:", exit);

  try {
    if (mainWindow !== undefined) await loadBootstrap(mainWindow);
    const detail = [
      desktopText("runtime.exitCode", {
        value: String(exit.code),
      }),
      desktopText("runtime.signal", {
        value: String(exit.signal),
      }),
      "",
      exit.output.slice(-4_000),
    ].join("\n");
    const result = await dialog.showMessageBox({
      type: "error",
      title: desktopText("runtime.stoppedTitle"),
      message: desktopText("runtime.stoppedMessage"),
      detail,
      buttons: [
        desktopText("runtime.restart"),
        desktopText("runtime.quit"),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      await startHarness();
    } else {
      app.quit();
    }
  } catch (error) {
    dialog.showErrorBox(
      desktopText("runtime.restartFailedTitle"),
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    app.quit();
  } finally {
    recovering = false;
  }
}

async function bootstrap(): Promise<void> {
  app.setName(PRODUCT_NAME);
  configureAppDataPaths(app);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    showMainWindow();
  });

  await app.whenReady();
  desktopLocale = new DesktopLocaleRuntime(
    resolveDesktopLocale(app.getLocale()),
  );
  await installMacOSSurfaceBootstrap();
  installPermissionPolicy();
  const minkeConfig = new MinkeConfigStore(app.getPath("userData"));
  const shortcutStore = minkeConfig.shortcuts;
  const terminalSettingsStore = minkeConfig.terminal;
  const modelRuntimeSettingsStore = minkeConfig.modelRuntime;
  const dataHomeManager = new DataHomeManager({
    userDataPath: app.getPath("userData"),
    homeDirectory: app.getPath("home"),
    environment: process.env,
    configuration: minkeConfig.dshHome,
    async chooseDirectory(defaultPath) {
      const options = dataHomeOpenDialogOptions(defaultPath);
      const result = mainWindow === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(mainWindow, options);
      return result.canceled
        ? undefined
        : result.filePaths[0];
    },
    restart() {
      setTimeout(() => {
        requestDesktopRestart(app, (exitCode) => {
          requestedExitCode = exitCode;
        });
      }, 100);
    },
  });
  const migrationState =
    await dataHomeManager.completePendingMigration();
  if (migrationState?.status === "failed") {
    console.error(
      "DSH data-directory migration failed:",
      migrationState.error,
    );
  }
  const activeDshHome = await dataHomeManager.activePath();
  activeDshEnvironment = buildDshChildEnvironment(
    activeDshHome,
    process.env,
  );
  const localModelCommands = await discoverLocalModelCommands({
    homeDirectory: app.getPath("home"),
    pathValue: process.env.PATH,
    platform: process.platform,
    ...(process.env.LOCALAPPDATA === undefined
      ? {}
      : { localAppData: process.env.LOCALAPPDATA }),
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
  try {
    shortcutBindings = await shortcutStore.read();
  } catch (error) {
    console.error("Unable to read native shortcut menu settings:", error);
  }
  try {
    modelRuntimeSettings = await modelRuntimeSettingsStore.read();
  } catch (error) {
    console.error("Unable to read model runtime settings:", error);
  }
  await createWindow();
  // installMacOSTray();
  shortcutMenuBinding = bindShortcutMenu(
    Menu,
    desktopLocale,
    shortcutBindings,
    (id) => {
      void invokeShortcutAction(id);
    },
  );
  shortcutSettingsBinding = bindShortcutSettingsIpc(
    ipcMain,
    shortcutStore,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
    (bindings) => shortcutMenuBinding?.updateBindings(bindings),
  );
  terminalSettingsBinding = bindTerminalSettingsIpc(
    ipcMain,
    terminalSettingsStore,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );
  modelRuntimeSettingsBinding = bindModelRuntimeSettingsIpc(
    ipcMain,
    modelRuntimeSettingsStore,
    modelRuntimeAvailability,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );
  dataHomeSettingsBinding = bindDataHomeSettingsIpc(
    ipcMain,
    dataHomeManager,
    (candidate) => {
      const event = candidate as IpcMainInvokeEvent;
      return (
        mainWindow !== undefined &&
        event.sender === mainWindow.webContents &&
        event.senderFrame !== null &&
        isHarnessUrl(event.senderFrame.url)
      );
    },
  );

  runtime = new HarnessRuntime({
    runtimeRoot: runtimeRoot(),
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
    onUnexpectedExit: (exit) => void handleUnexpectedExit(exit),
  });
  await startHarness();

  app.on("activate", () => {
    showMainWindow();
  });
}

app.on("before-quit", (event) => {
  quitting = true;
  // appTray?.destroy();
  // appTray = undefined;
  shortcutMenuBinding?.dispose();
  shortcutMenuBinding = undefined;
  shortcutSettingsBinding?.dispose();
  shortcutSettingsBinding = undefined;
  terminalSettingsBinding?.dispose();
  terminalSettingsBinding = undefined;
  modelRuntimeSettingsBinding?.dispose();
  modelRuntimeSettingsBinding = undefined;
  dataHomeSettingsBinding?.dispose();
  dataHomeSettingsBinding = undefined;
  if (shutdownStarted) return;
  if (runtime === undefined) {
    if (requestedExitCode !== undefined) {
      event.preventDefault();
      app.exit(requestedExitCode);
    }
    return;
  }
  event.preventDefault();
  shutdownStarted = true;
  void runtime.stop().finally(() => {
    if (requestedExitCode === undefined) {
      app.quit();
    } else {
      app.exit(requestedExitCode);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

if (started) {
  app.quit();
} else {
  void bootstrap().catch((error) => {
    console.error("Minke startup failed:", error);
    dialog.showErrorBox(
      desktopText("runtime.startupFailedTitle"),
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    app.quit();
  });
}
