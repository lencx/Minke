import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  embeddedNodeChildEnvironment,
} from "../../config/embedded-node-runtime.mts";
import type {
  PluginCatalogInstallationAdapter,
} from "@lencx/minke-plugin-catalog";
import {
  readHarnessRuntimeLayout,
  type HarnessRuntimeLayout,
} from "./harness-launch.ts";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const INSTALL_SPEC =
  /^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}(?:#path:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/u;

export interface PluginCatalogInstallCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PluginCatalogInstallCommandRunner {
  (
    command: string,
    args: readonly string[],
    options: PluginCatalogInstallCommandOptions,
  ): Promise<void>;
}

export interface PluginCatalogInstallationOptions {
  runtimeRoot: string;
  dshHome: string;
  electronExecutable: string;
  environment?: NodeJS.ProcessEnv;
  readRuntimeLayout?: () => Promise<HarnessRuntimeLayout>;
  runCommand?: PluginCatalogInstallCommandRunner;
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
  options: PluginCatalogInstallCommandOptions,
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

function installedDependencies(
  value: unknown,
): string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "plugin profile manifest must be an object",
    );
  }
  const dependencies = (
    value as Record<string, unknown>
  ).dependencies;
  if (dependencies === undefined) return [];
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError(
      "plugin profile dependencies must be an object",
    );
  }
  const entries = Object.entries(dependencies);
  if (
    entries.some(
      ([name, spec]) =>
        name.length === 0 ||
        name.length > 214 ||
        typeof spec !== "string" ||
        spec.length === 0,
    )
  ) {
    throw new TypeError(
      "plugin profile dependencies are invalid",
    );
  }
  return entries.map(([name]) => name);
}

/**
 * Installs validated catalog entries into Minke's active web profile through
 * the bundled command runtime. The adapter never uses a shell.
 */
export class PluginCatalogInstallationRuntime
implements PluginCatalogInstallationAdapter {
  readonly #runtimeRoot: string;
  readonly #dshHome: string;
  readonly #electronExecutable: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #readRuntimeLayout: () => Promise<HarnessRuntimeLayout>;
  readonly #runCommand: PluginCatalogInstallCommandRunner;

  constructor(options: PluginCatalogInstallationOptions) {
    this.#runtimeRoot = options.runtimeRoot;
    this.#dshHome = options.dshHome;
    this.#electronExecutable = options.electronExecutable;
    this.#environment = {
      ...(options.environment ?? process.env),
    };
    this.#readRuntimeLayout =
      options.readRuntimeLayout ??
      (() => readHarnessRuntimeLayout(this.#runtimeRoot));
    this.#runCommand =
      options.runCommand ?? runInstallCommand;
  }

  async listInstalledPackageNames(): Promise<readonly string[]> {
    try {
      return installedDependencies(
        JSON.parse(
          await readFile(
            join(
              this.#dshHome,
              "profiles",
              "web",
              "package.json",
            ),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async install(installSpec: string): Promise<void> {
    if (!INSTALL_SPEC.test(installSpec)) {
      throw new TypeError(
        "invalid plugin catalog install specification",
      );
    }
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
        installSpec,
      ],
      {
        cwd: this.#dshHome,
        env: environment,
      },
    );
  }
}
