import { delimiter } from "node:path";

/**
 * Product-owned environment names for the Electron-as-Node runtime.
 *
 * Harness intentionally strips ambient DSH_* identity before launching
 * managed subprocesses. These MINKE_* capabilities must survive that scrub
 * so every descendant resolves `dsh`, `node`, `pnpm`, and `pnpx` back to
 * the runtime and executable owned by Minke.
 */
export const embeddedNodeEnvironment = Object.freeze({
  executable: "MINKE_NODE_EXECUTABLE",
  mode: "ELECTRON_RUN_AS_NODE",
  pnpmEntry: "MINKE_PNPM_ENTRY",
} as const);

export interface EmbeddedNodeChildEnvironmentOptions {
  readonly electronExecutable: string;
  readonly pnpmEntry: string;
  readonly runtimeBin: string;
}

/** Inject Minke's self-contained CLI runtime into one child environment. */
export function embeddedNodeChildEnvironment(
  options: EmbeddedNodeChildEnvironmentOptions,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...inherited,
    [embeddedNodeEnvironment.executable]: options.electronExecutable,
    [embeddedNodeEnvironment.pnpmEntry]: options.pnpmEntry,
    [embeddedNodeEnvironment.mode]: "1",
    PATH: [options.runtimeBin, inherited.PATH]
      .filter(Boolean)
      .join(delimiter),
  };
  delete environment.DSH_ELECTRON_EXECUTABLE;
  delete environment.DSH_PNPM_ENTRY;
  return environment;
}
