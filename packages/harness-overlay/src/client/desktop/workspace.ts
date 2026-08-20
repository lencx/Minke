import {
  parseInstalledPluginsSnapshot,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  parseSessionLogExportId,
} from "@minke/harness-overlay/session-export-contract.ts";
import {
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  parseFileManagerChangeEvent,
  parseFileManagerDiffRequest,
  parseFileManagerDiffResult,
  parseFileManagerListRequest,
  parseFileManagerListResult,
  parseFileManagerOpenRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerPreviewResult,
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
  parseFileManagerWriteRequest,
  parseFileManagerWriteResult,
  type FileManagerViewStateUpdate,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalEvent,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import type {
  DesktopBridgeWindow,
  DesktopFilesPort,
  PluginInstallerPort,
  DesktopSessionLogsPort,
  DesktopTabsPort,
  DesktopTerminalPort,
} from "./contracts.ts";

/** Adapt plugin management exposed by the isolated preload. */
export function desktopPluginInstallerPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): PluginInstallerPort {
  const bridge = source.minkeDesktop?.pluginInstaller;
  if (bridge === undefined) {
    return {
      available: false,
      async install() {
        throw new Error(
          "Minke desktop plugin installer bridge is unavailable",
        );
      },
      async uninstall() {
        throw new Error(
          "Minke desktop plugin installer bridge is unavailable",
        );
      },
      async readInstalled() {
        throw new Error(
          "Minke desktop plugin installer bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async install(command) {
      await bridge.install(command);
    },
    async uninstall(name) {
      await bridge.uninstall(name);
    },
    async readInstalled() {
      return parseInstalledPluginsSnapshot(
        await bridge.readInstalled(),
      );
    },
  };
}

/** Adapt the native save/reveal workflow exposed by the isolated preload. */
export function desktopSessionLogsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopSessionLogsPort {
  const bridge = source.minkeDesktop?.sessionLogs;
  if (bridge === undefined) {
    return {
      available: false,
      async export() {
        throw new Error(
          "Minke desktop Session export bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async export(sessionId) {
      await bridge.export(parseSessionLogExportId(sessionId));
    },
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
      async readLayoutState() {
        return {};
      },
      async writeLayoutState() {},
      openExternal() {},
    };
  }
  return {
    available: true,
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
  if (bridge === undefined) {
    return {
      available: false,
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
      async open() {
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
    async diff(request) {
      return parseFileManagerDiffResult(
        await bridge.diff(
          parseFileManagerDiffRequest(request),
        ),
      );
    },
    async list(request) {
      return parseFileManagerListResult(
        await bridge.list(
          parseFileManagerListRequest(request),
        ),
      );
    },
    async open(request) {
      await bridge.open(parseFileManagerOpenRequest(request));
    },
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

/** Adapt the isolated preload bridge used by interactive Terminal tabs. */
export function desktopTerminalPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTerminalPort {
  const bridge = source.minkeDesktop?.terminal;
  if (bridge === undefined) {
    return {
      available: false,
      async create() {
        throw new Error(
          "Minke desktop Terminal bridge is unavailable",
        );
      },
      write() {},
      resize() {},
      close() {},
      subscribe() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async create(request) {
      return parseTerminalCreateResult(
        await bridge.create(parseTerminalCreateRequest(request)),
      );
    },
    write(request) {
      bridge.write(parseTerminalWriteRequest(request));
    },
    resize(request) {
      bridge.resize(parseTerminalResizeRequest(request));
    },
    close(sessionId) {
      bridge.close(parseTerminalSessionId(sessionId));
    },
    subscribe(listener) {
      return bridge.subscribe((event) => {
        listener(parseTerminalEvent(event));
      });
    },
  };
}
