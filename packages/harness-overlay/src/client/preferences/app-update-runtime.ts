import {
  DEFAULT_APP_UPDATE_SETTINGS,
  parseAppUpdateSettings,
  type AppUpdateSettings,
} from "@minke/harness-overlay/app-update-contract.ts";
import type {
  AppUpdateSettingsStore,
} from "@minke/harness-overlay/client/desktop/index.ts";

export type AppUpdateSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface AppUpdateSettingsSnapshot {
  settings: Readonly<AppUpdateSettings>;
  editable: boolean;
  error: AppUpdateSettingsErrorKind | undefined;
  revision: number;
}

/** Owns hydration, optimistic updates, and durable update preferences. */
export class AppUpdateSettingsRuntime {
  readonly store: AppUpdateSettingsStore;
  #snapshot: AppUpdateSettingsSnapshot = Object.freeze({
    settings: DEFAULT_APP_UPDATE_SETTINGS,
    editable: false,
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(store: AppUpdateSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): AppUpdateSettingsSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  setAutoDownload(autoDownload: boolean): void {
    if (!this.#snapshot.editable) {
      throw new Error("app update settings are not editable");
    }
    this.#commit({ autoDownload });
  }

  async flush(): Promise<void> {
    await this.#saveTail;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.store.available) {
      this.#publish({ error: "unavailable" });
      return;
    }
    try {
      const settings = parseAppUpdateSettings(
        await this.store.read(),
      );
      if (this.#disposed) return;
      this.#publish({
        settings,
        editable: true,
        error: undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({ error: "read" });
    }
  }

  #commit(value: AppUpdateSettings): void {
    const settings = parseAppUpdateSettings(value);
    if (
      settings.autoDownload ===
      this.#snapshot.settings.autoDownload
    ) {
      return;
    }
    this.#publish({ settings, error: undefined });
    const generation = ++this.#saveGeneration;
    const operation = this.#saveTail.then(async () => {
      await this.store.write(settings);
    });
    this.#saveTail = operation.then(
      () => {
        if (
          this.#disposed ||
          generation !== this.#saveGeneration
        ) {
          return;
        }
        if (this.#snapshot.error === "write") {
          this.#publish({ error: undefined });
        }
      },
      () => {
        if (
          this.#disposed ||
          generation !== this.#saveGeneration
        ) {
          return;
        }
        this.#publish({ error: "write" });
      },
    );
  }

  #publish(
    patch: Partial<
      Omit<AppUpdateSettingsSnapshot, "revision">
    >,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      settings: Object.freeze({
        ...(patch.settings ?? this.#snapshot.settings),
      }),
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
