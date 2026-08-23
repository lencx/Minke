/**
 * AES/CDN semantics adapted from
 * @tencent-weixin/openclaw-weixin@2.4.6 (MIT).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  WEIXIN_DEFAULT_CDN_BASE_URL,
  WeixinTransportError,
  type WeixinAttachmentKind,
  type WeixinInboundAttachment,
  type WeixinMediaBlob,
} from "./contract.ts";
import {
  parseGetUploadUrlResponse,
} from "./codec.ts";
import { WeixinNetwork } from "./network.ts";
import {
  MessageItemType,
  UploadMediaType,
  type MessageItem,
} from "./protocol.ts";

const CDN_UPLOAD_ATTEMPTS = 3;
const CDN_UPLOAD_RETRY_BASE_MS = 250;
const CDN_UPLOAD_RETRY_MAX_MS = 2_000;

interface UploadedMedia {
  readonly aesKeyHex: string;
  readonly ciphertextBytes: number;
  readonly downloadParameter: string;
  readonly plaintextBytes: number;
}

export function encryptAesEcb(
  plaintext: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
}

export function decryptAesEcb(
  ciphertext: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

function paddedSize(plaintextBytes: number): number {
  return Math.ceil((plaintextBytes + 1) / 16) * 16;
}

function mediaType(
  kind: "file" | "image" | "video",
): number {
  if (kind === "image") return UploadMediaType.IMAGE;
  if (kind === "video") return UploadMediaType.VIDEO;
  return UploadMediaType.FILE;
}

function downloadUrl(
  network: WeixinNetwork,
  cdnBaseUrl: string,
  attachment: WeixinInboundAttachment,
): string {
  const fullUrl = attachment.media.fullUrl?.trim();
  if (fullUrl) return network.trustedUrl(fullUrl).href;
  const parameter = attachment.media.encryptedQueryParam?.trim();
  if (!parameter) {
    throw new WeixinTransportError(
      "protocol",
      "Weixin media reference has no download location",
    );
  }
  const base = network.trustedUrl(cdnBaseUrl);
  const url = new URL("download", base.href.endsWith("/")
    ? base
    : new URL(`${base.href}/`));
  url.searchParams.set(
    "encrypted_query_param",
    attachment.media.encryptedQueryParam!,
  );
  return network.trustedUrl(url.href).href;
}

function uploadUrl(
  network: WeixinNetwork,
  cdnBaseUrl: string,
  fileKey: string,
  fullUrl: string | undefined,
  parameter: string | undefined,
): string {
  if (fullUrl?.trim()) {
    return network.trustedUrl(fullUrl.trim()).href;
  }
  if (!parameter?.trim()) {
    throw new WeixinTransportError(
      "protocol",
      "Weixin upload response omitted its target",
    );
  }
  const base = network.trustedUrl(cdnBaseUrl);
  const url = new URL("upload", base.href.endsWith("/")
    ? base
    : new URL(`${base.href}/`));
  url.searchParams.set("encrypted_query_param", parameter);
  url.searchParams.set("filekey", fileKey);
  return network.trustedUrl(url.href).href;
}

function parseAesKey(value: string): Uint8Array {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  const ascii = decoded.toString("ascii");
  if (decoded.length === 32 && /^[0-9a-f]{32}$/iu.test(ascii)) {
    return Buffer.from(ascii, "hex");
  }
  throw new WeixinTransportError(
    "protocol",
    "Weixin media reference has an invalid AES key",
  );
}

export function normalizeOutboundFileName(value: string): string {
  const normalized = value
    .replace(/[\\/]/gu, "_")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 255);
  if (normalized === "") {
    throw new WeixinTransportError(
      "invalid-config",
      "Weixin file delivery requires a file name",
    );
  }
  return normalized;
}

function retryDelayMs(
  error: WeixinTransportError,
  attempt: number,
): number {
  const fallback = Math.min(
    CDN_UPLOAD_RETRY_MAX_MS,
    CDN_UPLOAD_RETRY_BASE_MS * (2 ** (attempt - 1)),
  );
  const jitteredFallback = Math.max(
    1,
    Math.round(fallback * (0.75 + Math.random() * 0.5)),
  );
  return error.retryAfterMs ?? jitteredFallback;
}

function retryAbortError(
  signal: AbortSignal | undefined,
): WeixinTransportError {
  const reason = signal?.reason;
  if (
    reason instanceof WeixinTransportError &&
    reason.code === "session-stale"
  ) {
    return reason;
  }
  return new WeixinTransportError(
    "aborted",
    "Weixin media upload retry was aborted",
  );
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) throw retryAbortError(signal);
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(retryAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function uploadMedia(
  network: WeixinNetwork,
  input: {
    readonly apiBaseUrl: string;
    readonly bytes: Uint8Array;
    readonly cdnBaseUrl?: string;
    readonly kind: "file" | "image" | "video";
    readonly recipientId: string;
    readonly requestTimeoutMs: number;
    readonly signal?: AbortSignal;
    readonly token: string;
  },
): Promise<UploadedMedia> {
  if (input.bytes.byteLength === 0) {
    throw new WeixinTransportError(
      "invalid-config",
      "Weixin media payload is empty",
    );
  }
  if (input.bytes.byteLength > network.maxMediaBytes) {
    throw new WeixinTransportError(
      "payload-too-large",
      "Weixin media payload exceeds the configured size limit",
    );
  }

  const plaintext = new Uint8Array(input.bytes);
  const rawMd5 = createHash("md5").update(plaintext).digest("hex");
  const key = randomBytes(16);
  const keyHex = key.toString("hex");
  const fileKey = randomBytes(16).toString("hex");
  const ciphertext = encryptAesEcb(plaintext, key);
  const raw = await network.json({
    baseUrl: input.apiBaseUrl,
    body: JSON.stringify({
      aeskey: keyHex,
      base_info: network.baseInfo(),
      filekey: fileKey,
      filesize: paddedSize(plaintext.byteLength),
      media_type: mediaType(input.kind),
      no_need_thumb: true,
      rawfilemd5: rawMd5,
      rawsize: plaintext.byteLength,
      to_user_id: input.recipientId,
    }),
    endpoint: "ilink/bot/getuploadurl",
    method: "POST",
    signal: input.signal,
    timeoutMs: input.requestTimeoutMs,
    token: input.token,
  });
  const response = parseGetUploadUrlResponse(raw);
  if (response.ret !== undefined && response.ret !== 0) {
    throw new WeixinTransportError(
      "protocol",
      "Weixin rejected the media upload request",
      { remoteCode: response.ret },
    );
  }
  const target = uploadUrl(
    network,
    input.cdnBaseUrl ?? WEIXIN_DEFAULT_CDN_BASE_URL,
    fileKey,
    response.uploadFullUrl,
    response.uploadParam,
  );

  let downloadParameter: string | undefined;
  for (let attempt = 1; attempt <= CDN_UPLOAD_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      downloadParameter = await network.upload({
        bytes: ciphertext,
        signal: input.signal,
        timeoutMs: input.requestTimeoutMs,
        url: target,
      });
      break;
    } catch (error) {
      if (
        !(error instanceof WeixinTransportError) ||
        !error.retryable ||
        attempt === CDN_UPLOAD_ATTEMPTS
      ) {
        throw error;
      }
      network.reportDiagnostic({
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        error,
        operation: "media-upload",
        type: "retry",
      });
      await waitForRetry(
        retryDelayMs(error, attempt),
        input.signal,
      );
    }
  }
  if (downloadParameter === undefined) {
    throw new WeixinTransportError(
      "network",
      "Weixin CDN upload failed",
      { retryable: true },
    );
  }

  return {
    aesKeyHex: keyHex,
    ciphertextBytes: ciphertext.byteLength,
    downloadParameter,
    plaintextBytes: plaintext.byteLength,
  };
}

export function outboundMediaItem(
  input: {
    readonly fileName?: string;
    readonly kind: "file" | "image" | "video";
    readonly uploaded: UploadedMedia;
  },
): MessageItem {
  const media = {
    aes_key: Buffer.from(
      input.uploaded.aesKeyHex,
      "utf8",
    ).toString("base64"),
    encrypt_query_param: input.uploaded.downloadParameter,
    encrypt_type: 1,
  };
  if (input.kind === "image") {
    return {
      type: MessageItemType.IMAGE,
      image_item: {
        media,
        mid_size: input.uploaded.ciphertextBytes,
      },
    };
  }
  if (input.kind === "video") {
    return {
      type: MessageItemType.VIDEO,
      video_item: {
        media,
        video_size: input.uploaded.ciphertextBytes,
      },
    };
  }
  return {
    type: MessageItemType.FILE,
    file_item: {
      file_name: normalizeOutboundFileName(input.fileName ?? ""),
      len: String(input.uploaded.plaintextBytes),
      media,
    },
  };
}

export async function downloadInboundMedia(
  network: WeixinNetwork,
  input: {
    readonly attachment: WeixinInboundAttachment;
    readonly cdnBaseUrl?: string;
    readonly maxBytes?: number;
    readonly requestTimeoutMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<WeixinMediaBlob> {
  const requestedMaxBytes =
    input.maxBytes ?? network.maxMediaBytes;
  if (
    !Number.isSafeInteger(requestedMaxBytes) ||
    requestedMaxBytes <= 0
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      "media maxBytes must be a positive integer",
    );
  }
  const maxBytes = Math.min(
    requestedMaxBytes,
    network.maxMediaBytes,
  );
  const key = input.attachment.media.aesKey?.trim();
  if (
    input.attachment.kind !== "image" &&
    (key === undefined || key === "")
  ) {
    throw new WeixinTransportError(
      "protocol",
      "Encrypted Weixin media reference omitted its AES key",
    );
  }
  if (
    input.attachment.size !== undefined &&
    input.attachment.size > paddedSize(maxBytes)
  ) {
    throw new WeixinTransportError(
      "payload-too-large",
      "Weixin media exceeds the requested size limit",
    );
  }
  const encrypted = await network.bytes({
    maxBytes: paddedSize(maxBytes),
    signal: input.signal,
    timeoutMs: input.requestTimeoutMs,
    url: downloadUrl(
      network,
      input.cdnBaseUrl ?? WEIXIN_DEFAULT_CDN_BASE_URL,
      input.attachment,
    ),
  });
  let plaintext: Uint8Array;
  try {
    plaintext =
      key === undefined || key === ""
        ? encrypted
        : decryptAesEcb(encrypted, parseAesKey(key));
  } catch (error) {
    if (error instanceof WeixinTransportError) throw error;
    throw new WeixinTransportError(
      "protocol",
      "Weixin media decryption failed",
    );
  }
  if (plaintext.byteLength > maxBytes) {
    throw new WeixinTransportError(
      "payload-too-large",
      "Weixin decrypted media exceeds the requested size limit",
    );
  }
  return {
    bytes: new Uint8Array(plaintext),
    fileName: input.attachment.fileName,
    mimeType: input.attachment.mimeType,
  };
}

export function attachmentKindSupportsDownload(
  kind: WeixinAttachmentKind,
): boolean {
  return (
    kind === "file" ||
    kind === "image" ||
    kind === "video" ||
    kind === "voice"
  );
}
