import {
  createRemoteHostnameLabel,
  DEFAULT_REMOTE_SETTINGS,
  NO_REMOTE_AVAILABILITY,
  parseRemoteSettings,
  parseRemoteSettingsSnapshot,
  type RemoteMethodId,
  type RemoteSettings,
  type RemoteSettingsSnapshot as RemoteDataSnapshot,
  type TailscaleTransport,
} from "@lencx/minke-remote-access/contract";
import type {
  RemoteSettingsStore,
} from "../desktop/contracts.ts";

export type RemoteSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export type RemotePendingChange =
  | "enable"
  | "disable"
  | "configuration";

export interface RemoteSettingsSnapshot {
  data: Readonly<RemoteDataSnapshot>;
  editable: boolean;
  refreshing: boolean;
  saving: boolean;
  restartRequired: boolean;
  pendingChange: RemotePendingChange | undefined;
  error: RemoteSettingsErrorKind | undefined;
  revision: number;
}

function copySettings(
  settings: Readonly<RemoteSettings>,
): RemoteSettings {
  return {
    enabled: settings.enabled,
    method: settings.method,
    tailscale: { ...settings.tailscale },
    cloudflare: { ...settings.cloudflare },
  };
}

function defaultData(): RemoteDataSnapshot {
  return {
    available: { ...NO_REMOTE_AVAILABILITY },
    settings: copySettings(DEFAULT_REMOTE_SETTINGS),
    runtime: {
      method: "tailscale",
      transport: "serve",
      state: "unavailable",
    },
  };
}

function settingsEqual(
  left: Readonly<RemoteSettings>,
  right: Readonly<RemoteSettings>,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.method === right.method &&
    left.tailscale.transport ===
      right.tailscale.transport &&
    left.cloudflare.hostnameMode ===
      right.cloudflare.hostnameMode &&
    left.cloudflare.domain === right.cloudflare.domain &&
    left.cloudflare.generatedLabel ===
      right.cloudflare.generatedLabel &&
    left.cloudflare.customHostname ===
      right.cloudflare.customHostname &&
    left.cloudflare.teamName === right.cloudflare.teamName &&
    left.cloudflare.audience === right.cloudflare.audience &&
    left.cloudflare.tunnel === right.cloudflare.tunnel &&
    left.cloudflare.configPath ===
      right.cloudflare.configPath &&
    left.cloudflare.originPort ===
      right.cloudflare.originPort
  );
}

/** Browser-side completeness hint; desktop validation remains authoritative. */
export function canEnableRemoteSettings(
  settings: Readonly<RemoteSettings>,
  available: Readonly<RemoteDataSnapshot["available"]>,
): boolean {
  if (!available[settings.method]) return false;
  if (settings.method === "tailscale") return true;
  const cloudflare = settings.cloudflare;
  const hasHostname =
    cloudflare.hostnameMode === "generated"
      ? (
          /^m-[0123456789abcdefghjkmnpqrstvwxyz]{16}$/u.test(
            cloudflare.generatedLabel,
          ) &&
          cloudflare.domain.includes(".")
        )
      : cloudflare.customHostname.includes(".");
  return (
    hasHostname &&
    cloudflare.teamName !== "" &&
    cloudflare.audience !== "" &&
    cloudflare.tunnel !== "" &&
    cloudflare.configPath !== ""
  );
}

