/** Renderer-safe contracts for Minke's optional remote-access module. */
export const REMOTE_SETTINGS_READ_CHANNEL =
  "minke:remote:settings:read";
export const REMOTE_SETTINGS_WRITE_CHANNEL =
  "minke:remote:settings:write";
export const REMOTE_RUNTIME_CHANGED_CHANNEL =
  "minke:remote:runtime:changed";

export const REMOTE_METHODS = Object.freeze([
  Object.freeze({
    id: "tailscale",
    displayName: "Tailscale",
  }),
  Object.freeze({
    id: "cloudflare",
    displayName: "Cloudflare Access",
  }),
] as const);

export type RemoteMethodId =
  (typeof REMOTE_METHODS)[number]["id"];
export type TailscaleTransport = "serve" | "direct";
export type RemoteTransport =
  | TailscaleTransport
  | "access";

export const DEFAULT_CLOUDFLARE_ORIGIN_PORT = 49_321;

export interface RemoteSettings {
  enabled: boolean;
  method: RemoteMethodId;
  tailscale: {
    transport: TailscaleTransport;
    ipAddress: string;
  };
  cloudflare: {
    hostnameMode: "generated" | "custom";
    domain: string;
    generatedLabel: string;
    customHostname: string;
    teamName: string;
    audience: string;
    tunnel: string;
    configPath: string;
    originPort: number;
  };
}

export interface RemoteAvailability {
  tailscale: boolean;
  cloudflare: boolean;
}

export const DEFAULT_REMOTE_SETTINGS: Readonly<RemoteSettings> =
  Object.freeze({
    enabled: false,
    method: "tailscale",
    tailscale: Object.freeze({
      transport: "serve",
      ipAddress: "",
    }),
    cloudflare: Object.freeze({
      hostnameMode: "generated",
      domain: "",
      generatedLabel: "",
      customHostname: "",
      teamName: "",
      audience: "",
      tunnel: "",
      configPath: "",
      originPort: DEFAULT_CLOUDFLARE_ORIGIN_PORT,
    }),
  });

const HOSTNAME_ALPHABET =
  "0123456789abcdefghjkmnpqrstvwxyz";
const REMOTE_HOSTNAME_LABEL =
  /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/** Return whether a value is one canonical DNS hostname label. */
export function isRemoteHostnameLabel(
  value: string,
): boolean {
  return (
    value === value.trim().toLowerCase() &&
    REMOTE_HOSTNAME_LABEL.test(value)
  );
}

/** Generate a compact DNS-safe 80-bit label with no machine metadata. */
export function createRemoteHostnameLabel(
  entropy?: Uint8Array,
): string {
  const bytes =
    entropy === undefined
      ? globalThis.crypto.getRandomValues(new Uint8Array(10))
      : new Uint8Array(entropy);
  if (bytes.length !== 10) {
    throw new TypeError(
      "remote hostname entropy must contain 10 bytes",
    );
  }
  let buffer = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += HOSTNAME_ALPHABET[
        (buffer >>> bits) & 31
      ];
      buffer &= (1 << bits) - 1;
    }
  }
  return `m-${encoded}`;
}

/** Create fresh default settings, including the non-semantic host label. */
export function createDefaultRemoteSettings(
  entropy?: Uint8Array,
): RemoteSettings {
  return {
    enabled: false,
    method: "tailscale",
    tailscale: {
      transport: "serve",
      ipAddress: "",
    },
    cloudflare: {
      ...DEFAULT_REMOTE_SETTINGS.cloudflare,
      generatedLabel: createRemoteHostnameLabel(entropy),
    },
  };
}

export const NO_REMOTE_AVAILABILITY:
  Readonly<RemoteAvailability> = Object.freeze({
    tailscale: false,
    cloudflare: false,
  });

export type RemoteRuntimeState =
  | "disabled"
  | "unavailable"
  | "starting"
  | "stopping"
  | "retrying"
  | "ready"
  | "active"
  | "error";

export type RemoteRuntimeError =
  | "status"
  | "serve"
  | "serve-conflict"
  | "serve-https"
  | "serve-permission"
  | "direct-ip"
  | "direct-bind"
  | "harness-control"
  | "cloudflare-config"
  | "cloudflare-access"
  | "cloudflare-tunnel";

