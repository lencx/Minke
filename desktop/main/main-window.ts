import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
  type IpcMainEvent,
  type SaveDialogOptions,
} from "electron";
import { join, parse } from "node:path";
import {
  DesktopLocaleRuntime,
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "@minke/desktop/i18n";
import {
  type DesktopLocale,
} from "@minke/desktop/locale-contract";
import {
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract";
import {
  SHORTCUT_INVOKE_CHANNEL,
  type ProductShortcutActionId,
} from "@minke/harness-overlay/shortcut-contract";
import type {
  AgentBrowserRuntime,
} from "./agent-browser";
import {
  installHarnessPermissionPolicy,
} from "./harness-permission-policy";
import { bindMacOSWindowButtonSpacing } from "./macos-window-controls";
import {
  macOSWindowOptions,
} from "./macos-window";
import { bindMainWindowDevToolsShortcut } from "./main-window-devtools";
import { createStatefulMainWindow } from "./main-window-state";
import {
  minkeConfigFilePath,
} from "./minke-config";
import { isInternalNavigation } from "./navigation-policy";
import {
  bindSessionLogExport,
  type SessionLogExportBinding,
} from "./session-export";
import {
  bindTabs,
  canGrantTabWebPermission,
  type TabsBinding,
} from "./tabs";
import { bindWindowLocale } from "./window-locale";
import { bindWindowTheme } from "./window-theme";

const PRODUCT_NAME = "Minke";
const BACKGROUND_COLOR = "#0b1220";

export interface MainWindowRuntimeOptions {
  agentBrowser: AgentBrowserRuntime;
  locale: DesktopLocaleRuntime;
  environment(): NodeJS.ProcessEnv;
  harnessUrl(): string | undefined;
  attachHarness(window: BrowserWindow): Promise<void>;
  refreshMenu(): void;
}

function canOpenExternally(value: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(
      new URL(value).protocol,
    );
  } catch {
    return false;
  }
}

/**
 * Owns the desktop BrowserWindow and every binding whose lifetime is scoped
 * to that window.
 */
export class MainWindowRuntime {
  readonly #options: MainWindowRuntimeOptions;
  #window: BrowserWindow | undefined;
  #sessionLogExportBinding: SessionLogExportBinding | undefined;
  #tabsBinding: TabsBinding | undefined;

  constructor(options: MainWindowRuntimeOptions) {
    this.#options = options;
  }

  get current(): BrowserWindow | undefined {
    return this.#window;
  }

  async installSurfaceBootstrap(): Promise<void> {
    if (process.platform !== "darwin") return;
    await session.defaultSession.extensions.loadExtension(
      this.#macOSSurfaceBootstrapRoot(),
    );
  }

  installPermissionPolicy(): void {
    installHarnessPermissionPolicy(session.defaultSession, {
      harnessUrl: this.#options.harnessUrl,
      activeWebContents: () => this.#window?.webContents,
    });

    const tabsWebSession = session.fromPartition(
      TABS_WEB_PARTITION,
    );
    tabsWebSession.setPermissionCheckHandler(
      (_webContents, permission, requestingOrigin, details) =>
        canGrantTabWebPermission(
          permission,
          details.requestingUrl ?? requestingOrigin,
        ),
    );
    tabsWebSession.setPermissionRequestHandler(
      (_webContents, permission, callback, details) =>
        callback(
          canGrantTabWebPermission(
            permission,
            details.requestingUrl,
          ),
        ),
    );
  }

  show(): void {
    const window = this.#window;
    if (window === undefined) {
      void this.create();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  async create(): Promise<BrowserWindow> {
    const window = createStatefulMainWindow(
      minkeConfigFilePath(app.getPath("userData")),
      (bounds) => new BrowserWindow({
        title: PRODUCT_NAME,
        icon: this.#appIconPath(),
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
      ? bindMacOSWindowButtonSpacing(
          window,
          { platform: process.platform },
        )
      : undefined;
    bindMainWindowDevToolsShortcut(Menu);
    const windowTheme = bindWindowTheme(window, nativeTheme);
    const windowLocale = bindWindowLocale(
      window,
      this.#options.locale,
      (candidate) =>
        this.authorize(candidate as IpcMainEvent, window),
    );
    this.#window = window;
    this.#options.refreshMenu();
    this.#protectNavigation(window);

    const tabsBinding = bindTabs(
      ipcMain,
      window.webContents,
      shell,
      (candidate) => this.authorize(candidate, window),
      {
        runtimeRoot: this.#runtimeRoot(),
        electronExecutable: process.execPath,
        defaultCwd: app.getPath("home"),
        fileSystemRoot: parse(app.getPath("home")).root,
        minkeConfigPath: minkeConfigFilePath(
          app.getPath("userData"),
        ),
        environment: this.#options.environment(),
        agentBrowser: this.#options.agentBrowser,
      },
    );
    this.#tabsBinding = tabsBinding;

    const sessionLogExportBinding = bindSessionLogExport(
      ipcMain,
      window.webContents.session,
      window.webContents,
      shell,
      {
        authorize: (candidate) => this.authorize(candidate, window),
        harnessUrl: this.#options.harnessUrl,
        chooseDestination: async (suggestedFilename) => {
          const result = await dialog.showSaveDialog(
            window,
            this.#sessionExportSaveDialogOptions(
              suggestedFilename,
            ),
          );
          return result.canceled || result.filePath === ""
            ? undefined
            : result.filePath;
        },
        saveDialogOptions: (suggestedFilename) =>
          this.#sessionExportSaveDialogOptions(suggestedFilename),
        reportError: (error) => {
          void dialog
            .showMessageBox(window, {
              type: "error",
              title: this.#text("sessionExport.failedTitle"),
              message: this.#text("sessionExport.failedMessage"),
              detail: error.message,
              buttons: [this.#text("sessionExport.ok")],
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
    this.#sessionLogExportBinding = sessionLogExportBinding;

    window.once("ready-to-show", () => window.show());
    window.once("closed", () => {
      windowButtonSpacing?.dispose();
      sessionLogExportBinding.dispose();
      tabsBinding.dispose();
      windowLocale.dispose();
      windowTheme.dispose();
      if (this.#sessionLogExportBinding === sessionLogExportBinding) {
        this.#sessionLogExportBinding = undefined;
      }
      if (this.#tabsBinding === tabsBinding) {
        this.#tabsBinding = undefined;
      }
      if (this.#window === window) this.#window = undefined;
    });

    await this.#loadBootstrap(window);
    await this.#options.attachHarness(window);
    return window;
  }

  async loadBootstrap(): Promise<void> {
    const window = this.#window;
    if (window !== undefined) await this.#loadBootstrap(window);
  }

  authorize(
    candidate: Pick<IpcMainEvent, "sender" | "senderFrame">,
    window: BrowserWindow | undefined = this.#window,
  ): boolean {
    return (
      window !== undefined &&
      candidate.sender === window.webContents &&
      candidate.senderFrame !== null &&
      this.#isHarnessUrl(candidate.senderFrame.url)
    );
  }

  async invokeShortcut(
    id: ProductShortcutActionId,
  ): Promise<void> {
    const window = this.#window ?? await this.create();
    const harnessUrl = this.#options.harnessUrl();
    if (
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) {
      return;
    }
    if (
      harnessUrl !== undefined &&
      !this.#isHarnessUrl(window.webContents.getURL())
    ) {
      await window.loadURL(harnessUrl);
    }
    if (!this.#isHarnessUrl(window.webContents.getURL())) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send(SHORTCUT_INVOKE_CHANNEL, id);
  }

  #activeLocale(): DesktopLocale {
    return this.#options.locale.getSnapshot().active;
  }

  #text(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string {
    return this.#options.locale.t(key, params);
  }

  #runtimeRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "host")
      : join(app.getAppPath(), "runtime", "host");
  }

  #bootstrapUrl(): string | undefined {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
  }

  #macOSSurfaceBootstrapRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "desktop-style-extension")
      : join(
          app.getAppPath(),
          "resources",
          "desktop-style-extension",
        );
  }

  #appIconPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(
          app.getAppPath(),
          "resources",
          "icons",
          "icon.png",
        );
  }

  #sessionExportSaveDialogOptions(
    suggestedFilename: string,
  ): SaveDialogOptions {
    return {
      title: this.#text("sessionExport.saveDialogTitle"),
      defaultPath: join(
        app.getPath("downloads"),
        suggestedFilename,
      ),
      filters: [
        {
          name: this.#text("sessionExport.zipFilter"),
          extensions: ["zip"],
        },
      ],
      properties: [
        "createDirectory",
        "showOverwriteConfirmation",
      ],
    };
  }

  async #loadBootstrap(window: BrowserWindow): Promise<void> {
    const developmentUrl = this.#bootstrapUrl();
    if (developmentUrl !== undefined) {
      const url = new URL(developmentUrl);
      url.searchParams.set("locale", this.#activeLocale());
      await window.loadURL(url.toString());
      return;
    }
    await window.loadFile(
      join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
      {
        query: { locale: this.#activeLocale() },
      },
    );
  }

  #isHarnessUrl(value: string): boolean {
    const harnessUrl = this.#options.harnessUrl();
    if (harnessUrl === undefined) return false;
    try {
      return new URL(value).origin === new URL(harnessUrl).origin;
    } catch {
      return false;
    }
  }

  #protectNavigation(window: BrowserWindow): void {
    window.webContents.on("will-navigate", (details) => {
      if (
        isInternalNavigation(
          details.url,
          [this.#bootstrapUrl(), this.#options.harnessUrl()],
        )
      ) {
        return;
      }
      details.preventDefault();
      if (canOpenExternally(details.url)) {
        void shell.openExternal(details.url);
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (this.#isHarnessUrl(url)) {
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
}
