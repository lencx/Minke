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
  apply as installAgentBrowserTools,
} from "./host/agent-browser-tools.ts";
import {
  installAgentBrowserParentLifetime,
} from "./host/agent-browser-process.ts";
import {
  AGENT_BROWSER_IPC_VERSION_ENV,
  AGENT_BROWSER_PROTOCOL_VERSION,
} from "./agent-browser-contract.ts";
import {
  installAgentTurnControl,
  type AgentTurnSessionsPort,
} from "./host/agent-turn-control.ts";
import {
  RemotePreviewRuntime,
  type RemotePreviewWebServer,
} from "./host/remote-preview.ts";
import {
  installTrustedHostControl,
} from "./host/trusted-host-control.ts";
import {
  calibrateMinkeImIdentity,
  isMinkeImSessionId,
} from "./host/im-identity.ts";
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
export const inject = [
  "agentPresets",
  "agents",
  "apiProxy",
  "attachments",
  "connection",
  "systemPrompt",
  "tools",
  "webServer",
];

export interface Config {
  /** Absolute filesystem boundary exposed to remote Files tabs. */
  readonly rootPath?: string;
  /** Durable private storage for generated HTML preview snapshots. */
  readonly previewStorePath?: string;
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

interface MinkeHostAgent {
  readonly id: string;
  readonly session: {
    readonly id: string;
    readonly header?: {
      readonly cwd?: string;
    };
  };
  readonly ctx: {
    readonly systemPrompt: {
      section(section: {
        readonly name: string;
        readonly order: number;
        readonly text: string;
      }): () => void;
    };
    readonly tools: {
      restrict(filter: {
        readonly deny: readonly string[];
      }): () => void;
    };
  };
}

interface MinkeHostContext {
  get(name: "appExit"): ((code: number) => void) | undefined;
  effect(
    callback: () => void | (() => void | Promise<void>),
    label: string,
  ): unknown;
  readonly connection: {
    replaceTrustedHosts(
      trustedHosts: readonly string[],
    ): void;
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
  readonly apiProxy: {
    readonly sessions: AgentTurnSessionsPort;
  };
  readonly agents: {
    get(sessionId: string): MinkeHostAgent | undefined;
  };
  readonly tools: {
    register(definition: {
      readonly name: string;
      readonly description: string;
      readonly parameters: Record<string, unknown>;
      readonly output: {
        readonly schema: Record<string, unknown>;
        render(
          args: unknown,
          value: unknown,
        ): readonly (
          | { readonly type: "text"; readonly text: string }
          | {
              readonly type: "image";
              readonly attachment: {
                readonly attachmentId: string;
                readonly mediaType: "image/png";
                readonly bytes: number;
                readonly width: number;
                readonly height: number;
              };
            }
        )[];
      };
      readonly timeoutMs: number;
      execute(
        args: unknown,
        exec: {
          readonly signal: AbortSignal;
          readonly agent?: {
            readonly session: { readonly id: string };
          };
        },
      ): Promise<unknown>;
      finalizeContent?(
        exec: Readonly<{
          readonly signal: AbortSignal;
          readonly agent?: {
            readonly session: { readonly id: string };
          };
        }>,
        result: Readonly<{
          readonly isError: boolean;
          readonly value?: unknown;
          readonly content: readonly unknown[];
        }>,
      ): readonly unknown[] | undefined;
      presentCall(args: unknown): unknown;
    }): unknown;
  };
  readonly attachments: {
    saveImage(input: {
      readonly data: Uint8Array;
      readonly mediaType: "image/png";
      readonly name?: string;
    }): Promise<{
      readonly attachmentId: string;
      readonly mediaType: "image/png";
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
      readonly name?: string;
      readonly originalDimensions?: {
        readonly width: number;
        readonly height: number;
      };
    }>;
  };
  readonly agentPresets: {
    composedPreset(agentContext: unknown): string | undefined;
  };
  on(
    event: "agent/created" | "agent/disposed",
    listener: (payload: {
      readonly agent: MinkeHostAgent;
    }) => void,
  ): unknown;
  on(
    event: "agent-preset/selected",
    listener: (
      sessionId: string,
      agentPreset: string,
    ) => void,
  ): unknown;
  readonly webServer: PwaWebServer & RemotePreviewWebServer;
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

function configuredPreviewStore(
  config: Config | undefined,
): string {
  const candidate = config?.previewStorePath?.trim();
  if (candidate === undefined || candidate === "") {
    return resolve(process.cwd(), "remote-previews");
  }
  if (!isAbsolute(candidate)) {
    throw new TypeError(
      "Minke Host previewStorePath must be absolute",
    );
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
  const previews = new RemotePreviewRuntime({
    rootPath,
    storePath: configuredPreviewStore(config),
    webServer: ctx.webServer,
  });
  ctx.effect(
    () => () => previews.dispose(),
    "minke-host: Remote HTML previews",
  );
  ctx.on("agent/created", ({ agent }) => {
    calibrateMinkeImIdentity(agent);
  });
  installAgentTurnControl(ctx, undefined, {
    previewPublisher: {
      async publish(input) {
        if (!isMinkeImSessionId(input.sessionId)) return [];
        const agent = ctx.agents.get(input.sessionId);
        return await previews.publish({
          cwd: agent?.session.header?.cwd ?? rootPath,
          operationId: input.operationId,
          paths: input.paths,
        });
      },
    },
  });
  installTrustedHostControl(ctx);
  const agentBrowserIpcVersion =
    process.env[AGENT_BROWSER_IPC_VERSION_ENV];
  if (agentBrowserIpcVersion !== undefined) {
    const expectedVersion = String(AGENT_BROWSER_PROTOCOL_VERSION);
    if (agentBrowserIpcVersion !== expectedVersion) {
      throw new Error(
        `Agent Browser IPC version mismatch: expected ${expectedVersion}, received ${agentBrowserIpcVersion}`,
      );
    }
    const exit = ctx.get("appExit");
    if (typeof exit !== "function") {
      throw new Error(
        "Agent Browser desktop mode requires the Harness appExit service",
      );
    }
    installAgentBrowserParentLifetime(ctx, exit);
    if (!installAgentBrowserTools(ctx)) {
      throw new Error(
        "Agent Browser desktop mode failed to install its IPC tools",
      );
    }
  }
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
