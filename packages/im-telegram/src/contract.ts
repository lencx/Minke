export const TELEGRAM_DEFAULT_API_BASE_URL =
  "https://api.telegram.org";

export const TELEGRAM_DEFAULT_ALLOWED_UPDATES = Object.freeze([
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
] as const);

export const TELEGRAM_PREPARED_DELIVERY_ENCODING =
  "application/vnd.minke.telegram-prepared+json;v=1";

export type TelegramRemoteEffect = "none" | "unknown";

export type TelegramNetworkFailureKind =
  | "connect"
  | "dns"
  | "socket"
  | "tls"
  | "unknown";

export type TelegramTransportErrorCode =
  | "aborted"
  | "api"
  | "conflict"
  | "credential-invalid"
  | "http"
  | "invalid-config"
  | "invalid-state"
  | "network"
  | "payload-too-large"
  | "protocol"
  | "rate-limited"
  | "timeout";

export interface TelegramTransportErrorOptions {
  readonly apiErrorCode?: number;
  readonly effect?: TelegramRemoteEffect;
  readonly migrateToChatId?: string;
  readonly networkKind?: TelegramNetworkFailureKind;
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;
  readonly status?: number;
}

/**
 * A deliberately redacted error. It never retains a request URL, response
 * body, Telegram description, bot token, or the original network exception.
 */