/** Own renderer hydration and serialized persistence for remote access. */
export class RemoteSettingsRuntime {
  readonly store: RemoteSettingsStore;
  #snapshot: RemoteSettingsSnapshot = Object.freeze({
    data: Object.freeze(defaultData()),
    editable: false,
    refreshing: false,
    saving: false,
    restartRequired: false,
    pendingChange: undefined,
    error: undefined,
    revision: 0,
  });
  #initialSettings = copySettings(DEFAULT_REMOTE_SETTINGS);
  #persistedSettings = copySettings(DEFAULT_REMOTE_SETTINGS);
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

  setEnabled(enabled: boolean): void {
    const settings = this.#editableSettings();
    if (
      enabled &&
      !canEnableRemoteSettings(
        settings,
        this.#snapshot.data.available,
      )
    ) {
      throw new Error(
        "selected remote method is unavailable or incomplete",
      );
    }
    if (settings.enabled === enabled) return;
    settings.enabled = enabled;
    this.#update(settings);
  }

  /** Compatibility alias for the original one-method settings surface. */
  setTailscaleEnabled(enabled: boolean): void {
    this.setEnabled(enabled);
  }

  setMethod(method: RemoteMethodId): void {
    const settings = this.#editableSettings();
    if (settings.enabled) {
      throw new Error(
        "disable remote access before changing methods",
      );
    }
    if (settings.method === method) return;
    settings.method = method;
    this.#update(settings);
  }

  setTailscaleTransport(
    transport: TailscaleTransport,
  ): void {
    const settings = this.#editableSettings();
    if (settings.enabled) {
      throw new Error(
        "disable remote access before changing transports",
      );
    }
    if (settings.tailscale.transport === transport) return;
    settings.tailscale.transport = transport;
    this.#update(settings);
  }

  setCloudflareSettings(
    patch: Partial<RemoteSettings["cloudflare"]>,
  ): void {
    const settings = this.#editableSettings();
    if (settings.enabled) {
      throw new Error(
        "disable remote access before editing Cloudflare",
      );
    }
    settings.cloudflare = {
      ...settings.cloudflare,
      ...patch,
    };
    this.#update(settings);
  }

  regenerateCloudflareHostname(
    entropy?: Uint8Array,
  ): void {
    this.setCloudflareSettings({
      hostnameMode: "generated",
      generatedLabel: createRemoteHostnameLabel(entropy),
    });
  }

  async restart(): Promise<void> {
    if (!this.store.available) {
      throw new Error("remote settings are unavailable");
    }
    await this.#saveTail;
    await this.store.restart();
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

  #editableSettings(): RemoteSettings {
    if (!this.#snapshot.editable) {
      throw new Error("remote settings are not editable");
    }
    return copySettings(this.#snapshot.data.settings);
  }

  #update(value: RemoteSettings): void {
    const settings = parseRemoteSettings(value);
    if (
      settingsEqual(
        settings,
        this.#snapshot.data.settings,
      )
    ) {
      return;
    }
    const pendingChange = this.#pendingChange(settings);
    this.#publish({
      data: {
        ...this.#snapshot.data,
        settings,
      },
      saving: true,
      restartRequired: pendingChange !== undefined,
      pendingChange,
      error: undefined,
    });
    this.#persist(settings);
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
      this.#initialSettings = copySettings(data.settings);
      this.#persistedSettings = copySettings(data.settings);
      this.#publish({
        data,
        editable: true,
        saving: false,
        restartRequired: false,
        pendingChange: undefined,
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
      const settings = copySettings(data.settings);
      this.#persistedSettings = settings;
      const pendingChange = this.#pendingChange(settings);
      this.#publish({
        data,
        editable: true,
        refreshing: false,
        saving: false,
        restartRequired: pendingChange !== undefined,
        pendingChange,
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
      this.#persistedSettings = copySettings(payload);
    });
    this.#saveTail = operation.then(
      () => {
        if (
          this.#disposed ||
          generation !== this.#saveGeneration
        ) {
          return;
        }
        const pendingChange = this.#pendingChange(payload);
        this.#publish({
          saving: false,
          restartRequired: pendingChange !== undefined,
          pendingChange,
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
        const persisted = copySettings(
          this.#persistedSettings,
        );
        const pendingChange =
          this.#pendingChange(persisted);
        this.#publish({
          data: {
            ...this.#snapshot.data,
            settings: persisted,
          },
          saving: false,
          restartRequired: pendingChange !== undefined,
          pendingChange,
          error: "write",
        });
      },
    );
  }

  #pendingChange(
    settings: Readonly<RemoteSettings>,
  ): RemotePendingChange | undefined {
    if (settingsEqual(settings, this.#initialSettings)) {
      return undefined;
    }
    if (
      settings.enabled !== this.#initialSettings.enabled
    ) {
      return settings.enabled ? "enable" : "disable";
    }
    return "configuration";
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
        settings: Object.freeze(
          copySettings(nextData.settings),
        ),
        runtime: Object.freeze({
          ...nextData.runtime,
        }),
      }),
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
