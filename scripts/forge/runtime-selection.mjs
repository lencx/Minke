const supportedDesktopPlatforms = new Set(["darwin", "linux", "win32"]);
const electronNodeControls = Object.freeze([
  "ELECTRON_RUN_AS_NODE",
  "MINKE_INTERACTIVE_NODE_OPTIONS",
  "MINKE_INTERACTIVE_NODE_PATH",
  "MINKE_NODE_BOOTSTRAP",
  "NODE_OPTIONS",
  "NODE_PATH",
]);
const forgeWorkerMarker = "DSH_FORGE_WORKER";

function deleteEnvironmentName(environment, name) {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === name) delete environment[key];
  }
}

export function forgeUsesElectronWorker(platform = process.platform) {
  if (!supportedDesktopPlatforms.has(platform)) {
    throw new Error(`unsupported desktop platform ${JSON.stringify(platform)}`);
  }
  return platform === "darwin";
}

/** Give the macOS Forge worker one clean, explicit Electron-as-Node launch. */
export function forgeElectronWorkerEnvironment(
  inherited = process.env,
) {
  const environment = { ...inherited };
  for (const name of electronNodeControls) {
    deleteEnvironmentName(environment, name);
  }
  deleteEnvironmentName(environment, forgeWorkerMarker);
  environment[forgeWorkerMarker] = "1";
  environment.ELECTRON_RUN_AS_NODE = "1";
  return environment;
}

/**
 * Electron has already selected Node mode by the time the worker runs this
 * module. Consume that one-launch instruction before Forge creates children.
 */
export function consumeForgeElectronWorkerEnvironment(
  environment = process.env,
) {
  for (const name of electronNodeControls) {
    deleteEnvironmentName(environment, name);
  }
  deleteEnvironmentName(environment, forgeWorkerMarker);
}
