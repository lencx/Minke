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
import type {
  LocalModelRuntimeId,
} from "@lencx/minke-model-runtime/contract";

export type LocalModelCommands = Partial<
  Record<LocalModelRuntimeId, string>
>;

export interface LocalModelCommandDiscoveryOptions {
  homeDirectory: string;
  pathValue?: string;
  platform: NodeJS.Platform;
  localAppData?: string;
  includeSystemLocations?: boolean;
}

interface LocalModelCommandDescriptor {
  id: LocalModelRuntimeId;
  executableNames(platform: NodeJS.Platform): readonly string[];
  installedCandidates(
    options: LocalModelCommandDiscoveryOptions,
  ): readonly string[];
}

const COMMANDS: readonly LocalModelCommandDescriptor[] = [
  {
    id: "lmStudio",
    executableNames: (platform) =>
      platform === "win32"
        ? ["lms.exe", "lms.cmd", "lms.bat", "lms"]
        : ["lms"],
    installedCandidates: ({ homeDirectory, platform }) => [
      join(
        homeDirectory,
        ".lmstudio",
        "bin",
        platform === "win32" ? "lms.exe" : "lms",
      ),
    ],
  },
  {
    id: "ollama",
    executableNames: (platform) =>
      platform === "win32"
        ? ["ollama.exe", "ollama.cmd", "ollama.bat", "ollama"]
        : ["ollama"],
    installedCandidates: (options) => {
      if (options.platform === "darwin") {
        return [
          join(
            options.homeDirectory,
            "Applications",
            "Ollama.app",
            "Contents",
            "Resources",
            "ollama",
          ),
          ...(options.includeSystemLocations === false
            ? []
            : [
                join(
                  "/Applications",
                  "Ollama.app",
                  "Contents",
                  "Resources",
                  "ollama",
                ),
              ]),
        ];
      }
      if (options.platform === "win32") {
        return options.localAppData === undefined
          ? []
          : [
              join(
                options.localAppData,
                "Programs",
                "Ollama",
                "ollama.exe",
              ),
            ];
      }
      return options.includeSystemLocations === false
        ? []
        : [
            "/usr/local/bin/ollama",
            "/usr/bin/ollama",
          ];
    },
  },
];

function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function pathCandidates(
  descriptor: LocalModelCommandDescriptor,
  options: LocalModelCommandDiscoveryOptions,
): string[] {
  const names = descriptor.executableNames(options.platform);
  return (options.pathValue ?? "")
    .split(pathDelimiter(options.platform))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .flatMap((directory) =>
      names.map((name) =>
        join(
          isAbsolute(directory) ? directory : resolve(directory),
          name,
        )
      )
    );
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

async function discoverCommand(
  descriptor: LocalModelCommandDescriptor,
  options: LocalModelCommandDiscoveryOptions,
): Promise<string | undefined> {
  const candidates = [
    ...descriptor.installedCandidates(options),
    ...pathCandidates(descriptor, options),
  ];
  for (const candidate of new Set(candidates)) {
    if (await isExecutableFile(candidate, options.platform)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolve the two supported local runtimes without executing either command.
 * Known GUI install locations precede PATH so desktop launches remain useful
 * even when the inherited PATH is minimal.
 */
export async function discoverLocalModelCommands(
  options: LocalModelCommandDiscoveryOptions,
): Promise<LocalModelCommands> {
  const discovered = await Promise.all(
    COMMANDS.map(async (descriptor) => ({
      id: descriptor.id,
      command: await discoverCommand(descriptor, options),
    })),
  );
  return Object.fromEntries(
    discovered.flatMap(({ id, command }) =>
      command === undefined ? [] : [[id, command]]
    ),
  ) as LocalModelCommands;
}
