import {
  DiscordTransportError,
  type DiscordConversationContext,
  type DiscordInboundAttachment,
  type DiscordInboundEmbed,
  type DiscordInboundEmbedMedia,
  type DiscordInboundMessage,
  type DiscordInboundReply,
  type DiscordInboundUser,
} from "./contract.ts";

export interface DiscordChannelMetadata {
  readonly id: string;
  readonly parentId?: string;
  readonly type?: number;
}

export interface NormalizeDiscordMessageOptions {
  readonly channel?: DiscordChannelMetadata;
}

type UnknownRecord = Record<string, unknown>;

function protocol(message: string): DiscordTransportError {
  return new DiscordTransportError("protocol", message);
}

function record(
  value: unknown,
  label: string,
): UnknownRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw protocol(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function string(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") {
    throw protocol(`${label} must be a string`);
  }
  return value;
}

function nonEmptyString(
  value: unknown,
  label: string,
): string {
  const result = string(value, label);
  if (result.length === 0) {
    throw protocol(`${label} must not be empty`);
  }
  return result;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return string(value, label);
}

function snowflake(
  value: unknown,
  label: string,
): string {
  const result = nonEmptyString(value, label);
  if (!/^[0-9]{1,20}$/u.test(result)) {
    throw protocol(`${label} must be a Discord snowflake`);
  }
  return result;
}

function optionalSnowflake(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return snowflake(value, label);
}

function finiteNumber(
  value: unknown,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw protocol(`${label} must be a finite number`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, label);
}

function nonNegativeInteger(
  value: unknown,
  label: string,
): number {
  const result = finiteNumber(value, label);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw protocol(
      `${label} must be a non-negative safe integer`,
    );
  }
  return result;
}

function optionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return nonNegativeInteger(value, label);
}

function optionalBoolean(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw protocol(`${label} must be a boolean`);
  }
  return value;
}

function array(
  value: unknown,
  label: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw protocol(`${label} must be an array`);
  }
  return value;
}

function timestamp(
  value: unknown,
  label: string,
): number {
  const raw = nonEmptyString(value, label);
  const result = Date.parse(raw);
  if (
    !Number.isSafeInteger(result) ||
    result < 0
  ) {
    throw protocol(`${label} must be an ISO-8601 timestamp`);
  }
  return result;
}

function optionalTimestamp(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, label);
}

