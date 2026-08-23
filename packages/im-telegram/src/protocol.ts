import {
  TelegramTransportError,
  type TelegramBotIdentity,
} from "./contract.ts";

export interface TelegramApiFailure {
  readonly description?: string;
  readonly error_code?: number;
  readonly ok: false;
  readonly parameters?: {
    readonly migrate_to_chat_id?: number;
    readonly retry_after?: number;
  };
}

export interface TelegramApiSuccess {
  readonly ok: true;
  readonly result: unknown;
}

export type TelegramApiResponse =
  | TelegramApiFailure
  | TelegramApiSuccess;

export interface TelegramWireUser {
  readonly can_connect_to_business?: boolean;
  readonly can_join_groups?: boolean;
  readonly can_read_all_group_messages?: boolean;
  readonly first_name: string;
  readonly id: number;
  readonly is_bot: boolean;
  readonly language_code?: string;
  readonly last_name?: string;
  readonly supports_inline_queries?: boolean;
  readonly username?: string;
}

export interface TelegramWireChat {
  readonly first_name?: string;
  readonly id: number;
  readonly is_forum?: boolean;
  readonly last_name?: string;
  readonly title?: string;
  readonly type: string;
  readonly username?: string;
}

interface TelegramWireFile {
  readonly file_id: string;
  readonly file_size?: number;
  readonly file_unique_id: string;
}

export interface TelegramWirePhotoSize
  extends TelegramWireFile {
  readonly height: number;
  readonly width: number;
}

export interface TelegramWireDocument
  extends TelegramWireFile {
  readonly file_name?: string;
  readonly mime_type?: string;
}

export interface TelegramWireAudio
  extends TelegramWireDocument {
  readonly duration: number;
  readonly performer?: string;
  readonly title?: string;
}

export interface TelegramWireVideo
  extends TelegramWireDocument {
  readonly duration: number;
  readonly height: number;
  readonly width: number;
}

export interface TelegramWireVoice
  extends TelegramWireFile {
  readonly duration: number;
  readonly mime_type?: string;
}

export interface TelegramWireSticker
  extends TelegramWireFile {
  readonly custom_emoji_id?: string;
  readonly emoji?: string;
  readonly height: number;
  readonly is_animated: boolean;
  readonly is_video: boolean;
  readonly set_name?: string;
  readonly width: number;
}

export interface TelegramWireLocation {
  readonly heading?: number;
  readonly horizontal_accuracy?: number;
  readonly latitude: number;
  readonly live_period?: number;
  readonly longitude: number;
  readonly proximity_alert_radius?: number;
}

export interface TelegramWireContact {
  readonly first_name: string;
  readonly last_name?: string;
  readonly phone_number: string;
  readonly user_id?: number;
  readonly vcard?: string;
}

export interface TelegramWireMessage {
  readonly audio?: TelegramWireAudio;
  readonly caption?: string;
  readonly chat: TelegramWireChat;
  readonly contact?: TelegramWireContact;
  readonly date: number;
  readonly document?: TelegramWireDocument;
  readonly edit_date?: number;
  readonly from?: TelegramWireUser;
  readonly is_topic_message?: boolean;
  readonly location?: TelegramWireLocation;
  readonly message_id: number;
  readonly message_thread_id?: number;
  readonly photo?: readonly TelegramWirePhotoSize[];
  readonly reply_to_message?: TelegramWireMessage;
  readonly sender_chat?: TelegramWireChat;
  readonly sticker?: TelegramWireSticker;
  readonly text?: string;
  readonly video?: TelegramWireVideo;
  readonly voice?: TelegramWireVoice;
  readonly [key: string]: unknown;
}

export interface TelegramWireUpdate {
  readonly channel_post?: TelegramWireMessage;
  readonly edited_channel_post?: TelegramWireMessage;
  readonly edited_message?: TelegramWireMessage;
  readonly message?: TelegramWireMessage;
  readonly update_id: number;
}

function protocolError(message: string): TelegramTransportError {
  return new TelegramTransportError("protocol", message);
}

export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value)) {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return Number(value);
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return Number(value);
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw protocolError(`Telegram ${key} is invalid`);
  }
  return value;
}

