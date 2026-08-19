import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parsePluginCatalogGitHubToken,
  type PluginCatalogCredentialProvider,
  type PluginCatalogCredentialState,
} from "@lencx/minke-plugin-catalog";

const CREDENTIAL_VERSION = 1 as const;
const MAX_ENCRYPTED_TOKEN_BYTES = 16 * 1024;

interface EncryptedCredentialDocument {
  version: typeof CREDENTIAL_VERSION;
  encryptedToken: string;
}

export interface PluginCatalogSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface EncryptedGitHubTokenStoreOptions {
  userDataPath: string;
  secureStorage: PluginCatalogSecureStorage;
  environment?: NodeJS.ProcessEnv;
}

/** Resolve the encrypted token document below Minke's user-data root. */
export function pluginCatalogCredentialFilePath(
  userDataPath: string,
): string {
  return join(
    userDataPath,
    "plugins",
    "github-token-v1.json",
  );
}

function parseDocument(
  value: unknown,
): EncryptedCredentialDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "plugin catalog credential document must be an object",
    );
  }
  const document = value as Record<string, unknown>;
  if (
    Object.keys(document).length !== 2 ||
    document.version !== CREDENTIAL_VERSION ||
    typeof document.encryptedToken !== "string" ||
    document.encryptedToken.length === 0
  ) {
    throw new TypeError(
      "invalid plugin catalog credential document",
    );
  }
  const encrypted = Buffer.from(
    document.encryptedToken,
    "base64",
  );
  if (
    encrypted.length === 0 ||
    encrypted.length > MAX_ENCRYPTED_TOKEN_BYTES ||
    encrypted.toString("base64") !== document.encryptedToken
  ) {
    throw new TypeError(
      "invalid plugin catalog credential payload",
    );
  }
  return {
    version: CREDENTIAL_VERSION,
    encryptedToken: document.encryptedToken,
  };
}

/**
 * Stores one GitHub token with the operating system's credential-backed
 * encryption. Reads expose only credential metadata unless a scan explicitly
 * resolves the token.
 */
export class EncryptedGitHubTokenStore
implements PluginCatalogCredentialProvider {
  readonly path: string;
  readonly #secureStorage: PluginCatalogSecureStorage;
  readonly #environment: NodeJS.ProcessEnv;

  #tail: Promise<void> = Promise.resolve();
  #writeSequence = 0;

  constructor(options: EncryptedGitHubTokenStoreOptions) {
    this.path = pluginCatalogCredentialFilePath(
      options.userDataPath,
    );
    this.#secureStorage = options.secureStorage;
    this.#environment = {
      ...(options.environment ?? process.env),
    };
  }

  resolve(): Promise<string | undefined> {
    return this.#runExclusive(async () => {
      const inherited = this.#inheritedToken();
      if (inherited !== undefined) {
        return parsePluginCatalogGitHubToken(inherited);
      }
      const document = await this.#readDocument();
      if (document === undefined) return undefined;
      this.#assertEncryptionAvailable();
      return parsePluginCatalogGitHubToken(
        this.#secureStorage.decryptString(
          Buffer.from(document.encryptedToken, "base64"),
        ),
      );
    });
  }

  describe(): Promise<PluginCatalogCredentialState> {
    return this.#runExclusive(async () => {
      if (this.#inheritedToken() !== undefined) {
        return {
          configured: true,
          writable: false,
          source: "environment",
        };
      }
      const configured =
        (await this.#readDocument()) !== undefined;
      return {
        configured,
        writable: this.#encryptionAvailable(),
        ...(configured
          ? { source: "secure-storage" as const }
          : {}),
      };
    });
  }

  set(token: string): Promise<void> {
    const validated = parsePluginCatalogGitHubToken(token);
    return this.#runExclusive(async () => {
      this.#assertNoInheritedToken("save");
      this.#assertEncryptionAvailable();
      const encryptedToken =
        this.#secureStorage
          .encryptString(validated)
          .toString("base64");
      await this.#persist({
        version: CREDENTIAL_VERSION,
        encryptedToken,
      });
    });
  }

  unset(): Promise<void> {
    return this.#runExclusive(async () => {
      this.#assertNoInheritedToken("remove");
      await rm(this.path, { force: true });
    });
  }

  #runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #inheritedToken(): string | undefined {
    for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
      const value = this.#environment[name];
      if (
        typeof value === "string" &&
        value.trim().length > 0
      ) {
        return value;
      }
    }
    return undefined;
  }

  #encryptionAvailable(): boolean {
    try {
      return this.#secureStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  #assertEncryptionAvailable(): void {
    if (!this.#encryptionAvailable()) {
      throw new Error(
        "operating-system secure storage is unavailable",
      );
    }
  }

  #assertNoInheritedToken(operation: string): void {
    if (this.#inheritedToken() !== undefined) {
      throw new Error(
        `the GitHub token comes from the environment and cannot be ${operation}d here`,
      );
    }
  }

  async #readDocument():
  Promise<EncryptedCredentialDocument | undefined> {
    try {
      return parseDocument(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async #persist(
    document: EncryptedCredentialDocument,
  ): Promise<void> {
    await mkdir(dirname(this.path), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryPath = `${this.path}.${String(
      process.pid,
    )}.${String(++this.#writeSequence)}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(document)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
