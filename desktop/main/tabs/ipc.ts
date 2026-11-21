import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import {
  parseTabsLayoutStateUpdate,
  TABS_LAYOUT_STATE_READ_CHANNEL,
  TABS_LAYOUT_STATE_WRITE_CHANNEL,
  TABS_OPEN_EXTERNAL_CHANNEL,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  parseFileManagerDiffRequest,
  parseFileManagerListRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerUnwatchRequest,
  parseFileManagerViewStateUpdate,
  parseFileManagerWatchRequest,
  parseFileManagerWriteRequest,
  TABS_FILES_DIFF_CHANNEL,
  TABS_FILES_CHANGE_CHANNEL,
  TABS_FILES_LIST_CHANNEL,
  TABS_FILES_PREVIEW_CHANNEL,
  TABS_FILES_UNWATCH_CHANNEL,
  TABS_FILES_VIEW_STATE_READ_CHANNEL,
  TABS_FILES_VIEW_STATE_WRITE_CHANNEL,
  TABS_FILES_WATCH_CHANNEL,
  TABS_FILES_WRITE_CHANNEL,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  FileManagerRuntime,
} from "./files.ts";
import {
  FileWatchRuntime,
} from "./file-watch.ts";
import {
  FilesViewStateStore,
} from "./files-view-state.ts";
import {
  TabsLayoutStateStore,
} from "./layout-state.ts";
import {
  openNormalizedTabExternally,
} from "./security.ts";
import type {
  AgentBrowserRuntime,
} from "../agent-browser";
import type {
  ExternalTabOpener,
  TabsAuthorization,
  TabsBinding,
} from "./types.ts";

interface TabsBindingOptions {
  readonly fileSystemRoot: string;
  readonly minkeConfigPath: string;
  readonly agentBrowser: AgentBrowserRuntime;
}

/**
 * Bind file/layout state and Agent Browser projection for Minke tabs.
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
  options: TabsBindingOptions,
): TabsBinding {
  const files = new FileManagerRuntime({
    rootPath: options.fileSystemRoot,
    allowCrossVolumeAccess: true,
  });
  const filesViewState = new FilesViewStateStore(
    options.minkeConfigPath,
  );
  const tabsLayoutState = new TabsLayoutStateStore(
    options.minkeConfigPath,
  );
  const fileWatch = new FileWatchRuntime({
    send: (event) => {
      if (!embedder.isDestroyed()) {
        embedder.send(TABS_FILES_CHANGE_CHANNEL, event);
      }
    },
  });
  const agentBrowserProjection =
    options.agentBrowser.bindWindowProjection(
      ipc,
      embedder,
      authorize,
    );
  const handleOpenExternal = (
    event: IpcMainEvent,
    candidate: unknown,
  ): void => {
    if (!authorize(event)) return;
    openNormalizedTabExternally(external, candidate);
  };
  const handleTabsLayoutStateRead = async (
    event: IpcMainInvokeEvent,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Tabs request");
    }
    return await tabsLayoutState.read();
  };
  const handleTabsLayoutStateWrite = async (
    event: IpcMainInvokeEvent,
    update: unknown,
  ): Promise<void> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Tabs request");
    }
    await tabsLayoutState.write(
      parseTabsLayoutStateUpdate(update),
    );
  };
  const handleFilesList = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    const parsed = parseFileManagerListRequest(request);
    try {
      return await files.list(parsed);
    } catch (error) {
      if (error instanceof Error && "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")) {
        return { kind: "permission-denied" };
      }
      throw error;
    }
  };
  const handleFilesDiff = async (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    return await files.diff(
      parseFileManagerDiffRequest(request),
    );
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
  const handleFilesViewStateRead = async (
    event: IpcMainInvokeEvent,
  ): Promise<unknown> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    return await filesViewState.read();
  };
  const handleFilesViewStateWrite = async (
    event: IpcMainInvokeEvent,
    update: unknown,
  ): Promise<void> => {
    if (!authorize(event)) {
      throw new Error("unauthorized Files request");
    }
    await filesViewState.write(
      parseFileManagerViewStateUpdate(update),
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

  ipc.on(TABS_OPEN_EXTERNAL_CHANNEL, handleOpenExternal);
  ipc.handle(
    TABS_LAYOUT_STATE_READ_CHANNEL,
    handleTabsLayoutStateRead,
  );
  ipc.handle(
    TABS_LAYOUT_STATE_WRITE_CHANNEL,
    handleTabsLayoutStateWrite,
  );
  ipc.handle(TABS_FILES_LIST_CHANNEL, handleFilesList);
  ipc.handle(TABS_FILES_DIFF_CHANNEL, handleFilesDiff);
  ipc.handle(TABS_FILES_PREVIEW_CHANNEL, handleFilesPreview);
  ipc.handle(TABS_FILES_WRITE_CHANNEL, handleFilesWrite);
  ipc.handle(
    TABS_FILES_VIEW_STATE_READ_CHANNEL,
    handleFilesViewStateRead,
  );
  ipc.handle(
    TABS_FILES_VIEW_STATE_WRITE_CHANNEL,
    handleFilesViewStateWrite,
  );
  ipc.on(TABS_FILES_WATCH_CHANNEL, handleFilesWatch);
  ipc.on(TABS_FILES_UNWATCH_CHANNEL, handleFilesUnwatch);

  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipc.removeListener(
        TABS_OPEN_EXTERNAL_CHANNEL,
        handleOpenExternal,
      );
      ipc.removeHandler(TABS_LAYOUT_STATE_READ_CHANNEL);
      ipc.removeHandler(TABS_LAYOUT_STATE_WRITE_CHANNEL);
      ipc.removeHandler(TABS_FILES_LIST_CHANNEL);
      ipc.removeHandler(TABS_FILES_DIFF_CHANNEL);
      ipc.removeHandler(TABS_FILES_PREVIEW_CHANNEL);
      ipc.removeHandler(TABS_FILES_WRITE_CHANNEL);
      ipc.removeHandler(TABS_FILES_VIEW_STATE_READ_CHANNEL);
      ipc.removeHandler(TABS_FILES_VIEW_STATE_WRITE_CHANNEL);
      ipc.removeListener(
        TABS_FILES_WATCH_CHANNEL,
        handleFilesWatch,
      );
      ipc.removeListener(
        TABS_FILES_UNWATCH_CHANNEL,
        handleFilesUnwatch,
      );
      agentBrowserProjection.dispose();
      fileWatch.dispose();
    },
  };
}
