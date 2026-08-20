import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseInstalledPluginsSnapshot,
  parsePluginInstallTarget,
  type InstalledPlugin,
  type InstalledPluginsSnapshot,
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
const PROFILE_NAME = "web";

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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function readJsonFile(
  path: string,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (
      isRecord(error) &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function displayText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized === ""
    ? undefined
    : normalized.slice(0, maximumLength);
}

function repositoryValue(
  manifest: Record<string, unknown>,
): string | undefined {
  const repository = manifest.repository;
  if (typeof repository === "string") return repository;
  return isRecord(repository) &&
      typeof repository.url === "string"
    ? repository.url
    : undefined;
}

function normalizeRepositoryUrl(
  candidate: string | undefined,
): string | undefined {
  if (candidate === undefined) return undefined;
  let value = candidate.trim();
  if (value.startsWith("git+https://")) {
    value = value.slice(4);
  } else if (value.startsWith("git://github.com/")) {
    value = `https://${value.slice("git://".length)}`;
  } else if (value.startsWith("github:")) {
    value = `https://github.com/${value.slice("github:".length)}`;
  } else {
    const scp = /^git@github\.com:(.+)$/u.exec(value);
    const ssh = /^ssh:\/\/git@github\.com\/(.+)$/u.exec(value);
    const githubPath = scp?.[1] ?? ssh?.[1];
    if (githubPath !== undefined) {
      value = `https://github.com/${githubPath}`;
    }
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\.git\/?$/u, "");
  return url.toString().replace(/\/$/u, "");
}

async function readInstalledPackage(
  profileRoot: string,
  name: string,
  requested: string,
): Promise<InstalledPlugin> {
  let manifest: unknown;
  try {
    manifest = await readJsonFile(
      join(profileRoot, "node_modules", ...name.split("/"), "package.json"),
    );
  } catch {
    manifest = undefined;
  }
  if (!isRecord(manifest)) {
    return {
      name,
      requested,
      state: "missing",
    };
  }
  const version = displayText(manifest.version, 128);
  const description = displayText(manifest.description, 1_000);
  const repositoryUrl = normalizeRepositoryUrl(
    repositoryValue(manifest),
  );
  return {
    name,
    requested,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(repositoryUrl === undefined
      ? {}
      : { repositoryUrl }),
    state: "ready",
  };
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

  async listInstalled(): Promise<InstalledPluginsSnapshot> {
    const profileRoot = join(
      this.#dshHome,
      "profiles",
      PROFILE_NAME,
    );
    const manifest = await readJsonFile(
      join(profileRoot, "package.json"),
    );
    if (manifest === undefined) {
      return parseInstalledPluginsSnapshot({ plugins: [] });
    }
    if (!isRecord(manifest)) {
      throw new TypeError("invalid web profile manifest");
    }
    const dependencies = manifest.dependencies;
    const dsh = manifest.dsh;
    const profile = isRecord(dsh) ? dsh.profile : undefined;
    const bundles = isRecord(profile) ? profile.bundles : undefined;
    if (
      dependencies !== undefined &&
      !isRecord(dependencies)
    ) {
      throw new TypeError(
        "invalid web profile dependencies",
      );
    }
    if (bundles !== undefined && !Array.isArray(bundles)) {
      throw new TypeError("invalid web profile bundles");
    }
    const activeBundles = new Set(
      (Array.isArray(bundles) ? bundles : [])
        .filter((value): value is string =>
          typeof value === "string"),
    );
    const entries = Object.entries(
      isRecord(dependencies) ? dependencies : {},
    ).filter(
      (entry): entry is [string, string] =>
        activeBundles.has(entry[0]) &&
        typeof entry[1] === "string",
    );
    const plugins = await Promise.all(
      entries.map(([name, requested]) =>
        readInstalledPackage(profileRoot, name, requested)),
    );
    return parseInstalledPluginsSnapshot({ plugins });
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
        PROFILE_NAME,
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
