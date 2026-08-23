import { execFile } from "node:child_process";

const PLUGIN_COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface PluginInstallCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PluginInstallCommandRunner {
  (
    command: string,
    args: readonly string[],
    options: PluginInstallCommandOptions,
  ): Promise<void>;
}

function commandFailure(
  error: Error,
  stdout: string,
  stderr: string,
): Error {
  const detail = `${stderr}\n${stdout}`
    .trim()
    .slice(-8_192);
  return new Error(
    detail === ""
      ? "plugin command failed"
      : `plugin command failed: ${detail}`,
    { cause: error },
  );
}

export function runPluginCommand(
  command: string,
  args: readonly string[],
  options: PluginInstallCommandOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        timeout: PLUGIN_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        reject(commandFailure(error, stdout, stderr));
      },
    );
  });
}
