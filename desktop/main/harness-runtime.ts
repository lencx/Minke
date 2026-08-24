import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import {
  deleteEnvironmentName,
  embeddedNodeChildEnvironment,
  setEnvironmentName,
} from "../../config/embedded-node-runtime.mts";
import {
  type LocalModelRuntimeId,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";
import type {
  PluginManagementSettings,
} from "@minke/harness-overlay/plugin-install-contract";
import {
  DEFAULT_PLUGIN_MANAGEMENT_SETTINGS,
} from "@minke/harness-overlay/plugin-install-contract";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV,
  type WebSearchSettings,
} from "@minke/harness-overlay/web-search-settings-contract.ts";
import type {
  AgentTurnInput,
  AgentTurnResult,
} from "@minke/harness-overlay/agent-turn-contract.ts";
import {
  AGENT_BROWSER_IPC_VERSION_ENV,
  AGENT_BROWSER_PROTOCOL_VERSION,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  harnessWebArguments,
  readHarnessRuntimeLayout,
  type HarnessRuntimeLayout,
} from "./harness-launch.ts";
import {
  HarnessControlChannel,
} from "./harness-control.ts";
import type {
  ModelRuntimeSettingsTransactionPhase,
} from "./model-runtime-settings.ts";
import type {
  AgentBrowserBinding,
  AgentBrowserRuntime,
} from "./agent-browser";

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
  dshHome: string;
  electronExecutable: string;
  modelRuntimes: LocalModelRuntimeLaunchOptions;
  pluginManagement: PluginManagementSettings;
  webSearch: WebSearchSettings;
  agentBrowser?: Pick<AgentBrowserRuntime, "bindChild">;
  onUnexpectedExit(exit: HarnessRuntimeExit): void;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  controlTimeoutMs?: number;
  modelRuntimeControlTimeoutMs?: number;
  agentTurnTimeoutMs?: number;
}

export type LocalModelRuntimeLaunchOptions = Record<
  LocalModelRuntimeId,
  {
    enabled: boolean;
    command?: string;
  }
>;

type HarnessRuntimeEnvironmentOptions = Pick<
  HarnessRuntimeOptions,
  | "dshHome"
  | "electronExecutable"
  | "modelRuntimes"
  | "agentBrowser"
> & {
  pluginManagement?: PluginManagementSettings;
  webSearch?: WebSearchSettings;
};

const LOCAL_MODEL_ENVIRONMENT = [
  {
    id: "lmStudio",
    enabled: "MINKE_LM_STUDIO_ENABLED",
    command: "MINKE_LM_STUDIO_COMMAND",
  },
  {
    id: "ollama",
    enabled: "MINKE_OLLAMA_ENABLED",
    command: "MINKE_OLLAMA_COMMAND",
  },
] as const satisfies readonly {
  id: LocalModelRuntimeId;
  enabled: string;
  command: string;
}[];

/** Build the explicit child environment without inheriting stale Minke flags. */
export function harnessRuntimeEnvironment(
  layout: Pick<HarnessRuntimeLayout, "pnpmEntry" | "runtimeBin">,
  options: HarnessRuntimeEnvironmentOptions,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = embeddedNodeChildEnvironment(
    {
      electronExecutable: options.electronExecutable,
      pnpmEntry: layout.pnpmEntry,
      runtimeBin: layout.runtimeBin,
    },
    inherited,
  );
  setEnvironmentName(environment, "DSH_HOME", options.dshHome);
  const pluginManagement =
    options.pluginManagement ??
    DEFAULT_PLUGIN_MANAGEMENT_SETTINGS;
  setEnvironmentName(
    environment,
    "MINKE_PLUGIN_SAFE_MODE",
    pluginManagement.safeMode ? "1" : "0",
  );
  setEnvironmentName(
    environment,
    "MINKE_DISABLED_PLUGINS",
    JSON.stringify(pluginManagement.disabledPlugins),
  );
  const webSearch =
    options.webSearch ?? DEFAULT_WEB_SEARCH_SETTINGS;
  setEnvironmentName(
    environment,
    MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV,
    webSearch.fallbackEnabled ? "1" : "0",
  );
  deleteEnvironmentName(
    environment,
    AGENT_BROWSER_IPC_VERSION_ENV,
  );
  if (options.agentBrowser !== undefined) {
    setEnvironmentName(
      environment,
      AGENT_BROWSER_IPC_VERSION_ENV,
      String(AGENT_BROWSER_PROTOCOL_VERSION),
    );
  }
  deleteEnvironmentName(environment, "MINKE_HOST_ROOT");
  for (const descriptor of LOCAL_MODEL_ENVIRONMENT) {
    const runtime = options.modelRuntimes[descriptor.id];
    setEnvironmentName(
      environment,
      descriptor.enabled,
      runtime.enabled ? "1" : "0",
    );
    const command = runtime.command?.trim();
    setEnvironmentName(
      environment,
      descriptor.command,
      command === undefined || command === ""
        ? undefined
        : command,
    );
  }
  return environment;
}

/**
 * Owns the complete Harness process lifecycle. Callers only need to start and
 * stop it; runtime layout, Electron-as-Node, readiness parsing, PATH injection,
 * output capture, and process-tree termination stay behind this interface.
 */
