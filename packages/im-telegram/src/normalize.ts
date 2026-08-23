import {
  TelegramTransportError,
  type TelegramChatContext,
  type TelegramChatType,
  type TelegramFileMedia,
  type TelegramInboundContent,
  type TelegramInboundMessage,
  type TelegramInboundUpdateType,
  type TelegramPhotoVariant,
  type TelegramReplyContext,
  type TelegramStickerMedia,
  type TelegramUserContext,
} from "./contract.ts";
import type {
  TelegramWireAudio,
  TelegramWireChat,
  TelegramWireDocument,
  TelegramWireMessage,
  TelegramWirePhotoSize,
  TelegramWireSticker,
  TelegramWireUpdate,
  TelegramWireUser,
  TelegramWireVideo,
  TelegramWireVoice,
} from "./protocol.ts";

const SERVICE_MESSAGE_KEYS = Object.freeze([
  "animation",
  "game",
  "invoice",
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "message_auto_delete_timer_changed",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "poll",
  "venue",
  "video_note",
] as const);

function protocolError(message: string): TelegramTransportError {
  return new TelegramTransportError("protocol", message);
}

function unixMilliseconds(seconds: number, label: string): number {
  const value = seconds * 1_000;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw protocolError(`Telegram ${label} is invalid`);
  }
  return value;
}

function chatType(value: string): TelegramChatType {
  switch (value) {
    case "channel":
    case "group":
    case "private":
    case "supergroup":
      return value;
    default:
      return "unknown";
  }
}

function normalizeChat(
  chat: TelegramWireChat,
): TelegramChatContext {
  return Object.freeze({
    firstName: chat.first_name,
    id: String(chat.id),
    isForum: chat.is_forum,
    lastName: chat.last_name,
    title: chat.title,
    type: chatType(chat.type),
    username: chat.username,
  });
}

function normalizeUser(
  user: TelegramWireUser,
): TelegramUserContext {
  return Object.freeze({
    firstName: user.first_name,
    id: String(user.id),
    isBot: user.is_bot,
    languageCode: user.language_code,
    lastName: user.last_name,
    username: user.username,
  });
}

function normalizePhoto(
  photo: TelegramWirePhotoSize,
): TelegramPhotoVariant {
  return Object.freeze({
    fileId: photo.file_id,
    fileSize: photo.file_size,
    fileUniqueId: photo.file_unique_id,
    height: photo.height,
    width: photo.width,
  });
}

function normalizeFile(
  file:
    | TelegramWireAudio
    | TelegramWireDocument
    | TelegramWireVideo
    | TelegramWireVoice,
): TelegramFileMedia {
  return Object.freeze({
    durationSeconds:
      "duration" in file ? file.duration : undefined,
    fileId: file.file_id,
    fileName: "file_name" in file ? file.file_name : undefined,
    fileSize: file.file_size,
    fileUniqueId: file.file_unique_id,
    height: "height" in file ? file.height : undefined,
    mimeType: "mime_type" in file ? file.mime_type : undefined,
    performer: "performer" in file ? file.performer : undefined,
    title: "title" in file ? file.title : undefined,
    width: "width" in file ? file.width : undefined,
  });
}

function normalizeSticker(
  sticker: TelegramWireSticker,
): TelegramStickerMedia {
  return Object.freeze({
    customEmojiId: sticker.custom_emoji_id,
    emoji: sticker.emoji,
    fileId: sticker.file_id,
    fileSize: sticker.file_size,
    fileUniqueId: sticker.file_unique_id,
    height: sticker.height,
    isAnimated: sticker.is_animated,
    isVideo: sticker.is_video,
    setName: sticker.set_name,
    width: sticker.width,
  });
}

function photoArea(photo: TelegramPhotoVariant): number {
  return photo.width * photo.height;
}

function serviceType(
  message: TelegramWireMessage,
): string | undefined {
  return SERVICE_MESSAGE_KEYS.find(
    (key) => message[key] !== undefined,
  );
}

