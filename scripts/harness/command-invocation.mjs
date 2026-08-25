import { spawn as spawnChild } from "node:child_process";
import { extname } from "node:path";

export function isCommandUnavailableResult(
  result,
  command,
  { platform = process.platform } = {},
) {
  if (
    result === null ||
    typeof result !== "object" ||
    typeof result.code !== "number" ||
    typeof result.stderr !== "string" ||
    typeof command !== "string" ||
    command.length === 0
  ) {
    return false;
  }
  const normalizedStderr = result.stderr.toLowerCase();
  if (!normalizedStderr.includes(command.toLowerCase())) return false;
  if (platform === "win32") return result.code === 1;
  return (
    result.code === 127 &&
    normalizedStderr.includes(`${command.toLowerCase()} not found on path`)
  );
}

export function resolveCommandInvocation(
  command,
  args,
  {
    comspec = process.env.ComSpec,
    platform = process.platform,
  } = {},
) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string")
  ) {
    throw new TypeError("command and arguments must be non-empty strings");
  }
  const extension = extname(command).toLowerCase();
  if (
    platform !== "win32" ||
    (extension !== ".bat" && extension !== ".cmd")
  ) {
    return { args, command };
  }
  return {
    args: ["/d", "/c", command, ...args],
    command:
      typeof comspec === "string" && comspec.length > 0
        ? comspec
        : "cmd.exe",
  };
}

export function spawnCommand(
  command,
  args,
  options,
  {
    comspec = process.env.ComSpec,
    platform = process.platform,
    spawnProcess = spawnChild,
  } = {},
) {
  if (typeof spawnProcess !== "function") {
    throw new TypeError("spawnProcess must be a function");
  }
  const invocation = resolveCommandInvocation(command, args, {
    comspec,
    platform,
  });
  return spawnProcess(
    invocation.command,
    invocation.args,
    options,
  );
}
