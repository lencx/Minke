import type {
  ElectronSafeStoragePort,
} from "./credential-vault.ts";

export const CREDENTIAL_STORAGE_HELPER_FLAG =
  "--minke-credential-storage-helper";
export const CREDENTIAL_STORAGE_HELPER_RESPONSE_PREFIX =
  "MINKE_CREDENTIAL_STORAGE_V1:";

export type MacOSCredentialStorageRequest =
  | {
      readonly operation: "encrypt";
      readonly value: string;
    }
  | {
      readonly operation: "decrypt";
      readonly value: string;
    };

export type MacOSCredentialStorageResponse =
  | {
      readonly ok: true;
      readonly shouldReEncrypt?: boolean;
      readonly value: string;
    }
  | {
      readonly error: string;
      readonly ok: false;
    };

export interface MacOSCredentialStorageHelperPort {
  run(
    request: MacOSCredentialStorageRequest,
  ): Promise<MacOSCredentialStorageResponse>;
}

/**
 * Route every macOS safeStorage operation through a fresh, short-lived Minke
 * process. Chromium keeps a failed asynchronous Keychain initialization for
 * the lifetime of one process; ending the helper discards that state so the
 * next explicit click can request authorization again without restarting the
 * desktop application.
 */
export class MacOSCredentialStorage
  implements ElectronSafeStoragePort
{
  readonly #helper: MacOSCredentialStorageHelperPort;

  constructor(helper: MacOSCredentialStorageHelperPort) {
    this.#helper = helper;
  }

  isEncryptionAvailable(): boolean {
    return true;
  }

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    return true;
  }

  encryptString(): Buffer {
    throw new Error(
      "macOS credential storage requires its asynchronous helper",
    );
  }

  async encryptStringAsync(value: string): Promise<Buffer> {
    const response = await this.#helper.run({
      operation: "encrypt",
      value,
    });
    if (!response.ok) throw new Error(response.error);
    return Buffer.from(response.value, "base64");
  }

  decryptString(): string {
    throw new Error(
      "macOS credential storage requires its asynchronous helper",
    );
  }

  async decryptStringAsync(value: Buffer): Promise<{
    readonly result: string;
    readonly shouldReEncrypt: boolean;
  }> {
    const response = await this.#helper.run({
      operation: "decrypt",
      value: value.toString("base64"),
    });
    if (!response.ok) throw new Error(response.error);
    return {
      result: response.value,
      shouldReEncrypt: response.shouldReEncrypt ?? false,
    };
  }
}
