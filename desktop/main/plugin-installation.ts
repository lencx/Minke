import {
  parsePluginInstallTarget,
  parsePluginUninstallTarget,
  type InstalledPluginsSnapshot,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import type {
  HarnessRuntimeLayout,
} from "./harness-launch.ts";
import type {
  PluginInstallCommandRunner,
} from "./plugin-installation/command.ts";
import {
  WebPluginProfile,
} from "./plugin-installation/profile.ts";
import {
  PluginManagementRuntime,
  type PluginManagementSettingsStore,
} from "./plugin-installation/settings.ts";

export type {
  PluginInstallCommandOptions,
  PluginInstallCommandRunner,
} from "./plugin-installation/command.ts";
export type {
  PluginManagementSettingsStore,
} from "./plugin-installation/settings.ts";

export interface PluginInstallationOptions {
  runtimeRoot: string;
  dshHome: string;
  electronExecutable: string;
  environment?: NodeJS.ProcessEnv;
  readRuntimeLayout?: () => Promise<HarnessRuntimeLayout>;
  runCommand?: PluginInstallCommandRunner;
  settings?: PluginManagementSettingsStore;
}

/**
 * Manages installed web plugins behind one desktop Interface. Profile I/O and
 * policy persistence remain private implementation Modules.
 */
export class PluginInstallationRuntime {
  readonly #profile: WebPluginProfile;
  readonly #management: PluginManagementRuntime;

  constructor(options: PluginInstallationOptions) {
    this.#profile = new WebPluginProfile(options);
    this.#management = new PluginManagementRuntime(
      options.settings,
    );
  }

  async listInstalled(): Promise<InstalledPluginsSnapshot> {
    return this.#profile.list(await this.#management.read());
  }

  async install(candidate: string): Promise<void> {
    const target = parsePluginInstallTarget(candidate);
    await this.#profile.add(target);
  }

  async uninstall(candidate: string): Promise<void> {
    const target = parsePluginUninstallTarget(candidate);
    await this.#profile.remove(target);
    await this.#management.setEnabled(target, true);
  }

  async setEnabled(
    candidate: string,
    enabled: boolean,
  ): Promise<void> {
    const target = parsePluginUninstallTarget(candidate);
    await this.#management.setEnabled(target, enabled);
  }

  async setSafeMode(enabled: boolean): Promise<void> {
    await this.#management.setSafeMode(enabled);
  }
}
