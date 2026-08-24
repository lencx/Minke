import type {
  GatewayAccount,
  GatewayAttemptOutcome,
  GatewayDeliveryAttempt,
  GatewayDeliveryPreparation,
  GatewayInboundBatch,
  GatewayInboundEvent,
  GatewayPreparationOutcome,
  GatewayProviderSession,
} from "@lencx/minke-im-gateway";
import {
  TELEGRAM_MAX_DELIVERY_MESSAGES,
  TELEGRAM_PREPARED_DELIVERY_ENCODING,
  TelegramTransportError,
  type TelegramDeliveryIntent,
  type TelegramInboundBatch,
  type TelegramInboundMessage,
  type TelegramMediaSource,
  type TelegramPreparedDelivery,
  type TelegramSendBase,
  type TelegramTransport,
} from "./contract.ts";
import { planTelegramDeliveryIntents } from "./delivery-plan.ts";

export interface AdaptTelegramInboundBatchInput {
  readonly accountKey: string;
  readonly batch: TelegramInboundBatch;
  readonly generation: number;
}

export interface CreateTelegramGatewayProviderInput {
  readonly accountKey: string;
  readonly generation: number;
  readonly transport: TelegramTransport;
}

export function telegramAccountKey(botId: string): string {
  if (
    !/^[1-9][0-9]*$/u.test(botId) ||
    !Number.isSafeInteger(Number(botId))
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram bot identity is invalid",
    );
  }
  return `telegram:${botId}`;
}

function eventKind(
  message: TelegramInboundMessage,
): GatewayInboundEvent["kind"] {
  if (message.sender?.isBot === true) return "bot-echo";
  return message.content.kind === "unsupported"
    ? "system"
    : "user-message";
}

export function adaptTelegramInboundBatch(
  input: AdaptTelegramInboundBatchInput,
): GatewayInboundBatch {
  return {
    accountKey: input.accountKey,
    events: input.batch.messages.map((message) => ({
      conversationId: message.conversationId,
      kind: eventKind(message),
      nativeId: message.id,
      occurredAt: message.createdAt,
      payload: message,
      peerId: message.peerId,
      senderId: message.senderId,
    })),
    fromCheckpoint: input.batch.fromCheckpoint,
    generation: input.generation,
    nextCheckpoint: input.batch.nextCheckpoint,
  };
}

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function requiredNumber(
  value: unknown,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requiredNumber(value, label);
}

function optionalInteger(
  value: unknown,
  label: string,
): number | undefined {
  const result = optionalNumber(value, label);
  if (
    result !== undefined &&
    !Number.isSafeInteger(result)
  ) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return result;
}

