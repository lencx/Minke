import {
  PLUGIN_INSTALLED_READ_CHANNEL,
  PLUGIN_INSTALL_CHANNEL,
  PLUGIN_RESTART_CHANNEL,
  PLUGIN_UNINSTALL_CHANNEL,
  parseInstalledPluginsSnapshot,
  parsePluginInstallCommand,
  parsePluginInstallRequest,
  parsePluginUninstallRequest,
  type InstalledPluginsSnapshot,
} from "@minke/harness-overlay/plugin-install-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface PluginInstaller {
  install(target: string): Promise<void>;
  uninstall(name: string): Promise<void>;
  listInstalled(): Promise<InstalledPluginsSnapshot>;
}

export interface PluginInstallBinding {
  dispose(): void;
}

/** Bind one authorized, command-shaped plugin installation action. */
export function bindPluginInstallIpc(
  ipcMain: IpcMainLike,
  installer: PluginInstaller,
  authorize: (event: unknown) => boolean,
  restartDesktop: () => void,
): PluginInstallBinding {
  const install = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    if (!authorize(event)) {
      throw new Error("unauthorized plugin install request");
    }
    const request = parsePluginInstallRequest(value);
    const command = parsePluginInstallCommand(request.command);
    await installer.install(command.target);
  };
  const readInstalled = async (
    event: unknown,
  ): Promise<InstalledPluginsSnapshot> => {
    if (!authorize(event)) {
      throw new Error(
        "unauthorized installed plugin request",
      );
    }
    return parseInstalledPluginsSnapshot(
      await installer.listInstalled(),
    );
  };
  const uninstall = async (
    event: unknown,
    value: unknown,
  ): Promise<void> => {
    if (!authorize(event)) {
      throw new Error("unauthorized plugin uninstall request");
    }
    const request = parsePluginUninstallRequest(value);
    await installer.uninstall(request.name);
    restartDesktop();
  };
  const restart = (event: unknown): void => {
    if (!authorize(event)) {
      throw new Error("unauthorized plugin restart request");
    }
    restartDesktop();
  };

  ipcMain.handle(PLUGIN_INSTALL_CHANNEL, install);
  ipcMain.handle(PLUGIN_RESTART_CHANNEL, restart);
  ipcMain.handle(PLUGIN_UNINSTALL_CHANNEL, uninstall);
  ipcMain.handle(
    PLUGIN_INSTALLED_READ_CHANNEL,
    readInstalled,
  );

  let disposed = false;
  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(PLUGIN_INSTALL_CHANNEL);
      ipcMain.removeHandler(PLUGIN_RESTART_CHANNEL);
      ipcMain.removeHandler(PLUGIN_UNINSTALL_CHANNEL);
      ipcMain.removeHandler(PLUGIN_INSTALLED_READ_CHANNEL);
    },
  });
}
