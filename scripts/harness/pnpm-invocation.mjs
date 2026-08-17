import { extname } from "node:path";
import { resolveCommandInvocation } from "./command-invocation.mjs";

export function resolvePnpmInvocation(
  args,
  {
    comspec = process.env.ComSpec,
    nodeExecutable = process.execPath,
    npmExecPath = process.env.npm_execpath,
    platform = process.platform,
  } = {},
) {
  if (
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string")
  ) {
    throw new TypeError("pnpm arguments must be strings");
  }
  if (typeof npmExecPath !== "string" || npmExecPath.length === 0) {
    if (platform === "win32") {
      throw new Error(
        "run Harness staging through a pnpm package script so Windows can reuse its exact pnpm entrypoint",
      );
    }
    return { args, command: "pnpm" };
  }

  const extension = extname(npmExecPath).toLowerCase();
  if (extension === ".cjs" || extension === ".js" || extension === ".mjs") {
    return {
      args: [npmExecPath, ...args],
      command: nodeExecutable,
    };
  }
  if (
    platform === "win32" &&
    (extension === ".bat" || extension === ".cmd")
  ) {
    return resolveCommandInvocation(npmExecPath, args, {
      comspec,
      platform,
    });
  }
  return { args, command: npmExecPath };
}