export class TelegramTransportError extends Error {
  readonly apiErrorCode?: number;
  readonly code: TelegramTransportErrorCode;
  readonly effect: TelegramRemoteEffect;
  readonly migrateToChatId?: string;
  readonly networkKind?: TelegramNetworkFailureKind;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: TelegramTransportErrorCode,
    message: string,
    options: TelegramTransportErrorOptions = {},
  ) {
    super(message);
    this.name = "TelegramTransportError";
    this.apiErrorCode = options.apiErrorCode;
    this.code = code;
    this.effect = options.effect ?? "none";
    this.migrateToChatId = options.migrateToChatId;
    this.networkKind = options.networkKind;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export interface TelegramBotIdentity {
  readonly canConnectToBusiness?: boolean;
  readonly canJoinGroups?: boolean;
  readonly canReadAllGroupMessages?: boolean;
  readonly firstName: string;
  readonly id: string;
  readonly supportsInlineQueries?: boolean;
  readonly username?: string;
}

export interface TelegramUserContext {
  readonly firstName: string;
  readonly id: string;
  readonly isBot: boolean;
  readonly languageCode?: string;
  readonly lastName?: string;
  readonly username?: string;
}

export type TelegramChatType =
  | "channel"
  | "group"
  | "private"
  | "supergroup"
  | "unknown";

export interface TelegramChatContext {
  readonly firstName?: string;
  readonly id: string;
  readonly isForum?: boolean;
  readonly lastName?: string;
  readonly title?: string;
  readonly type: TelegramChatType;
  readonly username?: string;
}

export interface TelegramPhotoVariant {
  readonly fileId: string;
  readonly fileSize?: number;
  readonly fileUniqueId: string;
  readonly height: number;
  readonly width: number;
}

export interface TelegramFileMedia {
  readonly durationSeconds?: number;
  readonly fileId: string;
  readonly fileName?: string;
  readonly fileSize?: number;
  readonly fileUniqueId: string;
  readonly height?: number;
  readonly mimeType?: string;
  readonly performer?: string;
  readonly title?: string;
  readonly width?: number;
}

export interface TelegramStickerMedia
  extends TelegramFileMedia {
  readonly customEmojiId?: string;
  readonly emoji?: string;
  readonly isAnimated: boolean;
  readonly isVideo: boolean;
  readonly setName?: string;
}

export type TelegramInboundContent =
  | {
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly caption?: string;
      readonly kind: "photo";
      readonly photo: TelegramPhotoVariant;
      readonly variants: readonly TelegramPhotoVariant[];
    }
  | {
      readonly caption?: string;
      readonly document: TelegramFileMedia;
      readonly kind: "document";
    }
  | {
      readonly audio: TelegramFileMedia;
      readonly caption?: string;
      readonly kind: "audio";
    }
  | {
      readonly caption?: string;
      readonly kind: "video";
      readonly video: TelegramFileMedia;
    }
  | {
      readonly caption?: string;
      readonly kind: "voice";
      readonly voice: TelegramFileMedia;
    }
  | {
      readonly kind: "sticker";
      readonly sticker: TelegramStickerMedia;
    }
  | {
      readonly heading?: number;
      readonly horizontalAccuracy?: number;
      readonly kind: "location";
      readonly latitude: number;
      readonly livePeriodSeconds?: number;
      readonly longitude: number;
      readonly proximityAlertRadius?: number;
    }
  | {
      readonly firstName: string;
      readonly kind: "contact";
      readonly lastName?: string;
      readonly phoneNumber: string;
      readonly userId?: string;
      readonly vcard?: string;
    }
  | {
      readonly kind: "unsupported";
      readonly serviceType?: string;
    };

export interface TelegramReplyContext {
  readonly chatId: string;
  readonly contentKind: TelegramInboundContent["kind"];
  readonly messageId: string;
  readonly senderId?: string;
  readonly text?: string;
  readonly threadId?: string;
}

export type TelegramInboundUpdateType =
  | "channel-post"
  | "edited-channel-post"
  | "edited-message"
  | "message";

export interface TelegramInboundMessage {
  readonly chat: TelegramChatContext;
  readonly content: TelegramInboundContent;
  readonly conversationId: string;
  readonly createdAt: number;
  readonly editDate?: number;
  readonly id: string;
  readonly isTopicMessage: boolean;
  readonly messageId: string;
  readonly peerId: string;
  readonly reply?: TelegramReplyContext;
  readonly sender?: TelegramUserContext;
  readonly senderChat?: TelegramChatContext;
  readonly senderId: string;
  readonly threadId?: string;
  readonly updateId: string;
  readonly updateType: TelegramInboundUpdateType;
}

export interface TelegramInboundBatch {
  readonly fromCheckpoint: string | null;
  readonly messages: readonly TelegramInboundMessage[];
  /**
   * The first update ID that has not been admitted yet. Persist this only in
   * the same transaction that admits `messages`.
   */
  readonly nextCheckpoint: string;
  readonly suggestedPollTimeoutMs: number;
}

export type TelegramMediaSource =
  | {
      readonly fileId: string;
      readonly kind: "file-id";
    }
  | {
      readonly bytes: Uint8Array;
      readonly fileName: string;
      readonly kind: "bytes";
      readonly mimeType?: string;
    };

export interface TelegramSendBase {
  readonly allowSendingWithoutReply?: boolean;
  readonly chatId: string;
  readonly disableNotification?: boolean;
  readonly messageThreadId?: number;
  readonly protectContent?: boolean;
  readonly replyToMessageId?: number;
}

export interface TelegramSendMessageInput
  extends TelegramSendBase {
  readonly text: string;
}

export interface TelegramSendPhotoInput
  extends TelegramSendBase {
  readonly caption?: string;
  readonly photo: TelegramMediaSource;
}

export interface TelegramSendDocumentInput
  extends TelegramSendBase {
  readonly caption?: string;
  readonly document: TelegramMediaSource;
}

export interface TelegramSendAudioInput
  extends TelegramSendBase {
  readonly audio: TelegramMediaSource;
  readonly caption?: string;
  readonly durationSeconds?: number;
  readonly performer?: string;
  readonly title?: string;
}

export interface TelegramSendVideoInput
  extends TelegramSendBase {
  readonly caption?: string;
  readonly durationSeconds?: number;
  readonly height?: number;
  readonly video: TelegramMediaSource;
  readonly width?: number;
}

export interface TelegramSendVoiceInput
  extends TelegramSendBase {
  readonly caption?: string;
  readonly durationSeconds?: number;
  readonly voice: TelegramMediaSource;
}

export interface TelegramSendStickerInput
  extends TelegramSendBase {
  readonly emoji?: string;
  readonly sticker: TelegramMediaSource;
}

export interface TelegramSendLocationInput
  extends TelegramSendBase {
  readonly heading?: number;
  readonly horizontalAccuracy?: number;
  readonly latitude: number;
  readonly livePeriodSeconds?: number;
  readonly longitude: number;
  readonly proximityAlertRadius?: number;
}

export interface TelegramSendContactInput
  extends TelegramSendBase {
  readonly firstName: string;
  readonly lastName?: string;
  readonly phoneNumber: string;
  readonly vcard?: string;
}

export type TelegramDeliveryIntent =
  | ({ readonly kind: "text" } & TelegramSendMessageInput)
  | ({ readonly kind: "photo" } & TelegramSendPhotoInput)
  | ({ readonly kind: "document" } & TelegramSendDocumentInput)
  | ({ readonly kind: "audio" } & TelegramSendAudioInput)
  | ({ readonly kind: "video" } & TelegramSendVideoInput)
  | ({ readonly kind: "voice" } & TelegramSendVoiceInput)
  | ({ readonly kind: "sticker" } & TelegramSendStickerInput)
  | ({ readonly kind: "location" } & TelegramSendLocationInput)
  | ({ readonly kind: "contact" } & TelegramSendContactInput);

export interface TelegramPreparedDelivery {
  readonly encoding:
    typeof TELEGRAM_PREPARED_DELIVERY_ENCODING;
  readonly intent: TelegramDeliveryIntent;
  readonly operationId: string;
  readonly recipientId: string;
}

export interface TelegramDeliveryReceipt {
  readonly chatId: string;
  readonly messageId: string;
  readonly occurredAt: number;
  readonly threadId?: string;
}

export interface TelegramCredential {
  readonly token: string;
}

export interface TelegramTransportOptions {
  readonly allowedUpdates?: readonly string[];
  readonly apiBaseUrl?: string;
  /**
   * Delete any legacy webhook before opening long polling. Defaults to true
   * for Minke's single-owner desktop runtime.
   */
  readonly clearWebhookBeforePolling?: boolean;
  readonly credential: TelegramCredential;
  readonly fetch?: typeof globalThis.fetch;
  readonly getUpdatesLimit?: number;
  readonly longPollTimeoutMs?: number;
  readonly maxJsonBytes?: number;
  readonly maxUploadBytes?: number;
  readonly requestTimeoutMs?: number;
}

export interface TelegramTransport {
  /** Available after `getMe()` or `start()` succeeds. */
  readonly identity: TelegramBotIdentity | undefined;
  close(): Promise<void>;
  getMe(options?: {
    readonly signal?: AbortSignal;
  }): Promise<TelegramBotIdentity>;
  receive(
    checkpoint: string | null,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramInboundBatch>;
  send(
    intent: TelegramDeliveryIntent,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendAudio(
    input: TelegramSendAudioInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendContact(
    input: TelegramSendContactInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendDocument(
    input: TelegramSendDocumentInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendLocation(
    input: TelegramSendLocationInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendMessage(
    input: TelegramSendMessageInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendPhoto(
    input: TelegramSendPhotoInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendSticker(
    input: TelegramSendStickerInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendVideo(
    input: TelegramSendVideoInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  sendVoice(
    input: TelegramSendVoiceInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt>;
  start(options?: {
    readonly signal?: AbortSignal;
  }): Promise<void>;
}
