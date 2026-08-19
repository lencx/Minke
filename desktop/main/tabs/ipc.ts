import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  WebPreferences,
} from "electron";
import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import {
  TABS_OPEN_EXTERNAL_CHANNEL,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  parseFileManagerListRequest,
  parseFileManagerOpenRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerUnwatchRequest,
  parseFileManagerWatchRequest,
  parseFileManagerWriteRequest,
  TABS_FILES_CHANGE_CHANNEL,
  TABS_FILES_LIST_CHANNEL,
  TABS_FILES_OPEN_CHANNEL,
  TABS_FILES_PREVIEW_CHANNEL,
  TABS_FILES_UNWATCH_CHANNEL,
  TABS_FILES_WATCH_CHANNEL,
  TABS_FILES_WRITE_CHANNEL,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  TABS_TERMINAL_CLOSE_CHANNEL,
  TABS_TERMINAL_CREATE_CHANNEL,
  TABS_TERMINAL_EVENT_CHANNEL,
  TABS_TERMINAL_RESIZE_CHANNEL,
  TABS_TERMINAL_WRITE_CHANNEL,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import {
  FileManagerRuntime,
} from "./files.ts";
import {
  FileWatchRuntime,
} from "./file-watch.ts";
import {
  openNormalizedTabExternally,
  protectTabWebviewGuest,
  secureTabWebview,
} from "./security.ts";
import type {
  ExternalPathOpener,
  ExternalTabOpener,
  TabsAuthorization,
  TabsBinding,
} from "./types.ts";
import {
  loadTerminalPty,
  TerminalSessionRuntime,
} from "./terminal.ts";

interface TabsBindingOptions {
  readonly runtimeRoot: string;
  readonly defaultCwd: string;
  readonly fileSystemRoot: string;
  readonly environment: NodeJS.ProcessEnv;
}

async function resolveTerminalCwd(candidate: string): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new TypeError("terminal working directory must be absolute");
  }
  const details = await stat(candidate);
  if (!details.isDirectory()) {
    throw new TypeError("terminal working directory must be a directory");
  }
  return candidate;
}

function defaultTerminalShell(): {
  shell: string;
  args: readonly string[];
} {
  if (process.platform === "win32") {
    return {
      shell: process.env.COMSPEC ?? "cmd.exe",
      args: [],
    };
  }
  return {
    shell: process.env.SHELL ?? "/bin/zsh",
    args: ["-l"],
  };
}

/**
 * Bind the trusted main-process half of the Web tab adapter.
 * Renderer requests are accepted only from the active Harness document.
 */
