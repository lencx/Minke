/** Tailscale Serve and direct-IP transports. */
import {
  execFile,
  spawn as spawnChild,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import {
  createServer,
  connect as connectSocket,
  type Server,
  type Socket,
} from "node:net";
import {
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
} from "./contract.ts";
import {
  RemoteAccessError,
  type RemoteAccessLifecycle,
  type RemoteCommandExecutionOptions,
  type RemoteCommandExecutionResult,
  type RemoteCommandExecutor,
  type RemoteLaunchPlan,
  type RemoteProcessSpawner,
} from "./lifecycle.ts";

const DEFAULT_STATUS_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const TAILSCALE_SERVE_READY_MARKER = "Press Ctrl+C to exit.";
const TAILSCALE_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TAILSCALE_PREFERENCES_FAILURE =
  /tailscale cli failed to start:\s*failed to load preferences/iu;

type ServeError =
  | "serve"
  | "serve-conflict"
  | "serve-https"
  | "serve-permission";

interface TailscaleSelf {
  DNSName?: unknown;
  TailscaleIPs?: unknown;
}

interface ParsedTailscaleStatus {
  status: Record<string, unknown>;
  self: TailscaleSelf;
}

export interface TailscaleServiceOptions {
  command?: string;
  settings: RemoteSettings;
  execute?: RemoteCommandExecutor;
  spawn?: RemoteProcessSpawner;
  environment?: NodeJS.ProcessEnv;
  statusTimeoutMs?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export type TailscaleDirectServerFactory = (
  listener: (socket: Socket) => void,
) => Server;

export interface TailscaleDirectServiceOptions {
  command?: string;
  settings: RemoteSettings;
  execute?: RemoteCommandExecutor;
  environment?: NodeJS.ProcessEnv;
  statusTimeoutMs?: number;
  createServer?: TailscaleDirectServerFactory;
  connect?: typeof connectSocket;
}

function defaultExecute(
  command: string,
  args: readonly string[],
  options: RemoteCommandExecutionOptions,
): Promise<RemoteCommandExecutionResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        env: options.env,
        maxBuffer: MAX_COMMAND_OUTPUT,
        signal: options.signal,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolvePromise({
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawnChild(command, [...args], options);
}

function tailscaleEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    TAILSCALE_BE_CLI: "1",
  };
}

function classifyServeFailure(output: string): ServeError {
  const normalized = output.toLowerCase();
  if (
    (
      normalized.includes("prefs_save") ||
      normalized.includes("tailscale-serve/")
    ) &&
    (
      normalized.includes("keychain") ||
      normalized.includes("operation not permitted")
    )
  ) {
    return "serve-permission";
  }
  if (
    normalized.includes("error enabling https feature") ||
    normalized.includes("https is not enabled") ||
    normalized.includes("enable https")
  ) {
    return "serve-https";
  }
  if (
    normalized.includes(
      "another client is changing the serve config",
    ) ||
    normalized.includes("listener already exists for port 443")
  ) {
    return "serve-conflict";
  }
  return "serve";
}

function serveFailureMessage(kind: ServeError): string {
  switch (kind) {
    case "serve-permission":
      return "Tailscale could not save its Serve configuration to macOS Keychain";
    case "serve-https":
      return "Tailscale Serve requires HTTPS to be enabled for this tailnet";
    case "serve-conflict":
      return "Another Tailscale client is changing the Serve configuration";
    case "serve":
      return "Tailscale Serve failed to become ready";
  }
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

function parseTailscaleStatusSelf(
  output: string,
): ParsedTailscaleStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new TypeError("Tailscale status returned invalid JSON");
  }
  const status = object(parsed, "Tailscale status");
  const self = object(
    status.Self,
    "Tailscale status Self",
  ) as TailscaleSelf;
  if (status.BackendState !== "Running") {
    throw new TypeError("Tailscale status is not connected");
  }
  return { status, self };
}

