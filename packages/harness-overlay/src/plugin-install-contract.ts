export const PLUGIN_INSTALL_CHANNEL = "minke:plugin:install";

const MAX_PLUGIN_INSTALL_COMMAND_LENGTH = 640;
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