export function bindTabs(
  ipc: Pick<
    IpcMain,
    "handle" | "on" | "removeHandler" | "removeListener"
  >,
  embedder: WebContents,
  external: ExternalTabOpener & ExternalPathOpener,
  authorize: TabsAuthorization,
  options: TabsBindingOptions,
): TabsBinding {
  const terminalShell = defaultTerminalShell();
  const terminal = new TerminalSessionRuntime({
    pty: loadTerminalPty(options.runtimeRoot),
    shell: terminalShell.shell,
    shellArgs: terminalShell.args,
    defaultCwd: options.defaultCwd,
    environment: options.environment,
    resolveCwd: resolveTerminalCwd,
    send: (event) => {
      if (!embedder.isDestroyed()) {
        embedder.send(TABS_TERMINAL_EVENT_CHANNEL, event);
      }
    },
  });
  const files = new FileManagerRuntime({
    rootPath: options.fileSystemRoot,
    openPath: (path) => external.openPath(path),
  });
  const fileWatch = new FileWatchRuntime({
    send: (event) => {
      if (!embedder.isDestroyed()) {
        embedder.send(TABS_FILES_CHANGE_CHANNEL, event);
      }
    },
  });
  const handleWillAttach = (
    event: Electron.Event,
    webPreferences: WebPreferences,
    params: Record<string, string>,
  ): void => {
    if (!secureTabWebview(webPreferences, params)) {
      event.preventDefault();
    }
  };
  const handleDidAttach = (
    _event: Electron.Event,
    guest: WebContents,
  ): void => {
    protectTabWebviewGuest(guest, external);
  };
  const handleOpenExternal = (
    event: IpcMainEvent,
    candidate: unknown,
  ): void => {
    if (!authorize(event)) return;
    openNormalizedTabExternally(external, candidate);
  };
  const handleTerminalCreate = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Terminal request");
    }
    return await terminal.create(
      parseTerminalCreateRequest(request),
    );
  };
  const handleTerminalWrite = (
    event: IpcMainEvent,
    request: unknown,
  ): void => {
    if (!authorize(event)) return;
    try {
      terminal.write(parseTerminalWriteRequest(request));
    } catch {
      // Invalid high-frequency input is ignored at the trusted boundary.
    }
  };
  const handleTerminalResize = (
    event: IpcMainEvent,
    request: unknown,
  ): void => {
    if (!authorize(event)) return;
    try {
      terminal.resize(parseTerminalResizeRequest(request));
    } catch {
      // Invalid resize traffic is ignored at the trusted boundary.
    }
  };
  const handleTerminalClose = (
    event: IpcMainEvent,
    sessionId: unknown,
  ): void => {
    if (!authorize(event)) return;
    try {
      terminal.close(parseTerminalSessionId(sessionId));
    } catch {
      // Invalid close traffic is ignored at the trusted boundary.
    }
  };
  const handleFilesList = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    return await files.list(
      parseFileManagerListRequest(request),
    );
  };
  const handleFilesOpen = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<void> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    await files.open(parseFileManagerOpenRequest(request));
  };
  const handleFilesPreview = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    return await files.preview(
      parseFileManagerPreviewRequest(request),
    );
  };
  const handleFilesWrite = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    return await files.write(
      parseFileManagerWriteRequest(request),
    );
  };
  const handleFilesWatch = (
    event: IpcMainEvent,
    request: unknown,
  ): void => {
    if (!authorize(event)) return;
    try {
      fileWatch.watch(parseFileManagerWatchRequest(request));
    } catch {
      // Invalid or unavailable watch targets do not affect other Files tabs.
    }
  };
  const handleFilesUnwatch = (
    event: IpcMainEvent,
    request: unknown,
  ): void => {
    if (!authorize(event)) return;
    try {
      fileWatch.unwatch(parseFileManagerUnwatchRequest(request));
    } catch {
      // Invalid watcher ids cannot own a main-process filesystem watcher.
    }
  };

  embedder.on("will-attach-webview", handleWillAttach);
  embedder.on("did-attach-webview", handleDidAttach);
  ipc.on(TABS_OPEN_EXTERNAL_CHANNEL, handleOpenExternal);
  ipc.handle(TABS_TERMINAL_CREATE_CHANNEL, handleTerminalCreate);
  ipc.on(TABS_TERMINAL_WRITE_CHANNEL, handleTerminalWrite);
  ipc.on(TABS_TERMINAL_RESIZE_CHANNEL, handleTerminalResize);
  ipc.on(TABS_TERMINAL_CLOSE_CHANNEL, handleTerminalClose);
  ipc.handle(TABS_FILES_LIST_CHANNEL, handleFilesList);
  ipc.handle(TABS_FILES_OPEN_CHANNEL, handleFilesOpen);
  ipc.handle(TABS_FILES_PREVIEW_CHANNEL, handleFilesPreview);
  ipc.handle(TABS_FILES_WRITE_CHANNEL, handleFilesWrite);
  ipc.on(TABS_FILES_WATCH_CHANNEL, handleFilesWatch);
  ipc.on(TABS_FILES_UNWATCH_CHANNEL, handleFilesUnwatch);

  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      embedder.removeListener("will-attach-webview", handleWillAttach);
      embedder.removeListener("did-attach-webview", handleDidAttach);
      ipc.removeListener(
        TABS_OPEN_EXTERNAL_CHANNEL,
        handleOpenExternal,
      );
      ipc.removeHandler(TABS_TERMINAL_CREATE_CHANNEL);
      ipc.removeListener(
        TABS_TERMINAL_WRITE_CHANNEL,
        handleTerminalWrite,
      );
      ipc.removeListener(
        TABS_TERMINAL_RESIZE_CHANNEL,
        handleTerminalResize,
      );
      ipc.removeListener(
        TABS_TERMINAL_CLOSE_CHANNEL,
        handleTerminalClose,
      );
      ipc.removeHandler(TABS_FILES_LIST_CHANNEL);
      ipc.removeHandler(TABS_FILES_OPEN_CHANNEL);
      ipc.removeHandler(TABS_FILES_PREVIEW_CHANNEL);
      ipc.removeHandler(TABS_FILES_WRITE_CHANNEL);
      ipc.removeListener(
        TABS_FILES_WATCH_CHANNEL,
        handleFilesWatch,
      );
      ipc.removeListener(
        TABS_FILES_UNWATCH_CHANNEL,
        handleFilesUnwatch,
      );
      fileWatch.dispose();
      void terminal.dispose();
    },
  };
}
