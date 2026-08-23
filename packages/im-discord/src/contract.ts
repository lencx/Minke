import type {
  GatewayAccount,
  GatewayProviderSession,
} from "@lencx/minke-im-gateway";

export const DISCORD_API_BASE_URL =
  "https://discord.com/api/v10";
export const DISCORD_GATEWAY_VERSION = 10;
export const DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS = 2_000;
export const DISCORD_MAX_MESSAGE_REQUEST_BYTES =
  25 * 1024 * 1024;
export const DISCORD_PREPARED_DELIVERY_ENCODING =
  "application/vnd.minke.discord-prepared+json;v=1";

export const DISCORD_GATEWAY_INTENTS = Object.freeze({
  directMessages: 1 << 12,
  guildMessages: 1 << 9,
  guilds: 1 << 0,
  messageContent: 1 << 15,
});

export const DISCORD_DEFAULT_INTENTS =
  DISCORD_GATEWAY_INTENTS.guilds |
  DISCORD_GATEWAY_INTENTS.guildMessages |
  DISCORD_GATEWAY_INTENTS.directMessages |
  DISCORD_GATEWAY_INTENTS.messageContent;

export type DiscordTransportErrorCode =
  | "aborted"
  | "credential-invalid"
  | "forbidden"
  | "gateway-closed"
  | "gateway-fatal"
  | "http"
  | "invalid-config"
  | "invalid-intent"
  | "invalid-state"
  | "network"
  | "not-found"
  | "payload-too-large"
  | "protocol"
  | "rate-limited"
  | "server"
  | "timeout"
  | "untrusted-url";

export type DiscordRemoteEffect = "none" | "unknown";

export interface DiscordTransportErrorOptions {
  readonly effect?: DiscordRemoteEffect;
  readonly gatewayCloseCode?: number;
  readonly remoteCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;
  readonly status?: number;
  readonly terminal?: "credential-invalid";
}

/**
 * A redacted transport failure. It intentionally does not retain the source
 * error as `cause`, because fetch implementations can attach request headers.
 */
export class DiscordTransportError extends Error {
  readonly code: DiscordTransportErrorCode;
  readonly effect: DiscordRemoteEffect;
  readonly gatewayCloseCode?: number;
  readonly remoteCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly status?: number;
  readonly terminal?: "credential-invalid";

  constructor(
    code: DiscordTransportErrorCode,
    message: string,
    options: DiscordTransportErrorOptions = {},
  ) {
    super(message);
    this.name = "DiscordTransportError";
    this.code = code;
    this.effect = options.effect ?? "none";
    this.gatewayCloseCode = options.gatewayCloseCode;
    this.remoteCode = options.remoteCode;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.terminal = options.terminal;
  }
}

export interface DiscordBotIdentity {
  readonly avatar?: string;
  readonly discriminator?: string;
  readonly globalName?: string;
  readonly id: string;
  readonly username: string;
}

export interface DiscordInboundUser {
  readonly avatar?: string;
  readonly bot: boolean;
  readonly discriminator?: string;
  readonly globalName?: string;
  readonly id: string;
  readonly username: string;
}

export interface DiscordInboundAttachment {
  readonly contentType?: string;
  readonly description?: string;
  readonly durationSeconds?: number;
  readonly ephemeral: boolean;
  readonly fileName: string;
  readonly height?: number;
  readonly id: string;
  readonly proxyUrl: string;
  readonly size: number;
  readonly title?: string;
  readonly url: string;
  readonly waveform?: string;
  readonly width?: number;
}

export interface DiscordInboundEmbedMedia {
  readonly height?: number;
  readonly proxyUrl?: string;
  readonly url: string;
  readonly width?: number;
}

export interface DiscordInboundEmbed {
  readonly author?: {
    readonly iconUrl?: string;
    readonly name: string;
    readonly proxyIconUrl?: string;
    readonly url?: string;
  };
  readonly color?: number;
  readonly description?: string;
  readonly fields: readonly {
    readonly inline: boolean;
    readonly name: string;
    readonly value: string;
  }[];
  readonly footer?: {
    readonly iconUrl?: string;
    readonly proxyIconUrl?: string;
    readonly text: string;
  };
  readonly image?: DiscordInboundEmbedMedia;
  readonly provider?: {
    readonly name?: string;
    readonly url?: string;
  };
  readonly thumbnail?: DiscordInboundEmbedMedia;
  readonly timestamp?: string;
  readonly title?: string;
  readonly type?: string;
  readonly url?: string;
  readonly video?: DiscordInboundEmbedMedia;
}

