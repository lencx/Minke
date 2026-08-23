/**
 * Public interface of the Minke Weixin transport module.
 *
 * Protocol semantics were reimplemented from
 * @tencent-weixin/openclaw-weixin@2.4.6 (MIT).
 */

export const WEIXIN_UPSTREAM_RELEASE = "2.4.6";
export const WEIXIN_MAX_QR_CONTENT_BYTES = 2_048;
export const WEIXIN_DEFAULT_API_BASE_URL =
  "https://ilinkai.weixin.qq.com";
export const WEIXIN_DEFAULT_CDN_BASE_URL =
  "https://novac2c.cdn.weixin.qq.com/c2c";

export type WeixinTransportErrorCode =
  | "aborted"
  | "http"
  | "invalid-config"
  | "invalid-state"
  | "network"
  | "payload-too-large"
  | "protocol"
  | "session-stale"
  | "timeout"
  | "untrusted-url";

/**
 * Whether a failed operation could already have changed remote state.
 *
 * `unknown` is intentionally not retry-safe. The Gateway must surface the
 * ambiguity or use an explicit recovery policy instead of silently replaying.
 */
export type WeixinRemoteEffect = "none" | "partial" | "unknown";

export type WeixinNetworkFailureKind =
  | "connect"
  | "dns"
  | "socket"
  | "tls"
  | "unknown";

export interface WeixinTransportErrorOptions {
  readonly cause?: unknown;
  readonly completedClientIds?: readonly string[];
  readonly effect?: WeixinRemoteEffect;
  readonly networkKind?: WeixinNetworkFailureKind;
  readonly remoteCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;
  readonly status?: number;
}

