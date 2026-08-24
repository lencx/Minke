const EXTERNAL_RUNTIME_CONTROLS = [
  "ELECTRON_RUN_AS_NODE",
  "MINKE_INTERACTIVE_NODE_OPTIONS",
  "MINKE_INTERACTIVE_NODE_PATH",
  "MINKE_NODE_BOOTSTRAP",
  "NODE_OPTIONS",
  "NODE_PATH",
] as const;

/** Explicit DSH subprocess overrides for product-owned external runtimes. */
export function externalRuntimeEnvironment(
  additions: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const environment = { ...additions };
  for (const name of EXTERNAL_RUNTIME_CONTROLS) {
    for (const key of Object.keys(environment)) {
      if (key.toUpperCase() === name) {
        delete environment[key];
      }
    }
    environment[name] = undefined;
  }
  return environment;
}
