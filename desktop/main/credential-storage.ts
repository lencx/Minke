import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import type {
  ElectronSafeStoragePort,
  ElectronSafeStorageSource,
} from "./remote-hub/credential-vault.ts";
import {
  MacOSCredentialStorage,
  CREDENTIAL_STORAGE_HELPER_FLAG,
  CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX,
  type MacOSCredentialStorageHelperPort,
  type MacOSCredentialStorageRequest,
  type MacOSCredentialStorageResponse,
} from "./remote-hub/macos-credential-storage.ts";

const HELPER_OUTPUT_LIMIT = 64 * 1024;
const HELPER_TIMEOUT_MS = 5 * 60 * 1_000;

export interface CredentialStorageHelperLaunchOptions {
  readonly appPath: string;
  readonly defaultApp: boolean;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executablePath: string;
  readonly spawnProcess?: typeof spawn;
  readonly timeoutMs?: number;
}

function helperEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function appendBounded(
  current: string,
  chunk: Buffer | string,
): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") > HELPER_OUTPUT_LIMIT) {
    throw new Error(
      "Minke credential helper returned too much data",
    );
  }
  return next;
}

function parseHelperResponse(
  output: string,
): MacOSCredentialStorageResponse {
  const lines = output.split(/\r?\n/u);
  let line: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (
      lines[index].startsWith(
        CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX,
      )
    ) {
      line = lines[index];
      break;
    }
  }
  if (line === undefined) {
    throw new Error(
      "Minke credential helper returned no response",
    );
  }
  const candidate = JSON.parse(
    line.slice(
      CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX.length,
    ),
  ) as unknown;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as { ok?: unknown }).ok !== "boolean"
  ) {
    throw new TypeError(
      "Minke credential helper returned an invalid response",
    );
  }
  if ((candidate as { ok: boolean }).ok) {
    const response = candidate as {
      ok: true;
      shouldReEncrypt?: unknown;
      value?: unknown;
    };
    if (
      typeof response.value !== "string" ||
      (response.shouldReEncrypt !== undefined &&
        typeof response.shouldReEncrypt !== "boolean")
    ) {
      throw new TypeError(
        "Minke credential helper returned an invalid result",
      );
    }
    return {
      ok: true,
      value: response.value,
      ...(response.shouldReEncrypt === undefined
        ? {}
        : {
            shouldReEncrypt: response.shouldReEncrypt,
          }),
    };
  }
  const response = candidate as {
    error?: unknown;
    ok: false;
  };
  if (
    typeof response.error !== "string" ||
    response.error.length === 0 ||
    response.error.length > 1_024
  ) {
    throw new TypeError(
      "Minke credential helper returned an invalid error",
    );
  }
  return { error: response.error, ok: false };
}

function runHelper(
  options: CredentialStorageHelperLaunchOptions,
  request: MacOSCredentialStorageRequest,
): Promise<MacOSCredentialStorageResponse> {
  return new Promise((resolve, reject) => {
    const args = options.defaultApp
      ? [
          options.appPath,
          CREDENTIAL_STORAGE_HELPER_FLAG,
        ]
      : [CREDENTIAL_STORAGE_HELPER_FLAG];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (options.spawnProcess ?? spawn)(
        options.executablePath,
        args,
        {
          env: helperEnvironment(
            options.environment ?? process.env,
          ),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch (error) {
      reject(error);
      return;
    }

    let output = "";
    let settled = false;
    let stderrBytes = 0;
    const settle = (
      action: () => void,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const fail = (error: unknown): void => {
      settle(() => {
        child.kill();
        reject(
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      });
    };
    const timeout = setTimeout(() => {
      fail(
        new Error(
          "Minke credential authorization timed out",
        ),
      );
    }, options.timeoutMs ?? HELPER_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      try {
        output = appendBounded(output, chunk);
      } catch (error) {
        fail(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk.toString(), "utf8");
      if (stderrBytes > HELPER_OUTPUT_LIMIT) {
        fail(
          new Error(
            "Minke credential helper returned too much diagnostic data",
          ),
        );
      }
    });
    child.once("error", fail);
    child.once("close", () => {
      settle(() => {
        try {
          resolve(parseHelperResponse(output));
        } catch (error) {
          reject(error);
        }
      });
    });
    child.stdin.once("error", fail);
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export function createMacOSCredentialStorageHelper(
  options: CredentialStorageHelperLaunchOptions,
): MacOSCredentialStorageHelperPort {
  return {
    run: (request) => runHelper(options, request),
  };
}

export interface CredentialStorageOptions {
  readonly macOSHelper?: MacOSCredentialStorageHelperPort;
  readonly platform?: NodeJS.Platform;
}

export function createCredentialStorage(
  legacySource: () => ElectronSafeStoragePort,
  options: CredentialStorageOptions = {},
): ElectronSafeStorageSource {
  if (
    (options.platform ?? process.platform) !== "darwin"
  ) {
    return legacySource;
  }
  if (options.macOSHelper === undefined) {
    throw new Error(
      "Minke macOS credential helper is unavailable",
    );
  }
  const helper = options.macOSHelper;
  return () => new MacOSCredentialStorage(helper);
}
