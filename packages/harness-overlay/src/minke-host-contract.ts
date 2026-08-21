/** Transport-neutral contract shared by the Minke Host and browser adapter. */
export const MINKE_HOST_RPC_CHANNEL = "/minke";
export const MINKE_HOST_PROTOCOL_VERSION = 2;

export const MINKE_HOST_RPC_ENDPOINTS = [
  "capabilities",
  "files.diff",
  "files.list",
  "files.preview",
  "files.write",
  "terminal.close",
  "terminal.create",
  "terminal.read",
  "terminal.resize",
  "terminal.write",
] as const;

export type MinkeHostRpcEndpoint =
  (typeof MINKE_HOST_RPC_ENDPOINTS)[number];

export interface MinkeHostCapabilities {
  readonly protocolVersion: typeof MINKE_HOST_PROTOCOL_VERSION;
  readonly files: {
    readonly available: true;
    readonly nativeOpen: false;
    readonly root: string;
    readonly watch: false;
    readonly write: true;
  };
  readonly tabs: {
    readonly available: true;
    readonly embeddedWeb: false;
    readonly state: "client";
  };
  readonly terminal: {
    readonly available: true;
    readonly resize: true;
    readonly transport: "long-poll";
  };
}

function record(
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

/** Validate the capability handshake before a browser trusts the Host shape. */
export function parseMinkeHostCapabilities(
  value: unknown,
): MinkeHostCapabilities {
  const candidate = record(value, "Minke Host capabilities");
  const files = record(
    candidate.files,
    "Minke Host Files capabilities",
  );
  const tabs = record(
    candidate.tabs,
    "Minke Host Tabs capabilities",
  );
  const terminal = record(
    candidate.terminal,
    "Minke Host Terminal capabilities",
  );
  if (
    candidate.protocolVersion !== MINKE_HOST_PROTOCOL_VERSION ||
    files.available !== true ||
    files.nativeOpen !== false ||
    typeof files.root !== "string" ||
    files.root.length === 0 ||
    files.watch !== false ||
    files.write !== true ||
    tabs.available !== true ||
    tabs.embeddedWeb !== false ||
    tabs.state !== "client" ||
    terminal.available !== true ||
    terminal.resize !== true ||
    terminal.transport !== "long-poll"
  ) {
    throw new TypeError("Minke Host capabilities are incompatible");
  }
  return {
    protocolVersion: MINKE_HOST_PROTOCOL_VERSION,
    files: {
      available: true,
      nativeOpen: false,
      root: files.root,
      watch: false,
      write: true,
    },
    tabs: {
      available: true,
      embeddedWeb: false,
      state: "client",
    },
    terminal: {
      available: true,
      resize: true,
      transport: "long-poll",
    },
  };
}