export function parseApiResponse(
  value: unknown,
): TelegramApiResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw protocolError("Telegram API response is invalid");
  }
  if (value.ok) {
    if (!Object.hasOwn(value, "result")) {
      throw protocolError("Telegram API response omitted result");
    }
    return { ok: true, result: value.result };
  }
  const parameters = value.parameters;
  let normalizedParameters: TelegramApiFailure["parameters"];
  if (parameters !== undefined) {
    if (!isRecord(parameters)) {
      throw protocolError("Telegram response parameters are invalid");
    }
    normalizedParameters = {
      migrate_to_chat_id: optionalInteger(
        parameters,
        "migrate_to_chat_id",
      ),
      retry_after: optionalInteger(parameters, "retry_after"),
    };
  }
  return {
    description: optionalString(value, "description"),
    error_code: optionalInteger(value, "error_code"),
    ok: false,
    parameters: normalizedParameters,
  };
}

function parseUser(value: unknown): TelegramWireUser {
  if (!isRecord(value)) {
    throw protocolError("Telegram user is invalid");
  }
  return {
    can_connect_to_business: optionalBoolean(
      value,
      "can_connect_to_business",
    ),
    can_join_groups: optionalBoolean(value, "can_join_groups"),
    can_read_all_group_messages: optionalBoolean(
      value,
      "can_read_all_group_messages",
    ),
    first_name: requiredString(value, "first_name"),
    id: requiredInteger(value, "id"),
    is_bot: requiredBoolean(value, "is_bot"),
    language_code: optionalString(value, "language_code"),
    last_name: optionalString(value, "last_name"),
    supports_inline_queries: optionalBoolean(
      value,
      "supports_inline_queries",
    ),
    username: optionalString(value, "username"),
  };
}

function parseChat(value: unknown): TelegramWireChat {
  if (!isRecord(value)) {
    throw protocolError("Telegram chat is invalid");
  }
  return {
    first_name: optionalString(value, "first_name"),
    id: requiredInteger(value, "id"),
    is_forum: optionalBoolean(value, "is_forum"),
    last_name: optionalString(value, "last_name"),
    title: optionalString(value, "title"),
    type: requiredString(value, "type"),
    username: optionalString(value, "username"),
  };
}

function parseFile(
  value: Record<string, unknown>,
): TelegramWireFile {
  const fileSize = optionalInteger(value, "file_size");
  if (fileSize !== undefined && fileSize < 0) {
    throw protocolError("Telegram file_size is invalid");
  }
  return {
    file_id: requiredString(value, "file_id"),
    file_size: fileSize,
    file_unique_id: requiredString(value, "file_unique_id"),
  };
}

function parsePhoto(value: unknown): TelegramWirePhotoSize {
  if (!isRecord(value)) {
    throw protocolError("Telegram photo is invalid");
  }
  return {
    ...parseFile(value),
    height: requiredInteger(value, "height"),
    width: requiredInteger(value, "width"),
  };
}

function parseDocument(
  value: unknown,
): TelegramWireDocument {
  if (!isRecord(value)) {
    throw protocolError("Telegram document is invalid");
  }
  return {
    ...parseFile(value),
    file_name: optionalString(value, "file_name"),
    mime_type: optionalString(value, "mime_type"),
  };
}

function parseAudio(value: unknown): TelegramWireAudio {
  if (!isRecord(value)) {
    throw protocolError("Telegram audio is invalid");
  }
  return {
    ...parseDocument(value),
    duration: requiredInteger(value, "duration"),
    performer: optionalString(value, "performer"),
    title: optionalString(value, "title"),
  };
}

function parseVideo(value: unknown): TelegramWireVideo {
  if (!isRecord(value)) {
    throw protocolError("Telegram video is invalid");
  }
  return {
    ...parseDocument(value),
    duration: requiredInteger(value, "duration"),
    height: requiredInteger(value, "height"),
    width: requiredInteger(value, "width"),
  };
}

function parseVoice(value: unknown): TelegramWireVoice {
  if (!isRecord(value)) {
    throw protocolError("Telegram voice is invalid");
  }
  return {
    ...parseFile(value),
    duration: requiredInteger(value, "duration"),
    mime_type: optionalString(value, "mime_type"),
  };
}

function parseSticker(value: unknown): TelegramWireSticker {
  if (!isRecord(value)) {
    throw protocolError("Telegram sticker is invalid");
  }
  return {
    ...parseFile(value),
    custom_emoji_id: optionalString(value, "custom_emoji_id"),
    emoji: optionalString(value, "emoji"),
    height: requiredInteger(value, "height"),
    is_animated: requiredBoolean(value, "is_animated"),
    is_video: requiredBoolean(value, "is_video"),
    set_name: optionalString(value, "set_name"),
    width: requiredInteger(value, "width"),
  };
}

