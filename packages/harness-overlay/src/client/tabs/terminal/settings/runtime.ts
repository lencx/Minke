import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import type {
  TerminalSettingsStore,
} from "@minke/harness-overlay/client/bridge.ts";

export type TerminalSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface TerminalSettingsSnapshot {
  settings: Readonly<TerminalSettings>;
  editable: boolean;
  error: TerminalSettingsErrorKind | undefined;
  revision: number;
}

/** Owns hydration, optimistic updates, and serialized Terminal persistence. */
export class TerminalSettingsRuntime {
  readonly store: TerminalSettingsStore;
  #snapshot: TerminalSettingsSnapshot = Object.freeze({
    settings: DEFAULT_TERMINAL_SETTINGS,
    editable: false,
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(store: TerminalSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): TerminalSettingsSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Hydrate durable settings exactly once. */
  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  update(patch: Partial<TerminalSettings>): void {
    this.#assertEditable();
    this.#commit({
      ...this.#snapshot.settings,
      ...patch,
    });
  }

  reset(): void {
    this.#assertEditable();
    this.#commit(DEFAULT_TERMINAL_SETTINGS);
  }

  /** Await queued persistence, primarily for deterministic shutdown/tests. */
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
      this.#publish({
        error: "unavailable",
      });
      return;
    }
    try {
      const settings = parseTerminalSettings(await this.store.read());
      if (this.#disposed) return;
      this.#publish({
        settings,
        editable: true,
        error: undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({
        error: "read",
      });
    }
  }

  #assertEditable(): void {
    if (!this.#snapshot.editable) {
      throw new Error("terminal settings are not editable");
    }
  }

  #commit(value: Readonly<TerminalSettings>): void {
    const settings = parseTerminalSettings(value);
    if (sameSettings(settings, this.#snapshot.settings)) return;
    this.#publish({
      settings,
      error: undefined,
    });

    const generation = ++this.#saveGeneration;
    const payload = { ...settings };
    const operation = this.#saveTail.then(async () => {
      await this.store.write(payload);
    });
    this.#saveTail = operation.then(
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) return;
        if (this.#snapshot.error === "write") {
          this.#publish({ error: undefined });
        }
      },
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) return;
        this.#publish({ error: "write" });
      },
    );
  }

  #publish(
    patch: Partial<Omit<TerminalSettingsSnapshot, "revision">>,
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

function sameSettings(
  left: Readonly<TerminalSettings>,
  right: Readonly<TerminalSettings>,
): boolean {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight
  );
}
