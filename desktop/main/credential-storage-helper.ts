import {
  app,
  safeStorage,
  type SafeStorage,
} from "electron";
import type {
  MacOSCredentialStorageRequest,
  MacOSCredentialStorageResponse,
} from "./remote-hub/macos-credential-storage.ts";
import {
  CREDENTIAL_STORAGE_HELPER_FLAG,
  CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX,
} from "./remote-hub/macos-credential-storage.ts";

const HELPER_INPUT_LIMIT = 32 * 1024;

function parseRequest(
  value: unknown,
): MacOSCredentialStorageRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).length !== 2
  ) {
    throw new TypeError(
      "Minke credential helper request is invalid",
    );
  }
  const candidate = value as {
    operation?: unknown;
    value?: unknown;
  };
  if (
    (candidate.operation !== "encrypt" &&
      candidate.operation !== "decrypt") ||
    typeof candidate.value !== "string" ||
    Buffer.byteLength(candidate.value, "utf8") >
      HELPER_INPUT_LIMIT
  ) {
    throw new TypeError(
      "Minke credential helper request is invalid",
    );
  }
  return {
    operation: candidate.operation,
    value: candidate.value,
  };
}

async function readRequest(
  input: NodeJS.ReadableStream,
): Promise<MacOSCredentialStorageRequest> {
  let source = "";
  for await (const chunk of input) {
    source += chunk.toString();
    if (
      Buffer.byteLength(source, "utf8") >
      HELPER_INPUT_LIMIT
    ) {
      throw new Error(
        "Minke credential helper request is too large",
      );
    }
  }
  return parseRequest(JSON.parse(source));
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_024) ||
    "Credential authorization did not complete";
}

function writeResponse(
  output: NodeJS.WritableStream,
  response: MacOSCredentialStorageResponse,
): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(
      `${CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX}${JSON.stringify(response)}\n`,
      (error) => {
        if (error === undefined || error === null) {
          resolve();
        } else {
          reject(error);
        }
      },
    );
  });
}

export function isCredentialStorageHelperProcess(
  argv: readonly string[] = process.argv,
): boolean {
  return argv.includes(CREDENTIAL_STORAGE_HELPER_FLAG);
}

export interface CredentialStorageHelperRuntimeOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly storage?: SafeStorage;
}

export async function runCredentialStorageHelper(
  options: CredentialStorageHelperRuntimeOptions = {},
): Promise<number> {
  const output = options.output ?? process.stdout;
  try {
    await app.whenReady();
    app.dock?.hide();
    const request = await readRequest(
      options.input ?? process.stdin,
    );
    const storage = options.storage ?? safeStorage;
    if (!(await storage.isAsyncEncryptionAvailable())) {
      throw new Error(
        "macOS secure credential storage is unavailable",
      );
    }
    if (request.operation === "encrypt") {
      const encrypted = await storage.encryptStringAsync(
        request.value,
      );
      await writeResponse(output, {
        ok: true,
        value: encrypted.toString("base64"),
      });
    } else {
      const decrypted = await storage.decryptStringAsync(
        Buffer.from(request.value, "base64"),
      );
      await writeResponse(output, {
        ok: true,
        shouldReEncrypt: decrypted.shouldReEncrypt,
        value: decrypted.result,
      });
    }
    return 0;
  } catch (error) {
    try {
      await writeResponse(output, {
        error: errorMessage(error),
        ok: false,
      });
    } catch {
      return 1;
    }
    return 1;
  }
}
