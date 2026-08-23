/**
 * Internal Weixin wire shapes.
 *
 * Reimplemented from @tencent-weixin/openclaw-weixin@2.4.6 (MIT).
 * These types are intentionally not exported from the package interface.
 */

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: {
    message_item?: MessageItem;
    title?: string;
  };
  text_item?: {
    text?: string;
  };
  image_item?: {
    media?: CdnMedia;
    thumb_media?: CdnMedia;
    aeskey?: string;
    url?: string;
    mid_size?: number;
    thumb_size?: number;
    thumb_height?: number;
    thumb_width?: number;
    hd_size?: number;
  };
  voice_item?: {
    media?: CdnMedia;
    encode_type?: number;
    bits_per_sample?: number;
    sample_rate?: number;
    playtime?: number;
    text?: string;
  };
  file_item?: {
    media?: CdnMedia;
    file_name?: string;
    md5?: string;
    len?: string;
  };
  video_item?: {
    media?: CdnMedia;
    video_size?: number;
    play_length?: number;
    video_md5?: string;
    thumb_media?: CdnMedia;
    thumb_size?: number;
    thumb_height?: number;
    thumb_width?: number;
  };
  tool_call_start_item?: {
    tool_name?: string;
    tool_call_id?: string;
  };
  tool_call_result_item?: {
    tool_name?: string;
    tool_call_id?: string;
    status?: string;
  };
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  run_id?: string;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageRequest {
  msg: WeixinMessage;
}

export interface GetUploadUrlResponse {
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

export interface GetConfigResponse {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export type LoginWireStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface LoginStatusResponse {
  status: LoginWireStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
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

export function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
