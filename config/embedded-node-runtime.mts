import { delimiter, join } from "node:path";

/**
 * Product-owned environment names for the Electron-as-Node runtime.
 *
 * Harness intentionally strips ambient DSH_* identity before launching
 * managed subprocesses. These MINKE_* capabilities must survive that scrub
 * so product-owned launch seams can resolve `dsh`, `node`, `pnpm`, and
 * `pnpx` back to the runtime and executable owned by Minke. Interactive
 * login-shell startup files remain authoritative over their final PATH.
 */
export const embeddedNodeEnvironment = Object.freeze({
  bootstrap: "MINKE_NODE_BOOTSTRAP",
  executable: "MINKE_NODE_EXECUTABLE",
  interactiveNodeOptions: "MINKE_INTERACTIVE_NODE_OPTIONS",
  interactiveNodePath: "MINKE_INTERACTIVE_NODE_PATH",
  mode: "ELECTRON_RUN_AS_NODE",
  pnpmEntry: "MINKE_PNPM_ENTRY",
} as const);

export interface EmbeddedNodeChildEnvironmentOptions {
  readonly electronExecutable: string;
  readonly pnpmEntry: string;
  readonly runtimeBin: string;
}

export function deleteEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
): void {
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) {
      delete environment[key];
    }
  }
}

export function setEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
  value: string | undefined,
): void {
  deleteEnvironmentName(environment, name);
  if (value !== undefined) {
    environment[name] = value;
  }
}

export function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const normalized = name.toUpperCase();
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalized) return value;
  }
  return undefined;
}

function capturedEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  captureName: string,
): string | undefined {
  return (
    environmentValue(environment, captureName) ??
    environmentValue(environment, name)
  );
}

function runtimePath(
  runtimeBin: string,
  inheritedPath: string | undefined,
): string {
  const firstEntry = inheritedPath?.split(delimiter, 1)[0];
  const sameFirstEntry =
    firstEntry !== undefined &&
    (
      process.platform === "win32"
        ? firstEntry.toUpperCase() === runtimeBin.toUpperCase()
        : firstEntry === runtimeBin
    );
  if (sameFirstEntry && inheritedPath !== undefined) {
    return inheritedPath;
  }
  return [runtimeBin, inheritedPath].filter(Boolean).join(delimiter);
}

/**
 * Expose Minke's Node wrappers without changing how the immediate process
 * interprets its executable. Shells and arbitrary CLIs use this capability
 * environment; each wrapper opts into Electron-as-Node only for itself.
 * The runtime bin starts at the front of inherited PATH, while an interactive
 * shell may deliberately reorder it from its own startup files.
 */
export function embeddedNodeCapabilitiesEnvironment(
  options: EmbeddedNodeChildEnvironmentOptions,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...inherited,
  };
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.executable,
    options.electronExecutable,
  );
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.pnpmEntry,
    options.pnpmEntry,
  );
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.bootstrap,
    join(options.runtimeBin, "node-environment-bootstrap.cjs"),
  );
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.interactiveNodeOptions,
    capturedEnvironmentValue(
      inherited,
      "NODE_OPTIONS",
      embeddedNodeEnvironment.interactiveNodeOptions,
    ),
  );
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.interactiveNodePath,
    capturedEnvironmentValue(
      inherited,
      "NODE_PATH",
      embeddedNodeEnvironment.interactiveNodePath,
    ),
  );
  setEnvironmentName(
    environment,
    "PATH",
    runtimePath(
      options.runtimeBin,
      environmentValue(inherited, "PATH"),
    ),
  );
  deleteEnvironmentName(
    environment,
    embeddedNodeEnvironment.mode,
  );
  deleteEnvironmentName(
    environment,
    "DSH_ELECTRON_EXECUTABLE",
  );
  deleteEnvironmentName(environment, "DSH_PNPM_ENTRY");
  return environment;
}

/**
 * Launch the Electron executable itself as a Node process. This opt-in mode
 * belongs only on that direct child; it must not become a generic descendant
 * capability.
 */
export function embeddedNodeChildEnvironment(
  options: EmbeddedNodeChildEnvironmentOptions,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment =
    embeddedNodeCapabilitiesEnvironment(options, inherited);
  deleteEnvironmentName(environment, "NODE_OPTIONS");
  deleteEnvironmentName(environment, "NODE_PATH");
  setEnvironmentName(
    environment,
    embeddedNodeEnvironment.mode,
    "1",
  );
  return environment;
}

/** Launch a product-owned native command without Node/Electron bootstrap state. */
export function nativeChildEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...inherited };
  for (const name of [
    embeddedNodeEnvironment.mode,
    embeddedNodeEnvironment.interactiveNodeOptions,
    embeddedNodeEnvironment.interactiveNodePath,
    embeddedNodeEnvironment.bootstrap,
    "NODE_OPTIONS",
    "NODE_PATH",
  ]) {
    deleteEnvironmentName(environment, name);
  }
  return environment;
}
