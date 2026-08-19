/** Tailscale Serve adapter for the remote-access module. */
import {
  execFile,
  spawn as spawnChild,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import {
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  type RemoteRuntimeError,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
} from "./contract.ts";

const DEFAULT_STATUS_TIMEOUT_MS = 10_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const TAILSCALE_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export interface RemoteCommandExecutionOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface RemoteCommandExecutionResult {
  stdout: string;
  stderr: string;
}

export type RemoteCommandExecutor = (
  command: string,
  args: readonly string[],
  options: RemoteCommandExecutionOptions,
) => Promise<RemoteCommandExecutionResult>;

export type RemoteProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RemoteAccessServiceOptions {
  command?: string;
  settings: RemoteSettings;
  execute?: RemoteCommandExecutor;
  spawn?: RemoteProcessSpawner;
  environment?: NodeJS.ProcessEnv;
  statusTimeoutMs?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface RemoteLaunchPlan {
  trustedHosts: string[];
}

export class RemoteAccessError extends Error {
  readonly kind: RemoteRuntimeError;

  constructor(kind: RemoteRuntimeError, message: string) {
    super(message);
    this.name = "RemoteAccessError";
    this.kind = kind;
  }
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

/** Derive the one HTTPS hostname Tailscale Serve will publish. */
export function parseTailscaleStatusHostname(
  output: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new TypeError("Tailscale status returned invalid JSON");
  }
  const status = object(parsed, "Tailscale status");
  const self = object(status.Self, "Tailscale status Self");
  if (
    status.BackendState !== "Running" ||
    typeof self.DNSName !== "string"
  ) {
    throw new TypeError(
      "Tailscale status is not connected",
    );
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
      throw new TypeError("remote target must be a loopback Harness URL");
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
 * Own Tailscale's two-phase lifecycle: resolve the trusted hostname before DSH
 * starts, then foreground-Serve DSH's resolved loopback port.
 */
export class RemoteAccessService {
  readonly #command: string | undefined;
  readonly #settings: RemoteSettings;
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

  constructor(options: RemoteAccessServiceOptions) {
    this.#command =
      options.command?.trim() === ""
        ? undefined
        : options.command;
    this.#settings = parseRemoteSettings(options.settings);
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
      state: this.#settings.tailscale.enabled
        ? this.#command === undefined
          ? "unavailable"
          : "disabled"
        : "disabled",
    };
  }

  read(): RemoteRuntimeSnapshot {
    return parseRemoteRuntimeSnapshot(this.#snapshot);
  }

  async prepare(): Promise<RemoteLaunchPlan> {
    if (!this.#settings.tailscale.enabled) {
      this.#hostname = undefined;
      this.#publish({ method: "tailscale", state: "disabled" });
      return { trustedHosts: [] };
    }
    const command = this.#command;
    if (command === undefined) {
      this.#hostname = undefined;
      this.#publish({ method: "tailscale", state: "unavailable" });
      return { trustedHosts: [] };
    }
    if (this.#hostname !== undefined) {
      return { trustedHosts: [this.#hostname] };
    }

    try {
      const result = await this.#execute(
        command,
        ["status", "--json"],
        {
          env: this.#environment,
          timeoutMs: this.#statusTimeoutMs,
        },
      );
      const hostname = parseTailscaleStatusHostname(result.stdout);
      this.#hostname = hostname;
      this.#publish({
        method: "tailscale",
        state: "ready",
        url: `https://${hostname}`,
      });
      return { trustedHosts: [hostname] };
    } catch {
      this.#hostname = undefined;
      this.#publish({
        method: "tailscale",
        state: "error",
        error: "status",
      });
      throw new RemoteAccessError(
        "status",
        "Tailscale status could not provide a connected *.ts.net hostname",
      );
    }
  }

  async start(targetValue: string): Promise<void> {
    if (
      !this.#settings.tailscale.enabled ||
      this.#command === undefined
    ) {
      return;
    }
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
        ["serve", "--yes", target],
        {
          detached: false,
          env: this.#environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      this.#publishServeError();
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
      if (
        this.#process === child &&
        !this.#stopping
      ) {
        this.#publishServeError();
      }
    });
    child.once("exit", () => {
      if (this.#process !== child) return;
      this.#process = undefined;
      if (!this.#stopping) this.#publishServeError();
    });

    try {
      await this.#waitUntilReady(child, hostname);
      this.#publish({
        method: "tailscale",
        state: "active",
        url: `https://${hostname}`,
      });
    } catch {
      await this.#terminate(child);
      this.#publishServeError();
      throw new RemoteAccessError(
        "serve",
        "Tailscale Serve did not publish the expected HTTPS URL",
      );
    }
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (child !== undefined) {
      await this.#terminate(child);
    }
    if (this.#hostname !== undefined) {
      this.#publish({
        method: "tailscale",
        state: "ready",
        url: `https://${this.#hostname}`,
      });
    } else if (!this.#settings.tailscale.enabled) {
      this.#publish({ method: "tailscale", state: "disabled" });
    } else if (this.#command === undefined) {
      this.#publish({ method: "tailscale", state: "unavailable" });
    }
  }

  #publish(snapshot: RemoteRuntimeSnapshot): void {
    this.#snapshot = parseRemoteRuntimeSnapshot(snapshot);
  }

  #publishServeError(): void {
    this.#publish({
      method: "tailscale",
      state: "error",
      error: "serve",
    });
  }

  async #waitUntilReady(
    child: ChildProcess,
    hostname: string,
  ): Promise<void> {
    const expectedUrl = `https://${hostname}`;
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
        if (error === undefined) resolvePromise();
        else reject(error);
      };
      const inspect = (): void => {
        if (this.#output.includes(expectedUrl)) finish();
      };
      const onError = (): void => {
        finish(new Error("Tailscale Serve process failed"));
      };
      const onExit = (): void => {
        finish(new Error("Tailscale Serve exited before readiness"));
      };
      const timeout = setTimeout(() => {
        finish(new Error("Tailscale Serve readiness timed out"));
      }, this.#startupTimeoutMs);
      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExit);
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
