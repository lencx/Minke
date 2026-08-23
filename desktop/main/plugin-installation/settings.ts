import {
  DEFAULT_PLUGIN_MANAGEMENT_SETTINGS,
  parsePluginManagementSettings,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-install-contract.ts";

export interface PluginManagementSettingsStore {
  read(): Promise<PluginManagementSettings>;
  write(settings: PluginManagementSettings): Promise<void>;
}

function createTransientSettingsStore():
  PluginManagementSettingsStore {
  let settings = DEFAULT_PLUGIN_MANAGEMENT_SETTINGS;
  return {
    async read() {
      return settings;
    },
    async write(value) {
      settings = parsePluginManagementSettings(value);
    },
  };
}

/**
 * Serializes plugin policy updates so independent renderer actions cannot
 * overwrite one another.
 */
export class PluginManagementRuntime {
  readonly #store: PluginManagementSettingsStore;
  #tail: Promise<void> = Promise.resolve();

  constructor(store?: PluginManagementSettingsStore) {
    this.#store = store ?? createTransientSettingsStore();
  }

  async read(): Promise<PluginManagementSettings> {
    return parsePluginManagementSettings(
      await this.#store.read(),
    );
  }

  setEnabled(name: string, enabled: boolean): Promise<void> {
    return this.#update((current) => {
      const disabled = new Set(current.disabledPlugins);
      if (enabled) {
        disabled.delete(name);
      } else {
        disabled.add(name);
      }
      return {
        safeMode: current.safeMode,
        disabledPlugins: [...disabled].sort(),
      };
    });
  }

  setSafeMode(enabled: boolean): Promise<void> {
    return this.#update((current) => ({
      safeMode: enabled,
      disabledPlugins: current.disabledPlugins,
    }));
  }

  #update(
    update: (
      current: PluginManagementSettings,
    ) => PluginManagementSettings,
  ): Promise<void> {
    const operation = this.#tail.then(async () => {
      const current = await this.read();
      await this.#store.write(
        parsePluginManagementSettings(update(current)),
      );
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
}
