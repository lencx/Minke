/** Local command discovery for the remote-access module. */
import {
  access,
  constants,
  stat,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  resolve,
} from "node:path";

export interface RemoteCommands {
  tailscale?: string;
  cloudflared?: string;
}

export interface RemoteCommandDiscoveryOptions {
  homeDirectory: string;
  pathValue?: string;
  platform: NodeJS.Platform;
  localAppData?: string;
  programFiles?: string;
  includeSystemLocations?: boolean;
}

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function executableNames(
  platform: NodeJS.Platform,
  command: "tailscale" | "cloudflared",
): readonly string[] {
  const name = command;
  return platform === "win32"
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
    : [name];
}

function installedCandidates(
  options: RemoteCommandDiscoveryOptions,
  command: "tailscale" | "cloudflared",
): readonly string[] {
  if (options.platform === "darwin") {
    if (command === "cloudflared") {
      return options.includeSystemLocations === false
        ? []
        : [
            "/opt/homebrew/bin/cloudflared",
            "/usr/local/bin/cloudflared",
          ];
    }
    const relative = join(
      "Tailscale.app",
      "Contents",
      "MacOS",
      "Tailscale",
    );
    return [
      join(options.homeDirectory, "Applications", relative),
      ...(options.includeSystemLocations === false
        ? []
        : [
            join("/Applications", relative),
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
          ]),
    ];
  }
  if (options.platform === "win32") {
    if (command === "cloudflared") return [];
    return [
      ...(options.programFiles === undefined
        ? []
        : [
            join(
              options.programFiles,
              "Tailscale",
              "tailscale.exe",
            ),
          ]),
      ...(options.localAppData === undefined
        ? []
        : [
            join(
              options.localAppData,
              "Tailscale",
              "tailscale.exe",
            ),
          ]),
    ];
  }
  return options.includeSystemLocations === false
    ? []
    : [
        `/usr/local/bin/${command}`,
        `/usr/bin/${command}`,
      ];
}

function pathCandidates(
  options: RemoteCommandDiscoveryOptions,
  command: "tailscale" | "cloudflared",
): string[] {
  return (options.pathValue ?? "")
    .split(pathDelimiter(options.platform))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .flatMap((directory) =>
      executableNames(options.platform, command).map((name) =>
        join(
          isAbsolute(directory) ? directory : resolve(directory),
          name,
        )
      )
    );
}

async function discoverRemoteCommand(
  options: RemoteCommandDiscoveryOptions,
  command: "tailscale" | "cloudflared",
): Promise<string | undefined> {
  const candidates = [
    ...installedCandidates(options, command),
    ...pathCandidates(options, command),
  ];
  for (const candidate of new Set(candidates)) {
    if (await isExecutableFile(candidate, options.platform)) {
      return candidate;
    }
  }
  return undefined;
}

async function isExecutableFile(
  path: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    await access(
      path,
      platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate supported remote commands without executing them. Known GUI and
 * system install paths precede PATH so desktop launches work with a minimal
 * inherited environment.
 */
export async function discoverRemoteCommands(
  options: RemoteCommandDiscoveryOptions,
): Promise<RemoteCommands> {
  const [tailscale, cloudflared] = await Promise.all([
    discoverRemoteCommand(options, "tailscale"),
    discoverRemoteCommand(options, "cloudflared"),
  ]);
  return {
    ...(tailscale === undefined ? {} : { tailscale }),
    ...(cloudflared === undefined ? {} : { cloudflared }),
  };
}
