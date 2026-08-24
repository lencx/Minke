import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  deleteEnvironmentName,
  embeddedNodeCapabilitiesEnvironment,
  embeddedNodeEnvironment,
} from "../../../config/embedded-node-runtime.mts";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";

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

interface OwnedTerminal {
  readonly process: PtyProcess;
  readonly data: Disposable;
  readonly exit: Disposable;
}

export interface TerminalSessionRuntimeOptions {
  readonly pty: TerminalPtyModule;
  readonly shell: string;
  readonly shellArgs?: readonly string[];
  readonly runtimeRoot: string;
  readonly electronExecutable: string;
  readonly defaultCwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly resolveCwd: (candidate: string) => Promise<string>;
  readonly createId?: () => string;
  readonly send: (event: TerminalEvent) => void;
}

function terminalEnvironment(
  source: NodeJS.ProcessEnv,
  runtimeRoot: string,
  electronExecutable: string,
): Record<string, string> {
  const embedded = embeddedNodeCapabilitiesEnvironment(
    {
      electronExecutable,
      pnpmEntry: join(
        runtimeRoot,
        "node_modules",
        "pnpm",
        "bin",
        "pnpm.cjs",
      ),
      runtimeBin: join(runtimeRoot, "bin"),
    },
    source,
  );
  deleteEnvironmentName(
    embedded,
    embeddedNodeEnvironment.interactiveNodeOptions,
  );
  deleteEnvironmentName(
    embedded,
    embeddedNodeEnvironment.interactiveNodePath,
  );
  const environment = Object.fromEntries(
    Object.entries(embedded).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string",
    ),
  );
  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";
  environment.TERM_PROGRAM = "Minke";
  return environment;
}

export function loadTerminalPty(
  runtimeRoot: string,
): TerminalPtyModule {
  const require = createRequire(join(runtimeRoot, "package.json"));
  return require("node-pty") as TerminalPtyModule;
}

/** Main-process owner for every PTY created by the Tabs Terminal adapter. */
export class TerminalSessionRuntime {
  readonly #options: TerminalSessionRuntimeOptions;
  readonly #sessions = new Map<string, OwnedTerminal>();

  constructor(options: TerminalSessionRuntimeOptions) {
    this.#options = options;
  }

  async create(
    request: TerminalCreateRequest,
  ): Promise<TerminalCreateResult> {
    const cwd = await this.#options.resolveCwd(
      request.cwd ?? this.#options.defaultCwd,
    );
    const sessionId =
      this.#options.createId?.() ?? `terminal-${randomUUID()}`;
    const process = this.#options.pty.spawn(
      this.#options.shell,
      this.#options.shellArgs ?? ["-l"],
      {
        name: "xterm-256color",
        cols: request.cols,
        rows: request.rows,
        cwd,
        env: terminalEnvironment(
          this.#options.environment,
          this.#options.runtimeRoot,
          this.#options.electronExecutable,
        ),
      },
    );
    const data = process.onData((value) => {
      this.#options.send({
        type: "data",
        sessionId,
        data: value,
      });
    });
    const exit = process.onExit((result) => {
      this.#release(sessionId);
      this.#options.send({
        type: "exit",
        sessionId,
        exitCode: result.exitCode,
        ...(result.signal === undefined || result.signal === 0
          ? {}
          : { signal: result.signal }),
      });
    });
    this.#sessions.set(sessionId, { process, data, exit });
    return { sessionId };
  }

  write(request: TerminalWriteRequest): void {
    this.#sessions.get(request.sessionId)?.process.write(request.data);
  }

  resize(request: TerminalResizeRequest): void {
    this.#sessions
      .get(request.sessionId)
      ?.process.resize(request.cols, request.rows);
  }

  close(sessionId: string): void {
    const owned = this.#sessions.get(sessionId);
    if (owned === undefined) return;
    this.#release(sessionId);
    try {
      owned.process.kill();
    } catch {
      // A shell that exited between lookup and close is already released.
    }
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.#sessions.keys()]) {
      this.close(sessionId);
    }
  }

  #release(sessionId: string): void {
    const owned = this.#sessions.get(sessionId);
    if (owned === undefined) return;
    this.#sessions.delete(sessionId);
    owned.data.dispose();
    owned.exit.dispose();
  }
}