function parseLocation(
  value: unknown,
): TelegramWireLocation {
  if (!isRecord(value)) {
    throw protocolError("Telegram location is invalid");
  }
  return {
    heading: optionalInteger(value, "heading"),
    horizontal_accuracy: optionalNumber(
      value,
      "horizontal_accuracy",
    ),
    latitude: requiredNumber(value, "latitude"),
    live_period: optionalInteger(value, "live_period"),
    longitude: requiredNumber(value, "longitude"),
    proximity_alert_radius: optionalInteger(
      value,
      "proximity_alert_radius",
    ),
  };
}

function parseContact(value: unknown): TelegramWireContact {
  if (!isRecord(value)) {
    throw protocolError("Telegram contact is invalid");
  }
  return {
    first_name: requiredString(value, "first_name"),
    last_name: optionalString(value, "last_name"),
    phone_number: requiredString(value, "phone_number"),
    user_id: optionalInteger(value, "user_id"),
    vcard: optionalString(value, "vcard"),
  };
}

function parseMessage(
  value: unknown,
  allowReply = true,
): TelegramWireMessage {
  if (!isRecord(value)) {
    throw protocolError("Telegram message is invalid");
  }
  const photos = value.photo;
  if (photos !== undefined && !Array.isArray(photos)) {
    throw protocolError("Telegram photo list is invalid");
  }
  return {
    ...value,
    audio:
      value.audio === undefined
        ? undefined
        : parseAudio(value.audio),
    caption: optionalString(value, "caption"),
    chat: parseChat(value.chat),
    contact:
      value.contact === undefined
        ? undefined
        : parseContact(value.contact),
    date: requiredInteger(value, "date"),
    document:
      value.document === undefined
        ? undefined
        : parseDocument(value.document),
    edit_date: optionalInteger(value, "edit_date"),
    from:
      value.from === undefined
        ? undefined
        : parseUser(value.from),
    is_topic_message: optionalBoolean(
      value,
      "is_topic_message",
    ),
    location:
      value.location === undefined
        ? undefined
        : parseLocation(value.location),
    message_id: requiredInteger(value, "message_id"),
    message_thread_id: optionalInteger(
      value,
      "message_thread_id",
    ),
    photo: photos?.map(parsePhoto),
    reply_to_message:
      !allowReply || value.reply_to_message === undefined
        ? undefined
        : parseMessage(value.reply_to_message, false),
    sender_chat:
      value.sender_chat === undefined
        ? undefined
        : parseChat(value.sender_chat),
    sticker:
      value.sticker === undefined
        ? undefined
        : parseSticker(value.sticker),
    text: optionalString(value, "text"),
    video:
      value.video === undefined
        ? undefined
        : parseVideo(value.video),
    voice:
      value.voice === undefined
        ? undefined
        : parseVoice(value.voice),
  };
}

export function parseUpdates(
  value: unknown,
): readonly TelegramWireUpdate[] {
  if (!Array.isArray(value)) {
    throw protocolError("Telegram getUpdates result is invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw protocolError("Telegram update is invalid");
    }
    return {
      channel_post:
        candidate.channel_post === undefined
          ? undefined
          : parseMessage(candidate.channel_post),
      edited_channel_post:
        candidate.edited_channel_post === undefined
          ? undefined
          : parseMessage(candidate.edited_channel_post),
      edited_message:
        candidate.edited_message === undefined
          ? undefined
          : parseMessage(candidate.edited_message),
      message:
        candidate.message === undefined
          ? undefined
          : parseMessage(candidate.message),
      update_id: requiredInteger(candidate, "update_id"),
    };
  });
}

export function parseBotIdentity(
  value: unknown,
): TelegramBotIdentity {
  const user = parseUser(value);
  if (!user.is_bot || user.id <= 0) {
    throw protocolError("Telegram getMe result is not a bot");
  }
  return Object.freeze({
    canConnectToBusiness: user.can_connect_to_business,
    canJoinGroups: user.can_join_groups,
    canReadAllGroupMessages:
      user.can_read_all_group_messages,
    firstName: user.first_name,
    id: String(user.id),
    supportsInlineQueries: user.supports_inline_queries,
    username: user.username,
  });
}

export function parseSentMessage(value: unknown): {
  readonly chatId: string;
  readonly messageId: string;
  readonly occurredAt: number;
  readonly threadId?: string;
} {
  const message = parseMessage(value, false);
  return {
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    occurredAt: message.date * 1_000,
    threadId:
      message.message_thread_id === undefined
        ? undefined
        : String(message.message_thread_id),
  };
}
