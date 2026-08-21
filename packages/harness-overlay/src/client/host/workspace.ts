import {
  MINKE_HOST_RPC_CHANNEL,
  parseMinkeHostCapabilities,
  type MinkeHostRpcEndpoint,
  type MinkeHostRpcRequest,
  type MinkeHostRpcResponse,
} from "@minke/harness-overlay/minke-host-contract.ts";
import {
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
  type TabsLayoutState,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerListResult,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  type FileManagerViewState,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalReadRequest,
  parseTerminalReadResult,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  type TerminalEvent,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import {
  desktopFilesPort,
  desktopTabsPort,
  desktopTerminalPort,
  type DesktopFilesPort,
  type DesktopTabsPort,
  type DesktopTerminalPort,
} from "../desktop/index.ts";
import type {
  HarnessClientContext,
  HarnessRpcResult,
} from "../core/context.ts";

const TABS_LAYOUT_STORAGE_KEY = "minke.host.tabs-layout.v1";
const FILES_VIEW_STORAGE_KEY = "minke.host.files-view.v1";

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Connection = HarnessClientContext["connection"];
type HostCaller = <Endpoint extends MinkeHostRpcEndpoint>(
  endpoint: Endpoint,
  payload: MinkeHostRpcRequest<Endpoint>,
  signal?: AbortSignal,
) => Promise<MinkeHostRpcResponse<Endpoint>>;

function browserStorage(): BrowserStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function rpcValue(result: HarnessRpcResult, endpoint: string): unknown {
  if (result.ok) return result.value;
  throw new Error(
    `Minke Host ${endpoint} failed (${result.error.code}): ` +
      result.error.message,
  );
}

function readStored<State>(
  storage: BrowserStorage | undefined,
  key: string,
  parse: (value: unknown) => State,
  fallback: State,
): State {
  if (storage === undefined) return fallback;
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : parse(JSON.parse(value));
  } catch {
    return fallback;
  }
}

function writeStored(
  storage: BrowserStorage | undefined,
  key: string,
  value: unknown,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser state remains best-effort in private/locked-down contexts.
  }
}

function createHostCaller(connection: Connection): HostCaller {
  let ready:
    | ReturnType<typeof parseMinkeHostCapabilities>
    | Promise<ReturnType<typeof parseMinkeHostCapabilities>>
    | undefined;
  const ensureReady = () => {
    ready ??= connection.rpc
      .call(MINKE_HOST_RPC_CHANNEL, "capabilities", {})
      .then((result) =>
        parseMinkeHostCapabilities(
          rpcValue(result, "capabilities"),
        ));
    return Promise.resolve(ready);
  };
  return async <Endpoint extends MinkeHostRpcEndpoint>(
    endpoint: Endpoint,
    payload: MinkeHostRpcRequest<Endpoint>,
    signal?: AbortSignal,
  ): Promise<MinkeHostRpcResponse<Endpoint>> => {
    await ensureReady();
    return rpcValue(
      await connection.rpc.call(
        MINKE_HOST_RPC_CHANNEL,
        endpoint,
        payload,
        signal,
      ),
      endpoint,
    ) as MinkeHostRpcResponse<Endpoint>;
  };
}

/** Client-owned Tabs state for a normal browser projection. */
export function browserTabsPort(
  storage: BrowserStorage | undefined = browserStorage(),
): DesktopTabsPort {
  let state = readStored(
    storage,
    TABS_LAYOUT_STORAGE_KEY,
    parseTabsLayoutState,
    {},
  );
  return {
    available: true,
    embeddedWebAvailable: false,
    async readLayoutState() {
      return { ...state };
    },
    async writeLayoutState(value) {
      const update = parseTabsLayoutStateUpdate(value);
      state =
        update.placement === "right"
          ? { ...state, rightWidth: update.size }
          : { ...state, bottomHeight: update.size };
      writeStored(storage, TABS_LAYOUT_STORAGE_KEY, state);
    },
    openExternal(url) {
      globalThis.open?.(url, "_blank", "noopener,noreferrer");
    },
  };
}

/** Host RPC adapter for portable Files capabilities in a normal browser. */
export function browserFilesPort(
  connection: Connection,
  storage: BrowserStorage | undefined = browserStorage(),
): DesktopFilesPort {
  const call = createHostCaller(connection);
  let viewState: FileManagerViewState = readStored(
    storage,
    FILES_VIEW_STORAGE_KEY,
    parseFileManagerViewState,
    {},
  );
  return {
    available: true,
    nativeOpenAvailable: false,
    watchAvailable: false,
    async diff(request) {
      return parseFileManagerDiffResult(
        await call(
          "files.diff",
          parseFileManagerDiffRequest(request),
        ),
      );
    },
    async list(request) {
      return parseFileManagerListResult(
        await call(
          "files.list",
          parseFileManagerListRequest(request),
        ),
      );
    },
    async open() {
      throw new Error(
        "Opening a host path with a native application is desktop-only",
      );
    },
    async preview(request) {
      return parseFileManagerPreviewResult(
        await call(
          "files.preview",
          parseFileManagerPreviewRequest(request),
        ),
      );
    },
    async write(request) {
      return parseFileManagerWriteResult(
        await call(
          "files.write",
          parseFileManagerWriteRequest(request),
        ),
      );
    },
    async readViewState() {
      return parseFileManagerViewState(viewState);
    },
    async writeViewState(value) {
      const update = parseFileManagerViewStateUpdate(value);
      viewState =
        "codeTheme" in update
          ? {
              ...viewState,
              codeThemes: {
                ...viewState.codeThemes,
                [update.colorScheme]: update.codeTheme,
              },
            }
          : {
              ...viewState,
              [update.placement]: {
                ...viewState[update.placement],
                ...(update.explorerPosition === undefined
                  ? {}
                  : {
                      explorerPosition:
                        update.explorerPosition,
                    }),
                ...(update.previewWidth === undefined
                  ? {}
                  : { previewWidth: update.previewWidth }),
                ...(update.viewMode === undefined
                  ? {}
                  : { viewMode: update.viewMode }),
              },
            };
      writeStored(storage, FILES_VIEW_STORAGE_KEY, viewState);
    },
    watch() {
      return () => {};
    },
  };
}

