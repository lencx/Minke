import { createHash } from "node:crypto";
import type {
  GatewayAttemptOutcome,
  GatewayDeliveryAttempt,
  GatewayDeliveryPreparation,
  GatewayPreparationOutcome,
} from "@lencx/minke-im-gateway";
import {
  DISCORD_MAX_DELIVERY_MESSAGES,
  DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS,
  DISCORD_MAX_MESSAGE_REQUEST_BYTES,
  DISCORD_PREPARED_DELIVERY_ENCODING,
  DiscordTransportError,
  type DiscordOutboundAttachment,
  type DiscordOutboundMessage,
  type DiscordOutboundReply,
  type DiscordPreparedDelivery,
  type DiscordPreparedMessage,
} from "./contract.ts";
import { splitDiscordMessageText } from "./chunk.ts";
import { DiscordRestClient } from "./rest.ts";

type UnknownRecord = Record<string, unknown>;
const COMPLETE_RESPONSE_FILE_NAME = "minke-response.md";
const COMPLETE_RESPONSE_NOTICE =
  "⚠️ This reply is too long for Discord. The complete response is attached as `minke-response.md`.";

function record(
  value: unknown,
  label: string,
): UnknownRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
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

function snowflake(
  value: unknown,
  label: string,
): string {
  const result = requiredString(value, label);
  if (!/^[0-9]{1,20}$/u.test(result)) {
    throw new TypeError(`${label} must be a Discord snowflake`);
  }
  return result;
}

function optionalSnowflake(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  return snowflake(value, label);
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

function characterCount(value: string): number {
  return [...value].length;
}

function outboundReply(
  value: unknown,
  label: string,
): DiscordOutboundReply | undefined {
  if (value === undefined) return undefined;
  const input = record(value, label);
  return Object.freeze({
    channelId: optionalSnowflake(
      input.channelId,
      `${label}.channelId`,
    ),
    failIfNotExists: optionalBoolean(
      input.failIfNotExists,
      `${label}.failIfNotExists`,
    ),
    guildId: optionalSnowflake(
      input.guildId,
      `${label}.guildId`,
    ),
    messageId: snowflake(
      input.messageId,
      `${label}.messageId`,
    ),
  });
}

function outboundAttachment(
  value: unknown,
  index: number,
): DiscordOutboundAttachment {
  const label = `payload.attachments[${index}]`;
  const input = record(value, label);
  if (!(input.bytes instanceof Uint8Array)) {
    throw new TypeError(`${label}.bytes must be Uint8Array`);
  }
  if (input.bytes.byteLength === 0) {
    throw new TypeError(`${label}.bytes must not be empty`);
  }
  const fileName = requiredString(
    input.fileName,
    `${label}.fileName`,
  );
  if (
    fileName.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    throw new TypeError(
      `${label}.fileName contains unsupported characters`,
    );
  }
  const contentType = optionalString(
    input.contentType,
    `${label}.contentType`,
  );
  if (
    contentType !== undefined &&
    (
      contentType.length > 127 ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+:-]+)*$/u
        .test(contentType)
    )
  ) {
    throw new TypeError(`${label}.contentType is invalid`);
  }
  const description = optionalString(
    input.description,
    `${label}.description`,
  );
  if (
    description !== undefined &&
    characterCount(description) > 1_024
  ) {
    throw new TypeError(
      `${label}.description exceeds 1024 characters`,
    );
  }
  return Object.freeze({
    bytes: new Uint8Array(input.bytes),
    contentType,
    description,
    fileName,
  });
}

function outboundMessage(
  value: unknown,
): {
  readonly attachments: readonly DiscordOutboundAttachment[];
  readonly replyTo?: DiscordOutboundReply;
  readonly text?: string;
} {
  const payload = record(value, "payload");
  const kind = requiredString(payload.kind, "payload.kind");
  let text: string | undefined;
  let attachments: readonly DiscordOutboundAttachment[];
  let replyTo: DiscordOutboundReply | undefined;
  if (kind === "text") {
    text = requiredString(payload.text, "payload.text");
    attachments = Object.freeze([]);
    replyTo = outboundReply(payload.replyTo, "payload.replyTo");
  } else if (kind === "message") {
    text = optionalString(payload.text, "payload.text");
    const rawAttachments = payload.attachments ?? [];
    if (!Array.isArray(rawAttachments)) {
      throw new TypeError("payload.attachments must be an array");
    }
    attachments = Object.freeze(
      rawAttachments.map(outboundAttachment),
    );
    replyTo = outboundReply(payload.replyTo, "payload.replyTo");
    if (
      (text === undefined || text.length === 0) &&
      attachments.length === 0
    ) {
      throw new TypeError(
        "Discord message must contain text or an attachment",
      );
    }
    if (text === "") text = undefined;
  } else {
    throw new TypeError(
      "payload.kind must be text or message",
    );
  }
  return Object.freeze({
    attachments,
    replyTo,
    text,
  });
}