function optionalBoolean(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function deliveryBase(
  payload: Record<string, unknown>,
  recipientId: string,
): TelegramSendBase {
  return {
    allowSendingWithoutReply: optionalBoolean(
      payload.allowSendingWithoutReply,
      "payload.allowSendingWithoutReply",
    ),
    chatId: recipientId,
    disableNotification: optionalBoolean(
      payload.disableNotification,
      "payload.disableNotification",
    ),
    messageThreadId: optionalInteger(
      payload.messageThreadId,
      "payload.messageThreadId",
    ),
    protectContent: optionalBoolean(
      payload.protectContent,
      "payload.protectContent",
    ),
    replyToMessageId: optionalInteger(
      payload.replyToMessageId,
      "payload.replyToMessageId",
    ),
  };
}

function mediaSource(
  value: unknown,
  label: string,
): TelegramMediaSource {
  const source = record(value, label);
  if (source.kind === "file-id") {
    return {
      fileId: requiredString(
        source.fileId,
        `${label}.fileId`,
      ),
      kind: "file-id",
    };
  }
  if (source.kind === "bytes") {
    if (!(source.bytes instanceof Uint8Array)) {
      throw new TypeError(`${label}.bytes must be Uint8Array`);
    }
    return {
      bytes: new Uint8Array(source.bytes),
      fileName: requiredString(
        source.fileName,
        `${label}.fileName`,
      ),
      kind: "bytes",
      mimeType: optionalString(
        source.mimeType,
        `${label}.mimeType`,
      ),
    };
  }
  throw new TypeError(`${label}.kind is unsupported`);
}

function normalizeDeliveryIntent(
  payloadValue: unknown,
  recipientId: string,
): TelegramDeliveryIntent {
  const payload = record(
    payloadValue,
    "Telegram Gateway payload",
  );
  const kind = requiredString(payload.kind, "payload.kind");
  const base = deliveryBase(payload, recipientId);
  switch (kind) {
    case "text":
      return {
        ...base,
        kind,
        text: requiredString(payload.text, "payload.text"),
      };
    case "rich-markdown":
      return {
        ...base,
        kind,
        markdown: requiredString(
          payload.markdown,
          "payload.markdown",
        ),
      };
    case "photo":
      return {
        ...base,
        caption: optionalString(
          payload.caption,
          "payload.caption",
        ),
        kind,
        photo: mediaSource(payload.photo, "payload.photo"),
      };
    case "document":
      return {
        ...base,
        caption: optionalString(
          payload.caption,
          "payload.caption",
        ),
        document: mediaSource(
          payload.document,
          "payload.document",
        ),
        kind,
      };
    case "audio":
      return {
        ...base,
        audio: mediaSource(payload.audio, "payload.audio"),
        caption: optionalString(
          payload.caption,
          "payload.caption",
        ),
        durationSeconds: optionalInteger(
          payload.durationSeconds,
          "payload.durationSeconds",
        ),
        kind,
        performer: optionalString(
          payload.performer,
          "payload.performer",
        ),
        title: optionalString(
          payload.title,
          "payload.title",
        ),
      };
    case "video":
      return {
        ...base,
        caption: optionalString(
          payload.caption,
          "payload.caption",
        ),
        durationSeconds: optionalInteger(
          payload.durationSeconds,
          "payload.durationSeconds",
        ),
        height: optionalInteger(
          payload.height,
          "payload.height",
        ),
        kind,
        video: mediaSource(payload.video, "payload.video"),
        width: optionalInteger(payload.width, "payload.width"),
      };
    case "voice":
      return {
        ...base,
        caption: optionalString(
          payload.caption,
          "payload.caption",
        ),
        durationSeconds: optionalInteger(
          payload.durationSeconds,
          "payload.durationSeconds",
        ),
        kind,
        voice: mediaSource(payload.voice, "payload.voice"),
      };
    case "sticker":
      return {
        ...base,
        emoji: optionalString(
          payload.emoji,
          "payload.emoji",
        ),
        kind,
        sticker: mediaSource(
          payload.sticker,
          "payload.sticker",
        ),
      };
    case "location":
      return {
        ...base,
        heading: optionalNumber(
          payload.heading,
          "payload.heading",
        ),
        horizontalAccuracy: optionalNumber(
          payload.horizontalAccuracy,
          "payload.horizontalAccuracy",
        ),
        kind,
        latitude: requiredNumber(
          payload.latitude,
          "payload.latitude",
        ),
        livePeriodSeconds: optionalInteger(
          payload.livePeriodSeconds,
          "payload.livePeriodSeconds",
        ),
        longitude: requiredNumber(
          payload.longitude,
          "payload.longitude",
        ),
        proximityAlertRadius: optionalInteger(
          payload.proximityAlertRadius,
          "payload.proximityAlertRadius",
        ),
      };
    case "contact":
      return {
        ...base,
        firstName: requiredString(
          payload.firstName,
          "payload.firstName",
        ),
        kind,
        lastName: optionalString(
          payload.lastName,
          "payload.lastName",
        ),
        phoneNumber: requiredString(
          payload.phoneNumber,
          "payload.phoneNumber",
        ),
        vcard: optionalString(
          payload.vcard,
          "payload.vcard",
        ),
      };
    default:
      throw new TypeError(
        `Unsupported Telegram Gateway payload kind: ${kind}`,
      );
  }
}

function preparedDelivery(
  value: unknown,
  operationId: string,
  recipientId: string,
): TelegramPreparedDelivery | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.encoding !==
      TELEGRAM_PREPARED_DELIVERY_ENCODING ||
    candidate.operationId !== operationId ||
    candidate.recipientId !== recipientId
  ) {
    return undefined;
  }
  try {
    if (
      !Array.isArray(candidate.intents) ||
      candidate.intents.length === 0 ||
      candidate.intents.length >
        TELEGRAM_MAX_DELIVERY_MESSAGES
    ) {
      return undefined;
    }
    const intents = Object.freeze(
      candidate.intents.map((value, index) => {
        const intent = Object.freeze(
          normalizeDeliveryIntent(value, recipientId),
        );
        if (
          index > 0 &&
          (
            intent.replyToMessageId !== undefined ||
            intent.allowSendingWithoutReply !== undefined
          )
        ) {
          throw new TypeError(
            "Only the first Telegram message may reference the source message",
          );
        }
        return intent;
      }),
    );
    return Object.freeze({
      encoding: TELEGRAM_PREPARED_DELIVERY_ENCODING,
      intents,
      operationId,
      recipientId,
    });
  } catch {
    return undefined;
  }
}

