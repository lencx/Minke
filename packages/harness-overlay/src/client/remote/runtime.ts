import {
  DEFAULT_REMOTE_SETTINGS,
  NO_REMOTE_AVAILABILITY,
  parseRemoteSettings,
  parseRemoteSettingsSnapshot,
  type RemoteSettings,
  type RemoteSettingsSnapshot as RemoteDataSnapshot,
} from "@lencx/minke-remote-access/contract";
import type {
  RemoteSettingsStore,
} from "../desktop/contracts.ts";

export type RemoteSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export interface RemoteSettingsSnapshot {
  data: Readonly<RemoteDataSnapshot>;
  editable: boolean;
  refreshing: boolean;
  restartRequired: boolean;
  error: RemoteSettingsErrorKind | undefined;
  revision: number;
}

function defaultData(): RemoteDataSnapshot {
  return {
    available: { ...NO_REMOTE_AVAILABILITY },
    settings: {
      tailscale: {
        ...DEFAULT_REMOTE_SETTINGS.tailscale,
      },
    },
    runtime: {
      method: "tailscale",
      state: "unavailable",
    },
  };
}

function copySettings(
  settings: Readonly<RemoteSettings>,
): RemoteSettings {
  return {
    tailscale: { ...settings.tailscale },
  };
}

/** Own renderer hydration and serialized persistence for remote opt-in. */
export class RemoteSettingsRuntime {
  readonly store: RemoteSettingsStore;
  #snapshot: RemoteSettingsSnapshot = Object.freeze({
    data: Object.freeze(defaultData()),
    editable: false,
    refreshing: false,
    restartRequired: false,
    error: undefined,
    revision: 0,
  });
  #initialEnabled = false;
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #refreshPromise: Promise<void> | undefined;
  #disposed = false;

  constructor(store: RemoteSettingsStore) {
    this.store = store;
  }

  getSnapshot = (): RemoteSettingsSnapshot => this.#snapshot;

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

  setTailscaleEnabled(enabled: boolean): void {
    if (!this.#snapshot.editable) {
      throw new Error("remote settings are not editable");
    }
    if (enabled && !this.#snapshot.data.available.tailscale) {
      throw new Error("Tailscale command is unavailable");
    }
    const settings = copySettings(this.#snapshot.data.settings);
    if (settings.tailscale.enabled === enabled) return;
    settings.tailscale = { enabled };
    const parsed = parseRemoteSettings(settings);
    this.#publish({
      data: {
        ...this.#snapshot.data,
        settings: parsed,
      },
      restartRequired: enabled !== this.#initialEnabled,
      error: undefined,
    });
    this.#persist(parsed);
  }

  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#refreshPromise ??= this.#refresh().finally(() => {
      this.#refreshPromise = undefined;
    });
    return this.#refreshPromise;
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
      const data = parseRemoteSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      this.#initialEnabled = data.settings.tailscale.enabled;
      this.#publish({
        data,
        editable: true,
        error: data.error === "read" ? "read" : undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({ error: "read" });
    }
  }

  async #refresh(): Promise<void> {
    if (!this.store.available) {
      this.#publish({ error: "unavailable" });
      return;
    }
    this.#publish({ refreshing: true });
    await this.#saveTail;
    try {
      const data = parseRemoteSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      this.#publish({
        data,
        editable: true,
        refreshing: false,
        error: data.error === "read" ? "read" : undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({
        refreshing: false,
        error: "read",
      });
    }
  }

  #persist(settings: RemoteSettings): void {
    const generation = ++this.#saveGeneration;
    const payload = copySettings(settings);
    const operation = this.#saveTail.then(async () => {
      await this.store.write(payload);
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
    patch: Partial<Omit<RemoteSettingsSnapshot, "revision">>,
  ): void {
    if (this.#disposed) return;
    const nextData = patch.data ?? this.#snapshot.data;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      data: Object.freeze({
        ...nextData,
        available: Object.freeze({
          ...nextData.available,
        }),
        settings: Object.freeze(copySettings(nextData.settings)),
        runtime: Object.freeze({
          ...nextData.runtime,
        }),
      }),
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