function tailscaleStatusFailureMessage(
  output: string,
  error: unknown,
  expected: string,
): string {
  if (TAILSCALE_PREFERENCES_FAILURE.test(output)) {
    return "Tailscale CLI failed to load preferences";
  }
  if (error instanceof TypeError) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    (
      Reflect.get(error, "code") === "ETIMEDOUT" ||
      Reflect.get(error, "killed") === true
    )
  ) {
    return `Tailscale status timed out before providing ${expected}`;
  }
  return `Tailscale status command failed before providing ${expected}`;
}

/** Derive the one HTTPS hostname Tailscale Serve will publish. */
export function parseTailscaleStatusHostname(
  output: string,
): string {
  const { self } = parseTailscaleStatusSelf(output);
  if (typeof self.DNSName !== "string") {
    throw new TypeError("Tailscale status is not connected");
  }
  const hostname = self.DNSName
    .replace(/\.$/u, "")
    .toLowerCase();
  if (
    !TAILSCALE_HOSTNAME.test(hostname) ||
    !hostname.endsWith(".ts.net") ||
    hostname.split(".").length < 4
  ) {
    throw new TypeError(
      "Tailscale status returned an invalid DNS name",
    );
  }
  return hostname;
}

function isTailscaleIpv4(value: string): boolean {
  const parts = value.split(".");
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
  return (
    Number(parts[0]) === 100 &&
    Number(parts[1]) >= 64 &&
    Number(parts[1]) <= 127
  );
}

/** Resolve the exact CGNAT IPv4 address owned by this Tailscale node. */
export function parseTailscaleStatusIpv4(
  output: string,
): string {
  const { self } = parseTailscaleStatusSelf(output);
  if (!Array.isArray(self.TailscaleIPs)) {
    throw new TypeError(
      "Tailscale status did not provide node addresses",
    );
  }
  const ipv4 = self.TailscaleIPs.find(
    (value): value is string =>
      typeof value === "string" && isTailscaleIpv4(value),
  );
  if (ipv4 === undefined) {
    throw new TypeError(
      "Tailscale status did not provide a valid IPv4 address",
    );
  }
  return ipv4;
}

/** Refuse to expose anything except DSH's exact random loopback origin. */
export function parseLoopbackHarnessUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      value !== url.origin
    ) {
      throw new TypeError(
        "remote target must be a loopback Harness URL",
      );
    }
    return url.origin;
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.includes("loopback Harness URL")
    ) {
      throw error;
    }
    throw new TypeError(
      "remote target must be a loopback Harness URL",
    );
  }
}

/**
 * Own Tailscale Serve's two-phase lifecycle: resolve the trusted hostname
 * before DSH starts, then foreground-Serve DSH's random loopback port.
 */
