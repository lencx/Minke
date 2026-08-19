/**
 * Product-owned environment names for the Electron-as-Node runtime.
 *
 * Harness intentionally strips ambient DSH_* identity before launching
 * managed subprocesses. These MINKE_* capabilities must survive that scrub
 * so every descendant resolves `node`, `pnpm`, and `pnpx` back to the
 * executable and pnpm entry owned by Minke.
 */
export const embeddedNodeEnvironment = Object.freeze({
  executable: "MINKE_NODE_EXECUTABLE",
  mode: "ELECTRON_RUN_AS_NODE",
  pnpmEntry: "MINKE_PNPM_ENTRY",
} as const);
