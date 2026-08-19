import {
  PLUGIN_CATALOG_CANCEL_CHANNEL,
  PLUGIN_CATALOG_READ_CHANNEL,
  PLUGIN_CATALOG_REFRESH_CHANNEL,
  parsePluginCatalogSnapshot,
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
    "cancelRefresh" | "read" | "refresh"
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

  ipcMain.handle(PLUGIN_CATALOG_READ_CHANNEL, read);
  ipcMain.handle(PLUGIN_CATALOG_REFRESH_CHANNEL, refresh);
  ipcMain.handle(PLUGIN_CATALOG_CANCEL_CHANNEL, cancel);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(PLUGIN_CATALOG_CANCEL_CHANNEL);
      ipcMain.removeHandler(PLUGIN_CATALOG_READ_CHANNEL);
      ipcMain.removeHandler(PLUGIN_CATALOG_REFRESH_CHANNEL);
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
