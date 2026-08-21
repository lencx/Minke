/** Transport-neutral contract shared by the Minke Host and browser adapter. */
import type {
  FileManagerDiffRequest,
  FileManagerDiffResult,
  FileManagerListRequest,
  FileManagerListResult,
  FileManagerPreviewRequest,
  FileManagerPreviewResult,
  FileManagerWriteRequest,
  FileManagerWriteResult,
} from "./tabs/files-contract.ts";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from "./tabs/terminal-contract.ts";

export const MINKE_HOST_RPC_CHANNEL = "/minke";
export const MINKE_HOST_PROTOCOL_VERSION = 2;

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

/** One source of truth for every Host request and successful response. */
export type MinkeHostRpcMap = {
  readonly capabilities: {
    readonly request: Record<string, never>;
    readonly response: MinkeHostCapabilities;
  };
  readonly "files.diff": {
    readonly request: FileManagerDiffRequest;
    readonly response: FileManagerDiffResult;
  };
  readonly "files.list": {
    readonly request: FileManagerListRequest;
    readonly response: FileManagerListResult;
  };
  readonly "files.preview": {
    readonly request: FileManagerPreviewRequest;
    readonly response: FileManagerPreviewResult;
  };
  readonly "files.write": {
    readonly request: FileManagerWriteRequest;
    readonly response: FileManagerWriteResult;
  };
  readonly "terminal.close": {
    readonly request: string;
    readonly response: null;
  };
  readonly "terminal.create": {
    readonly request: TerminalCreateRequest;
    readonly response: TerminalCreateResult;
  };
  readonly "terminal.read": {
    readonly request: TerminalReadRequest;
    readonly response: TerminalReadResult;
  };
  readonly "terminal.resize": {
    readonly request: TerminalResizeRequest;
    readonly response: null;
  };
  readonly "terminal.write": {
    readonly request: TerminalWriteRequest;
    readonly response: null;
  };
}

export type MinkeHostRpcEndpoint = keyof MinkeHostRpcMap;
export type MinkeHostRpcRequest<
  Endpoint extends MinkeHostRpcEndpoint,
> = MinkeHostRpcMap[Endpoint]["request"];
export type MinkeHostRpcResponse<
  Endpoint extends MinkeHostRpcEndpoint,
> = MinkeHostRpcMap[Endpoint]["response"];

export const MINKE_HOST_RPC_ENDPOINTS = Object.freeze({
  capabilities: true,
  "files.diff": true,
  "files.list": true,
  "files.preview": true,
  "files.write": true,
  "terminal.close": true,
  "terminal.create": true,
  "terminal.read": true,
  "terminal.resize": true,
  "terminal.write": true,
} satisfies Readonly<Record<MinkeHostRpcEndpoint, true>>);

export function isMinkeHostRpcEndpoint(
  value: string,
): value is MinkeHostRpcEndpoint {
  return Object.hasOwn(MINKE_HOST_RPC_ENDPOINTS, value);
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
