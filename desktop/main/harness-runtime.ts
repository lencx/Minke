import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { delimiter } from "node:path";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
} from "./harness-launch";

const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u;
const MAX_CAPTURED_OUTPUT = 64 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface HarnessRuntimeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

export interface HarnessRuntimeOptions {
  runtimeRoot: string;
  dataRoot: string;
  electronExecutable: string;
  onUnexpectedExit(exit: HarnessRuntimeExit): void;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

/**
 * Owns the complete Harness process lifecycle. Callers only need to start and
 * stop it; runtime layout, Electron-as-Node, readiness parsing, PATH injection,
 * output capture, and process-tree termination stay behind this interface.
 */
export class HarnessRuntime {
  readonly #options: HarnessRuntimeOptions;
  #child: ChildProcess | undefined;
  #output = "";
  #stopping = false;
  #ready = false;

  constructor(options: HarnessRuntimeOptions) {
    this.#options = options;
  }

  async start(): Promise<string> {
    if (this.#child !== undefined) {
      throw new Error("Harness runtime is already running");
    }

    const layout = await readHarnessRuntimeLayout(this.#options.runtimeRoot);
    await Promise.all([
      access(layout.entryPath),
      access(layout.pnpmEntry),
      access(layout.runtimeBin),
      access(layout.productPatch),
    ]);
    await mkdir(this.#options.dataRoot, { recursive: true });

    this.#output = "";
    this.#stopping = false;
    this.#ready = false;

    const child = spawn(
      this.#options.electronExecutable,
      harnessWebArguments(layout),
      {
        cwd: this.#options.dataRoot,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          DSH_ELECTRON_EXECUTABLE: this.#options.electronExecutable,
          DSH_HOME: this.#options.dataRoot,
          DSH_PNPM_ENTRY: layout.pnpmEntry,
          ELECTRON_RUN_AS_NODE: "1",
          PATH: [layout.runtimeBin, process.env.PATH]
            .filter(Boolean)
            .join(delimiter),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#child = child;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#capture(chunk));
    child.stderr?.on("data", (chunk: string) => this.#capture(chunk));

    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      const exit = { code, signal, output: this.#output };
      if (this.#ready && !this.#stopping) {
        this.#options.onUnexpectedExit(exit);
      }
    });

    const url = await this.#waitUntilReady(child);
    this.#ready = true;
    return url;
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child === undefined) return;

    this.#stopping = true;
    this.#signalProcessTree(child, "SIGTERM");
    const exited = await this.#waitForExit(
      child,
      this.#options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
    if (!exited) {
      this.#signalProcessTree(child, "SIGKILL");
      await this.#waitForExit(child, 1_000);
    }
    if (this.#child === child) this.#child = undefined;
    this.#ready = false;
  }

  #capture(chunk: string): void {
    this.#output = `${this.#output}${chunk}`.slice(-MAX_CAPTURED_OUTPUT);
  }

  async #waitUntilReady(child: ChildProcess): Promise<string> {
    const timeoutMs =
      this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

    return await new Promise<string>((resolvePromise, reject) => {
      let settled = false;

      const finish = (error?: Error, url?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off("data", inspect);
        child.stderr?.off("data", inspect);
        child.off("error", onError);
        child.off("exit", onExit);
        if (error !== undefined) reject(error);
        else resolvePromise(url as string);
      };

      const inspect = () => {
        const match = READY_PATTERN.exec(this.#output);
        if (match?.[1] === undefined) return;
        try {
          finish(undefined, validateReadyUrl(match[1]));
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        finish(
          new Error(
            `Harness exited before readiness (code ${String(code)}, signal ${String(signal)})\n${this.#output}`,
          ),
        );
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              `Harness did not become ready within ${String(timeoutMs)} ms\n${this.#output}`,
            ),
          ),
        timeoutMs,
      );

      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExit);
      inspect();
    });
  }

  #signalProcessTree(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): void {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") throw error;
    }
  }

  async #waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return await new Promise<boolean>((resolvePromise) => {
      const timeout = setTimeout(() => {
        child.off("exit", onExit);
        resolvePromise(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolvePromise(true);
      };
      child.once("exit", onExit);
    });
  }
}

function validateReadyUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`Harness published an unsafe readiness URL: ${value}`);
  }
  return url.origin;
}