export class TailscaleServeService
implements RemoteAccessLifecycle {
  readonly #command: string | undefined;
  readonly #enabled: boolean;
  readonly #execute: RemoteCommandExecutor;
  readonly #spawn: RemoteProcessSpawner;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #statusTimeoutMs: number;
  readonly #startupTimeoutMs: number;
  readonly #shutdownTimeoutMs: number;
  #hostname: string | undefined;
  #process: ChildProcess | undefined;
  #stopping = false;
  #output = "";
  #snapshot: RemoteRuntimeSnapshot;

  constructor(options: TailscaleServiceOptions) {
    const settings = parseRemoteSettings(options.settings);
    this.#command =
      options.command?.trim() === ""
        ? undefined
        : options.command;
    this.#enabled =
      settings.enabled &&
      settings.method === "tailscale" &&
      settings.tailscale.transport === "serve";
    this.#execute = options.execute ?? defaultExecute;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#environment = tailscaleEnvironment(
      options.environment ?? process.env,
    );
    this.#statusTimeoutMs =
      options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    this.#startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#snapshot = {
      method: "tailscale",
      transport: "serve",
      state: this.#enabled && this.#command === undefined
        ? "unavailable"
        : "disabled",
    };
  }

  read(): RemoteRuntimeSnapshot {
    return parseRemoteRuntimeSnapshot(this.#snapshot);
  }

  async prepare(signal?: AbortSignal): Promise<RemoteLaunchPlan> {
    if (!this.#enabled) {
      this.#hostname = undefined;
      this.#publish("disabled");
      return { trustedHosts: [] };
    }
    const command = this.#command;
    if (command === undefined) {
      this.#hostname = undefined;
      this.#publish("unavailable");
      return { trustedHosts: [] };
    }
    if (this.#hostname !== undefined) {
      return { trustedHosts: [this.#hostname] };
    }

    let statusOutput = "";
    try {
      const result = await this.#execute(
        command,
        ["status", "--json"],
        {
          env: this.#environment,
          ...(signal === undefined ? {} : { signal }),
          timeoutMs: this.#statusTimeoutMs,
        },
      );
      statusOutput = `${result.stdout}\n${result.stderr}`;
      const hostname =
        parseTailscaleStatusHostname(result.stdout);
      this.#hostname = hostname;
      this.#publish("ready", `https://${hostname}`);
      return { trustedHosts: [hostname] };
    } catch (error) {
      this.#hostname = undefined;
      this.#publishError("status");
      throw new RemoteAccessError(
        "status",
        tailscaleStatusFailureMessage(
          statusOutput,
          error,
          "a connected *.ts.net hostname",
        ),
        { cause: error },
      );
    }
  }

  async start(
    targetValue: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#enabled || this.#command === undefined) return;
    if (this.#process !== undefined) {
      throw new Error("remote access is already running");
    }
    const hostname = this.#hostname;
    if (hostname === undefined) {
      throw new RemoteAccessError(
        "status",
        "Tailscale remote access must be prepared before it starts",
      );
    }
    const target = parseLoopbackHarnessUrl(targetValue);
    this.#output = "";
    this.#stopping = false;

    let child: ChildProcess;
    try {
      child = this.#spawn(
        this.#command,
        ["serve", "--yes", "--bg=false", target],
        {
          detached: false,
          env: this.#environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      this.#publishError("serve");
      throw new RemoteAccessError(
        "serve",
        "Tailscale Serve could not start",
      );
    }
    this.#process = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const capture = (chunk: string | Buffer): void => {
      this.#output = `${this.#output}${String(chunk)}`.slice(
        -MAX_COMMAND_OUTPUT,
      );
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", () => {
      if (this.#process === child && !this.#stopping) {
        this.#publishError(
          classifyServeFailure(this.#output),
        );
      }
    });
    child.once("exit", () => {
      if (this.#process !== child) return;
      this.#process = undefined;
      if (!this.#stopping) {
        this.#publishError(
          classifyServeFailure(this.#output),
        );
      }
    });

    try {
      await this.#waitUntilReady(child, signal);
      this.#publish("active", `https://${hostname}`);
    } catch {
      const kind = classifyServeFailure(this.#output);
      await this.#terminate(child);
      this.#publishError(kind);
      throw new RemoteAccessError(
        kind,
        serveFailureMessage(kind),
      );
    }
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (child !== undefined) {
      await this.#terminate(child);
    }
    if (this.#hostname !== undefined) {
      this.#publish(
        "ready",
        `https://${this.#hostname}`,
      );
    } else if (!this.#enabled) {
      this.#publish("disabled");
    } else if (this.#command === undefined) {
      this.#publish("unavailable");
    }
  }

  #publish(
    state: "disabled" | "unavailable" | "ready" | "active",
    url?: string,
  ): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "tailscale",
      transport: "serve",
      state,
      ...(url === undefined ? {} : { url }),
    });
  }

  #publishError(error: "status" | ServeError): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "tailscale",
      transport: "serve",
      state: "error",
      error,
    });
  }

  async #waitUntilReady(
    child: ChildProcess,
    signal?: AbortSignal,
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off("data", inspect);
        child.stderr?.off("data", inspect);
        child.off("error", onError);
        child.off("exit", onExit);
        signal?.removeEventListener("abort", onAbort);
        if (error === undefined) resolvePromise();
        else reject(error);
      };
      const inspect = (): void => {
        if (
          this.#output.includes(
            TAILSCALE_SERVE_READY_MARKER,
          )
        ) {
          finish();
        }
      };
      const onError = (): void => {
        finish(new Error("Tailscale Serve process failed"));
      };
      const onExit = (): void => {
        finish(
          new Error(
            "Tailscale Serve exited before readiness",
          ),
        );
      };
      const onAbort = (): void => {
        finish(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException(
                "The operation was aborted",
                "AbortError",
              ),
        );
      };
      const timeout = setTimeout(() => {
        finish(
          new Error(
            "Tailscale Serve readiness timed out",
          ),
        );
      }, this.#startupTimeoutMs);
      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExit);
      signal?.addEventListener("abort", onAbort, {
        once: true,
      });
      if (signal?.aborted === true) onAbort();
      inspect();
    });
  }

  async #terminate(child: ChildProcess): Promise<void> {
    this.#stopping = true;
    if (
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill(
        process.platform === "win32" ? "SIGTERM" : "SIGINT",
      );
    }
    const exited = await this.#waitForExit(
      child,
      this.#shutdownTimeoutMs,
    );
    if (!exited) {
      child.kill("SIGKILL");
      await this.#waitForExit(child, 1_000);
    }
    if (this.#process === child) this.#process = undefined;
    this.#stopping = false;
  }

  async #waitForExit(
    child: ChildProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    if (
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return true;
    }
    return await new Promise<boolean>((resolvePromise) => {
      const timeout = setTimeout(() => {
        child.off("exit", onExit);
        resolvePromise(false);
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timeout);
        resolvePromise(true);
      };
      child.once("exit", onExit);
    });
  }
}

