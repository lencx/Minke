import type {
  DownloadItem,
  Event as ElectronEvent,
  IpcMain,
  IpcMainInvokeEvent,
  SaveDialogOptions,
  Session,
  WebContents,
} from "electron";
import {
  parseSessionLogExportId,
  SESSION_LOG_EXPORT_CHANNEL,
  SESSION_LOG_EXPORT_PATH,
  SESSION_LOG_EXPORT_TOKEN_PARAMETER,
  sessionLogExportFilename,
} from "../../../packages/harness-overlay/src/session-export-contract.ts";

type DownloadState = "completed" | "cancelled" | "interrupted";
type DownloadDoneListener = (
  event: ElectronEvent,
  state: DownloadState,
) => void;

export interface SessionLogExportBinding {
  dispose(): void;
}

export interface SessionLogExportOptions {
  authorize(event: IpcMainInvokeEvent): boolean;
  harnessUrl(): string | undefined;
  chooseDestination(
    suggestedFilename: string,
  ): Promise<string | undefined>;
  saveDialogOptions(
    suggestedFilename: string,
  ): SaveDialogOptions;
  reportError(error: Error): void;
}

interface PendingExport {
  readonly sessionId: string;
  readonly token: string;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  destination: string | undefined;
  settled: boolean;
}

interface SessionExportDownload {
  readonly sessionId: string;
  readonly token: string | null;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function harnessOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function parseDownload(
  candidate: string,
  expectedOrigin: string | undefined,
): SessionExportDownload | undefined {
  if (expectedOrigin === undefined) return undefined;
  try {
    const url = new URL(candidate);
    if (
      url.origin !== expectedOrigin ||
      url.pathname !== SESSION_LOG_EXPORT_PATH
    ) {
      return undefined;
    }
    return {
      sessionId: parseSessionLogExportId(
        url.searchParams.get("sessionId"),
      ),
      token: url.searchParams.get(
        SESSION_LOG_EXPORT_TOKEN_PARAMETER,
      ),
    };
  } catch {
    return undefined;
  }
}

function createPending(
  sessionId: string,
  token: string,
): PendingExport {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    sessionId,
    token,
    promise,
    resolve,
    reject,
    destination: undefined,
    settled: false,
  };
}

/**
 * Own the native desktop Session-export boundary. Header requests choose an
 * explicit destination before download; the upstream `/export` command keeps
 * its browser trigger but receives native save-dialog options here.
 */
