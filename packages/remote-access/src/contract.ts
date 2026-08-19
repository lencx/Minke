/** Renderer-safe contracts for Minke's optional remote-access module. */
export const REMOTE_SETTINGS_READ_CHANNEL =
  "minke:remote:settings:read";
export const REMOTE_SETTINGS_WRITE_CHANNEL =
  "minke:remote:settings:write";

export const REMOTE_METHODS = Object.freeze([
  Object.freeze({
    id: "tailscale",
    displayName: "Tailscale",
  }),
] as const);

export type RemoteMethodId =
  (typeof REMOTE_METHODS)[number]["id"];

export interface RemoteSettings {
  tailscale: {
    enabled: boolean;
  };
}

export interface RemoteAvailability {
  tailscale: boolean;
}

export const DEFAULT_REMOTE_SETTINGS: Readonly<RemoteSettings> =
  Object.freeze({
    tailscale: Object.freeze({ enabled: false }),
  });

export const NO_REMOTE_AVAILABILITY:
  Readonly<RemoteAvailability> = Object.freeze({
    tailscale: false,
  });

export type RemoteRuntimeState =
  | "disabled"
  | "unavailable"
  | "ready"
  | "active"
  | "error";

export type RemoteRuntimeError = "status" | "serve";

export interface RemoteRuntimeSnapshot {
  method: "tailscale";
  state: RemoteRuntimeState;
  url?: string;
  error?: RemoteRuntimeError;
}

export interface RemoteSettingsSnapshot {
  available: RemoteAvailability;
  settings: RemoteSettings;
  runtime: RemoteRuntimeSnapshot;
  error?: "read";
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

/** Validate the durable, default-closed remote access preferences. */
export function parseRemoteSettings(
  value: unknown,
): RemoteSettings {
  const settings = object(value, "remote settings");
  const tailscale = object(
    settings.tailscale,
    "Tailscale remote settings",
  );
  if (
    !hasExactKeys(settings, ["tailscale"]) ||
    !hasExactKeys(tailscale, ["enabled"]) ||
    typeof tailscale.enabled !== "boolean"
  ) {
    throw new TypeError("invalid remote settings");
  }
  return {
    tailscale: {
      enabled: tailscale.enabled,
    },
  };
}

/** Validate which concrete remote commands the desktop discovered. */
export function parseRemoteAvailability(
  value: unknown,
): RemoteAvailability {
  const availability = object(value, "remote availability");
  if (
    !hasExactKeys(availability, ["tailscale"]) ||
    typeof availability.tailscale !== "boolean"
  ) {
    throw new TypeError("invalid remote availability");
  }
  return {
    tailscale: availability.tailscale,
  };
}

function parseRemoteUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("invalid remote runtime snapshot");
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      !url.hostname.endsWith(".ts.net") ||
      value !== url.origin
    ) {
      throw new TypeError("invalid remote runtime snapshot");
    }
    return url.origin;
  } catch {
    throw new TypeError("invalid remote runtime snapshot");
  }
}

/** Validate the finite, secret-free runtime state exposed to the renderer. */
export function parseRemoteRuntimeSnapshot(
  value: unknown,
): RemoteRuntimeSnapshot {
  const runtime = object(value, "remote runtime snapshot");
  const keys = Object.keys(runtime);
  if (
    keys.some(
      (key) =>
        key !== "method" &&
        key !== "state" &&
        key !== "url" &&
        key !== "error",
    ) ||
    runtime.method !== "tailscale" ||
    ![
      "disabled",
      "unavailable",
      "ready",
      "active",
      "error",
    ].includes(String(runtime.state))
  ) {
    throw new TypeError("invalid remote runtime snapshot");
  }
  const state = runtime.state as RemoteRuntimeState;
  const hasUrl = runtime.url !== undefined;
  const hasError = runtime.error !== undefined;
  if (
    ((state === "ready" || state === "active") !== hasUrl) ||
    ((state === "error") !== hasError) ||
    (
      hasError &&
      runtime.error !== "status" &&
      runtime.error !== "serve"
    )
  ) {
    throw new TypeError("invalid remote runtime snapshot");
  }
  return {
    method: "tailscale",
    state,
    ...(hasUrl ? { url: parseRemoteUrl(runtime.url) } : {}),
    ...(hasError
      ? { error: runtime.error as RemoteRuntimeError }
      : {}),
  };
}

/** Validate one renderer-facing settings snapshot crossing desktop IPC. */
export function parseRemoteSettingsSnapshot(
  value: unknown,
): RemoteSettingsSnapshot {
  const snapshot = object(value, "remote settings snapshot");
  const keys = Object.keys(snapshot);
  if (
    keys.some(
      (key) =>
        key !== "available" &&
        key !== "settings" &&
        key !== "runtime" &&
        key !== "error",
    ) ||
    (
      snapshot.error !== undefined &&
      snapshot.error !== "read"
    )
  ) {
    throw new TypeError("invalid remote settings snapshot");
  }
  return {
    available: parseRemoteAvailability(snapshot.available),
    settings: parseRemoteSettings(snapshot.settings),
    runtime: parseRemoteRuntimeSnapshot(snapshot.runtime),
    ...(snapshot.error === "read" ? { error: "read" as const } : {}),
  };
}