export class HarnessRuntime {
  readonly #options: HarnessRuntimeOptions;
  #modelRuntimes: LocalModelRuntimeLaunchOptions;
  #stagedModelRuntimes:
    | LocalModelRuntimeLaunchOptions
    | undefined;
  #modelRuntimeTail: Promise<void> = Promise.resolve();
  #child: ChildProcess | undefined;
  #control: HarnessControlChannel | undefined;
  #agentBrowserBinding: AgentBrowserBinding | undefined;
  #output = "";
  #stopping = false;
  #ready = false;

  constructor(options: HarnessRuntimeOptions) {
    this.#options = options;
    this.#modelRuntimes = copyModelRuntimes(
      options.modelRuntimes,
    );
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
    await mkdir(this.#options.dshHome, { recursive: true });

    this.#output = "";
    this.#stopping = false;
    this.#ready = false;

    const child = spawn(
      this.#options.electronExecutable,
      harnessWebArguments(layout),
      {
        cwd: this.#options.dshHome,
        detached: process.platform !== "win32",
        env: harnessRuntimeEnvironment(layout, {
          ...this.#options,
          modelRuntimes: this.#modelRuntimes,
        }),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    this.#child = child;
    this.#control = new HarnessControlChannel(
      child,
      this.#options.controlTimeoutMs,
      this.#options.modelRuntimeControlTimeoutMs,
      this.#options.agentTurnTimeoutMs,
    );
    const agentBrowserBinding =
      this.#options.agentBrowser?.bindChild(child);
    this.#agentBrowserBinding = agentBrowserBinding;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.#capture(chunk));
    child.stderr?.on("data", (chunk: string) => this.#capture(chunk));

    child.once("exit", (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#control?.dispose();
      this.#control = undefined;
      agentBrowserBinding?.dispose();
      if (this.#agentBrowserBinding === agentBrowserBinding) {
        this.#agentBrowserBinding = undefined;
      }
      const exit = { code, signal, output: this.#output };
      if (this.#ready && !this.#stopping) {
        this.#options.onUnexpectedExit(exit);
      }
    });

    const url = await this.#waitUntilReady(child);
    this.#ready = true;
    return url;
  }

  /** Replace trusted remote authorities without restarting Harness. */
  replaceTrustedHosts(
    trustedHosts: readonly string[],
  ): Promise<void> {
    const control = this.#control;
    if (control === undefined || !this.#ready) {
      return Promise.reject(
        new Error("Harness runtime is not ready"),
      );
    }
    return control.replaceTrustedHosts(trustedHosts);
  }

  /** Run or recover one durable Agent turn in the live Harness process. */
  runAgentTurn(
    input: AgentTurnInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<AgentTurnResult> {
    const control = this.#control;
    if (control === undefined || !this.#ready) {
      return Promise.reject(
        new Error("Harness runtime is not ready"),
      );
    }
    return control.runAgentTurn(input, options);
  }

  /**
   * Reconcile local runtimes transactionally. An apply ACK stages the desired
   * launch state, but only finalize may advance crash recovery after the
   * settings store has committed. Rollback always discards the staged state,
   * including when live rollback itself fails.
   */
  reconfigureModelRuntimes(
    settings: ModelRuntimeSettings,
    mode: ModelRuntimeSettingsTransactionPhase = "apply",
  ): Promise<void> {
    if (mode === "finalize") {
      const staged = this.#stagedModelRuntimes;
      if (
        staged === undefined ||
        !sameModelRuntimeSettings(staged, settings)
      ) {
        return Promise.reject(
          new Error(
            "model-runtime transaction has no matching staged apply",
          ),
        );
      }
      this.#modelRuntimes = staged;
      this.#stagedModelRuntimes = undefined;
      return Promise.resolve();
    }
    const operation = this.#modelRuntimeTail.then(async () => {
      const control = this.#control;
      if (control === undefined || !this.#ready) {
        throw new Error("Harness runtime is not ready");
      }
      if (
        mode === "apply" &&
        this.#stagedModelRuntimes !== undefined
      ) {
        throw new Error(
          "model-runtime transaction already has a staged apply",
        );
      }
      try {
        await control.reconfigureModelRuntimes(settings, mode);
        if (mode === "apply") {
          this.#stagedModelRuntimes =
            modelRuntimesWithSettings(
              this.#modelRuntimes,
              settings,
            );
        }
      } finally {
        if (mode === "rollback") {
          this.#stagedModelRuntimes = undefined;
        }
      }
    });
    this.#modelRuntimeTail = operation.catch(() => undefined);
    return operation;
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
    this.#control?.dispose();
    this.#control = undefined;
    this.#agentBrowserBinding?.dispose();
    this.#agentBrowserBinding = undefined;
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

function copyModelRuntimes(
  value: LocalModelRuntimeLaunchOptions,
): LocalModelRuntimeLaunchOptions {
  return {
    lmStudio: { ...value.lmStudio },
    ollama: { ...value.ollama },
  };
}

function modelRuntimesWithSettings(
  current: LocalModelRuntimeLaunchOptions,
  settings: ModelRuntimeSettings,
): LocalModelRuntimeLaunchOptions {
  const next = copyModelRuntimes(current);
  for (const descriptor of LOCAL_MODEL_ENVIRONMENT) {
    next[descriptor.id].enabled =
      settings[descriptor.id].enabled;
  }
  return next;
}

function sameModelRuntimeSettings(
  launch: LocalModelRuntimeLaunchOptions,
  settings: ModelRuntimeSettings,
): boolean {
  return LOCAL_MODEL_ENVIRONMENT.every(
    ({ id }) =>
      launch[id].enabled === settings[id].enabled,
  );
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