export async function prepareTelegramDelivery(
  delivery: GatewayDeliveryPreparation,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayPreparationOutcome> {
  if (options.signal?.aborted === true) {
    return {
      reasonCode: "aborted",
      status: "deferred",
    };
  }
  if (delivery.prepared !== undefined) {
    const cached = preparedDelivery(
      delivery.prepared.payload,
      delivery.operationId,
      delivery.recipientId,
    );
    if (cached === undefined) {
      return {
        errorCode: "invalid-prepared-delivery",
        status: "rejected",
      };
    }
    return {
      preparedPayload: cached,
      status: "ready",
    };
  }
  try {
    const intent = normalizeDeliveryIntent(
      delivery.payload,
      delivery.recipientId,
    );
    const intents = planTelegramDeliveryIntents(intent);
    return {
      preparedPayload: Object.freeze({
        encoding: TELEGRAM_PREPARED_DELIVERY_ENCODING,
        intents,
        operationId: delivery.operationId,
        recipientId: delivery.recipientId,
      } satisfies TelegramPreparedDelivery),
      status: "ready",
    };
  } catch {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
}

export async function deliverTelegramAttempt(
  transport: TelegramTransport,
  attempt: GatewayDeliveryAttempt,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayAttemptOutcome> {
  const prepared = preparedDelivery(
    attempt.preparedPayload,
    attempt.operationId,
    attempt.recipientId,
  );
  if (prepared === undefined) {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
  let deliveredAny = false;
  try {
    let providerReceiptId: string | undefined;
    for (const intent of prepared.intents) {
      const receipt = await transport.send(intent, options);
      deliveredAny = true;
      providerReceiptId =
        `${receipt.chatId}:${receipt.messageId}`;
    }
    return {
      providerReceiptId,
      status: "accepted",
    };
  } catch (error) {
    if (deliveredAny) {
      return {
        errorCode:
          error instanceof TelegramTransportError
            ? error.code
            : "unexpected-transport-error",
        status: "uncertain",
      };
    }
    if (!(error instanceof TelegramTransportError)) {
      return {
        errorCode: "unexpected-transport-error",
        status: "uncertain",
      };
    }
    if (error.effect === "unknown") {
      return {
        errorCode: error.code,
        status: "uncertain",
      };
    }
    if (error.code === "aborted") {
      return {
        reasonCode: error.code,
        status: "deferred",
      };
    }
    if (error.code === "credential-invalid") {
      return {
        errorCode: error.code,
        status: "rejected",
        terminal: "credential-invalid",
      };
    }
    if (error.retryable) {
      return {
        errorCode: error.code,
        retryAfterMs: error.retryAfterMs ?? 0,
        status: "retry",
      };
    }
    return {
      errorCode: error.code,
      status: "rejected",
    };
  }
}

export function createTelegramGatewayProvider(
  input: CreateTelegramGatewayProviderInput,
): GatewayProviderSession {
  const identity = input.transport.identity;
  if (identity === undefined) {
    throw new TelegramTransportError(
      "invalid-state",
      "Telegram transport must pass getMe before provider creation",
    );
  }
  const expectedAccountKey = telegramAccountKey(identity.id);
  if (input.accountKey !== expectedAccountKey) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram account key does not match the validated bot identity",
    );
  }
  const account: GatewayAccount = Object.freeze({
    accountKey: input.accountKey,
    generation: input.generation,
    provider: "telegram",
    providerAccountId: identity.id,
    requiresDeliveryContext: false,
  });
  return Object.freeze({
    account,
    close: async () => await input.transport.close(),
    deliver: async (
      attempt: GatewayDeliveryAttempt,
      options?: { readonly signal?: AbortSignal },
    ) =>
      await deliverTelegramAttempt(
        input.transport,
        attempt,
        options,
      ),
    prepare: async (
      delivery: GatewayDeliveryPreparation,
      options?: { readonly signal?: AbortSignal },
    ) =>
      await prepareTelegramDelivery(delivery, options),
    receive: async (
      checkpoint: string | null,
      options?: { readonly signal?: AbortSignal },
    ) =>
      adaptTelegramInboundBatch({
        accountKey: account.accountKey,
        batch: await input.transport.receive(
          checkpoint,
          options,
        ),
        generation: account.generation,
      }),
    start: async (options?: {
      readonly signal?: AbortSignal;
    }) => {
      await input.transport.start(options);
      if (input.transport.identity?.id !== account.providerAccountId) {
        throw new TelegramTransportError(
          "protocol",
          "Telegram bot identity changed after provider creation",
        );
      }
    },
  });
}
