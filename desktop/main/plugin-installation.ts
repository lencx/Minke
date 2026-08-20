import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  parsePluginInstallTarget,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  embeddedNodeChildEnvironment,
} from "../../config/embedded-node-runtime.mts";
import {
  readHarnessRuntimeLayout,
  type HarnessRuntimeLayout,
} from "./harness-launch.ts";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface PluginInstallCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PluginInstallCommandRunner {
  (
    command: string,
    args: readonly string[],
    options: PluginInstallCommandOptions,
  ): Promise<void>;
}

export interface PluginInstallationOptions {
  runtimeRoot: string;
  dshHome: string;
  electronExecutable: string;
  environment?: NodeJS.ProcessEnv;
  readRuntimeLayout?: () => Promise<HarnessRuntimeLayout>;
  runCommand?: PluginInstallCommandRunner;
}

function commandFailure(
  error: Error,
  stdout: string,
  stderr: string,
): Error {
  const detail = `${stderr}\n${stdout}`
    .trim()
    .slice(-8_192);
  return new Error(
    detail === ""
      ? "plugin installation failed"
      : `plugin installation failed: ${detail}`,
    { cause: error },
  );
}

function runInstallCommand(
  command: string,
  args: readonly string[],
  options: PluginInstallCommandOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        timeout: INSTALL_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        reject(commandFailure(error, stdout, stderr));
      },
    );
  });
}

/**
 * Install one explicitly entered package into Minke's web profile. The
 * runtime validates a single package target and executes without a shell.
 */
export class PluginInstallationRuntime {
  readonly #runtimeRoot: string;
  readonly #dshHome: string;
  readonly #electronExecutable: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #readRuntimeLayout: () => Promise<HarnessRuntimeLayout>;
  readonly #runCommand: PluginInstallCommandRunner;

  constructor(options: PluginInstallationOptions) {
    this.#runtimeRoot = options.runtimeRoot;
    this.#dshHome = options.dshHome;
    this.#electronExecutable = options.electronExecutable;
    this.#environment = {
      ...(options.environment ?? process.env),
    };
    this.#readRuntimeLayout =
      options.readRuntimeLayout ??
      (() => readHarnessRuntimeLayout(this.#runtimeRoot));
    this.#runCommand = options.runCommand ?? runInstallCommand;
  }

  async install(candidate: string): Promise<void> {
    const target = parsePluginInstallTarget(candidate);
    const layout = await this.#readRuntimeLayout();
    await mkdir(this.#dshHome, {
      recursive: true,
      mode: 0o700,
    });
    const environment = embeddedNodeChildEnvironment(
      {
        electronExecutable: this.#electronExecutable,
        pnpmEntry: layout.pnpmEntry,
        runtimeBin: layout.runtimeBin,
      },
      this.#environment,
    );
    environment.DSH_HOME = this.#dshHome;
    await this.#runCommand(
      this.#electronExecutable,
      [
        "--expose-internals",
        layout.entryPath,
        "plugin",
        "--profile",
        "web",
        "add",
        target,
      ],
      {
        cwd: this.#dshHome,
        env: environment,
      },
    );
  }
}
