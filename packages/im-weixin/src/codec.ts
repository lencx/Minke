import { createHash } from "node:crypto";
import {
  WeixinTransportError,
  type WeixinAttachmentKind,
  type WeixinInboundAttachment,
  type WeixinInboundMessage,
  type WeixinInboundMessageState,
  type WeixinInboundMessageType,
  type WeixinInboundReference,
  type WeixinItemKind,
  type WeixinToolProgress,
  type WeixinVoiceCodec,
} from "./contract.ts";
import {
  MessageItemType,
  MessageType,
  type CdnMedia,
  type GetConfigResponse,
  type GetUpdatesResponse,
  type LoginStatusResponse,
  type LoginWireStatus,
  type MessageItem,
  type QrCodeResponse,
  type WeixinMessage,
  isRecord,
  optionalNumber,
  optionalString,
} from "./protocol.ts";

const LOGIN_STATUSES = new Set<LoginWireStatus>([
  "wait",
  "scaned",
  "confirmed",
  "expired",
  "scaned_but_redirect",
  "need_verifycode",
  "verify_code_blocked",
  "binded_redirect",
]);
const MAX_QUOTED_MESSAGE_DEPTH = 2;

function protocolError(message: string): WeixinTransportError {
  return new WeixinTransportError("protocol", message);
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function parseCdnMedia(
  value: unknown,
): CdnMedia | undefined {
  if (!isRecord(value)) return undefined;
  return {
    encrypt_query_param: optionalString(value, "encrypt_query_param"),
    aes_key: optionalString(value, "aes_key"),
    encrypt_type: optionalNumber(value, "encrypt_type"),
    full_url: optionalString(value, "full_url"),
  };
}

function parseMessageItem(
  value: unknown,
  depth = 0,
): MessageItem {
  if (!isRecord(value)) {
    throw protocolError("Weixin message item is not an object");
  }

  const refRecord = optionalRecord(value, "ref_msg");
  const image = optionalRecord(value, "image_item");
  const voice = optionalRecord(value, "voice_item");
  const file = optionalRecord(value, "file_item");
  const video = optionalRecord(value, "video_item");
  const text = optionalRecord(value, "text_item");
  const toolStart = optionalRecord(value, "tool_call_start_item");
  const toolResult = optionalRecord(value, "tool_call_result_item");
  const refItem = refRecord?.message_item;

  return {
    type: optionalNumber(value, "type"),
    create_time_ms: optionalNumber(value, "create_time_ms"),
    update_time_ms: optionalNumber(value, "update_time_ms"),
    is_completed:
      typeof value.is_completed === "boolean"
        ? value.is_completed
        : undefined,
    msg_id: optionalString(value, "msg_id"),
    ref_msg:
      refRecord === undefined
        ? undefined
        : {
            title: optionalString(refRecord, "title"),
            message_item:
              refItem === undefined ||
              depth >= MAX_QUOTED_MESSAGE_DEPTH
                ? undefined
                : parseMessageItem(refItem, depth + 1),
          },
    text_item:
      text === undefined
        ? undefined
        : { text: optionalString(text, "text") },
    image_item:
      image === undefined
        ? undefined
        : {
            media: parseCdnMedia(image.media),
            thumb_media: parseCdnMedia(image.thumb_media),
            aeskey: optionalString(image, "aeskey"),
            url: optionalString(image, "url"),
            mid_size: optionalNumber(image, "mid_size"),
            thumb_size: optionalNumber(image, "thumb_size"),
            thumb_height: optionalNumber(image, "thumb_height"),
            thumb_width: optionalNumber(image, "thumb_width"),
            hd_size: optionalNumber(image, "hd_size"),
          },
    voice_item:
      voice === undefined
        ? undefined
        : {
            media: parseCdnMedia(voice.media),
            encode_type: optionalNumber(voice, "encode_type"),
            bits_per_sample: optionalNumber(voice, "bits_per_sample"),
            sample_rate: optionalNumber(voice, "sample_rate"),
            playtime: optionalNumber(voice, "playtime"),
            text: optionalString(voice, "text"),
          },
    file_item:
      file === undefined
        ? undefined
        : {
            media: parseCdnMedia(file.media),
            file_name: optionalString(file, "file_name"),
            md5: optionalString(file, "md5"),
            len: optionalString(file, "len"),
          },
    video_item:
      video === undefined
        ? undefined
        : {
            media: parseCdnMedia(video.media),
            video_size: optionalNumber(video, "video_size"),
            play_length: optionalNumber(video, "play_length"),
            video_md5: optionalString(video, "video_md5"),
            thumb_media: parseCdnMedia(video.thumb_media),
            thumb_size: optionalNumber(video, "thumb_size"),
            thumb_height: optionalNumber(video, "thumb_height"),
            thumb_width: optionalNumber(video, "thumb_width"),
          },
    tool_call_start_item:
      toolStart === undefined
        ? undefined
        : {
            tool_name: optionalString(toolStart, "tool_name"),
            tool_call_id: optionalString(
              toolStart,
              "tool_call_id",
            ),
          },
    tool_call_result_item:
      toolResult === undefined
        ? undefined
        : {
            tool_name: optionalString(toolResult, "tool_name"),
            tool_call_id: optionalString(
              toolResult,
              "tool_call_id",
            ),
            status: optionalString(toolResult, "status"),
          },
  };
}

function parseMessage(value: unknown): WeixinMessage {
  if (!isRecord(value)) {
    throw protocolError("Weixin message is not an object");
  }
  const itemList = value.item_list;
  if (itemList !== undefined && !Array.isArray(itemList)) {
    throw protocolError("Weixin message item_list is not an array");
  }
  return {
    seq: optionalNumber(value, "seq"),
    message_id: optionalNumber(value, "message_id"),
    from_user_id: optionalString(value, "from_user_id"),
    to_user_id: optionalString(value, "to_user_id"),
    client_id: optionalString(value, "client_id"),
    create_time_ms: optionalNumber(value, "create_time_ms"),
    update_time_ms: optionalNumber(value, "update_time_ms"),
    delete_time_ms: optionalNumber(value, "delete_time_ms"),
    session_id: optionalString(value, "session_id"),
    group_id: optionalString(value, "group_id"),
    message_type: optionalNumber(value, "message_type"),
    message_state: optionalNumber(value, "message_state"),
    item_list: itemList?.map((item) => parseMessageItem(item)),
    context_token: optionalString(value, "context_token"),
    run_id: optionalString(value, "run_id"),
  };
}

export function parseQrCodeResponse(value: unknown): QrCodeResponse {
  if (!isRecord(value)) throw protocolError("Weixin QR response is invalid");
  const qrcode = optionalString(value, "qrcode");
  const content = optionalString(value, "qrcode_img_content");
  if (!qrcode?.trim() || !content?.trim()) {
    throw protocolError("Weixin QR response omitted its challenge");
  }
  return { qrcode, qrcode_img_content: content };
}

export function parseLoginStatusResponse(
  value: unknown,
): LoginStatusResponse {
  if (!isRecord(value)) {
    throw protocolError("Weixin login response is invalid");
  }
  const status = optionalString(value, "status");
  if (
    status === undefined ||
    !LOGIN_STATUSES.has(status as LoginWireStatus)
  ) {
    throw protocolError("Weixin login response has an unknown status");
  }
  return {
    status: status as LoginWireStatus,
    bot_token: optionalString(value, "bot_token"),
    ilink_bot_id: optionalString(value, "ilink_bot_id"),
    baseurl: optionalString(value, "baseurl"),
    ilink_user_id: optionalString(value, "ilink_user_id"),
    redirect_host: optionalString(value, "redirect_host"),
  };
}

export function parseGetUpdatesResponse(
  value: unknown,
): GetUpdatesResponse {
  if (!isRecord(value)) {
    throw protocolError("Weixin getUpdates response is invalid");
  }
  if (value.msgs !== undefined && !Array.isArray(value.msgs)) {
    throw protocolError("Weixin getUpdates msgs is not an array");
  }
  return {
    ret: optionalNumber(value, "ret"),
    errcode: optionalNumber(value, "errcode"),
    errmsg: optionalString(value, "errmsg"),
    msgs: value.msgs?.map((message) => parseMessage(message)),
    get_updates_buf: optionalString(value, "get_updates_buf"),
    longpolling_timeout_ms: optionalNumber(
      value,
      "longpolling_timeout_ms",
    ),
  };
}

export function parseGetConfigResponse(
  value: unknown,
): GetConfigResponse {
  if (!isRecord(value)) {
    throw protocolError("Weixin getConfig response is invalid");
  }
  return {
    ret: optionalNumber(value, "ret"),
    errmsg: optionalString(value, "errmsg"),
    typing_ticket: optionalString(value, "typing_ticket"),
  };
}

export function parseRetResponse(
  value: unknown,
  label: string,
): { readonly ret?: number } {
  if (!isRecord(value)) {
    throw protocolError(`Weixin ${label} response is invalid`);
  }
  return { ret: optionalNumber(value, "ret") };
}

export function parseGetUploadUrlResponse(value: unknown): {
  readonly uploadFullUrl?: string;
  readonly uploadParam?: string;
  readonly ret?: number;
} {
  if (!isRecord(value)) {
    throw protocolError("Weixin getUploadUrl response is invalid");
  }
  return {
    uploadFullUrl: optionalString(value, "upload_full_url"),
    uploadParam: optionalString(value, "upload_param"),
    ret: optionalNumber(value, "ret"),
  };
}

function messageId(message: WeixinMessage): string {
  if (message.message_id !== undefined) {
    return `weixin:message:${String(message.message_id)}`;
  }
  const clientId = message.client_id?.trim();
  if (clientId) return `weixin:client:${clientId}`;
  const itemId = message.item_list
    ?.map((item) => item.msg_id?.trim())
    .find((value) => Boolean(value));
  if (itemId) return `weixin:item:${itemId}`;
  if (message.seq !== undefined) {
    return [
      "weixin:seq",
      String(message.seq),
      message.from_user_id ?? "",
      message.session_id ?? "",
    ].join(":");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");
  return `weixin:digest:${digest}`;
}

function inboundMessageType(value: number | undefined): WeixinInboundMessageType {
  if (value === MessageType.USER) return "user";
  if (value === MessageType.BOT) return "bot";
  return "unknown";
}

function mimeFromFilename(filename: string | undefined): string {
  const extension = filename
    ?.toLowerCase()
    .match(/(\.[a-z0-9]+)$/u)?.[1];
  const known: Readonly<Record<string, string>> = {
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".gz": "application/gzip",
    ".avi": "video/x-msvideo",
    ".bmp": "image/bmp",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".tar": "application/x-tar",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  };
  return extension === undefined
    ? "application/octet-stream"
    : known[extension] ?? "application/octet-stream";
}

function voiceCodec(
  encodeType: number | undefined,
): {
  readonly codec: WeixinVoiceCodec;
  readonly mimeType: string;
} {
  switch (encodeType) {
    case 1:
      return { codec: "pcm", mimeType: "audio/pcm" };
    case 2:
      return { codec: "adpcm", mimeType: "audio/adpcm" };
    case 3:
      return {
        codec: "feature",
        mimeType: "application/octet-stream",
      };
    case 4:
      return { codec: "speex", mimeType: "audio/speex" };
    case 5:
      return { codec: "amr", mimeType: "audio/amr" };
    case 6:
      return { codec: "silk", mimeType: "audio/silk" };
    case 7:
      return { codec: "mp3", mimeType: "audio/mpeg" };
    case 8:
      return { codec: "ogg-speex", mimeType: "audio/ogg" };
    default:
      return {
        codec: "unknown",
        mimeType: "application/octet-stream",
      };
  }
}

function nonnegativeSafeInteger(
  value: number | undefined,
): number | undefined {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function decimalSize(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function imageAesKey(item: MessageItem): string | undefined {
  const hex = item.image_item?.aeskey?.trim();
  if (hex && /^[0-9a-f]{32}$/iu.test(hex)) {
    return Buffer.from(hex, "hex").toString("base64");
  }
  return item.image_item?.media?.aes_key;
}

function attachmentFromItem(
  messageIdValue: string,
  item: MessageItem,
  index: string,
  quoted: boolean,
): WeixinInboundAttachment | undefined {
  let aesKey: string | undefined;
  let encryptedQueryParam: string | undefined;
  let fileName: string | undefined;
  let fullUrl: string | undefined;
  let kind: WeixinAttachmentKind;
  let mimeType: string;
  let size: number | undefined;
  let audio: WeixinInboundAttachment["audio"];

  switch (item.type) {
    case MessageItemType.IMAGE:
      kind = "image";
      mimeType = "image/*";
      aesKey = imageAesKey(item);
      encryptedQueryParam =
        item.image_item?.media?.encrypt_query_param;
      fullUrl = item.image_item?.media?.full_url;
      size =
        item.image_item?.hd_size ??
        item.image_item?.mid_size;
      break;
    case MessageItemType.VOICE:
      kind = "voice";
      {
        const encoding = voiceCodec(item.voice_item?.encode_type);
        mimeType = encoding.mimeType;
        audio = {
          bitsPerSample: nonnegativeSafeInteger(
            item.voice_item?.bits_per_sample,
          ),
          codec: encoding.codec,
          durationMs: nonnegativeSafeInteger(
            item.voice_item?.playtime,
          ),
          encodeType: nonnegativeSafeInteger(
            item.voice_item?.encode_type,
          ),
          sampleRateHz: nonnegativeSafeInteger(
            item.voice_item?.sample_rate,
          ),
        };
      }
      aesKey = item.voice_item?.media?.aes_key;
      encryptedQueryParam =
        item.voice_item?.media?.encrypt_query_param;
      fullUrl = item.voice_item?.media?.full_url;
      break;
    case MessageItemType.FILE: {
      kind = "file";
      fileName = item.file_item?.file_name;
      mimeType = mimeFromFilename(fileName);
      aesKey = item.file_item?.media?.aes_key;
      encryptedQueryParam =
        item.file_item?.media?.encrypt_query_param;
      fullUrl = item.file_item?.media?.full_url;
      size = decimalSize(item.file_item?.len);
      break;
    }
    case MessageItemType.VIDEO:
      kind = "video";
      mimeType = "video/mp4";
      aesKey = item.video_item?.media?.aes_key;
      encryptedQueryParam =
        item.video_item?.media?.encrypt_query_param;
      fullUrl = item.video_item?.media?.full_url;
      size = item.video_item?.video_size;
      break;
    default:
      return undefined;
  }

  if (!encryptedQueryParam && !fullUrl) return undefined;
  return {
    id: `${messageIdValue}:attachment:${index}`,
    kind,
    ...(audio === undefined ? {} : { audio }),
    fileName,
    mimeType,
    size,
    quoted,
    media: {
      aesKey,
      encryptedQueryParam,
      fullUrl,
    },
  };
}

function textFromItem(item: MessageItem): string | undefined {
  if (
    item.type === MessageItemType.TEXT &&
    item.text_item?.text !== undefined
  ) {
    return item.text_item.text;
  }
  if (
    item.type === MessageItemType.VOICE &&
    item.voice_item?.text
  ) {
    return item.voice_item.text;
  }
  return undefined;
}

function itemKind(item: MessageItem): WeixinItemKind {
  switch (item.type) {
    case MessageItemType.TEXT:
      return "text";
    case MessageItemType.IMAGE:
      return "image";
    case MessageItemType.VOICE:
      return "voice";
    case MessageItemType.FILE:
      return "file";
    case MessageItemType.VIDEO:
      return "video";
    case MessageItemType.TOOL_CALL_START:
      return "tool-call-start";
    case MessageItemType.TOOL_CALL_RESULT:
      return "tool-call-result";
    default:
      return "unknown";
  }
}

function inboundState(
  value: number | undefined,
): WeixinInboundMessageState {
  if (value === 0) return "new";
  if (value === 1) return "generating";
  if (value === 2) return "finished";
  return "unknown";
}

function toolProgressFromItem(
  item: MessageItem,
): WeixinToolProgress | undefined {
  if (item.type === MessageItemType.TOOL_CALL_START) {
    return {
      completed: item.is_completed ?? false,
      createdAt: item.create_time_ms,
      itemId: item.msg_id,
      kind: "start",
      status: undefined,
      toolCallId: item.tool_call_start_item?.tool_call_id,
      toolName: item.tool_call_start_item?.tool_name,
      updatedAt: item.update_time_ms,
    };
  }
  if (item.type === MessageItemType.TOOL_CALL_RESULT) {
    return {
      completed: item.is_completed ?? true,
      createdAt: item.create_time_ms,
      itemId: item.msg_id,
      kind: "result",
      status: item.tool_call_result_item?.status,
      toolCallId: item.tool_call_result_item?.tool_call_id,
      toolName: item.tool_call_result_item?.tool_name,
      updatedAt: item.update_time_ms,
    };
  }
  return undefined;
}

function inboundReference(
  messageIdValue: string,
  item: MessageItem,
  index: number,
): WeixinInboundReference | undefined {
  const reference = item.ref_msg;
  if (reference === undefined) return undefined;
  const referencedItem = reference.message_item;
  const quotedAttachment =
    referencedItem === undefined
      ? undefined
      : attachmentFromItem(
          messageIdValue,
          referencedItem,
          `${String(index)}:quoted`,
          true,
        );
  return {
    attachmentIds: Object.freeze(
      quotedAttachment === undefined
        ? []
        : [quotedAttachment.id],
    ),
    itemId: referencedItem?.msg_id,
    kind:
      referencedItem === undefined
        ? "unknown"
        : itemKind(referencedItem),
    text:
      referencedItem === undefined
        ? undefined
        : textFromItem(referencedItem),
    title: reference.title,
  };
}

export function normalizeInboundMessage(
  message: WeixinMessage,
): WeixinInboundMessage {
  const id = messageId(message);
  const senderId = message.from_user_id?.trim() ?? "";
  const recipientId = message.to_user_id?.trim() ?? "";
  const groupId = message.group_id?.trim() || undefined;
  const sessionId = message.session_id?.trim() || undefined;
  const text = (message.item_list ?? [])
    .map((item) => textFromItem(item))
    .filter((value): value is string => value !== undefined)
    .join("\n");
  const attachments = (message.item_list ?? []).flatMap(
    (item, index) => {
      const values: WeixinInboundAttachment[] = [];
      const current = attachmentFromItem(
        id,
        item,
        String(index),
        false,
      );
      if (current !== undefined) values.push(current);
      if (item.ref_msg?.message_item !== undefined) {
        const quoted = attachmentFromItem(
          id,
          item.ref_msg.message_item,
          `${String(index)}:quoted`,
          true,
        );
        if (quoted !== undefined) values.push(quoted);
      }
      return values;
    },
  );
  const references = (message.item_list ?? [])
    .map((item, index) => inboundReference(id, item, index))
    .filter(
      (value): value is WeixinInboundReference =>
        value !== undefined,
    );
  const toolProgress = (message.item_list ?? [])
    .map(toolProgressFromItem)
    .filter(
      (value): value is WeixinToolProgress =>
        value !== undefined,
    );
  const supportedItemTypes = new Set<number>([
    MessageItemType.TEXT,
    MessageItemType.IMAGE,
    MessageItemType.VOICE,
    MessageItemType.FILE,
    MessageItemType.VIDEO,
    MessageItemType.TOOL_CALL_START,
    MessageItemType.TOOL_CALL_RESULT,
  ]);
  const unsupportedItemTypes = [
    ...new Set(
      (message.item_list ?? [])
        .map((item) => item.type)
        .filter(
          (type): type is number =>
            type !== undefined && !supportedItemTypes.has(type),
        ),
    ),
  ];
  const contextToken =
    message.context_token?.trim()
      ? message.context_token
      : undefined;

  const messageType = inboundMessageType(message.message_type);
  const conversationId =
    groupId ??
    (messageType === "bot"
      ? recipientId || senderId
      : senderId || recipientId);

  return {
    id,
    clientId: message.client_id,
    senderId,
    recipientId,
    conversationId,
    groupId,
    sessionId,
    messageType,
    state: inboundState(message.message_state),
    createdAt: message.create_time_ms,
    updatedAt: message.update_time_ms,
    deletedAt: message.delete_time_ms,
    text,
    attachments: Object.freeze(attachments),
    references: Object.freeze(references),
    toolProgress: Object.freeze(toolProgress),
    unsupportedItemTypes: Object.freeze(unsupportedItemTypes),
    replyContext:
      messageType === "user" && contextToken && senderId
        ? {
            contextToken,
            recipientId: senderId,
          }
        : undefined,
    runId: message.run_id,
  };
}