function assertPreparedMessageBounds(
  message: {
    readonly attachments: readonly DiscordOutboundAttachment[];
    readonly text?: string;
  },
): void {
  if (
    message.text !== undefined &&
    characterCount(message.text) >
      DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS
  ) {
    throw new TypeError(
      "Discord message text exceeds 2000 characters",
    );
  }
  const encoder = new TextEncoder();
  let estimatedBytes =
    message.text === undefined
      ? 0
      : encoder.encode(message.text).byteLength;
  for (const attachment of message.attachments) {
    estimatedBytes +=
      attachment.bytes.byteLength +
      encoder.encode(attachment.fileName).byteLength +
      (
        attachment.description === undefined
          ? 0
          : encoder.encode(attachment.description).byteLength
      );
  }
  if (estimatedBytes > DISCORD_MAX_MESSAGE_REQUEST_BYTES) {
    throw new TypeError(
      "Discord message exceeds the 25 MiB request limit",
    );
  }
}

export function discordNonceForOperation(
  operationId: string,
  messageIndex = 0,
): string {
  if (
    typeof operationId !== "string" ||
    operationId.length === 0
  ) {
    throw new TypeError("operationId must not be empty");
  }
  if (
    !Number.isSafeInteger(messageIndex) ||
    messageIndex < 0 ||
    messageIndex >= DISCORD_MAX_DELIVERY_MESSAGES
  ) {
    throw new TypeError(
      "messageIndex must identify a Discord delivery message",
    );
  }
  return `minke_${createHash("sha256")
    .update("minke-discord-message\u0000", "utf8")
    .update(
      String(Buffer.byteLength(operationId, "utf8")),
      "utf8",
    )
    .update("\u0000", "utf8")
    .update(operationId, "utf8")
    .update("\u0000", "utf8")
    .update(String(messageIndex), "utf8")
    .digest("base64url")
    .slice(0, 19)}`;
}

function preparedMessages(
  content: ReturnType<typeof outboundMessage>,
  operationId: string,
): readonly DiscordPreparedMessage[] {
  const sourceText = content.text;
  const sourceChunks =
    sourceText === undefined
      ? [undefined]
      : [...splitDiscordMessageText(sourceText)];
  const overflow =
    sourceChunks.length > DISCORD_MAX_DELIVERY_MESSAGES;
  const textChunks: readonly (string | undefined)[] =
    overflow
      ? Object.freeze([
          ...sourceChunks.slice(
            0,
            DISCORD_MAX_DELIVERY_MESSAGES - 1,
          ),
          COMPLETE_RESPONSE_NOTICE,
        ])
      : Object.freeze(sourceChunks);
  const completeResponseAttachment:
    | DiscordOutboundAttachment
    | undefined =
    overflow && sourceText !== undefined
      ? Object.freeze({
          bytes: new TextEncoder().encode(sourceText),
          contentType: "text/markdown; charset=utf-8",
          description: "Complete Minke response",
          fileName: COMPLETE_RESPONSE_FILE_NAME,
        })
      : undefined;
  return Object.freeze(
    textChunks.map((text, index) => {
      const attachments: readonly DiscordOutboundAttachment[] =
        Object.freeze([
          ...(index === 0 ? content.attachments : []),
          ...(completeResponseAttachment !== undefined &&
          index === textChunks.length - 1
            ? [completeResponseAttachment]
            : []),
        ]);
      const message: DiscordPreparedMessage = Object.freeze({
        attachments,
        nonce: discordNonceForOperation(
          operationId,
          index,
        ),
        ...(index === 0 &&
        content.replyTo !== undefined
          ? { replyTo: content.replyTo }
          : {}),
        ...(text === undefined ? {} : { text }),
      });
      assertPreparedMessageBounds(message);
      return message;
    }),
  );
}