export interface RemoteRuntimeSnapshot {
  method: RemoteMethodId;
  transport: RemoteTransport;
  state: RemoteRuntimeState;
  /** Stable, clean public origin used by status and Remote Hub links. */
  url?: string;
  /** Ephemeral browser bootstrap capability; never persisted or proxied. */
  bootstrapUrl?: string;
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

function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
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
  const cloudflare = object(
    settings.cloudflare,
    "Cloudflare remote settings",
  );
  if (
    !hasExactKeys(settings, [
      "enabled",
      "method",
      "tailscale",
      "cloudflare",
    ]) ||
    typeof settings.enabled !== "boolean" ||
    (
      settings.method !== "tailscale" &&
      settings.method !== "cloudflare"
    ) ||
    !hasExactKeys(tailscale, [
      "transport",
      "ipAddress",
    ]) ||
    (
      tailscale.transport !== "serve" &&
      tailscale.transport !== "direct"
    ) ||
    !isBoundedString(tailscale.ipAddress, 64) ||
    !hasExactKeys(cloudflare, [
      "hostnameMode",
      "domain",
      "generatedLabel",
      "customHostname",
      "teamName",
      "audience",
      "tunnel",
      "configPath",
      "originPort",
    ]) ||
    (
      cloudflare.hostnameMode !== "generated" &&
      cloudflare.hostnameMode !== "custom"
    ) ||
    !isBoundedString(cloudflare.domain, 253) ||
    !isBoundedString(cloudflare.generatedLabel, 63) ||
    !isBoundedString(cloudflare.customHostname, 253) ||
    !isBoundedString(cloudflare.teamName, 253) ||
    !isBoundedString(cloudflare.audience, 512) ||
    !isBoundedString(cloudflare.tunnel, 256) ||
    !isBoundedString(cloudflare.configPath, 4_096) ||
    !Number.isInteger(cloudflare.originPort) ||
    Number(cloudflare.originPort) < 1_024 ||
    Number(cloudflare.originPort) > 65_535
  ) {
    throw new TypeError("invalid remote settings");
  }
  return {
    enabled: settings.enabled,
    method: settings.method,
    tailscale: {
      transport: tailscale.transport,
      ipAddress: tailscale.ipAddress,
    },
    cloudflare: {
      hostnameMode: cloudflare.hostnameMode,
      domain: cloudflare.domain,
      generatedLabel: cloudflare.generatedLabel,
      customHostname: cloudflare.customHostname,
      teamName: cloudflare.teamName,
      audience: cloudflare.audience,
      tunnel: cloudflare.tunnel,
      configPath: cloudflare.configPath,
      originPort: cloudflare.originPort as number,
    },
  };
}

/**
 * Upgrade previously shipped remote sections. Keep this parser out of IPC so
 * obsolete shapes are accepted exclusively at the durable-file seam.
 */
export function migrateLegacyRemoteSettings(
  value: unknown,
): RemoteSettings {
  const settings = object(value, "legacy remote settings");
  const tailscale = object(
    settings.tailscale,
    "legacy Tailscale remote settings",
  );
  if (
    hasExactKeys(settings, [
      "enabled",
      "method",
      "tailscale",
      "cloudflare",
    ]) &&
    hasExactKeys(tailscale, ["transport"])
  ) {
    return parseRemoteSettings({
      ...settings,
      tailscale: {
        transport: tailscale.transport,
        ipAddress: "",
      },
    });
  }
  if (
    !hasExactKeys(settings, ["tailscale"]) ||
    !hasExactKeys(tailscale, ["enabled"]) ||
    typeof tailscale.enabled !== "boolean"
  ) {
    throw new TypeError("invalid legacy remote settings");
  }
  return {
    ...createDefaultRemoteSettings(),
    enabled: tailscale.enabled,
  };
}

/** Validate which concrete remote commands the desktop discovered. */
export function parseRemoteAvailability(
  value: unknown,
): RemoteAvailability {
  const availability = object(value, "remote availability");
  if (
    !hasExactKeys(availability, ["tailscale", "cloudflare"]) ||
    typeof availability.tailscale !== "boolean" ||
    typeof availability.cloudflare !== "boolean"
  ) {
    throw new TypeError("invalid remote availability");
  }
  return {
    tailscale: availability.tailscale,
    cloudflare: availability.cloudflare,
  };
}

/** Return whether a value is a canonical Tailscale CGNAT IPv4 address. */
export function isTailscaleIpv4(
  hostname: string,
): boolean {
  const parts = hostname.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^(?:0|[1-9]\d{0,2})$/u.test(part) ||
        Number(part) > 255,
    )
  ) {
    return false;
  }
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return first === 100 && second >= 64 && second <= 127;
}

