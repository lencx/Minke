import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import {
  TERMINAL_MAX_EVENTS_PER_READ,
  TERMINAL_MAX_INPUT_LENGTH,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalEvent,
  type TerminalReadRequest,
  type TerminalReadResult,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from "../tabs/terminal-contract.ts";
import {
  interactiveShellEnvironment,
} from "./process-environment.ts";

const MAX_ACTIVE_TERMINALS = 8;
const MAX_RETAINED_EVENTS = 1_024;
const MAX_RETAINED_OUTPUT_BYTES = 512 * 1_024;

interface Disposable {
  dispose(): void;
}

interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(
    listener: (event: {
      exitCode: number;
      signal?: number;
    }) => void,
  ): Disposable;
}

export interface TerminalPtyModule {
  spawn(
    file: string,
    args: readonly string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): PtyProcess;
}

interface HostTerminalSession {
  readonly sessionId: string;
  readonly waiters: Set<() => void>;
  readonly events: TerminalEvent[];
  process: PtyProcess | undefined;
  data: Disposable | undefined;
  exit: Disposable | undefined;
  baseCursor: number;
  retainedBytes: number;
  done: boolean;
}

export interface HostTerminalRuntimeOptions {
  readonly pty: TerminalPtyModule | (() => TerminalPtyModule);
  readonly shell: string;
  readonly shellArgs?: readonly string[];
  readonly defaultCwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly resolveCwd?: (candidate: string) => Promise<string>;
  readonly createId?: () => string;
}

function eventBytes(event: TerminalEvent): number {
  if (event.type === "data") {
    return Buffer.byteLength(event.data, "utf8");
  }
  if (event.type === "error") {
    return Buffer.byteLength(event.message, "utf8");
  }
  return 16;
}

function terminalEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(interactiveShellEnvironment(source)).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string",
    ),
  );
  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";
  environment.TERM_PROGRAM = "Minke";
  return environment;
}

/** Load the node-pty copy owned by the staged DSH Host runtime. */
export function loadHostTerminalPty(): TerminalPtyModule {
  const require = createRequire(import.meta.url);
  return require("node-pty") as TerminalPtyModule;
}

export function defaultHostTerminalShell(): {
  readonly shell: string;
  readonly args: readonly string[];
} {
  if (process.platform === "win32") {
    return {
      shell: process.env.COMSPEC ?? "cmd.exe",
      args: [],
    };
  }
  return {
    shell:
      process.env.SHELL ??
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh"),
    args: ["-l"],
  };
}

export async function resolveHostTerminalCwd(
  candidate: string,
): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new TypeError(
      "terminal working directory must be absolute",
    );
  }
  const canonical = await realpath(candidate);
  const details = await stat(canonical);
  if (!details.isDirectory()) {
    throw new TypeError(
      "terminal working directory must be a directory",
    );
  }
  return canonical;
}

/**
 * Owns remote PTYs and a bounded cursor journal consumed through long-poll
 * Host RPC. Aborting an active poll terminates its PTY so a disconnected
 * browser cannot leave an orphan shell behind.
 */
export class HostTerminalRuntime {
  readonly #options: HostTerminalRuntimeOptions;
  readonly #sessions = new Map<string, HostTerminalSession>();
  #pty: TerminalPtyModule | undefined;
  #disposed = false;

  constructor(options: HostTerminalRuntimeOptions) {
    this.#options = options;
  }

  get activeSessions(): number {
    return this.#sessions.size;
  }

