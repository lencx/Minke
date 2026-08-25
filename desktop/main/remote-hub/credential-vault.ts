import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  GatewayCipher,
} from "@lencx/minke-im-gateway";
import type {
  WeixinAccountGrant,
} from "@lencx/minke-im-weixin";

export interface ElectronSafeStoragePort {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  getSelectedStorageBackend?(): string;
  isEncryptionAvailable(): boolean;
}

export interface StoredWeixinGrant {
  readonly generation: number;
  readonly grant: WeixinAccountGrant;
}

export type BotCredentialProvider = "telegram" | "discord";

export interface StoredBotCredential {
  readonly accountId: string;
  readonly accountLabel: string;
  readonly authorizedUserId?: string;
  readonly connectionPaused?: true;
  readonly generation: number;
  readonly token: string;
}

interface AeadDocument {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly tag: string;
  readonly version: 1;
}

interface WrappedKeyDocument {
  readonly version: 1;
  readonly wrappedKey: string;
}

const AEAD_VERSION = 1;
const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const GATEWAY_ENVELOPE_BYTES =
  1 + GCM_NONCE_BYTES + GCM_TAG_BYTES;
const WEIXIN_GRANT_PURPOSE = "minke:weixin-grant:v1";
const BOT_CREDENTIAL_PURPOSE: Readonly<
  Record<BotCredentialProvider, string>
> = Object.freeze({
  telegram: "minke:telegram-bot-credential:v1",
  discord: "minke:discord-bot-credential:v1",
});

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function storedGrant(value: unknown): StoredWeixinGrant {
  if (!isRecord(value) || !isRecord(value.grant)) {
    throw new TypeError("stored Weixin grant is invalid");
  }
  const grant = value.grant;
  const keys = Object.keys(value);
  const grantKeys = Object.keys(grant);
  if (
    keys.length !== 2 ||
    !keys.includes("generation") ||
    !keys.includes("grant") ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) <= 0 ||
    !grantKeys.every((key) =>
      [
        "accountId",
        "token",
        "baseUrl",
        "authorizedUserId",
      ].includes(key)
    ) ||
    (
      grantKeys.length !== 3 &&
      grantKeys.length !== 4
    ) ||
    typeof grant.accountId !== "string" ||
    grant.accountId.length === 0 ||
    typeof grant.token !== "string" ||
    grant.token.length === 0 ||
    typeof grant.baseUrl !== "string" ||
    grant.baseUrl.length === 0 ||
    (
      grant.authorizedUserId !== undefined &&
      typeof grant.authorizedUserId !== "string"
    )
  ) {
    throw new TypeError("stored Weixin grant is invalid");
  }
  return {
    generation: Number(value.generation),
    grant: {
      accountId: grant.accountId,
      token: grant.token,
      baseUrl: grant.baseUrl,
      ...(grant.authorizedUserId === undefined
        ? {}
        : { authorizedUserId: grant.authorizedUserId }),
    },
  };
}

function storedBotCredential(
  value: unknown,
): StoredBotCredential {
  const keys = isRecord(value) ? Object.keys(value) : [];
  if (
    !isRecord(value) ||
    !keys.every((key) =>
      [
        "accountId",
        "accountLabel",
        "authorizedUserId",
        "connectionPaused",
        "generation",
        "token",
      ].includes(key)
    ) ||
    ![
      "accountId",
      "accountLabel",
      "generation",
      "token",
    ].every((key) => keys.includes(key)) ||
    keys.length < 4 ||
    keys.length > 6 ||
    typeof value.accountId !== "string" ||
    value.accountId.length === 0 ||
    value.accountId.length > 128 ||
    typeof value.accountLabel !== "string" ||
    value.accountLabel.length === 0 ||
    value.accountLabel.length > 128 ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) <= 0 ||
    typeof value.token !== "string" ||
    value.token.length < 20 ||
    value.token.length > 4_096 ||
    /\s/u.test(value.token) ||
    (
      value.authorizedUserId !== undefined &&
      (
        typeof value.authorizedUserId !== "string" ||
        value.authorizedUserId.length === 0 ||
        value.authorizedUserId.length > 128
      )
    ) ||
    (
      value.connectionPaused !== undefined &&
      value.connectionPaused !== true
    )
  ) {
    throw new TypeError("stored bot credential is invalid");
  }
  return {
    accountId: value.accountId,
    accountLabel: value.accountLabel,
    ...(value.authorizedUserId === undefined
      ? {}
      : { authorizedUserId: value.authorizedUserId }),
    ...(value.connectionPaused === true
      ? { connectionPaused: true as const }
      : {}),
    generation: Number(value.generation),
    token: value.token,
  };
}

function aeadDocument(value: unknown): AeadDocument {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    value.version !== AEAD_VERSION ||
    typeof value.nonce !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string" ||
    value.nonce.length === 0 ||
    value.tag.length === 0
  ) {
    throw new TypeError("encrypted credential document is invalid");
  }
  return {
    version: AEAD_VERSION,
    nonce: value.nonce,
    tag: value.tag,
    ciphertext: value.ciphertext,
  };
}