/**
 * Bind a raw TCP forwarder to this node's exact Tailscale IPv4 address. The
 * original Host and Origin bytes reach DSH unchanged, preserving its
 * trusted-host and loopback-only privileged-method fences.
 */
export class TailscaleDirectService
implements RemoteAccessLifecycle {
  readonly #command: string | undefined;
  readonly #enabled: boolean;
  readonly #execute: RemoteCommandExecutor;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #statusTimeoutMs: number;
  readonly #createServer: TailscaleDirectServerFactory;
  readonly #connect: typeof connectSocket;
  readonly #sockets = new Set<Socket>();
  #ip: string | undefined;
  #port: number | undefined;
  #target: URL | undefined;
  #server: Server | undefined;
  #stopping = false;
  #snapshot: RemoteRuntimeSnapshot;

  constructor(options: TailscaleDirectServiceOptions) {
    const settings = parseRemoteSettings(options.settings);
    this.#command =
      options.command?.trim() === ""
        ? undefined
        : options.command;
    this.#enabled =
      settings.enabled &&
      settings.method === "tailscale" &&
      settings.tailscale.transport === "direct";
    this.#execute = options.execute ?? defaultExecute;
    this.#environment = tailscaleEnvironment(
      options.environment ?? process.env,
    );
    this.#statusTimeoutMs =
      options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    this.#createServer =
      options.createServer ?? ((listener) => createServer(listener));
    this.#connect = options.connect ?? connectSocket;
    this.#snapshot = {
      method: "tailscale",
      transport: "direct",
      state: this.#enabled && this.#command === undefined
        ? "unavailable"
        : "disabled",
    };
  }

  read(): RemoteRuntimeSnapshot {
    return parseRemoteRuntimeSnapshot(this.#snapshot);
  }

  async prepare(signal?: AbortSignal): Promise<RemoteLaunchPlan> {
    if (!this.#enabled) {
      this.#publish("disabled");
      return { trustedHosts: [] };
    }
    const command = this.#command;
    if (command === undefined) {
      this.#publish("unavailable");
      return { trustedHosts: [] };
    }
    if (this.#ip === undefined) {
      let statusOutput = "";
      try {
        const result = await this.#execute(
          command,
          ["status", "--json"],
          {
            env: this.#environment,
            ...(signal === undefined ? {} : { signal }),
            timeoutMs: this.#statusTimeoutMs,
          },
        );
        statusOutput = `${result.stdout}\n${result.stderr}`;
        this.#ip = parseTailscaleStatusIpv4(result.stdout);
      } catch (error) {
        this.#publishError("status");
        throw new RemoteAccessError(
          "status",
          tailscaleStatusFailureMessage(
            statusOutput,
            error,
            "a connected node IPv4 address",
          ),
          { cause: error },
        );
      }
    }
    try {
      await this.#ensureServer(this.#port ?? 0);
    } catch {
      this.#publishError("direct-bind");
      throw new RemoteAccessError(
        "direct-bind",
        "Minke could not bind its direct proxy to the Tailscale IPv4 address",
      );
    }
    const authority = this.#authority();
    this.#publish("ready", `http://${authority}`);
    return { trustedHosts: [authority] };
  }

  async start(
    targetValue: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#enabled || this.#command === undefined) return;
    if (this.#ip === undefined || this.#port === undefined) {
      throw new RemoteAccessError(
        "status",
        "Tailscale direct access must be prepared before it starts",
      );
    }
    const target = new URL(
      parseLoopbackHarnessUrl(targetValue),
    );
    try {
      await this.#ensureServer(this.#port);
    } catch {
      this.#publishError("direct-bind");
      throw new RemoteAccessError(
        "direct-bind",
        "Minke could not rebind its direct Tailscale proxy",
      );
    }
    this.#target = target;
    this.#publish(
      "active",
      `http://${this.#authority()}`,
    );
  }

  async stop(): Promise<void> {
    this.#target = undefined;
    await this.#closeServer();
    if (this.#ip !== undefined && this.#port !== undefined) {
      this.#publish(
        "ready",
        `http://${this.#authority()}`,
      );
    } else if (!this.#enabled) {
      this.#publish("disabled");
    } else if (this.#command === undefined) {
      this.#publish("unavailable");
    }
  }

  #authority(): string {
    if (this.#ip === undefined || this.#port === undefined) {
      throw new Error("Tailscale direct endpoint is unresolved");
    }
    return `${this.#ip}:${String(this.#port)}`;
  }

  async #ensureServer(port: number): Promise<void> {
    if (this.#server?.listening === true) return;
    const ip = this.#ip;
    if (ip === undefined) {
      throw new Error("Tailscale direct IPv4 is unresolved");
    }
    const server = this.#createServer((socket) => {
      this.#accept(socket);
    });
    this.#server = server;
    this.#stopping = false;
    server.on("error", () => {
      if (this.#server === server && !this.#stopping) {
        this.#publishError("direct-bind");
      }
    });
    server.on("close", () => {
      if (
        this.#server === server &&
        !this.#stopping &&
        this.#target !== undefined
      ) {
        this.#server = undefined;
        this.#publishError("direct-bind");
      }
    });
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolvePromise();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({
          host: ip,
          port,
          exclusive: true,
        });
      });
    } catch (error) {
      if (this.#server === server) this.#server = undefined;
      throw error;
    }
    const address = server.address();
    if (
      address === null ||
      typeof address === "string" ||
      address.address !== ip ||
      !Number.isInteger(address.port)
    ) {
      await this.#closeServer();
      throw new Error(
        "Tailscale direct proxy bound an unexpected address",
      );
    }
    this.#port = address.port;
  }

  #accept(client: Socket): void {
    const target = this.#target;
    if (target === undefined) {
      client.destroy();
      return;
    }
    this.#track(client);
    const upstream = this.#connect({
      host: target.hostname,
      port: Number(target.port),
    });
    this.#track(upstream);
    const fail = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.once("error", fail);
    upstream.once("error", fail);
    upstream.once("connect", () => {
      client.pipe(upstream);
      upstream.pipe(client);
    });
  }

  #track(socket: Socket): void {
    this.#sockets.add(socket);
    socket.once("close", () => {
      this.#sockets.delete(socket);
    });
  }

  async #closeServer(): Promise<void> {
    this.#stopping = true;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server?.listening === true) {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
    this.#stopping = false;
  }

  #publish(
    state: "disabled" | "unavailable" | "ready" | "active",
    url?: string,
  ): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "tailscale",
      transport: "direct",
      state,
      ...(url === undefined ? {} : { url }),
    });
  }

  #publishError(error: "status" | "direct-bind"): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "tailscale",
      transport: "direct",
      state: "error",
      error,
    });
  }
}
