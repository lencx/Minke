import { join } from "node:path";

export function applicationResourcesRoot(appRoot, platform) {
  return platform === "darwin"
    ? join(appRoot, "Contents", "Resources")
    : join(appRoot, "resources");
}

export function applicationExecutablePath(appRoot, platform) {
  if (platform === "darwin") {
    return join(appRoot, "Contents", "MacOS", "Minke");
  }
  return join(appRoot, platform === "win32" ? "Minke.exe" : "Minke");
}

export function packagedApplicationLayout(
  projectRoot,
  platform = process.platform,
  arch = process.arch,
) {
  const outputRoot = join(
    projectRoot,
    "out",
    `Minke-${platform}-${arch}`,
  );
  const appRoot =
    platform === "darwin" ? join(outputRoot, "Minke.app") : outputRoot;
  return {
    appRoot,
    executablePath: applicationExecutablePath(appRoot, platform),
    outputRoot,
    resourcesRoot: applicationResourcesRoot(appRoot, platform),
  };
}
