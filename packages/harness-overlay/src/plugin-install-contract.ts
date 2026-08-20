export const PLUGIN_INSTALL_CHANNEL = "minke:plugin:install";
export const PLUGIN_UNINSTALL_CHANNEL = "minke:plugin:uninstall";
export const PLUGIN_INSTALLED_READ_CHANNEL =
  "minke:plugin:installed:read";

const MAX_PLUGIN_INSTALL_COMMAND_LENGTH = 640;
const MAX_INSTALLED_PLUGINS = 512;
const MAX_PLUGIN_NAME_LENGTH = 214;
const MAX_PLUGIN_VERSION_LENGTH = 128;
const MAX_PLUGIN_DESCRIPTION_LENGTH = 1_000;
const MAX_PLUGIN_REPOSITORY_URL_LENGTH = 2_048;
const NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const NPM_PACKAGE_TARGET =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._+~-]*)?$/u;
const GITHUB_PACKAGE_TARGET =
  /^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}(?:#path:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/u;

export interface PluginInstallCommand {
  readonly command: string;
  readonly target: string;
}

export interface PluginInstallRequest {
  readonly command: string;
}

export interface PluginUninstallRequest {
  readonly name: string;
}

export type InstalledPluginState = "ready" | "missing";

export interface InstalledPlugin {
  readonly name: string;
  readonly requested: string;
  readonly version?: string;
  readonly description?: string;
  readonly repositoryUrl?: string;
  readonly state: InstalledPluginState;
}

export interface InstalledPluginsSnapshot {
  readonly plugins: readonly InstalledPlugin[];
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

function parseDisplayText(
  value: unknown,
  maximumLength: number,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(`invalid installed plugin ${label}`);
  }
  return value;
}

function parseOptionalDisplayText(
  value: unknown,
  maximumLength: number,
  label: string,
): string | undefined {
  return value === undefined
    ? undefined
    : parseDisplayText(value, maximumLength, label);
}

function parseInstalledPlugin(value: unknown): InstalledPlugin {
  if (!isRecord(value)) {
    throw new TypeError("invalid installed plugin");
  }
  const allowedKeys = new Set([
    "name",
    "requested",
    "version",
    "description",
    "repositoryUrl",
    "state",
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    !Object.hasOwn(value, "name") ||
    !Object.hasOwn(value, "requested") ||
    !Object.hasOwn(value, "state")
  ) {
    throw new TypeError("invalid installed plugin record");
  }
  const name = parseDisplayText(
    value.name,
    MAX_PLUGIN_NAME_LENGTH,
    "name",
  );
  if (!NPM_PACKAGE_NAME.test(name)) {
    throw new TypeError("invalid installed plugin name");
  }
  const requested = parseDisplayText(
    value.requested,
    MAX_PLUGIN_INSTALL_COMMAND_LENGTH,
    "requested version",
  );
  const version = parseOptionalDisplayText(
    value.version,
    MAX_PLUGIN_VERSION_LENGTH,
    "version",
  );
  const description = parseOptionalDisplayText(
    value.description,
    MAX_PLUGIN_DESCRIPTION_LENGTH,
    "description",
  );
  const repositoryUrl = parseOptionalDisplayText(
    value.repositoryUrl,
    MAX_PLUGIN_REPOSITORY_URL_LENGTH,
    "repository URL",
  );
  if (repositoryUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(repositoryUrl);
    } catch {
      throw new TypeError(
        "invalid installed plugin repository URL",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new TypeError(
        "invalid installed plugin repository URL",
      );
    }
  }
  if (value.state !== "ready" && value.state !== "missing") {
    throw new TypeError("invalid installed plugin state");
  }
  return Object.freeze({
    name,
    requested,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(repositoryUrl === undefined
      ? {}
      : { repositoryUrl }),
    state: value.state,
  });
}

export function parseInstalledPluginsSnapshot(
  value: unknown,
): InstalledPluginsSnapshot {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.plugins) ||
    value.plugins.length > MAX_INSTALLED_PLUGINS
  ) {
    throw new TypeError("invalid installed plugin snapshot");
  }
  return Object.freeze({
    plugins: Object.freeze(
      value.plugins.map(parseInstalledPlugin),
    ),
  });
}

export function parsePluginInstallTarget(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLUGIN_INSTALL_COMMAND_LENGTH ||
    value.trim() !== value ||
    (
      !NPM_PACKAGE_TARGET.test(value) &&
      !GITHUB_PACKAGE_TARGET.test(value)
    )
  ) {
    throw new TypeError("invalid plugin install target");
  }
  return value;
}

export function parsePluginInstallCommand(
  value: unknown,
): PluginInstallCommand {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLUGIN_INSTALL_COMMAND_LENGTH ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new TypeError("invalid plugin install command");
  }
  const parts = value.trim().split(/[ \t]+/u);
  if (
    parts.length !== 6 ||
    parts[0] !== "dsh" ||
    parts[1] !== "plugin" ||
    parts[2] !== "--profile" ||
    parts[3] !== "web" ||
    parts[4] !== "add"
  ) {
    throw new TypeError(
      "plugin install command must match `dsh plugin --profile web add <package>`",
    );
  }
  const target = parsePluginInstallTarget(parts[5]);
  return Object.freeze({
    command: `dsh plugin --profile web add ${target}`,
    target,
  });
}

export function parsePluginInstallRequest(
  value: unknown,
): PluginInstallRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as Record<string, unknown>).command !== "string"
  ) {
    throw new TypeError("invalid plugin install request");
  }
  return Object.freeze({
    command: parsePluginInstallCommand(
      (value as Record<string, unknown>).command,
    ).command,
  });
}

export function parsePluginUninstallTarget(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLUGIN_NAME_LENGTH ||
    value.trim() !== value ||
    !NPM_PACKAGE_NAME.test(value)
  ) {
    throw new TypeError("invalid plugin uninstall target");
  }
  return value;
}

export function parsePluginUninstallRequest(
  value: unknown,
): PluginUninstallRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "name")
  ) {
    throw new TypeError("invalid plugin uninstall request");
  }
  return Object.freeze({
    name: parsePluginUninstallTarget(value.name),
  });
}
