import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  NO_MODEL_RUNTIME_AVAILABILITY,
  parseModelRuntimeSettings,
  parseModelRuntimeSettingsSnapshot,
  type LocalModelRuntimeId,
  type ModelRuntimeAvailability,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import type {
  ModelRuntimeSettingsStore,
} from "@minke/harness-overlay/client/desktop/index.ts";

export type LocalModelSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface LocalModelSettingsSnapshot {
  available: Readonly<ModelRuntimeAvailability>;
  settings: Readonly<ModelRuntimeSettings>;
  editable: boolean;
  applying: boolean;
  error: LocalModelSettingsErrorKind | undefined;
  revision: number;
}

function copySettings(
  value: Readonly<ModelRuntimeSettings>,
): ModelRuntimeSettings {
  return {
    lmStudio: { ...value.lmStudio },
    ollama: { ...value.ollama },
  };
}

/** Owns hydration, optimistic changes, and serialized two-runtime persistence. */
export class LocalModelSettingsRuntime {
  readonly store: ModelRuntimeSettingsStore;
  #snapshot: LocalModelSettingsSnapshot = Object.freeze({
    available: Object.freeze({
      ...NO_MODEL_RUNTIME_AVAILABILITY,
    }),
    settings: Object.freeze(copySettings(
      DEFAULT_MODEL_RUNTIME_SETTINGS,
    )),
    editable: false,
    applying: false,
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #persistedSettings = copySettings(
    DEFAULT_MODEL_RUNTIME_SETTINGS,
  );
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(store: ModelRuntimeSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): LocalModelSettingsSnapshot =>
    this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    if (this.#initializePromise === undefined) {
      let tracked: Promise<void>;
      tracked = this.#initialize().finally(() => {
        if (this.#initializePromise === tracked) {
          this.#initializePromise = undefined;
        }
      });
      this.#initializePromise = tracked;
    }
    return this.#initializePromise;
  }

  retry(): Promise<void> {
    return this.initialize();
  }

  setEnabled(
    id: LocalModelRuntimeId,
    enabled: boolean,
  ): void {
    if (!this.#snapshot.editable) {
      throw new Error("model runtime settings are not editable");
    }
    if (!this.#snapshot.available[id]) {
      throw new Error(`${id} command is unavailable`);
    }
    const settings = copySettings(this.#snapshot.settings);
    settings[id] = { enabled };
    this.#commit(settings);
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
      this.#publish({
        error: "unavailable",
      });
      return;
    }
    try {
      const snapshot = parseModelRuntimeSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      if (snapshot.error === "read") {
        this.#publish({
          available: snapshot.available,
          editable: false,
          error: "read",
        });
        return;
      }
      this.#persistedSettings = copySettings(snapshot.settings);
      this.#publish({
        available: snapshot.available,
        settings: snapshot.settings,
        editable: true,
        error: undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({
        editable: false,
        error: "read",
      });
    }
  }

  #commit(value: Readonly<ModelRuntimeSettings>): void {
    const settings = parseModelRuntimeSettings(value);
    if (sameSettings(settings, this.#snapshot.settings)) return;
    this.#publish({
      settings,
      applying: true,
      error: undefined,
    });

    const generation = ++this.#saveGeneration;
    const payload = copySettings(settings);
    const operation = this.#saveTail.then(async () => {
      await this.store.write(payload);
    });
    this.#saveTail = operation.then(
      () => {
        this.#persistedSettings = copySettings(payload);
        if (
          this.#disposed ||
          generation !== this.#saveGeneration
        ) {
          return;
        }
        this.#publish({
          applying: false,
          error: undefined,
        });
      },
      () => {
        if (
          this.#disposed ||
          generation !== this.#saveGeneration
        ) {
          return;
        }
        this.#publish({
          settings: this.#persistedSettings,
          applying: false,
          error: "write",
        });
      },
    );
  }

  #publish(
    patch: Partial<
      Omit<LocalModelSettingsSnapshot, "revision">
    >,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      available: Object.freeze({
        ...(patch.available ?? this.#snapshot.available),
      }),
      settings: Object.freeze(
        copySettings(
          patch.settings ?? this.#snapshot.settings,
        ),
      ),
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}

function sameSettings(
  left: Readonly<ModelRuntimeSettings>,
  right: Readonly<ModelRuntimeSettings>,
): boolean {
  return (
    left.lmStudio.enabled === right.lmStudio.enabled &&
    left.ollama.enabled === right.ollama.enabled
  );
}
