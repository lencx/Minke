import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseInstalledPluginsSnapshot,
  type InstalledPlugin,
  type InstalledPluginsSnapshot,
  type PluginManagementSettings,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  embeddedNodeChildEnvironment,
  setEnvironmentName,
} from "../../../config/embedded-node-runtime.mts";
import {
  readHarnessRuntimeLayout,
  type HarnessRuntimeLayout,
} from "../harness-launch.ts";
import {
  runPluginCommand,
  type PluginInstallCommandRunner,
} from "./command.ts";

const PROFILE_NAME = "web";

export interface WebPluginProfileOptions {
  runtimeRoot: string;
  dshHome: string;
  electronExecutable: string;
  environment?: NodeJS.ProcessEnv;
  readRuntimeLayout?: () => Promise<HarnessRuntimeLayout>;
  runCommand?: PluginInstallCommandRunner;
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
  enabled: boolean,
): Promise<InstalledPlugin> {
  let manifest: unknown;
  try {
    manifest = await readJsonFile(
      join(
        profileRoot,
        "node_modules",
        ...name.split("/"),
        "package.json",
      ),
    );
  } catch {
    manifest = undefined;
  }
  if (!isRecord(manifest)) {
    return {
      name,
      requested,
      enabled,
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
    enabled,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(repositoryUrl === undefined
      ? {}
      : { repositoryUrl }),
    state: "ready",
  };
}

/**
 * Owns the DSH web profile: manifest discovery, installed package metadata,
 * and shell-free add/remove commands.
 */
export class WebPluginProfile {
  readonly #dshHome: string;
  readonly #electronExecutable: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #readRuntimeLayout: () => Promise<HarnessRuntimeLayout>;
  readonly #runCommand: PluginInstallCommandRunner;

  constructor(options: WebPluginProfileOptions) {
    const runtimeRoot = options.runtimeRoot;
    this.#dshHome = options.dshHome;
    this.#electronExecutable = options.electronExecutable;
    this.#environment = {
      ...(options.environment ?? process.env),
    };
    this.#readRuntimeLayout =
      options.readRuntimeLayout ??
      (() => readHarnessRuntimeLayout(runtimeRoot));
    this.#runCommand = options.runCommand ?? runPluginCommand;
  }

  async list(
    settings: PluginManagementSettings,
  ): Promise<InstalledPluginsSnapshot> {
    const profileRoot = join(
      this.#dshHome,
      "profiles",
      PROFILE_NAME,
    );
    const manifest = await readJsonFile(
      join(profileRoot, "package.json"),
    );
    if (manifest === undefined) {
      return parseInstalledPluginsSnapshot({
        plugins: [],
        safeMode: settings.safeMode,
      });
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
        readInstalledPackage(
          profileRoot,
          name,
          requested,
          !settings.disabledPlugins.includes(name),
        )),
    );
    return parseInstalledPluginsSnapshot({
      plugins,
      safeMode: settings.safeMode,
    });
  }

  add(target: string): Promise<void> {
    return this.#runProfileCommand("add", target);
  }

  remove(target: string): Promise<void> {
    return this.#runProfileCommand("remove", target);
  }

  async #runProfileCommand(
    action: "add" | "remove",
    target: string,
  ): Promise<void> {
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
    setEnvironmentName(environment, "DSH_HOME", this.#dshHome);
    await this.#runCommand(
      this.#electronExecutable,
      [
        "--expose-internals",
        layout.entryPath,
        "plugin",
        "--profile",
        PROFILE_NAME,
        action,
        target,
      ],
      {
        cwd: this.#dshHome,
        env: environment,
      },
    );
  }
}
