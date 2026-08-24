import { execFile } from "node:child_process";
import {
  nativeChildEnvironment,
} from "../../config/embedded-node-runtime.mts";

export type XattrReader = (
  args: readonly string[],
) => Promise<string>;

function readXattr(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/xattr",
      [...args],
      {
        encoding: "utf8",
        env: nativeChildEnvironment(),
        maxBuffer: 8 * 1024,
        timeout: 5_000,
      },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(error);
      },
    );
  });
}

/**
 * Requires Chromium's macOS download quarantine marker to remain present.
 * This helper is intentionally read-only and never offers a delete operation.
 */
export async function assertMacFileQuarantined(
  path: string,
  reader: XattrReader = readXattr,
): Promise<void> {
  let value: string;
  try {
    value = await reader([
      "-p",
      "com.apple.quarantine",
      path,
    ]);
  } catch {
    throw new Error(
      "downloaded update is not quarantined by macOS",
    );
  }
  if (value.trim() === "" || value.length > 4_096) {
    throw new Error(
      "downloaded update is not quarantined by macOS",
    );
  }
}
