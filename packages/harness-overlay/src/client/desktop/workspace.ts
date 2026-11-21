import {
  parsePluginManagementSettings,
} from "@minke/harness-overlay/plugin-recovery-contract.ts";
import {
  parseAgentBrowserNavigationRequest,
  parseAgentBrowserControlRequest,
  parseAgentBrowserProjection,
  parseAgentBrowserProjections,
  parseAgentBrowserSessionId,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  parseAgentBrowserHistoryClearRequest,
  parseAgentBrowserHistoryDeleteRequest,
  parseAgentBrowserHistoryReadRequest,
  parseAgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import {
  parseAgentBrowserAnnotationCommitRequest,
  parseAgentBrowserAnnotationCommitResult,
  parseAgentBrowserAnnotationEvent,
  parseAgentBrowserAnnotationRefreshRequest,
  parseAgentBrowserAnnotationRefreshResult,
  parseAgentBrowserAnnotationSession,
  parseAgentBrowserAnnotationStartRequest,
  parseAgentBrowserAnnotationStopRequest,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  FileManagerPermissionError,
  parseDesktopFileManagerListResult,
  parseFileManagerChangeEvent,
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  type FileManagerViewStateUpdate,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  DesktopBridgeWindow,
  DesktopAgentBrowserPort,
  DesktopFilesPort,
  PluginRecoveryPort,
  DesktopTabsPort,
} from "./contracts.ts";

/** Adapt main-owned Agent Browser sessions to the Tabs projection. */
export function desktopAgentBrowserPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopAgentBrowserPort {
  const bridge = source.minkeDesktop?.agentBrowser;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return [];
      },
      async setControl() {
        throw new Error(
          "Minke desktop Agent Browser bridge is unavailable",
        );
      },
      async navigate() {
        throw new Error(
          "Minke desktop Agent Browser bridge is unavailable",
        );
      },
      async readHistory() {
        throw new Error(
          "Minke desktop Agent Browser history bridge is unavailable",
        );
      },
      async clearHistory() {
        throw new Error(
          "Minke desktop Agent Browser history bridge is unavailable",
        );
      },
      async deleteHistory() {
        throw new Error(
          "Minke desktop Agent Browser history bridge is unavailable",
        );
      },
      async startAnnotation() {
        throw new Error(
          "Minke desktop Agent Browser bridge is unavailable",
        );
      },
      async stopAnnotation() {},
      async refreshAnnotation() {
        throw new Error(
          "Minke desktop Agent Browser bridge is unavailable",
        );
      },
      async commitAnnotation() {
        throw new Error(
          "Minke desktop Agent Browser bridge is unavailable",
        );
      },
      close() {},
      subscribe() {
        return () => {};
      },
      subscribeAnnotationEvents() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseAgentBrowserProjections(await bridge.read());
    },
    async setControl(sessionId, owner) {
      const request = parseAgentBrowserControlRequest({
        sessionId,
        owner,
      });
      return parseAgentBrowserProjection(
        await bridge.setControl(request.sessionId, request.owner),
      );
    },
    async navigate(sessionId, command) {
      const request = parseAgentBrowserNavigationRequest({
        sessionId,
        command,
      });
      return parseAgentBrowserProjection(
        await bridge.navigate(request.sessionId, request.command),
      );
    },
    async readHistory(request) {
      return parseAgentBrowserHistorySnapshot(
        await bridge.readHistory(
          parseAgentBrowserHistoryReadRequest(request),
        ),
      );
    },
    async clearHistory(request) {
      return parseAgentBrowserHistorySnapshot(
        await bridge.clearHistory(
          parseAgentBrowserHistoryClearRequest(request),
        ),
      );
    },
    async deleteHistory(request) {
      await bridge.deleteHistory(
        parseAgentBrowserHistoryDeleteRequest(request),
      );
    },
    async startAnnotation(sessionId) {
      const request = parseAgentBrowserAnnotationStartRequest({
        sessionId,
      });
      return parseAgentBrowserAnnotationSession(
        await bridge.startAnnotation(request.sessionId),
      );
    },
    async stopAnnotation(request) {
      await bridge.stopAnnotation(
        parseAgentBrowserAnnotationStopRequest(request),
      );
    },
    async refreshAnnotation(request) {
      return parseAgentBrowserAnnotationRefreshResult(
        await bridge.refreshAnnotation(
          parseAgentBrowserAnnotationRefreshRequest(request),
        ),
      );
    },
    async commitAnnotation(request) {
      const parsed = parseAgentBrowserAnnotationCommitRequest(request);
      return parseAgentBrowserAnnotationCommitResult(
        await bridge.commitAnnotation(parsed),
      );
    },
    close(sessionId) {
      bridge.close(parseAgentBrowserSessionId(sessionId));
    },
    subscribe(listener) {
      return bridge.subscribe((value) => {
        try {
          listener(parseAgentBrowserProjections(value));
        } catch {
          // Ignore malformed main-process projections.
        }
      });
    },
    subscribeAnnotationEvents(listener) {
      return bridge.subscribeAnnotationEvents((value) => {
        try {
          listener(parseAgentBrowserAnnotationEvent(value));
        } catch {
          // Ignore malformed annotation traffic from main.
        }
      });
    },
  };
}