export function normalizeTelegramContent(
  message: TelegramWireMessage,
): TelegramInboundContent {
  if (message.text !== undefined) {
    return Object.freeze({
      kind: "text",
      text: message.text,
    });
  }
  if (message.photo !== undefined) {
    if (message.photo.length === 0) {
      throw protocolError("Telegram photo list is empty");
    }
    const variants = Object.freeze(
      message.photo.map(normalizePhoto),
    );
    const photo = variants.reduce((best, candidate) =>
      photoArea(candidate) >= photoArea(best) ? candidate : best
    );
    return Object.freeze({
      caption: message.caption,
      kind: "photo",
      photo,
      variants,
    });
  }
  if (message.document !== undefined) {
    return Object.freeze({
      caption: message.caption,
      document: normalizeFile(message.document),
      kind: "document",
    });
  }
  if (message.audio !== undefined) {
    return Object.freeze({
      audio: normalizeFile(message.audio),
      caption: message.caption,
      kind: "audio",
    });
  }
  if (message.video !== undefined) {
    return Object.freeze({
      caption: message.caption,
      kind: "video",
      video: normalizeFile(message.video),
    });
  }
  if (message.voice !== undefined) {
    return Object.freeze({
      caption: message.caption,
      kind: "voice",
      voice: normalizeFile(message.voice),
    });
  }
  if (message.sticker !== undefined) {
    return Object.freeze({
      kind: "sticker",
      sticker: normalizeSticker(message.sticker),
    });
  }
  if (message.location !== undefined) {
    return Object.freeze({
      heading: message.location.heading,
      horizontalAccuracy:
        message.location.horizontal_accuracy,
      kind: "location",
      latitude: message.location.latitude,
      livePeriodSeconds: message.location.live_period,
      longitude: message.location.longitude,
      proximityAlertRadius:
        message.location.proximity_alert_radius,
    });
  }
  if (message.contact !== undefined) {
    return Object.freeze({
      firstName: message.contact.first_name,
      kind: "contact",
      lastName: message.contact.last_name,
      phoneNumber: message.contact.phone_number,
      userId:
        message.contact.user_id === undefined
          ? undefined
          : String(message.contact.user_id),
      vcard: message.contact.vcard,
    });
  }
  return Object.freeze({
    kind: "unsupported",
    serviceType: serviceType(message),
  });
}

function replyText(
  content: TelegramInboundContent,
): string | undefined {
  switch (content.kind) {
    case "text":
      return content.text;
    case "audio":
    case "document":
    case "photo":
    case "video":
    case "voice":
      return content.caption;
    case "contact":
    case "location":
    case "sticker":
    case "unsupported":
      return undefined;
  }
}

function normalizeReply(
  message: TelegramWireMessage,
): TelegramReplyContext {
  const content = normalizeTelegramContent(message);
  const senderId =
    message.from?.id ?? message.sender_chat?.id;
  return Object.freeze({
    chatId: String(message.chat.id),
    contentKind: content.kind,
    messageId: String(message.message_id),
    senderId:
      senderId === undefined ? undefined : String(senderId),
    text: replyText(content),
    threadId:
      message.message_thread_id === undefined
        ? undefined
        : String(message.message_thread_id),
  });
}

function conversationId(
  chatId: string,
  threadId: string | undefined,
): string {
  return threadId === undefined
    ? `telegram:chat:${chatId}`
    : `telegram:chat:${chatId}:thread:${threadId}`;
}

export function normalizeTelegramMessage(input: {
  readonly message: TelegramWireMessage;
  readonly updateId: number;
  readonly updateType: TelegramInboundUpdateType;
}): TelegramInboundMessage {
  const chat = normalizeChat(input.message.chat);
  const threadId =
    input.message.message_thread_id === undefined
      ? undefined
      : String(input.message.message_thread_id);
  const sender =
    input.message.from === undefined
      ? undefined
      : normalizeUser(input.message.from);
  const senderChat =
    input.message.sender_chat === undefined
      ? undefined
      : normalizeChat(input.message.sender_chat);
  const senderId =
    sender?.id ?? senderChat?.id ?? chat.id;
  return Object.freeze({
    chat,
    content: normalizeTelegramContent(input.message),
    conversationId: conversationId(chat.id, threadId),
    createdAt: unixMilliseconds(
      input.message.date,
      "message date",
    ),
    editDate:
      input.message.edit_date === undefined
        ? undefined
        : unixMilliseconds(
            input.message.edit_date,
            "message edit date",
          ),
    id: `telegram:update:${String(input.updateId)}`,
    isTopicMessage: input.message.is_topic_message === true,
    messageId: String(input.message.message_id),
    peerId: chat.id,
    reply:
      input.message.reply_to_message === undefined
        ? undefined
        : normalizeReply(input.message.reply_to_message),
    sender,
    senderChat,
    senderId,
    threadId,
    updateId: String(input.updateId),
    updateType: input.updateType,
  });
}

export function normalizeTelegramUpdate(
  update: TelegramWireUpdate,
): TelegramInboundMessage | undefined {
  if (update.message !== undefined) {
    return normalizeTelegramMessage({
      message: update.message,
      updateId: update.update_id,
      updateType: "message",
    });
  }
  if (update.edited_message !== undefined) {
    return normalizeTelegramMessage({
      message: update.edited_message,
      updateId: update.update_id,
      updateType: "edited-message",
    });
  }
  if (update.channel_post !== undefined) {
    return normalizeTelegramMessage({
      message: update.channel_post,
      updateId: update.update_id,
      updateType: "channel-post",
    });
  }
  if (update.edited_channel_post !== undefined) {
    return normalizeTelegramMessage({
      message: update.edited_channel_post,
      updateId: update.update_id,
      updateType: "edited-channel-post",
    });
  }
  return undefined;
}