export class WeixinTransportError extends Error {
  readonly code: WeixinTransportErrorCode;
  readonly completedClientIds: readonly string[];
  readonly effect: WeixinRemoteEffect;
  readonly networkKind?: WeixinNetworkFailureKind;
  readonly remoteCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: WeixinTransportErrorCode,
    message: string,
    options: WeixinTransportErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "WeixinTransportError";
    this.code = code;
    this.completedClientIds = Object.freeze([
      ...(options.completedClientIds ?? []),
    ]);
    this.effect = options.effect ?? "none";
    this.networkKind = options.networkKind;
    this.remoteCode = options.remoteCode;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export type WeixinDiagnosticOperation =
  | "media-upload"
  | "notify-start"
  | "notify-stop";

export interface WeixinDiagnosticError {
  readonly code: WeixinTransportErrorCode;
  readonly effect: WeixinRemoteEffect;
  readonly networkKind?: WeixinNetworkFailureKind;
  readonly remoteCode?: number;
  readonly retryAfterMs?: number;
  readonly status?: number;
}

/**
 * Deliberately redacted operational signal. It never contains identifiers,
 * credentials, opaque tokens, URLs, response bodies, or raw error messages.
 */
export interface WeixinDiagnosticEvent {
  readonly attempt?: number;
  readonly durationMs?: number;
  readonly error: WeixinDiagnosticError;
  readonly operation: WeixinDiagnosticOperation;
  readonly severity: "warning";
  readonly type: "advisory-failure" | "retry";
}

export interface WeixinObservability {
  /**
   * Synchronous, best-effort observer. Exceptions from the callback are
   * isolated from transport control flow.
   */
  readonly onDiagnostic?: (event: WeixinDiagnosticEvent) => void;
}

export interface WeixinNetworkPolicy {
  /**
   * DNS suffixes allowed for API and CDN requests. A leading dot matches the
   * suffix and its apex. The safe default is `.weixin.qq.com`.
   */
  readonly trustedHostSuffixes?: readonly string[];
  readonly maxJsonBytes?: number;
  readonly maxMediaBytes?: number;
}

export interface WeixinClientMetadata {
  /** Observability-only bot identity, for example `Minke/0.2.0`. */
  readonly botAgent?: string;
  /** Wire-compatible channel release. Defaults to the audited upstream release. */
  readonly channelVersion?: string;
  readonly routeTag?: string;
}

export interface WeixinLoginOptions
  extends WeixinClientMetadata,
    WeixinNetworkPolicy,
    WeixinObservability {
  readonly botType?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly knownBotTokens?: readonly string[];
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface WeixinLoginChallenge {
  /** Opaque content that the caller must render as a QR code. */
  readonly qrContent: string;
  readonly expiresAt: number;
}

export interface WeixinAccountGrant {
  readonly accountId: string;
  readonly token: string;
  readonly baseUrl: string;
  readonly authorizedUserId?: string;
}

export type WeixinLoginProgress =
  | { readonly status: "waiting" }
  | { readonly status: "scanned" }
  | { readonly status: "verification-required" }
  | {
      readonly status: "refreshed";
      readonly challenge: WeixinLoginChallenge;
      readonly reason: "expired" | "verification-blocked";
    }
  | {
      /**
       * The remote service issued a credential. The caller must durably store
       * it before reporting the account as connected.
       */
      readonly status: "grant-issued";
      readonly grant: WeixinAccountGrant;
    }
  | {
      /**
       * The remote account is already bound but no credential was returned.
       * This is not equivalent to a locally usable connection.
       */
      readonly status: "already-bound";
    };

export interface WeixinLoginFlow {
  readonly challenge: WeixinLoginChallenge;
  poll(options?: {
    readonly signal?: AbortSignal;
    readonly verificationCode?: string;
  }): Promise<WeixinLoginProgress>;
  close(): void;
}

export type WeixinInboundMessageType = "bot" | "unknown" | "user";
export type WeixinInboundMessageState =
  | "finished"
  | "generating"
  | "new"
  | "unknown";
export type WeixinAttachmentKind = "file" | "image" | "video" | "voice";
export type WeixinItemKind =
  | WeixinAttachmentKind
  | "text"
  | "tool-call-result"
  | "tool-call-start"
  | "unknown";
export type WeixinVoiceCodec =
  | "adpcm"
  | "amr"
  | "feature"
  | "mp3"
  | "ogg-speex"
  | "pcm"
  | "silk"
  | "speex"
  | "unknown";

/**
 * Serializable private download metadata. Signed parameters and AES keys must
 * be stored with the same protection as a context token.
 */
export interface WeixinMediaReference {
  readonly aesKey?: string;
  readonly encryptedQueryParam?: string;
  readonly fullUrl?: string;
}

export interface WeixinInboundAttachment {
  readonly id: string;
  readonly kind: WeixinAttachmentKind;
  readonly audio?: {
    readonly bitsPerSample?: number;
    readonly codec: WeixinVoiceCodec;
    readonly durationMs?: number;
    readonly encodeType?: number;
    readonly sampleRateHz?: number;
  };
  readonly fileName?: string;
  readonly mimeType: string;
  readonly size?: number;
  readonly quoted: boolean;
  readonly media: WeixinMediaReference;
}

export interface WeixinInboundReference {
  readonly attachmentIds: readonly string[];
  readonly itemId?: string;
  readonly kind: WeixinItemKind;
  readonly text?: string;
  readonly title?: string;
}

export interface WeixinToolProgress {
  readonly completed: boolean;
  readonly createdAt?: number;
  readonly itemId?: string;
  readonly kind: "result" | "start";
  readonly status?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly updatedAt?: number;
}

export interface WeixinReplyContext {
  readonly contextToken: string;
  readonly recipientId: string;
}

export interface WeixinInboundMessage {
  /** Stable native identifier used for durable deduplication. */
  readonly id: string;
  /** Echo of the outbound client_id, usable for outbox reconciliation. */
  readonly clientId?: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly conversationId: string;
  readonly groupId?: string;
  readonly sessionId?: string;
  readonly messageType: WeixinInboundMessageType;
  readonly state: WeixinInboundMessageState;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly deletedAt?: number;
  readonly text: string;
  readonly attachments: readonly WeixinInboundAttachment[];
  readonly references: readonly WeixinInboundReference[];
  readonly toolProgress: readonly WeixinToolProgress[];
  readonly unsupportedItemTypes: readonly number[];
  readonly replyContext?: WeixinReplyContext;
  readonly runId?: string;
}

export interface WeixinInboundBatch {
  /** Exact checkpoint supplied to receive(), for Gateway compare-and-swap. */
  readonly fromCheckpoint: string | null;
  readonly messages: readonly WeixinInboundMessage[];
  /**
   * Opaque cursor returned by Weixin. The transport does not persist it.
   * Commit it atomically with durable inbox admission.
   */
  readonly nextCheckpoint: string;
  readonly suggestedPollTimeoutMs?: number;
}

export interface WeixinMediaBlob {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType: string;
}

interface WeixinDeliveryIntentBase {
  /**
   * Stable Gateway outbox identifier. It becomes the Weixin client_id.
   * Reusing it does not imply that the remote service guarantees deduplication.
   */
  readonly operationId: string;
  readonly recipientId: string;
  /**
   * Latest opaque token received for this peer. iLink can return apparent
   * success while silently dropping a send when this value is missing or stale.
   */
  readonly contextToken: string;
  readonly runId?: string;
}

/**
 * One intent produces exactly one downstream message. Captions and media are
 * separate Gateway outbox obligations so partial delivery remains explicit.
 */
export type WeixinDeliveryIntent =
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "text";
        readonly text: string;
      };
    })
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "image";
        readonly bytes: Uint8Array;
      };
    })
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "video";
        readonly bytes: Uint8Array;
      };
    })
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "file";
        readonly bytes: Uint8Array;
        readonly fileName: string;
      };
    })
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "tool-call-start";
        readonly occurredAt?: number;
        readonly toolCallId?: string;
        readonly toolName: string;
      };
    })
  | (WeixinDeliveryIntentBase & {
      readonly content: {
        readonly kind: "tool-call-result";
        readonly occurredAt?: number;
        readonly status: "blocked" | "completed" | "failed" | "unknown";
        readonly toolCallId?: string;
        readonly toolName: string;
      };
    });

