import { existsSync } from "node:fs";

export class ReusableRuntimeUnavailableError extends Error {
  constructor(reason, message, options) {
    super(message, options);
    this.name = "ReusableRuntimeUnavailableError";
    this.reason = reason;
  }
}

export function assertReusableRuntimeFiles(
  paths,
  pathExists = existsSync,
) {
  for (const path of paths) {
    if (!pathExists(path)) {
      throw new ReusableRuntimeUnavailableError(
        "incomplete",
        `staged Harness runtime is incomplete because ${path} is missing; run harness:stage`,
      );
    }
  }
}

export function parseStageFlags(argv) {
  const known = new Set([
    "--refresh-if-stale",
    "--skip-build",
    "--skip-install",
  ]);
  for (const flag of argv) {
    if (!known.has(flag)) {
      throw new Error(`unknown option ${JSON.stringify(flag)}`);
    }
  }
  const flags = {
    refreshIfStale: argv.includes("--refresh-if-stale"),
    skipBuild: argv.includes("--skip-build"),
    skipInstall: argv.includes("--skip-install"),
  };
  if (
    flags.refreshIfStale &&
    !(flags.skipBuild && flags.skipInstall)
  ) {
    throw new Error(
      "--refresh-if-stale requires --skip-install and --skip-build",
    );
  }
  return Object.freeze(flags);
}

export async function chooseStagePlan(
  flags,
  validateReusable,
) {
  if (!(flags.skipInstall && flags.skipBuild)) {
    return Object.freeze({
      mode: "full",
      skipBuild: flags.skipBuild,
      skipInstall: flags.skipInstall,
    });
  }
  try {
    await validateReusable();
    return Object.freeze({
      mode: "reuse",
      skipBuild: true,
      skipInstall: true,
    });
  } catch (error) {
    if (
      !flags.refreshIfStale ||
      !(error instanceof ReusableRuntimeUnavailableError)
    ) {
      throw error;
    }
    return Object.freeze({
      fallbackReason: error.reason,
      mode: "full",
      skipBuild: false,
      skipInstall: false,
    });
  }
}
