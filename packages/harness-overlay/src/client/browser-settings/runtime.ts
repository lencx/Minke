import {
  DEFAULT_BROWSER_SETTINGS,
  defaultChromeUserAgent,
  parseBrowserSettings,
  type BrowserSettings,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import type {
  BrowserSettingsStore,
} from "@minke/harness-overlay/client/desktop/index.ts";

export type BrowserSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface BrowserSettingsSnapshot {
  settings: Readonly<BrowserSettings>;
  automaticUserAgent: string;
  editable: boolean;
  error: BrowserSettingsErrorKind | undefined;
  revision: number;
}

/** Owns hydration, validation, and durable browser identity settings. */
export class BrowserSettingsRuntime {
  readonly store: BrowserSettingsStore;
  #snapshot: BrowserSettingsSnapshot;
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(
    store: BrowserSettingsStore,
    sourceUserAgent: string,
  ) {
    this.store = store;
    this.#snapshot = Object.freeze({
      settings: DEFAULT_BROWSER_SETTINGS,
      automaticUserAgent: defaultChromeUserAgent(sourceUserAgent),
      editable: false,
      error: undefined,
      revision: 0,
    });
  }

  getSnapshot = (): BrowserSettingsSnapshot => this.#snapshot;

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

  setUserAgent(
    field: "webUserAgent" | "agentUserAgent",
    userAgent: string,
  ): void {
    if (!this.#snapshot.editable) {
      throw new Error("browser settings are not editable");
    }
    this.#commit({
      ...this.#snapshot.settings,
      [field]: userAgent,
    });
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
      const settings = parseBrowserSettings(
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

  #commit(value: BrowserSettings): void {
    const settings = parseBrowserSettings(value);
    if (
      settings.webUserAgent ===
        this.#snapshot.settings.webUserAgent &&
      settings.agentUserAgent ===
        this.#snapshot.settings.agentUserAgent
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
      Omit<BrowserSettingsSnapshot, "revision">
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