export function bindSessionLogExport(
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">,
  downloadSession: Pick<Session, "fetch" | "on" | "removeListener">,
  webContents: Pick<WebContents, "downloadURL">,
  shell: { showItemInFolder(path: string): void },
  options: SessionLogExportOptions,
): SessionLogExportBinding {
  const activeBySession = new Map<string, PendingExport>();
  const pendingByToken = new Map<string, PendingExport>();
  const downloadListeners = new Map<
    DownloadItem,
    DownloadDoneListener
  >();
  let disposed = false;
  let tokenSequence = 0;

  const release = (pending: PendingExport): void => {
    if (activeBySession.get(pending.sessionId) === pending) {
      activeBySession.delete(pending.sessionId);
    }
    if (pendingByToken.get(pending.token) === pending) {
      pendingByToken.delete(pending.token);
    }
  };

  const succeed = (pending: PendingExport): void => {
    if (pending.settled) return;
    pending.settled = true;
    release(pending);
    pending.resolve();
  };

  const report = (error: Error): void => {
    if (disposed) return;
    try {
      options.reportError(error);
    } catch (reportError) {
      console.error("Unable to present Session export failure:", reportError);
    }
  };

  const fail = (
    pending: PendingExport | undefined,
    cause: unknown,
    shouldReport = true,
  ): void => {
    const error = asError(cause);
    if (pending?.settled === true) return;
    if (pending !== undefined) {
      pending.settled = true;
      release(pending);
    }
    if (shouldReport) report(error);
    pending?.reject(error);
  };

  const reveal = (
    path: string,
    pending: PendingExport | undefined,
  ): void => {
    if (path === "") {
      fail(pending, new Error("Session export completed without a save path"));
      return;
    }
    try {
      shell.showItemInFolder(path);
      if (pending !== undefined) succeed(pending);
    } catch (error) {
      fail(pending, error);
    }
  };

  const handleWillDownload = (
    event: ElectronEvent,
    item: DownloadItem,
    source: WebContents,
  ): void => {
    if (disposed || source !== webContents) return;
    const download = parseDownload(
      item.getURL(),
      harnessOrigin(options.harnessUrl()),
    );
    if (download === undefined) return;

    const pending = download.token === null
      ? undefined
      : pendingByToken.get(download.token);
    if (
      pending !== undefined &&
      (
        pending.sessionId !== download.sessionId ||
        pending.destination === undefined
      )
    ) {
      event.preventDefault();
      fail(pending, new Error("Session export download did not match its request"));
      return;
    }

    try {
      if (pending?.destination !== undefined) {
        item.setSavePath(pending.destination);
      } else {
        item.setSaveDialogOptions(
          options.saveDialogOptions(
            sessionLogExportFilename(download.sessionId),
          ),
        );
      }
    } catch (error) {
      event.preventDefault();
      fail(pending, error);
      return;
    }

    const done: DownloadDoneListener = (_doneEvent, state) => {
      downloadListeners.delete(item);
      if (disposed) return;
      if (state === "completed") {
        reveal(
          pending?.destination ?? item.getSavePath(),
          pending,
        );
        return;
      }
      if (state === "cancelled" && pending === undefined) {
        return;
      }
      fail(
        pending,
        new Error(`Session export ${state}`),
      );
    };
    downloadListeners.set(item, done);
    item.once("done", done);
  };

  const prepare = async (pending: PendingExport): Promise<void> => {
    try {
      const origin = harnessOrigin(options.harnessUrl());
      if (origin === undefined) {
        throw new Error("Harness is unavailable");
      }
      const url = new URL(SESSION_LOG_EXPORT_PATH, origin);
      url.searchParams.set("sessionId", pending.sessionId);
      url.searchParams.set("includeDescendants", "true");
      url.searchParams.set(
        SESSION_LOG_EXPORT_TOKEN_PARAMETER,
        pending.token,
      );
      const response = await downloadSession.fetch(url.toString(), {
        method: "HEAD",
      });
      if (pending.settled || disposed) return;
      if (!response.ok) {
        throw new Error(`Session export failed: HTTP ${String(response.status)}`);
      }
      const destination = await options.chooseDestination(
        sessionLogExportFilename(pending.sessionId),
      );
      if (pending.settled || disposed) return;
      if (destination === undefined) {
        succeed(pending);
        return;
      }
      if (
        destination.length === 0 ||
        destination.includes("\u0000")
      ) {
        throw new Error("Session export destination is invalid");
      }
      pending.destination = destination;
      webContents.downloadURL(url.toString());
    } catch (error) {
      fail(pending, error);
    }
  };

  const invoke = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> => {
    if (!options.authorize(event)) {
      return Promise.reject(
        new Error("unauthorized Session export request"),
      );
    }
    let sessionId: string;
    try {
      sessionId = parseSessionLogExportId(value);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    if (disposed) {
      return Promise.reject(
        new Error("Session export binding is unavailable"),
      );
    }
    const existing = activeBySession.get(sessionId);
    if (existing !== undefined) return existing.promise;

    const token = `${Date.now().toString(36)}-${String(
      ++tokenSequence,
    )}`;
    const pending = createPending(sessionId, token);
    activeBySession.set(sessionId, pending);
    pendingByToken.set(token, pending);
    void prepare(pending);
    return pending.promise;
  };

  ipcMain.handle(SESSION_LOG_EXPORT_CHANNEL, invoke);
  downloadSession.on("will-download", handleWillDownload);

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(SESSION_LOG_EXPORT_CHANNEL);
      downloadSession.removeListener(
        "will-download",
        handleWillDownload,
      );
      for (const [item, listener] of downloadListeners) {
        item.removeListener("done", listener);
      }
      downloadListeners.clear();
      for (const pending of [...activeBySession.values()]) {
        succeed(pending);
      }
    },
  });
}
