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
} from "../../../packages/harness-overlay/src/tabs/contract.ts";
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
} from "../../../packages/harness-overlay/src/tabs/terminal-contract.ts";
import {
  openNormalizedTabExternally,
  protectTabWebviewGuest,
  secureTabWebview,
} from "./security.ts";
import type {
  ExternalTabOpener,
  TabsAuthorization,
  TabsBinding,
} from "./types.ts";
import {
  loadTerminalPty,
  TerminalSessionRuntime,
} from "./terminal.ts";

interface TerminalBindingOptions {
  readonly runtimeRoot: string;
  readonly defaultCwd: string;
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
  external: ExternalTabOpener,
  authorize: TabsAuthorization,
  terminalOptions: TerminalBindingOptions,
): TabsBinding {
  const terminalShell = defaultTerminalShell();
  const terminal = new TerminalSessionRuntime({
    pty: loadTerminalPty(terminalOptions.runtimeRoot),
    shell: terminalShell.shell,
    shellArgs: terminalShell.args,
    defaultCwd: terminalOptions.defaultCwd,
    environment: process.env,
    resolveCwd: resolveTerminalCwd,
    send: (event) => {
      if (!embedder.isDestroyed()) {
        embedder.send(TABS_TERMINAL_EVENT_CHANNEL, event);
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

  embedder.on("will-attach-webview", handleWillAttach);
  embedder.on("did-attach-webview", handleDidAttach);
  ipc.on(TABS_OPEN_EXTERNAL_CHANNEL, handleOpenExternal);
  ipc.handle(TABS_TERMINAL_CREATE_CHANNEL, handleTerminalCreate);
  ipc.on(TABS_TERMINAL_WRITE_CHANNEL, handleTerminalWrite);
  ipc.on(TABS_TERMINAL_RESIZE_CHANNEL, handleTerminalResize);
  ipc.on(TABS_TERMINAL_CLOSE_CHANNEL, handleTerminalClose);

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
      void terminal.dispose();
    },
  };
}
