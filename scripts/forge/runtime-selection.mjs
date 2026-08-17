const supportedDesktopPlatforms = new Set(["darwin", "linux", "win32"]);

export function forgeUsesElectronWorker(platform = process.platform) {
  if (!supportedDesktopPlatforms.has(platform)) {
    throw new Error(`unsupported desktop platform ${JSON.stringify(platform)}`);
  }
  return platform === "darwin";
}
