import {
  createRemoteHostnameLabel,
  DEFAULT_REMOTE_SETTINGS,
  isRemoteHostnameLabel,
  isTailscaleIpv4,
  NO_REMOTE_AVAILABILITY,
  parseRemoteRuntimeSnapshot,
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

export type RemoteSettingsOperation =
  | { readonly kind: "idle" }
  | { readonly kind: "refreshing" }
  | { readonly kind: "saving" };

export interface RemoteSettingsSnapshot {
  data: Readonly<RemoteDataSnapshot>;
  editable: boolean;
  operation: RemoteSettingsOperation;
  error: RemoteSettingsErrorKind | undefined;
  revision: number;
}

const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const IPV4_ADDRESS = /^\d+(?:\.\d+){3}$/u;

export type CloudflareBaseDomainAdvisory =
  | "invalid"
  | "nested";
export type CloudflareHostnameLabelAdvisory = "invalid";
export type TailscaleIpAddressAdvisory = "invalid";

export interface CloudflareHostnameFields {
  baseDomain: string;
  label: string;
}

/**
 * Present the one composed-hostname editor while preserving legacy custom
 * hostname settings until the user edits or regenerates them.
 */
export function cloudflareHostnameFields(
  settings: Readonly<RemoteSettings["cloudflare"]>,
): CloudflareHostnameFields {
  if (settings.hostnameMode === "generated") {
    return {
      baseDomain: settings.domain,
      label: settings.generatedLabel,
    };
  }
  const separator = settings.customHostname.indexOf(".");
  if (
    separator <= 0 ||
    separator === settings.customHostname.length - 1
  ) {
    return {
      baseDomain: "",
      label: settings.customHostname,
    };
  }
  return {
    baseDomain: settings.customHostname.slice(separator + 1),
    label: settings.customHostname.slice(0, separator),
  };
}

/** Return a non-blocking advisory for an optional Direct IP override. */
export function tailscaleIpAddressAdvisory(
  value: string,
): TailscaleIpAddressAdvisory | undefined {
  if (value === "" || isTailscaleIpv4(value)) {
    return undefined;
  }
  return "invalid";
}

/**
 * Return a non-blocking browser-side advisory for the generated host base.
 * The desktop Cloudflare parser remains the authoritative safety boundary.
 */
export function cloudflareBaseDomainAdvisory(
  value: string,
): CloudflareBaseDomainAdvisory | undefined {
  if (value === "") return undefined;
  if (
    value !== value.trim().toLowerCase() ||
    !DNS_NAME.test(value) ||
    IPV4_ADDRESS.test(value) ||
    value.endsWith(".ts.net") ||
    value.endsWith(".cloudflareaccess.com")
  ) {
    return "invalid";
  }
  return value.split(".").length > 2
    ? "nested"
    : undefined;
}

/** Return a non-blocking advisory for a manually edited host label. */
export function cloudflareHostnameLabelAdvisory(
  value: string,
): CloudflareHostnameLabelAdvisory | undefined {
  if (value === "" || isRemoteHostnameLabel(value)) {
    return undefined;
  }
  return "invalid";
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
    left.tailscale.ipAddress ===
      right.tailscale.ipAddress &&
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
          cloudflare.generatedLabel !== "" &&
          cloudflare.domain !== ""
        )
      : cloudflare.customHostname !== "";
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
    operation: Object.freeze({ kind: "idle" }),
    error: undefined,
    revision: 0,
  });
  #persistedSettings = copySettings(DEFAULT_REMOTE_SETTINGS);
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #refreshPromise: Promise<void> | undefined;
  #unsubscribeRuntime: (() => void) | undefined;
  #runtimeRevision = 0;
  #disposed = false;

  constructor(store: RemoteSettingsStore) {
    this.store = store;
    this.#unsubscribeRuntime = store.subscribe?.((snapshot) => {
      if (this.#disposed) return;
      this.#runtimeRevision += 1;
      this.#publish({
        data: {
          ...this.#snapshot.data,
          runtime: parseRemoteRuntimeSnapshot(snapshot),
        },
      });
    });
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
    this.setTailscaleSettings({ transport });
  }

  setTailscaleSettings(
    patch: Partial<RemoteSettings["tailscale"]>,
  ): void {
    const settings = this.#editableSettings();
    if (settings.enabled) {
      throw new Error(
        "disable remote access before editing Tailscale",
      );
    }
    settings.tailscale = {
      ...settings.tailscale,
      ...patch,
    };
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
    const { baseDomain } = cloudflareHostnameFields(
      this.#snapshot.data.settings.cloudflare,
    );
    this.setCloudflareSettings({
      hostnameMode: "generated",
      domain: baseDomain,
      generatedLabel: createRemoteHostnameLabel(entropy),
    });
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
    this.#unsubscribeRuntime?.();
    this.#unsubscribeRuntime = undefined;
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
    this.#publish({
      data: {
        ...this.#snapshot.data,
        settings,
      },
      operation: { kind: "saving" },
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
      const runtimeRevision = this.#runtimeRevision;
      const response = parseRemoteSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      const data = this.#preserveNewerRuntime(
        response,
        runtimeRevision,
      );
      this.#persistedSettings = copySettings(data.settings);
      this.#publish({
        data,
        editable: true,
        operation: { kind: "idle" },
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
    await this.#saveTail;
    this.#publish({
      operation: { kind: "refreshing" },
    });
    try {
      const runtimeRevision = this.#runtimeRevision;
      const response = parseRemoteSettingsSnapshot(
        await this.store.read(),
      );
      if (this.#disposed) return;
      const data = this.#preserveNewerRuntime(
        response,
        runtimeRevision,
      );
      this.#persistedSettings =
        copySettings(data.settings);
      this.#publish({
        data,
        editable: true,
        operation: { kind: "idle" },
        error: data.error === "read" ? "read" : undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({
        operation: { kind: "idle" },
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
        this.#publish({
          operation: { kind: "idle" },
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
        this.#publish({
          data: {
            ...this.#snapshot.data,
            settings: persisted,
          },
          operation: { kind: "idle" },
          error: "write",
        });
      },
    );
  }

  #preserveNewerRuntime(
    response: RemoteDataSnapshot,
    runtimeRevision: number,
  ): RemoteDataSnapshot {
    if (runtimeRevision === this.#runtimeRevision) {
      return response;
    }
    return {
      ...response,
      runtime: this.#snapshot.data.runtime,
    };
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