function parseRemoteUrl(
  value: unknown,
  method: RemoteMethodId,
  transport: RemoteTransport,
): string {
  if (typeof value !== "string") {
    throw new TypeError("invalid remote runtime snapshot");
  }
  try {
    const url = new URL(value);
    const clean =
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      value === url.origin;
    const valid =
      method === "tailscale" && transport === "serve"
        ? (
            url.protocol === "https:" &&
            url.port === "" &&
            url.hostname.endsWith(".ts.net")
          )
        : method === "tailscale" && transport === "direct"
          ? (
              url.protocol === "http:" &&
              url.port !== "" &&
              isTailscaleIpv4(url.hostname)
            )
          : method === "cloudflare" && transport === "access"
            ? (
                url.protocol === "https:" &&
                url.port === "" &&
                url.hostname.includes(".") &&
                !url.hostname.endsWith(".ts.net")
              )
            : false;
    if (!clean || !valid) {
      throw new TypeError("invalid remote runtime snapshot");
    }
    return url.origin;
  } catch {
    throw new TypeError("invalid remote runtime snapshot");
  }
}

const DSH_LAUNCH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Validate the process-scoped DSH browser launch capability. */
export function parseRemoteBootstrapToken(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    !DSH_LAUNCH_TOKEN_PATTERN.test(value)
  ) {
    throw new TypeError("invalid remote bootstrap token");
  }
  return value;
}

function parseRemoteBootstrapUrl(
  value: unknown,
  publicUrl: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError("invalid remote runtime snapshot");
  }
  try {
    const url = new URL(value);
    const entries = [...url.searchParams];
    const token = entries[0]?.[1];
    if (
      url.origin !== publicUrl ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.hash !== "" ||
      entries.length !== 1 ||
      entries[0]?.[0] !== "token" ||
      token === undefined ||
      parseRemoteBootstrapToken(token) !== token ||
      value !== url.href
    ) {
      throw new TypeError("invalid remote runtime snapshot");
    }
    return url.href;
  } catch {
    throw new TypeError("invalid remote runtime snapshot");
  }
}

function isRuntimePair(
  method: unknown,
  transport: unknown,
): method is RemoteMethodId {
  return (
    (
      method === "tailscale" &&
      (transport === "serve" || transport === "direct")
    ) ||
    (method === "cloudflare" && transport === "access")
  );
}

const REMOTE_RUNTIME_ERRORS:
  ReadonlySet<RemoteRuntimeError> = new Set([
  "status",
  "serve",
  "serve-conflict",
  "serve-https",
  "serve-permission",
  "direct-ip",
  "direct-bind",
  "harness-control",
  "cloudflare-config",
  "cloudflare-access",
  "cloudflare-tunnel",
]);

/**
 * Validate the finite runtime state exposed to the renderer.
 *
 * The optional bootstrap URL is an ephemeral capability tied exactly to the
 * clean public origin. It is intentionally absent from durable settings and
 * provider launch configuration.
 */
export function parseRemoteRuntimeSnapshot(
  value: unknown,
): RemoteRuntimeSnapshot {
  const runtime = object(value, "remote runtime snapshot");
  const keys = Object.keys(runtime);
  if (
    keys.some(
      (key) =>
        key !== "method" &&
        key !== "transport" &&
        key !== "state" &&
        key !== "url" &&
        key !== "bootstrapUrl" &&
        key !== "error",
    ) ||
    !isRuntimePair(runtime.method, runtime.transport) ||
    ![
      "disabled",
      "unavailable",
      "starting",
      "stopping",
      "retrying",
      "ready",
      "active",
      "error",
    ].includes(String(runtime.state))
  ) {
    throw new TypeError("invalid remote runtime snapshot");
  }
  const method = runtime.method;
  const transport = runtime.transport as RemoteTransport;
  const state = runtime.state as RemoteRuntimeState;
  const hasUrl = runtime.url !== undefined;
  const hasBootstrapUrl = runtime.bootstrapUrl !== undefined;
  const hasError = runtime.error !== undefined;
  if (
    ((state === "ready" || state === "active") !== hasUrl) ||
    (hasBootstrapUrl && !hasUrl) ||
    (
      (
        state === "error" ||
        state === "retrying"
      ) !== hasError
    ) ||
    (
      hasError &&
      !REMOTE_RUNTIME_ERRORS.has(
        runtime.error as RemoteRuntimeError,
      )
    )
  ) {
    throw new TypeError("invalid remote runtime snapshot");
  }
  const url = hasUrl
    ? parseRemoteUrl(
        runtime.url,
        method,
        transport,
      )
    : undefined;
  return {
    method,
    transport,
    state,
    ...(url === undefined ? {} : { url }),
    ...(hasBootstrapUrl && url !== undefined
      ? {
          bootstrapUrl: parseRemoteBootstrapUrl(
            runtime.bootstrapUrl,
            url,
          ),
        }
      : {}),
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
