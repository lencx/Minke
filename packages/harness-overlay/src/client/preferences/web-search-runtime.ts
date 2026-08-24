import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  parseWebSearchSettings,
  type WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import type {
  WebSearchSettingsStore,
} from "@minke/harness-overlay/client/desktop/index.ts";

export type WebSearchSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface WebSearchSettingsSnapshot {
  settings: Readonly<WebSearchSettings>;
  editable: boolean;
  error: WebSearchSettingsErrorKind | undefined;
  revision: number;
}

/** Owns hydration and durable, restart-bound web-search preferences. */
export class WebSearchSettingsRuntime {
  readonly store: WebSearchSettingsStore;
  #snapshot: WebSearchSettingsSnapshot = Object.freeze({
    settings: DEFAULT_WEB_SEARCH_SETTINGS,
    editable: false,
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(store: WebSearchSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): WebSearchSettingsSnapshot => this.#snapshot;

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

  setFallbackEnabled(fallbackEnabled: boolean): void {
    if (!this.#snapshot.editable) {
      throw new Error("web search settings are not editable");
    }
    this.#commit({ fallbackEnabled });
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
      const settings = parseWebSearchSettings(
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

  #commit(value: WebSearchSettings): void {
    const settings = parseWebSearchSettings(value);
    if (
      settings.fallbackEnabled ===
      this.#snapshot.settings.fallbackEnabled
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
      Omit<WebSearchSettingsSnapshot, "revision">
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
