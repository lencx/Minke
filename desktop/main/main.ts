import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import started from "electron-squirrel-startup";
import { join } from "node:path";
import {
  DesktopLocaleRuntime,
  translateDesktop,
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "../i18n";
import {
  resolveDesktopLocale,
  type DesktopLocale,
} from "../locale-contract";
import {
  HarnessRuntime,
  type HarnessRuntimeExit,
} from "./harness-runtime";
import {
  macOSWindowOptions,
} from "./macos-window";
import { bindMacOSWindowButtonSpacing } from "./macos-window-controls";
import { isInternalNavigation } from "./navigation-policy";
import {
  bindShortcutSettingsIpc,
  ShortcutSettingsStore,
  type ShortcutSettingsBinding,
} from "./shortcut-settings";
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
let shortcutSettingsBinding: ShortcutSettingsBinding | undefined;
let desktopLocale: DesktopLocaleRuntime | undefined;
let appTray: Tray | undefined;

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

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "trayTemplate.png")
    : join(app.getAppPath(), "resources", "icons", "trayTemplate.png");
}

function showMainWindow(): void {
  if (mainWindow === undefined) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function installMacOSTray(): void {
  if (process.platform !== "darwin") return;
  const image = nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) {
    throw new Error(`Tray image is missing at ${trayIconPath()}`);
  }
  image.setTemplateImage(true);
  appTray = new Tray(image);
  appTray.setToolTip(PRODUCT_NAME);
  appTray.on("click", showMainWindow);
}

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

  webContents.on("will-attach-webview", (event) => event.preventDefault());
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    icon: appIconPath(),
    width: 1280,
    height: 820,
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
      transparent: process.platform === "darwin",
    },
  });
  const windowButtonSpacing = process.platform === "darwin"
    ? bindMacOSWindowButtonSpacing(window, { platform: process.platform })
    : undefined;
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
  protectNavigation(window.webContents);
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    windowButtonSpacing?.dispose();
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
  await createWindow();
  installMacOSTray();
  const shortcutStore = new ShortcutSettingsStore(
    join(app.getPath("userData"), "settings", "shortcuts.json"),
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
  );

  runtime = new HarnessRuntime({
    runtimeRoot: runtimeRoot(),
    dataRoot: join(app.getPath("userData"), "harness"),
    electronExecutable: process.execPath,
    onUnexpectedExit: (exit) => void handleUnexpectedExit(exit),
  });
  await startHarness();

  app.on("activate", () => {
    showMainWindow();
  });
}

app.on("before-quit", (event) => {
  quitting = true;
  appTray?.destroy();
  appTray = undefined;
  shortcutSettingsBinding?.dispose();
  shortcutSettingsBinding = undefined;
  if (shutdownStarted || runtime === undefined) return;
  event.preventDefault();
  shutdownStarted = true;
  void runtime.stop().finally(() => app.quit());
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