/** Adapt desktop-only recovery; package operations use DSH's native page. */
export function desktopPluginRecoveryPort(
  source: DesktopBridgeWindow = window as unknown as DesktopBridgeWindow,
): PluginRecoveryPort {
  const bridge = source.minkeDesktop?.pluginRecovery;
  const unavailable = async (): Promise<never> => {
    throw new Error("Minke desktop plugin recovery bridge is unavailable");
  };
  return bridge === undefined ? {
    available: false, setSafeMode: unavailable, readSettings: unavailable,
  } : {
    available: true,
    setSafeMode: enabled => bridge.setSafeMode(enabled),
    async readSettings() { return parsePluginManagementSettings(await bridge.readSettings()); },
  };
}

/** Adapt the isolated preload bridge used by host-backed tab actions. */
export function desktopTabsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTabsPort {
  const bridge = source.minkeDesktop?.tabs;
  if (bridge === undefined) {
    return {
      available: false,
      embeddedWebAvailable: false,
      async readLayoutState() {
        return {};
      },
      async writeLayoutState() {},
      openExternal() {},
    };
  }
  return {
    available: true,
    embeddedWebAvailable: true,
    async readLayoutState() {
      if (bridge.readLayoutState === undefined) return {};
      return parseTabsLayoutState(await bridge.readLayoutState());
    },
    async writeLayoutState(update) {
      if (bridge.writeLayoutState === undefined) return;
      await bridge.writeLayoutState(
        parseTabsLayoutStateUpdate(update),
      );
    },
    resolveLocalPath(candidate) {
      return bridge.resolveLocalPath?.(candidate);
    },
    openExternal(url) {
      bridge.openExternal(url);
    },
  };
}

/** Adapt the isolated preload bridge used by host-backed Files tabs. */
export function desktopFilesPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopFilesPort {
  const bridge = source.minkeDesktop?.files;
  const directoryPicker = source.__DSH_DIRECTORY_PICKER__;
  if (bridge === undefined) {
    return {
      available: false,
      watchAvailable: false,
      async diff() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async list() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async preview() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      async write() {
        throw new Error(
          "Minke desktop Files bridge is unavailable",
        );
      },
      watch() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    watchAvailable: bridge.watch !== undefined,
    async diff(request) {
      return parseFileManagerDiffResult(
        await bridge.diff(
          parseFileManagerDiffRequest(request),
        ),
      );
    },
    async list(request) {
      const result = parseDesktopFileManagerListResult(
        await bridge.list(
          parseFileManagerListRequest(request),
        ),
      );
      if ("kind" in result) throw new FileManagerPermissionError();
      return result;
    },
    ...(directoryPicker === undefined ? {} : {
      async chooseDirectory() {
        return (await directoryPicker.pick()) ?? undefined;
      },
    }),
    async preview(request) {
      return parseFileManagerPreviewResult(
        await bridge.preview(
          parseFileManagerPreviewRequest(request),
        ),
      );
    },
    async write(request) {
      return parseFileManagerWriteResult(
        await bridge.write(
          parseFileManagerWriteRequest(request),
        ),
      );
    },
    ...(bridge.readViewState === undefined
      ? {}
      : {
          async readViewState() {
            return parseFileManagerViewState(
              await bridge.readViewState?.(),
            );
          },
        }),
    ...(bridge.writeViewState === undefined
      ? {}
      : {
          async writeViewState(update: FileManagerViewStateUpdate) {
            await bridge.writeViewState?.(
              parseFileManagerViewStateUpdate(update),
            );
          },
        }),
    watch(paths, listener) {
      if (bridge.watch === undefined) return () => {};
      return bridge.watch(paths, (event) => {
        listener(parseFileManagerChangeEvent(event));
      });
    },
  };
}