export type DiscordConversationContext =
  | {
      readonly channelId: string;
      readonly channelType?: number;
      readonly kind: "direct";
    }
  | {
      readonly channelId: string;
      readonly channelType?: number;
      readonly guildId: string;
      readonly kind: "guild-channel";
    }
  | {
      readonly channelId: string;
      readonly guildId: string;
      readonly kind: "guild-thread";
      readonly parentChannelId?: string;
      readonly threadType: 10 | 11 | 12;
    };

export interface DiscordInboundReply {
  readonly authorId?: string;
  readonly channelId?: string;
  readonly content?: string;
  readonly guildId?: string;
  readonly messageId: string;
}

export interface DiscordInboundMessage {
  readonly attachments: readonly DiscordInboundAttachment[];
  readonly author: DiscordInboundUser;
  readonly channelId: string;
  readonly content: string;
  readonly context: DiscordConversationContext;
  readonly editedAt?: number;
  readonly embeds: readonly DiscordInboundEmbed[];
  readonly flags: number;
  readonly guildId?: string;
  readonly id: string;
  readonly messageType: number;
  readonly nonce?: string;
  readonly reply?: DiscordInboundReply;
  readonly timestamp: number;
}

export interface DiscordOutboundAttachment {
  readonly bytes: Uint8Array;
  readonly contentType?: string;
  readonly description?: string;
  readonly fileName: string;
}

export interface DiscordOutboundReply {
  readonly channelId?: string;
  readonly failIfNotExists?: boolean;
  readonly guildId?: string;
  readonly messageId: string;
}

export type DiscordOutboundMessage =
  | {
      readonly kind: "text";
      readonly replyTo?: DiscordOutboundReply;
      readonly text: string;
    }
  | {
      readonly attachments?: readonly DiscordOutboundAttachment[];
      readonly kind: "message";
      readonly replyTo?: DiscordOutboundReply;
      readonly text?: string;
    };

export interface DiscordPreparedDelivery {
  readonly attachments: readonly DiscordOutboundAttachment[];
  readonly channelId: string;
  readonly encoding: typeof DISCORD_PREPARED_DELIVERY_ENCODING;
  readonly nonce: string;
  readonly replyTo?: DiscordOutboundReply;
  readonly text?: string;
}

export interface DiscordDeliveryReceipt {
  readonly channelId: string;
  readonly messageId: string;
  readonly nonce: string;
  readonly outcome: "accepted";
}

export interface DiscordWebSocketMessageEvent {
  readonly data: unknown;
}

export interface DiscordWebSocketCloseEvent {
  readonly code?: number;
}

export interface DiscordWebSocketLike {
  readonly readyState: number;
  addEventListener(
    type: "close",
    listener: (event: DiscordWebSocketCloseEvent) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: () => void,
  ): void;
  addEventListener(
    type: "message",
    listener: (event: DiscordWebSocketMessageEvent) => void,
  ): void;
  close(code?: number, reason?: string): void;
  removeEventListener(
    type: "close",
    listener: (event: DiscordWebSocketCloseEvent) => void,
  ): void;
  removeEventListener(
    type: "error",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: DiscordWebSocketMessageEvent) => void,
  ): void;
  send(data: string): void;
}

export type DiscordWebSocketFactory = (
  url: string,
) => DiscordWebSocketLike;

export interface DiscordTimerPort {
  clearTimeout(handle: unknown): void;
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): unknown;
}

export type DiscordConnectionState =
  | "closed"
  | "connecting"
  | "fatal"
  | "idle"
  | "ready"
  | "reconnecting";

export interface DiscordProviderStatus {
  readonly botId: string;
  readonly lastSequence: number | null;
  readonly resumable: boolean;
  readonly state: DiscordConnectionState;
}

export interface DiscordProviderOptions {
  readonly accountKey: string;
  /**
   * A bot identity returned by a prior `validateDiscordBotToken()` call.
   * Supplying it avoids a duplicate `/users/@me` request before construction.
   */
  readonly bot?: DiscordBotIdentity;
  readonly fetch?: typeof globalThis.fetch;
  readonly generation: number;
  readonly intents?: number;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly reconnectBackoffMs?: (attempt: number) => number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly timers?: DiscordTimerPort;
  readonly token: string;
  readonly userAgent?: string;
  readonly webSocketFactory?: DiscordWebSocketFactory;
}

export interface ValidateDiscordBotTokenOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly timers?: DiscordTimerPort;
  readonly token: string;
  readonly userAgent?: string;
}

export interface DiscordGatewayProvider
  extends GatewayProviderSession {
  readonly account: GatewayAccount;
  readonly bot: DiscordBotIdentity;
  getStatus(): DiscordProviderStatus;
}
