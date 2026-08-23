import {
  dialog,
  session,
  shell,
  type BrowserWindow,
  type DownloadItem,
  type MessageBoxOptions,
  type Session,
} from "electron";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import {
  type DesktopMessageKey,
  type DesktopTranslateParams,
} from "@minke/desktop/i18n";
import type {
  AppUpdateCheckResult,
} from "@minke/harness-overlay/app-update-contract";
import {
  assertTrustedDownloadUrlChain,
  fetchAppUpdate,
  type AppUpdate,
  type AppUpdateTarget,
  shouldConfirmUpdateDownload,
  verifyDownloadedUpdate,
} from "./app-update";
import { assertMacFileQuarantined } from "./macos-quarantine";
import { assertWindowsFileQuarantined } from "./windows-quarantine";

const INITIAL_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const CHECK_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_START_TIMEOUT_MS = 30_000;
const UPDATE_SESSION_PARTITION = "minke-app-update";

export interface AppUpdateRuntimeOptions {
  target: AppUpdateTarget;
  autoDownload: boolean;
  currentVersion: string;
  userDataPath: string;
  window(): BrowserWindow | undefined;
  text(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string;
}

interface VerifiedUpdateDownload {
  directory: string;
  path: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readyDetailKey(
  update: AppUpdate,
): DesktopMessageKey {
  switch (update.target.installer) {
    case "dmg":
      return "update.readyDetail.dmg";
    case "exe":
      return "update.readyDetail.exe";
    case "deb":
      return "update.readyDetail.deb";
    case "rpm":
      return "update.readyDetail.rpm";
    case "appimage":
      return "update.readyDetail.appimage";
  }
}

/**
 * Checks GitHub for a trusted desktop release and opens its verified installer.
 * Installation remains an explicit user action on every supported platform.
 */
export class AppUpdateRuntime {
  readonly #options: AppUpdateRuntimeOptions;
  readonly #downloadSession: Session;
  #initialTimer: NodeJS.Timeout | undefined;
  #interval: NodeJS.Timeout | undefined;
  #activeDownload: DownloadItem | undefined;
  #pendingDownload:
    | ((
        event: Electron.Event,
        item: DownloadItem,
      ) => void)
    | undefined;
  #offeredVersion: string | undefined;
  #checkAbort: AbortController | undefined;
  #autoDownload: boolean;
  #checking = false;
  #offering = false;
  #disposed = false;

  constructor(options: AppUpdateRuntimeOptions) {
    this.#options = options;
    this.#autoDownload = options.autoDownload;
    this.#downloadSession = session.fromPartition(
      UPDATE_SESSION_PARTITION,
      { cache: false },
    );
    this.#downloadSession.on(
      "will-download",
      this.#onWillDownload,
    );
  }