function wrappedKeyDocument(value: unknown): WrappedKeyDocument {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== AEAD_VERSION ||
    typeof value.wrappedKey !== "string" ||
    value.wrappedKey.length === 0
  ) {
    throw new TypeError("wrapped Gateway key document is invalid");
  }
  return {
    version: AEAD_VERSION,
    wrappedKey: value.wrappedKey,
  };
}

function decodeBase64(
  value: string,
  name: string,
  expectedBytes?: number,
): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (
      expectedBytes !== undefined &&
      decoded.byteLength !== expectedBytes
    )
  ) {
    throw new TypeError(`${name} is invalid`);
  }
  return decoded;
}

function sealAead(
  key: Buffer,
  plaintext: Uint8Array,
  purpose: string,
): {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
} {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    nonce,
    { authTagLength: GCM_TAG_BYTES },
  );
  cipher.setAAD(Buffer.from(purpose, "utf8"), {
    plaintextLength: plaintext.byteLength,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  return {
    ciphertext,
    nonce,
    tag: cipher.getAuthTag(),
  };
}

function openAead(
  key: Buffer,
  input: {
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly tag: Uint8Array;
  },
  purpose: string,
): Buffer {
  if (
    input.nonce.byteLength !== GCM_NONCE_BYTES ||
    input.tag.byteLength !== GCM_TAG_BYTES
  ) {
    throw new TypeError("authenticated ciphertext envelope is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    input.nonce,
    { authTagLength: GCM_TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(purpose, "utf8"), {
    plaintextLength: input.ciphertext.byteLength,
  });
  decipher.setAuthTag(Buffer.from(input.tag));
  return Buffer.concat([
    decipher.update(input.ciphertext),
    decipher.final(),
  ]);
}

function protectedBackend(
  storage: ElectronSafeStoragePort,
): boolean {
  if (!storage.isEncryptionAvailable()) return false;
  return storage.getSelectedStorageBackend?.() !== "basic_text";
}

/**
 * Persist every Remote Hub credential with an authenticated data key wrapped
 * by Electron's OS-backed safeStorage.
 *
 * The file contains ciphertext only and is never folded into the ordinary
 * Minke configuration document.
 */
export class RemoteHubCredentialVault {
  readonly #gatewayKeyPath: string;
  readonly #weixinGrantPath: string;
  readonly #storage: ElectronSafeStoragePort;
  #gatewayKey: Buffer | undefined;
  #gatewayKeyPromise: Promise<Buffer> | undefined;

  constructor(
    userDataPath: string,
    storage: ElectronSafeStoragePort,
  ) {
    this.#weixinGrantPath = join(
      userDataPath,
      "secrets",
      "weixin.grant.json",
    );
    this.#gatewayKeyPath = join(
      userDataPath,
      "secrets",
      "im-gateway.key.json",
    );
    this.#storage = storage;
  }

  get available(): boolean {
    return protectedBackend(this.#storage);
  }

  async read(): Promise<StoredWeixinGrant | undefined> {
    return await this.#readCredential(
      this.#weixinGrantPath,
      WEIXIN_GRANT_PURPOSE,
      "Weixin grant",
      storedGrant,
    );
  }

  async write(value: StoredWeixinGrant): Promise<void> {
    const validated = storedGrant(value);
    await this.#writeCredential(
      this.#weixinGrantPath,
      WEIXIN_GRANT_PURPOSE,
      validated,
    );
  }

  async delete(): Promise<void> {
    await rm(this.#weixinGrantPath, { force: true });
  }

  async readBot(
    provider: BotCredentialProvider,
  ): Promise<StoredBotCredential | undefined> {
    return await this.#readCredential(
      this.#botCredentialPath(provider),
      BOT_CREDENTIAL_PURPOSE[provider],
      `${provider} bot credential`,
      storedBotCredential,
    );
  }

  async writeBot(
    provider: BotCredentialProvider,
    value: StoredBotCredential,
  ): Promise<void> {
    await this.#writeCredential(
      this.#botCredentialPath(provider),
      BOT_CREDENTIAL_PURPOSE[provider],
      storedBotCredential(value),
    );
  }

  async deleteBot(
    provider: BotCredentialProvider,
  ): Promise<void> {
    await rm(this.#botCredentialPath(provider), { force: true });
  }

  async deleteAllCredentials(): Promise<void> {
    await Promise.all([
      this.delete(),
      this.deleteBot("telegram"),
      this.deleteBot("discord"),
    ]);
  }

  async resetGatewayCipher(): Promise<void> {
    await this.#gatewayKeyPromise?.catch(() => {});
    this.#gatewayKey?.fill(0);
    this.#gatewayKey = undefined;
    await rm(this.#gatewayKeyPath, { force: true });
  }

  gatewayCipher(): GatewayCipher {
    if (!this.available) {
      throw new Error("OS credential protection is unavailable");
    }
    if (this.#gatewayKey === undefined) {
      throw new Error("Gateway cipher has not been initialized");
    }
    const key = Buffer.from(this.#gatewayKey);
    return Object.freeze({
      seal: (plaintext: Uint8Array, purpose: string) => {
        const encrypted = sealAead(
          key,
          plaintext,
          purpose,
        );
        const envelope = Buffer.allocUnsafe(
          GATEWAY_ENVELOPE_BYTES +
          encrypted.ciphertext.byteLength,
        );
        envelope[0] = AEAD_VERSION;
        encrypted.nonce.copy(envelope, 1);
        encrypted.tag.copy(
          envelope,
          1 + GCM_NONCE_BYTES,
        );
        encrypted.ciphertext.copy(
          envelope,
          GATEWAY_ENVELOPE_BYTES,
        );
        return new Uint8Array(envelope);
      },
      open: (ciphertext: Uint8Array, purpose: string) => {
        if (
          ciphertext.byteLength < GATEWAY_ENVELOPE_BYTES ||
          ciphertext[0] !== AEAD_VERSION
        ) {
          throw new Error(
            "Gateway authenticated ciphertext envelope is invalid",
          );
        }
        return new Uint8Array(openAead(
          key,
          {
            nonce: ciphertext.subarray(
              1,
              1 + GCM_NONCE_BYTES,
            ),
            tag: ciphertext.subarray(
              1 + GCM_NONCE_BYTES,
              GATEWAY_ENVELOPE_BYTES,
            ),
            ciphertext: ciphertext.subarray(
              GATEWAY_ENVELOPE_BYTES,
            ),
          },
          purpose,
        ));
      },
    });
  }

  async #ensureGatewayKey(): Promise<Buffer> {
    if (this.#gatewayKey !== undefined) {
      return this.#gatewayKey;
    }
    this.#gatewayKeyPromise ??= this.#loadOrCreateGatewayKey()
      .then((key) => {
        this.#gatewayKey = key;
        return key;
      })
      .finally(() => {
        this.#gatewayKeyPromise = undefined;
      });
    return await this.#gatewayKeyPromise;
  }

  #botCredentialPath(provider: BotCredentialProvider): string {
    return join(
      dirname(this.#weixinGrantPath),
      `${provider}.bot.json`,
    );
  }

  async #readCredential<T>(
    path: string,
    purpose: string,
    label: string,
    validate: (value: unknown) => T,
  ): Promise<T | undefined> {
    if (!this.available) {
      throw new Error("OS credential protection is unavailable");
    }
    const key = await this.#ensureGatewayKey();
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const document = aeadDocument(JSON.parse(source));
    const plaintext = openAead(
      key,
      {
        ciphertext: decodeBase64(
          document.ciphertext,
          `${label} ciphertext`,
        ),
        nonce: decodeBase64(
          document.nonce,
          `${label} nonce`,
          GCM_NONCE_BYTES,
        ),
        tag: decodeBase64(
          document.tag,
          `${label} authentication tag`,
          GCM_TAG_BYTES,
        ),
      },
      purpose,
    );
    return validate(JSON.parse(plaintext.toString("utf8")));
  }

  async #writeCredential(
    path: string,
    purpose: string,
    value: unknown,
  ): Promise<void> {
    if (!this.available) {
      throw new Error("OS credential protection is unavailable");
    }
    const key = await this.#ensureGatewayKey();
    const encrypted = sealAead(
      key,
      Buffer.from(JSON.stringify(value), "utf8"),
      purpose,
    );
    await this.#writeProtectedDocument(path, {
      version: AEAD_VERSION,
      nonce: encrypted.nonce.toString("base64"),
      tag: encrypted.tag.toString("base64"),
      ciphertext: encrypted.ciphertext.toString("base64"),
    });
  }

  async #loadOrCreateGatewayKey(): Promise<Buffer> {
    try {
      const source = await readFile(
        this.#gatewayKeyPath,
        "utf8",
      );
      const document = wrappedKeyDocument(JSON.parse(source));
      const encodedKey = this.#storage.decryptString(
        decodeBase64(
          document.wrappedKey,
          "wrapped Gateway key",
        ),
      );
      return decodeBase64(
        encodedKey,
        "unwrapped Gateway key",
        AES_KEY_BYTES,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const key = randomBytes(AES_KEY_BYTES);
    const wrapped = this.#storage.encryptString(
      key.toString("base64"),
    );
    try {
      await this.#writeProtectedDocument(
        this.#gatewayKeyPath,
        {
          version: AEAD_VERSION,
          wrappedKey: wrapped.toString("base64"),
        },
      );
      return key;
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  async #writeProtectedDocument(
    path: string,
    value: AeadDocument | WrappedKeyDocument,
  ): Promise<void> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        `${JSON.stringify(value)}\n`,
        { mode: 0o600 },
      );
      await chmod(temporary, 0o600);
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
