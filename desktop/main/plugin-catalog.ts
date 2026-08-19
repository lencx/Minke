import {
  PLUGIN_CATALOG_CANCEL_CHANNEL,
  PLUGIN_CATALOG_INSTALL_CHANNEL,
  PLUGIN_CATALOG_READ_CHANNEL,
  PLUGIN_CATALOG_REFRESH_CHANNEL,
  PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL,
  PLUGIN_CATALOG_TOKEN_SET_CHANNEL,
  parsePluginCatalogInstallRequest,
  parsePluginCatalogSnapshot,
  parsePluginCatalogTokenSetRequest,
  type PluginCatalogSnapshot,
} from "@minke/desktop/plugin-catalog-contract.ts";
import type {
  PluginCatalogModule,
} from "@lencx/minke-plugin-catalog";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface PluginCatalogBinding {
  dispose(): void;
}

/** Bind authorized snapshot reads and explicit refresh lifecycle actions. */
export function bindPluginCatalogIpc(
  ipcMain: IpcMainLike,
  catalog: Pick<
    PluginCatalogModule,
    | "cancelRefresh"
    | "clearGitHubToken"
    | "install"
    | "read"
    | "refresh"
    | "saveGitHubToken"
  >,
  authorize: (event: unknown) => boolean,
): PluginCatalogBinding {
  const read = async (
    event: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    return parsePluginCatalogSnapshot(await catalog.read());
  };
  const refresh = async (
    event: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    return parsePluginCatalogSnapshot(await catalog.refresh());
  };
  const cancel = async (
    event: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    return parsePluginCatalogSnapshot(
      await catalog.cancelRefresh(),
    );
  };
  const install = async (
    event: unknown,
    value: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    const request =
      parsePluginCatalogInstallRequest(value);
    return parsePluginCatalogSnapshot(
      await catalog.install(request.pluginId),
    );
  };
  const setToken = async (
    event: unknown,
    value: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    const request =
      parsePluginCatalogTokenSetRequest(value);
    return parsePluginCatalogSnapshot(
      await catalog.saveGitHubToken(request.token),
    );
  };
  const clearToken = async (
    event: unknown,
  ): Promise<PluginCatalogSnapshot> => {
    assertAuthorized(authorize, event);
    return parsePluginCatalogSnapshot(
      await catalog.clearGitHubToken(),
    );
  };

  ipcMain.handle(PLUGIN_CATALOG_READ_CHANNEL, read);
  ipcMain.handle(PLUGIN_CATALOG_REFRESH_CHANNEL, refresh);
  ipcMain.handle(PLUGIN_CATALOG_CANCEL_CHANNEL, cancel);
  ipcMain.handle(PLUGIN_CATALOG_INSTALL_CHANNEL, install);
  ipcMain.handle(
    PLUGIN_CATALOG_TOKEN_SET_CHANNEL,
    setToken,
  );
  ipcMain.handle(
    PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL,
    clearToken,
  );

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(PLUGIN_CATALOG_CANCEL_CHANNEL);
      ipcMain.removeHandler(PLUGIN_CATALOG_INSTALL_CHANNEL);
      ipcMain.removeHandler(PLUGIN_CATALOG_READ_CHANNEL);
      ipcMain.removeHandler(PLUGIN_CATALOG_REFRESH_CHANNEL);
      ipcMain.removeHandler(
        PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL,
      );
      ipcMain.removeHandler(
        PLUGIN_CATALOG_TOKEN_SET_CHANNEL,
      );
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized plugin catalog request");
  }
}