function webUrl(
  value: unknown,
  label: string,
  protocols: readonly string[],
): string {
  const raw = nonEmptyString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw protocol(`${label} must be an absolute URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw protocol(`${label} uses an unsupported URL scheme`);
  }
  return parsed.href;
}

function optionalWebUrl(
  value: unknown,
  label: string,
  protocols: readonly string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return webUrl(value, label, protocols);
}

function normalizeUser(
  value: unknown,
  label: string,
): DiscordInboundUser {
  const input = record(value, label);
  return Object.freeze({
    avatar: optionalString(input.avatar, `${label}.avatar`),
    bot: optionalBoolean(input.bot, `${label}.bot`) ?? false,
    discriminator: optionalString(
      input.discriminator,
      `${label}.discriminator`,
    ),
    globalName: optionalString(
      input.global_name,
      `${label}.global_name`,
    ),
    id: snowflake(input.id, `${label}.id`),
    username: nonEmptyString(
      input.username,
      `${label}.username`,
    ),
  });
}

function normalizeAttachment(
  value: unknown,
  index: number,
): DiscordInboundAttachment {
  const label = `message.attachments[${index}]`;
  const input = record(value, label);
  return Object.freeze({
    contentType: optionalString(
      input.content_type,
      `${label}.content_type`,
    ),
    description: optionalString(
      input.description,
      `${label}.description`,
    ),
    durationSeconds: optionalFiniteNumber(
      input.duration_secs,
      `${label}.duration_secs`,
    ),
    ephemeral:
      optionalBoolean(
        input.ephemeral,
        `${label}.ephemeral`,
      ) ?? false,
    fileName: nonEmptyString(
      input.filename,
      `${label}.filename`,
    ),
    height: optionalNonNegativeInteger(
      input.height,
      `${label}.height`,
    ),
    id: snowflake(input.id, `${label}.id`),
    proxyUrl: webUrl(
      input.proxy_url,
      `${label}.proxy_url`,
      ["https:"],
    ),
    size: nonNegativeInteger(input.size, `${label}.size`),
    title: optionalString(input.title, `${label}.title`),
    url: webUrl(input.url, `${label}.url`, ["https:"]),
    waveform: optionalString(
      input.waveform,
      `${label}.waveform`,
    ),
    width: optionalNonNegativeInteger(
      input.width,
      `${label}.width`,
    ),
  });
}

function normalizeEmbedMedia(
  value: unknown,
  label: string,
): DiscordInboundEmbedMedia | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, label);
  return Object.freeze({
    height: optionalNonNegativeInteger(
      input.height,
      `${label}.height`,
    ),
    proxyUrl: optionalWebUrl(
      input.proxy_url,
      `${label}.proxy_url`,
      ["http:", "https:"],
    ),
    url: webUrl(
      input.url,
      `${label}.url`,
      ["http:", "https:", "attachment:"],
    ),
    width: optionalNonNegativeInteger(
      input.width,
      `${label}.width`,
    ),
  });
}

function normalizeEmbed(
  value: unknown,
  index: number,
): DiscordInboundEmbed {
  const label = `message.embeds[${index}]`;
  const input = record(value, label);
  const rawFields =
    input.fields === undefined
      ? []
      : array(input.fields, `${label}.fields`);
  const fields = rawFields.map((rawField, fieldIndex) => {
    const fieldLabel = `${label}.fields[${fieldIndex}]`;
    const field = record(rawField, fieldLabel);
    return Object.freeze({
      inline:
        optionalBoolean(
          field.inline,
          `${fieldLabel}.inline`,
        ) ?? false,
      name: string(field.name, `${fieldLabel}.name`),
      value: string(field.value, `${fieldLabel}.value`),
    });
  });
  const rawAuthor =
    input.author === undefined || input.author === null
      ? undefined
      : record(input.author, `${label}.author`);
  const rawFooter =
    input.footer === undefined || input.footer === null
      ? undefined
      : record(input.footer, `${label}.footer`);
  const rawProvider =
    input.provider === undefined || input.provider === null
      ? undefined
      : record(input.provider, `${label}.provider`);
  return Object.freeze({
    author:
      rawAuthor === undefined
        ? undefined
        : Object.freeze({
            iconUrl: optionalWebUrl(
              rawAuthor.icon_url,
              `${label}.author.icon_url`,
              ["http:", "https:", "attachment:"],
            ),
            name: string(
              rawAuthor.name,
              `${label}.author.name`,
            ),
            proxyIconUrl: optionalWebUrl(
              rawAuthor.proxy_icon_url,
              `${label}.author.proxy_icon_url`,
              ["http:", "https:"],
            ),
            url: optionalWebUrl(
              rawAuthor.url,
              `${label}.author.url`,
              ["http:", "https:"],
            ),
          }),
    color: optionalNonNegativeInteger(
      input.color,
      `${label}.color`,
    ),
    description: optionalString(
      input.description,
      `${label}.description`,
    ),
    fields: Object.freeze(fields),
    footer:
      rawFooter === undefined
        ? undefined
        : Object.freeze({
            iconUrl: optionalWebUrl(
              rawFooter.icon_url,
              `${label}.footer.icon_url`,
              ["http:", "https:", "attachment:"],
            ),
            proxyIconUrl: optionalWebUrl(
              rawFooter.proxy_icon_url,
              `${label}.footer.proxy_icon_url`,
              ["http:", "https:"],
            ),
            text: string(
              rawFooter.text,
              `${label}.footer.text`,
            ),
          }),
    image: normalizeEmbedMedia(
      input.image,
      `${label}.image`,
    ),
    provider:
      rawProvider === undefined
        ? undefined
        : Object.freeze({
            name: optionalString(
              rawProvider.name,
              `${label}.provider.name`,
            ),
            url: optionalWebUrl(
              rawProvider.url,
              `${label}.provider.url`,
              ["http:", "https:"],
            ),
          }),
    thumbnail: normalizeEmbedMedia(
      input.thumbnail,
      `${label}.thumbnail`,
    ),
    timestamp: optionalString(
      input.timestamp,
      `${label}.timestamp`,
    ),
    title: optionalString(input.title, `${label}.title`),
    type: optionalString(input.type, `${label}.type`),
    url: optionalWebUrl(
      input.url,
      `${label}.url`,
      ["http:", "https:"],
    ),
    video: normalizeEmbedMedia(
      input.video,
      `${label}.video`,
    ),
  });
}

function normalizeReply(
  input: UnknownRecord,
): DiscordInboundReply | undefined {
  if (
    input.message_reference === undefined ||
    input.message_reference === null
  ) {
    return undefined;
  }
  const reference = record(
    input.message_reference,
    "message.message_reference",
  );
  const messageId = optionalSnowflake(
    reference.message_id,
    "message.message_reference.message_id",
  );
  if (messageId === undefined) return undefined;
  const referenced =
    input.referenced_message === undefined ||
    input.referenced_message === null
      ? undefined
      : record(
          input.referenced_message,
          "message.referenced_message",
        );
  const referencedAuthor =
    referenced?.author === undefined ||
    referenced.author === null
      ? undefined
      : record(
          referenced.author,
          "message.referenced_message.author",
        );
  return Object.freeze({
    authorId:
      referencedAuthor === undefined
        ? undefined
        : optionalSnowflake(
            referencedAuthor.id,
            "message.referenced_message.author.id",
          ),
    channelId: optionalSnowflake(
      reference.channel_id,
      "message.message_reference.channel_id",
    ),
    content:
      referenced === undefined
        ? undefined
        : optionalString(
            referenced.content,
            "message.referenced_message.content",
          ),
    guildId: optionalSnowflake(
      reference.guild_id,
      "message.message_reference.guild_id",
    ),
    messageId,
  });
}

function normalizeMentionedUserIds(
  value: unknown,
): readonly string[] {
  return Object.freeze(
    array(value, "message.mentions").map(
      (rawMention, index) => {
        const label = `message.mentions[${index}]`;
        return snowflake(
          record(rawMention, label).id,
          `${label}.id`,
        );
      },
    ),
  );
}

function conversationContext(
  channelId: string,
  guildId: string | undefined,
  channelType: number | undefined,
  parentChannelId: string | undefined,
): DiscordConversationContext {
  if (guildId === undefined) {
    return Object.freeze({
      channelId,
      channelType,
      kind: "direct",
    });
  }
  if (
    channelType === 10 ||
    channelType === 11 ||
    channelType === 12
  ) {
    return Object.freeze({
      channelId,
      guildId,
      kind: "guild-thread",
      parentChannelId,
      threadType: channelType,
    });
  }
  return Object.freeze({
    channelId,
    channelType,
    guildId,
    kind: "guild-channel",
  });
}

export function normalizeDiscordMessage(
  value: unknown,
  options: NormalizeDiscordMessageOptions = {},
): DiscordInboundMessage {
  const input = record(value, "message");
  const channelId = snowflake(
    input.channel_id,
    "message.channel_id",
  );
  if (
    options.channel !== undefined &&
    options.channel.id !== channelId
  ) {
    throw protocol(
      "cached channel metadata does not match the message channel",
    );
  }
  const guildId = optionalSnowflake(
    input.guild_id,
    "message.guild_id",
  );
  const channelType =
    optionalNonNegativeInteger(
      input.channel_type,
      "message.channel_type",
    ) ?? options.channel?.type;
  const rawNonce = input.nonce;
  const nonce =
    typeof rawNonce === "string"
      ? rawNonce
      : typeof rawNonce === "number" &&
          Number.isSafeInteger(rawNonce)
        ? String(rawNonce)
        : undefined;
  const attachments = array(
    input.attachments,
    "message.attachments",
  ).map(normalizeAttachment);
  const embeds = array(
    input.embeds,
    "message.embeds",
  ).map(normalizeEmbed);
  return Object.freeze({
    attachments: Object.freeze(attachments),
    author: normalizeUser(input.author, "message.author"),
    channelId,
    content: string(input.content, "message.content"),
    context: conversationContext(
      channelId,
      guildId,
      channelType,
      options.channel?.parentId,
    ),
    editedAt: optionalTimestamp(
      input.edited_timestamp,
      "message.edited_timestamp",
    ),
    embeds: Object.freeze(embeds),
    flags:
      optionalNonNegativeInteger(
        input.flags,
        "message.flags",
      ) ?? 0,
    guildId,
    id: snowflake(input.id, "message.id"),
    mentionedUserIds: normalizeMentionedUserIds(
      input.mentions,
    ),
    messageType: nonNegativeInteger(
      input.type,
      "message.type",
    ),
    nonce,
    reply: normalizeReply(input),
    timestamp: timestamp(input.timestamp, "message.timestamp"),
  });
}

export function normalizeDiscordChannelMetadata(
  value: unknown,
): DiscordChannelMetadata {
  const input = record(value, "channel");
  return Object.freeze({
    id: snowflake(input.id, "channel.id"),
    parentId: optionalSnowflake(
      input.parent_id,
      "channel.parent_id",
    ),
    type: optionalNonNegativeInteger(
      input.type,
      "channel.type",
    ),
  });
}