  async create(
    request: TerminalCreateRequest,
  ): Promise<TerminalCreateResult> {
    if (this.#disposed) {
      throw new Error("Minke Host Terminal is disposed");
    }
    if (this.#sessions.size >= MAX_ACTIVE_TERMINALS) {
      throw new Error("Minke Host Terminal session limit reached");
    }
    const cwd = await (
      this.#options.resolveCwd ?? resolveHostTerminalCwd
    )(request.cwd ?? this.#options.defaultCwd);
    const sessionId =
      this.#options.createId?.() ??
      `host-terminal-${randomUUID()}`;
    const session: HostTerminalSession = {
      sessionId,
      waiters: new Set(),
      events: [],
      process: undefined,
      data: undefined,
      exit: undefined,
      baseCursor: 0,
      retainedBytes: 0,
      done: false,
    };
    this.#sessions.set(sessionId, session);
    try {
      const process = this.#ptyModule().spawn(
        this.#options.shell,
        this.#options.shellArgs ?? ["-l"],
        {
          name: "xterm-256color",
          cols: request.cols,
          rows: request.rows,
          cwd,
          env: terminalEnvironment(this.#options.environment),
        },
      );
      session.process = process;
      session.data = process.onData((data) => {
        for (
          let offset = 0;
          offset < data.length;
          offset += TERMINAL_MAX_INPUT_LENGTH
        ) {
          this.#append(sessionId, {
            type: "data",
            sessionId,
            data: data.slice(
              offset,
              offset + TERMINAL_MAX_INPUT_LENGTH,
            ),
          });
        }
      });
      session.exit = process.onExit((result) => {
        const current = this.#sessions.get(sessionId);
        if (current === undefined || current.done) return;
        current.done = true;
        this.#releaseProcess(current);
        this.#append(sessionId, {
          type: "exit",
          sessionId,
          exitCode: result.exitCode,
          ...(result.signal === undefined || result.signal === 0
            ? {}
            : { signal: result.signal }),
        });
      });
      return { sessionId };
    } catch (error) {
      this.#sessions.delete(sessionId);
      this.#releaseProcess(session);
      throw error;
    }
  }

  write(request: TerminalWriteRequest): void {
    this.#session(request.sessionId).process?.write(request.data);
  }

  resize(request: TerminalResizeRequest): void {
    this.#session(request.sessionId).process?.resize(
      request.cols,
      request.rows,
    );
  }

  async read(
    request: TerminalReadRequest,
    signal: AbortSignal,
  ): Promise<TerminalReadResult> {
    let snapshot = this.#snapshot(request);
    if (
      snapshot.events.length > 0 ||
      snapshot.done ||
      request.waitMs === 0
    ) {
      return snapshot;
    }

    await new Promise<void>((resolvePromise, reject) => {
      const session = this.#session(request.sessionId);
      let settled = false;
      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.waiters.delete(wake);
        signal.removeEventListener("abort", abort);
      };
      const wake = (): void => {
        cleanup();
        resolvePromise();
      };
      const abort = (): void => {
        cleanup();
        this.close(request.sessionId);
        reject(
          signal.reason ??
            new Error("terminal poll was aborted"),
        );
      };
      const timer = setTimeout(wake, request.waitMs);
      session.waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

    snapshot = this.#snapshot(request);
    return snapshot;
  }

  close(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    this.#sessions.delete(sessionId);
    this.#releaseProcess(session);
    for (const wake of [...session.waiters]) wake();
    try {
      session.process?.kill();
    } catch {
      // A PTY that exited between lookup and close is already quiescent.
    }
    session.process = undefined;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const sessionId of [...this.#sessions.keys()]) {
      this.close(sessionId);
    }
  }

  #ptyModule(): TerminalPtyModule {
    this.#pty ??=
      typeof this.#options.pty === "function"
        ? this.#options.pty()
        : this.#options.pty;
    return this.#pty;
  }

  #session(sessionId: string): HostTerminalSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new TypeError("unknown terminal session");
    }
    return session;
  }

  #append(sessionId: string, event: TerminalEvent): void {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    session.events.push(event);
    session.retainedBytes += eventBytes(event);
    while (
      session.events.length > 1 &&
      (
        session.events.length > MAX_RETAINED_EVENTS ||
        session.retainedBytes > MAX_RETAINED_OUTPUT_BYTES
      )
    ) {
      const removed = session.events.shift();
      if (removed === undefined) break;
      session.baseCursor += 1;
      session.retainedBytes -= eventBytes(removed);
    }
    for (const wake of [...session.waiters]) wake();
  }

  #snapshot(request: TerminalReadRequest): TerminalReadResult {
    const session = this.#session(request.sessionId);
    const endCursor =
      session.baseCursor + session.events.length;
    if (request.cursor > endCursor) {
      throw new TypeError(
        "terminal cursor is ahead of the stream",
      );
    }
    const startCursor = Math.max(
      request.cursor,
      session.baseCursor,
    );
    const startIndex = startCursor - session.baseCursor;
    const events = session.events.slice(
      startIndex,
      startIndex + TERMINAL_MAX_EVENTS_PER_READ,
    );
    const cursor = startCursor + events.length;
    return {
      cursor,
      done: session.done && cursor === endCursor,
      truncated: request.cursor < session.baseCursor,
      events,
    };
  }

  #releaseProcess(session: HostTerminalSession): void {
    session.data?.dispose();
    session.exit?.dispose();
    session.data = undefined;
    session.exit = undefined;
  }
}
