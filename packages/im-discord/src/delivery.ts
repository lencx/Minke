import { createHash } from "node:crypto";
import type {
  GatewayAttemptOutcome,
  GatewayDeliveryAttempt,
  GatewayDeliveryPreparation,
  GatewayPreparationOutcome,
} from "@lencx/minke-im-gateway";
import {
  DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS,
  DISCORD_MAX_MESSAGE_REQUEST_BYTES,
  DISCORD_PREPARED_DELIVERY_ENCODING,
  DiscordTransportError,
  type DiscordOutboundAttachment,
  type DiscordOutboundMessage,
  type DiscordOutboundReply,
  type DiscordPreparedDelivery,
} from "./contract.ts";
import { DiscordRestClient } from "./rest.ts";

type UnknownRecord = Record<string, unknown>;

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
  if (
    text !== undefined &&
    characterCount(text) >
      DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS
  ) {
    throw new TypeError(
      "Discord message text exceeds 2000 characters",
    );
  }
  const encoder = new TextEncoder();
  let estimatedBytes =
    text === undefined ? 0 : encoder.encode(text).byteLength;
  for (const attachment of attachments) {
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
  return Object.freeze({
    attachments,
    replyTo,
    text,
  });
}

export function discordNonceForOperation(
  operationId: string,
): string {
  if (
    typeof operationId !== "string" ||
    operationId.length === 0
  ) {
    throw new TypeError("operationId must not be empty");
  }
  return `minke_${createHash("sha256")
    .update(operationId, "utf8")
    .digest("base64url")
    .slice(0, 19)}`;
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
    attachments: content.attachments,
    channelId,
    encoding: DISCORD_PREPARED_DELIVERY_ENCODING,
    nonce: discordNonceForOperation(delivery.operationId),
    replyTo: content.replyTo,
    text: content.text,
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
  const nonce = requiredString(
    input.nonce,
    "preparedPayload.nonce",
  );
  if (
    nonce !== discordNonceForOperation(attempt.operationId)
  ) {
    throw new TypeError(
      "prepared Discord nonce does not match operationId",
    );
  }
  const rawAttachments = input.attachments;
  if (!Array.isArray(rawAttachments)) {
    throw new TypeError(
      "preparedPayload.attachments must be an array",
    );
  }
  const content = outboundMessage({
    attachments: rawAttachments,
    kind: "message",
    replyTo: input.replyTo,
    text: input.text,
  });
  return Object.freeze({
    attachments: content.attachments,
    channelId,
    encoding: DISCORD_PREPARED_DELIVERY_ENCODING,
    nonce,
    replyTo: content.replyTo,
    text: content.text,
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
    const receipt = await rest.createMessage(
      prepared,
      options,
    );
    return {
      providerReceiptId: receipt.messageId,
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