const TERMINAL_POLL_WAIT_MS = 20_000;
const TERMINAL_TRUNCATED_NOTICE =
  "\r\n\u001b[2m[earlier terminal output was truncated]\u001b[0m\r\n";

interface BrowserTerminalPoll {
  readonly controller: AbortController;
  cursor: number;
}

/** Long-poll adapter for interactive Minke Host Terminal sessions. */
export function browserTerminalPort(
  connection: Connection,
): DesktopTerminalPort {
  const call = createHostCaller(connection);
  const listeners = new Set<(event: TerminalEvent) => void>();
  const sessions = new Map<string, BrowserTerminalPoll>();

  const publish = (event: TerminalEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const publishError = (
    sessionId: string,
    error: unknown,
  ): void => {
    publish({
      type: "error",
      sessionId,
      message:
        error instanceof Error ? error.message : String(error),
    });
  };
  const closeRemote = (sessionId: string): void => {
    void call(
      "terminal.close",
      parseTerminalSessionId(sessionId),
    ).catch(() => {
      // The Host may already have released an exited or disconnected PTY.
    });
  };
  const close = (sessionId: string): void => {
    const poll = sessions.get(sessionId);
    if (poll === undefined) return;
    sessions.delete(sessionId);
    poll.controller.abort();
    closeRemote(sessionId);
  };
  const poll = async (
    sessionId: string,
    state: BrowserTerminalPoll,
  ): Promise<void> => {
    try {
      while (sessions.get(sessionId) === state) {
        const result = parseTerminalReadResult(
          await call(
            "terminal.read",
            parseTerminalReadRequest({
              sessionId,
              cursor: state.cursor,
              waitMs: TERMINAL_POLL_WAIT_MS,
            }),
            state.controller.signal,
          ),
        );
        if (result.cursor < state.cursor) {
          throw new Error(
            "Minke Host Terminal cursor moved backwards",
          );
        }
        if (result.truncated) {
          publish({
            type: "data",
            sessionId,
            data: TERMINAL_TRUNCATED_NOTICE,
          });
        }
        state.cursor = result.cursor;
        for (const event of result.events) publish(event);
        if (result.done) {
          if (sessions.get(sessionId) === state) {
            sessions.delete(sessionId);
            closeRemote(sessionId);
          }
          return;
        }
      }
    } catch (error) {
      if (state.controller.signal.aborted) return;
      if (sessions.get(sessionId) === state) {
        sessions.delete(sessionId);
        publishError(sessionId, error);
        closeRemote(sessionId);
      }
    }
  };

  return {
    available: true,
    async create(request) {
      const result = parseTerminalCreateResult(
        await call(
          "terminal.create",
          parseTerminalCreateRequest(request),
        ),
      );
      const state: BrowserTerminalPoll = {
        controller: new AbortController(),
        cursor: 0,
      };
      sessions.set(result.sessionId, state);
      void poll(result.sessionId, state);
      return result;
    },
    write(request) {
      const parsed = parseTerminalWriteRequest(request);
      if (!sessions.has(parsed.sessionId)) return;
      void call("terminal.write", parsed).catch((error) => {
        publishError(parsed.sessionId, error);
      });
    },
    resize(request) {
      const parsed = parseTerminalResizeRequest(request);
      if (!sessions.has(parsed.sessionId)) return;
      void call("terminal.resize", parsed).catch((error) => {
        publishError(parsed.sessionId, error);
      });
    },
    close,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          for (const sessionId of [...sessions.keys()]) {
            close(sessionId);
          }
        }
      };
    },
  };
}

/** Prefer native preload capabilities and fall back to Minke Host. */
export function minkeWorkspacePorts(
  connection: Connection,
  desktopTabs: DesktopTabsPort = desktopTabsPort(),
  desktopFiles: DesktopFilesPort = desktopFilesPort(),
  desktopTerminal: DesktopTerminalPort = desktopTerminalPort(),
): {
  readonly files: DesktopFilesPort;
  readonly tabs: DesktopTabsPort;
  readonly terminal: DesktopTerminalPort;
} {
  return {
    files: desktopFiles.available
      ? desktopFiles
      : browserFilesPort(connection),
    tabs: desktopTabs.available
      ? desktopTabs
      : browserTabsPort(),
    terminal: desktopTerminal.available
      ? desktopTerminal
      : browserTerminalPort(connection),
  };
}

export type {
  BrowserStorage,
  TabsLayoutState,
};