export function prepareDiscordPayload(
  delivery: GatewayDeliveryPreparation,
): DiscordPreparedDelivery {
  const channelId = snowflake(
    delivery.recipientId,
    "recipientId",
  );
  const content = outboundMessage(
    delivery.payload as DiscordOutboundMessage,
  );
  return Object.freeze({
    channelId,
    encoding: DISCORD_PREPARED_DELIVERY_ENCODING,
    messages: preparedMessages(
      content,
      delivery.operationId,
    ),
  });
}

function preparedDiscordPayload(
  value: unknown,
  attempt: GatewayDeliveryAttempt,
): DiscordPreparedDelivery {
  const input = record(value, "preparedPayload");
  if (
    input.encoding !== DISCORD_PREPARED_DELIVERY_ENCODING
  ) {
    throw new TypeError(
      "preparedPayload encoding is not Discord v1",
    );
  }
  const channelId = snowflake(
    input.channelId,
    "preparedPayload.channelId",
  );
  if (channelId !== attempt.recipientId) {
    throw new TypeError(
      "prepared Discord channel does not match recipientId",
    );
  }
  const rawMessages = input.messages;
  if (
    !Array.isArray(rawMessages) ||
    rawMessages.length === 0 ||
    rawMessages.length > DISCORD_MAX_DELIVERY_MESSAGES
  ) {
    throw new TypeError(
      "preparedPayload.messages must contain 1 to 8 messages",
    );
  }
  const messages = Object.freeze(
    rawMessages.map((value, index) => {
      const message = record(
        value,
        `preparedPayload.messages[${index}]`,
      );
      const nonce = requiredString(
        message.nonce,
        `preparedPayload.messages[${index}].nonce`,
      );
      if (
        nonce !==
        discordNonceForOperation(
          attempt.operationId,
          index,
        )
      ) {
        throw new TypeError(
          "prepared Discord nonce does not match operationId",
        );
      }
      const content = outboundMessage({
        attachments: message.attachments,
        kind: "message",
        replyTo: message.replyTo,
        text: message.text,
      });
      if (
        index > 0 &&
        content.replyTo !== undefined
      ) {
        throw new TypeError(
          "only the first Discord message may reference the source message",
        );
      }
      const preparedMessage: DiscordPreparedMessage =
        Object.freeze({
          attachments: content.attachments,
          nonce,
          ...(content.replyTo === undefined
            ? {}
            : { replyTo: content.replyTo }),
          ...(content.text === undefined
            ? {}
            : { text: content.text }),
        });
      assertPreparedMessageBounds(preparedMessage);
      return preparedMessage;
    }),
  );
  return Object.freeze({
    channelId,
    encoding: DISCORD_PREPARED_DELIVERY_ENCODING,
    messages,
  });
}

export async function prepareDiscordDelivery(
  delivery: GatewayDeliveryPreparation,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayPreparationOutcome> {
  if (options.signal?.aborted === true) {
    return {
      reasonCode: "aborted",
      status: "deferred",
    };
  }
  try {
    return {
      preparedPayload: prepareDiscordPayload(delivery),
      status: "ready",
    };
  } catch {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
}

export async function deliverDiscordAttempt(
  rest: DiscordRestClient,
  attempt: GatewayDeliveryAttempt,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayAttemptOutcome> {
  let prepared: DiscordPreparedDelivery;
  try {
    prepared = preparedDiscordPayload(
      attempt.preparedPayload,
      attempt,
    );
  } catch {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
  try {
    let providerReceiptId: string | undefined;
    for (const message of prepared.messages) {
      const receipt = await rest.createMessage(
        prepared.channelId,
        message,
        options,
      );
      providerReceiptId = receipt.messageId;
    }
    return {
      providerReceiptId,
      status: "accepted",
    };
  } catch (error) {
    if (!(error instanceof DiscordTransportError)) {
      return {
        errorCode: "unexpected-transport-error",
        status: "uncertain",
      };
    }
    if (error.effect !== "none") {
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
    if (
      error.code === "credential-invalid" ||
      error.terminal === "credential-invalid"
    ) {
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