export const WEIXIN_PREPARED_DELIVERY_ENCODING =
  "application/vnd.minke.weixin-prepared+json;v=1";

export interface WeixinPreparedDelivery {
  readonly bytes: Uint8Array;
  readonly encoding: typeof WEIXIN_PREPARED_DELIVERY_ENCODING;
}

export interface WeixinDeliveryDraft {
  readonly content: WeixinDeliveryIntent["content"];
  readonly operationId: string;
  readonly prepared?: WeixinPreparedDelivery;
  readonly recipientId: string;
}

export interface WeixinPreparedDeliveryIntent {
  readonly contextToken: string;
  readonly operationId: string;
  readonly prepared: WeixinPreparedDelivery;
  readonly recipientId: string;
  readonly runId?: string;
}

export interface WeixinDeliveryReceipt {
  readonly operationId: string;
  readonly clientIds: readonly string[];
  readonly outcome: "accepted";
  readonly retrySafety: "unconfirmed";
}

export interface WeixinCredential {
  readonly accountId: string;
  readonly token: string;
  readonly baseUrl?: string;
}

export interface WeixinTransportOptions
  extends WeixinClientMetadata,
    WeixinNetworkPolicy,
    WeixinObservability {
  readonly credential: WeixinCredential;
  readonly cdnBaseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly longPollTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

export interface WeixinTransport {
  readonly accountId: string;
  start(options?: { readonly signal?: AbortSignal }): Promise<void>;
  receive(
    checkpoint: string | null,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WeixinInboundBatch>;
  deliver(
    intent: WeixinDeliveryIntent,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WeixinDeliveryReceipt>;
  deliverPrepared(
    intent: WeixinPreparedDeliveryIntent,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WeixinDeliveryReceipt>;
  prepareDelivery(
    draft: WeixinDeliveryDraft,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WeixinPreparedDelivery>;
  downloadMedia(
    attachment: WeixinInboundAttachment,
    options?: {
      readonly maxBytes?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<WeixinMediaBlob>;
  setTyping(
    input: {
      readonly active: boolean;
      readonly contextToken: string;
      readonly recipientId: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly sent: boolean }>;
  close(): Promise<void>;
}
