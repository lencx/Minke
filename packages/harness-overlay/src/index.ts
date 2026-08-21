import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  isMinkeHostRpcEndpoint,
  MINKE_HOST_PROTOCOL_VERSION,
  MINKE_HOST_RPC_CHANNEL,
  type MinkeHostCapabilities,
  type MinkeHostRpcEndpoint,
  type MinkeHostRpcResponse,
} from "./minke-host-contract.ts";
import {
  FileManagerRuntime,
} from "./host/file-manager.ts";
import {
  defaultHostTerminalShell,
  HostTerminalRuntime,
  loadHostTerminalPty,
} from "./host/terminal.ts";
import {
  installMinkePwaHost,
  type PwaWebServer,
} from "./host/pwa.ts";
import {
  parseFileManagerDiffRequest,
  parseFileManagerListRequest,
  parseFileManagerPreviewRequest,
  parseFileManagerWriteRequest,
} from "./tabs/files-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalReadRequest,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
} from "./tabs/terminal-contract.ts";

export const name = "minke-host";
export const inject = ["connection", "webServer"];

export interface Config {
  /** Absolute filesystem boundary exposed to remote Files tabs. */
  readonly rootPath?: string;
}

interface HostRpcError {
  readonly code: "bad-request" | "internal";
  readonly message: string;
  readonly details: {
    readonly issues?: readonly never[];
  };
}

type HostRpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: HostRpcError };

type HostRpcHandlers = {
  readonly [Endpoint in MinkeHostRpcEndpoint]: (
    payload: unknown,
    signal: AbortSignal,
  ) =>
    | MinkeHostRpcResponse<Endpoint>
    | Promise<MinkeHostRpcResponse<Endpoint>>;
};

interface MinkeHostContext {
  effect(
    callback: () => void | (() => void | Promise<void>),
    label: string,
  ): unknown;
  readonly connection: {
    readonly rpc: {
      handle(
        channel: string,
        handler: (
          endpoint: string,
          payload: unknown,
          signal: AbortSignal,
        ) => Promise<HostRpcResult>,
        options: { readonly authority: "trusted-host" },
      ): () => Promise<void>;
    };
  };
  readonly webServer: PwaWebServer;
}

function configuredRoot(config: Config | undefined): string {
  const candidate = config?.rootPath?.trim();
  if (candidate === undefined || candidate === "") {
    return resolve(homedir());
  }
  if (!isAbsolute(candidate)) {
    throw new TypeError("Minke Host rootPath must be absolute");
  }
  return resolve(candidate);
}

function failure(error: unknown): HostRpcResult {
  const message =
    error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError) {
    return {
      ok: false,
      error: {
        code: "bad-request",
        message,
        details: { issues: [] },
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "internal",
      message,
      details: {},
    },
  };
}

/**
 * Mount portable Minke capabilities on DSH's trusted browser transport seam.
 * Browser Files and Terminal adapters keep native-only Web views and OS path
 * opening behind Electron preload.
 */
export function apply(
  ctx: MinkeHostContext,
  config?: Config,
): void {
  const rootPath = configuredRoot(config);
  const files = new FileManagerRuntime({
    rootPath,
    openPath: async () =>
      "native path opening is unavailable through Minke Host",
  });
  const terminalShell = defaultHostTerminalShell();
  const terminal = new HostTerminalRuntime({
    pty: loadHostTerminalPty,
    shell: terminalShell.shell,
    shellArgs: terminalShell.args,
    defaultCwd: rootPath,
    environment: process.env,
  });
  ctx.effect(
    () => () => terminal.dispose(),
    "minke-host: Terminal runtime",
  );
  ctx.effect(
    () => installMinkePwaHost(ctx.webServer),
    "minke-host: PWA resources",
  );
  const capabilities: MinkeHostCapabilities = {
    protocolVersion: MINKE_HOST_PROTOCOL_VERSION,
    files: {
      available: true,
      nativeOpen: false,
      root: rootPath,
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
  const handlers: HostRpcHandlers = {
    capabilities: () => capabilities,
    "files.diff": (payload) =>
      files.diff(parseFileManagerDiffRequest(payload)),
    "files.list": (payload) =>
      files.list(parseFileManagerListRequest(payload)),
    "files.preview": (payload) =>
      files.preview(parseFileManagerPreviewRequest(payload)),
    "files.write": (payload) =>
      files.write(parseFileManagerWriteRequest(payload)),
    "terminal.close": (payload) => {
      terminal.close(parseTerminalSessionId(payload));
      return null;
    },
    "terminal.create": (payload) =>
      terminal.create(parseTerminalCreateRequest(payload)),
    "terminal.read": (payload, signal) =>
      terminal.read(
        parseTerminalReadRequest(payload),
        signal,
      ),
    "terminal.resize": (payload) => {
      terminal.resize(parseTerminalResizeRequest(payload));
      return null;
    },
    "terminal.write": (payload) => {
      terminal.write(parseTerminalWriteRequest(payload));
      return null;
    },
  };

  ctx.connection.rpc.handle(
    MINKE_HOST_RPC_CHANNEL,
    async (endpoint, payload, signal) => {
      if (!isMinkeHostRpcEndpoint(endpoint)) {
        return {
          ok: false,
          error: {
            code: "bad-request",
            message: `unknown Minke Host endpoint: ${endpoint}`,
            details: { issues: [] },
          },
        };
      }
      try {
        return {
          ok: true,
          value: await handlers[endpoint](payload, signal),
        };
      } catch (error) {
        return failure(error);
      }
    },
    { authority: "trusted-host" },
  );
}