  start(): void {
    if (
      this.#disposed ||
      this.#initialTimer !== undefined ||
      this.#interval !== undefined
    ) {
      return;
    }
    this.#initialTimer = setTimeout(() => {
      this.#initialTimer = undefined;
      this.#runAutomaticCheck();
    }, INITIAL_CHECK_DELAY_MS);
    this.#initialTimer.unref();
    this.#interval = setInterval(() => {
      this.#runAutomaticCheck();
    }, CHECK_INTERVAL_MS);
    this.#interval.unref();
  }

  setAutoDownload(autoDownload: boolean): void {
    this.#autoDownload = autoDownload;
  }

  async checkNow(): Promise<AppUpdateCheckResult> {
    return await this.#checkForUpdates(true);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#initialTimer !== undefined) {
      clearTimeout(this.#initialTimer);
      this.#initialTimer = undefined;
    }
    if (this.#interval !== undefined) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
    if (
      this.#activeDownload !== undefined &&
      this.#activeDownload.getState() === "progressing"
    ) {
      this.#activeDownload.cancel();
    }
    this.#activeDownload = undefined;
    this.#pendingDownload = undefined;
    this.#checkAbort?.abort();
    this.#checkAbort = undefined;
    this.#downloadSession.removeListener(
      "will-download",
      this.#onWillDownload,
    );
    this.#setProgress(-1);
  }

  #runAutomaticCheck(): void {
    void this.#checkForUpdates(false).catch((error: unknown) => {
      if (!this.#disposed) {
        console.error("Minke update check failed:", error);
      }
    });
  }

  async #checkForUpdates(
    manual: boolean,
  ): Promise<AppUpdateCheckResult> {
    if (this.#disposed) return "unavailable";
    if (this.#checking || this.#offering) return "busy";
    this.#checking = true;
    const controller = new AbortController();
    this.#checkAbort = controller;
    const timeout = setTimeout(() => {
      controller.abort();
    }, CHECK_REQUEST_TIMEOUT_MS);
    timeout.unref();
    let update: AppUpdate | undefined;
    try {
      update = await fetchAppUpdate(
        (input, init) =>
          this.#downloadSession.fetch(input, {
            ...init,
            bypassCustomProtocolHandlers: true,
            signal: controller.signal,
          }),
        this.#options.currentVersion,
        this.#options.target,
      );
    } finally {
      clearTimeout(timeout);
      if (this.#checkAbort === controller) {
        this.#checkAbort = undefined;
      }
      this.#checking = false;
    }
    if (this.#disposed) return "unavailable";
    if (update === undefined) return "up-to-date";
    if (
      !manual &&
      this.#offeredVersion === update.version
    ) {
      return "update-available";
    }

    this.#offeredVersion = update.version;
    this.#offering = true;
    void this.#offerUpdate(update)
      .catch((error: unknown) => {
        if (!this.#disposed) {
          console.error("Minke update flow failed:", error);
        }
      })
      .finally(() => {
        this.#offering = false;
      });
    return "update-available";
  }

  async #offerUpdate(update: AppUpdate): Promise<void> {
    if (shouldConfirmUpdateDownload(this.#autoDownload)) {
      const choice = await this.#showMessageBox({
        type: "info",
        title: this.#options.text("update.availableTitle"),
        message: this.#options.text("update.availableMessage", {
          version: update.version,
        }),
        detail: this.#options.text("update.availableDetail", {
          current: this.#options.currentVersion,
        }),
        buttons: [
          this.#options.text("update.download"),
          this.#options.text("update.later"),
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0 || this.#disposed) return;
    }

    let download: VerifiedUpdateDownload | undefined;
    try {
      download = await this.#downloadAndVerify(update);
      if (this.#disposed) {
        await this.#discardDownload(download);
        return;
      }
      const appImage =
        update.target.installer === "appimage";
      const ready = await this.#showMessageBox({
        type: "info",
        title: this.#options.text("update.readyTitle"),
        message: this.#options.text("update.readyMessage", {
          version: update.version,
        }),
        detail: this.#options.text(readyDetailKey(update)),
        buttons: [
          this.#options.text(
            appImage
              ? "update.showAppImage"
              : "update.openInstaller",
          ),
          this.#options.text("update.later"),
        ],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (ready.response !== 0 || this.#disposed) {
        await this.#discardDownload(download);
        return;
      }
      await this.#openVerifiedUpdate(update, download.path);
    } catch (error) {
      if (download !== undefined) {
        await this.#discardDownload(download);
      }
      if (!this.#disposed) {
        await this.#offerBrowserFallback(update, error);
      }
    }
  }

  async #assertPlatformProvenance(
    update: AppUpdate,
    path: string,
  ): Promise<void> {
    if (update.target.platform === "darwin") {
      await assertMacFileQuarantined(path);
    } else if (update.target.platform === "win32") {
      await assertWindowsFileQuarantined(path);
    }
  }

  async #openVerifiedUpdate(
    update: AppUpdate,
    path: string,
  ): Promise<void> {
    if (update.target.installer === "appimage") {
      await chmod(path, 0o700);
    }
    await verifyDownloadedUpdate(path, update.asset);
    await this.#assertPlatformProvenance(update, path);
    if (update.target.installer === "appimage") {
      shell.showItemInFolder(path);
      return;
    }
    const openError = await shell.openPath(path);
    if (openError !== "") {
      throw new Error(openError);
    }
  }

  async #downloadAndVerify(
    update: AppUpdate,
  ): Promise<VerifiedUpdateDownload> {
    const updatesRoot = join(
      this.#options.userDataPath,
      "updates",
    );
    await mkdir(updatesRoot, {
      recursive: true,
      mode: 0o700,
    });
    const updatesRootDetails = await lstat(updatesRoot);
    if (
      !updatesRootDetails.isDirectory() ||
      updatesRootDetails.isSymbolicLink()
    ) {
      throw new TypeError(
        "application update cache is not a private directory",
      );
    }
    await chmod(updatesRoot, 0o700);
    const downloadRoot = await mkdtemp(
      join(updatesRoot, `${update.version}-`),
    );
    await chmod(downloadRoot, 0o700);
    const destination = join(
      downloadRoot,
      update.asset.name,
    );
    try {
      await this.#download(update, destination);
      await verifyDownloadedUpdate(destination, update.asset);
      await this.#assertPlatformProvenance(
        update,
        destination,
      );
      return {
        directory: downloadRoot,
        path: destination,
      };
    } catch (error) {
      await rm(downloadRoot, {
        recursive: true,
        force: true,
      });
      throw error;
    } finally {
      this.#setProgress(-1);
    }
  }

  async #discardDownload(
    download: VerifiedUpdateDownload,
  ): Promise<void> {
    try {
      await rm(download.directory, {
        recursive: true,
        force: true,
      });
    } catch (error) {
      console.error(
        "Unable to remove discarded Minke update:",
        error,
      );
    }
  }

  #download(
    update: AppUpdate,
    destination: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (
        this.#pendingDownload !== undefined ||
        this.#activeDownload !== undefined
      ) {
        reject(new Error("another update download is active"));
        return;
      }
      let policyFailure: Error | undefined;
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimeout);
        if (this.#pendingDownload === onWillDownload) {
          this.#pendingDownload = undefined;
        }
        if (error === undefined) resolve();
        else reject(error);
      };
      const onWillDownload = (
        event: Electron.Event,
        item: DownloadItem,
      ) => {
        clearTimeout(startTimeout);
        if (settled) {
          event.preventDefault();
          return;
        }
        try {
          assertTrustedDownloadUrlChain(
            update.asset.url,
            item.getURLChain(),
          );
          item.setSavePath(destination);
        } catch (error) {
          event.preventDefault();
          settle(
            error instanceof Error
              ? error
              : new Error(String(error)),
          );
          return;
        }
        this.#activeDownload = item;
        item.on("updated", () => {
          try {
            assertTrustedDownloadUrlChain(
              update.asset.url,
              item.getURLChain(),
            );
            const total = item.getTotalBytes();
            if (total !== 0 && total !== update.asset.size) {
              throw new Error(
                "update server reported an unexpected installer size",
              );
            }
            const received = item.getReceivedBytes();
            if (received > update.asset.size) {
              throw new Error(
                "update download exceeded its declared size",
              );
            }
            this.#setProgress(
              Math.min(received / update.asset.size, 1),
            );
          } catch (error) {
            policyFailure =
              error instanceof Error
                ? error
                : new Error(String(error));
            item.cancel();
          }
        });
        item.once("done", (_doneEvent, state) => {
          this.#activeDownload = undefined;
          this.#setProgress(-1);
          if (policyFailure !== undefined) {
            settle(policyFailure);
            return;
          }
          if (state !== "completed") {
            settle(
              new Error(`update download ended as ${state}`),
            );
            return;
          }
          try {
            assertTrustedDownloadUrlChain(
              update.asset.url,
              item.getURLChain(),
            );
            settle();
          } catch (error) {
            settle(
              error instanceof Error
                ? error
                : new Error(String(error)),
            );
          }
        });
      };
      const startTimeout = setTimeout(() => {
        settle(new Error("update download did not start in time"));
      }, DOWNLOAD_START_TIMEOUT_MS);
      startTimeout.unref();
      this.#pendingDownload = onWillDownload;
      try {
        this.#downloadSession.downloadURL(update.asset.url, {
          headers: {
            Accept: "application/octet-stream",
            "User-Agent": `Minke/${this.#options.currentVersion}`,
          },
        });
      } catch (error) {
        settle(
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      }
    });
  }

  readonly #onWillDownload = (
    event: Electron.Event,
    item: DownloadItem,
  ): void => {
    const pending = this.#pendingDownload;
    this.#pendingDownload = undefined;
    if (pending === undefined || this.#disposed) {
      event.preventDefault();
      return;
    }
    pending(event, item);
  };

  async #offerBrowserFallback(
    update: AppUpdate,
    error: unknown,
  ): Promise<void> {
    console.error("Minke update download failed:", error);
    const choice = await this.#showMessageBox({
      type: "error",
      title: this.#options.text("update.failedTitle"),
      message: this.#options.text("update.failedMessage"),
      detail: this.#options.text("update.failedDetail", {
        error: errorMessage(error),
      }),
      buttons: [
        this.#options.text("update.openReleasePage"),
        this.#options.text("update.cancel"),
      ],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0 || this.#disposed) return;
    await shell.openExternal(
      `https://github.com/lencx/Minke/releases/tag/${update.tag}`,
    );
  }

  #showMessageBox(
    options: MessageBoxOptions,
  ): ReturnType<typeof dialog.showMessageBox> {
    const window = this.#options.window();
    return window === undefined || window.isDestroyed()
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(window, options);
  }

  #setProgress(value: number): void {
    const window = this.#options.window();
    if (window === undefined || window.isDestroyed()) return;
    window.setProgressBar(value);
  }
}
