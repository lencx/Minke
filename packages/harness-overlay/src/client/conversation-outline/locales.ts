export const conversationOutlineZh = {
  label: "对话目录",
  messagePosition: "已加载消息 {index} / {total}",
  messageAction:
    "跳转到第 {index} 条已加载消息，共 {total} 条",
  image: "[图片]",
  nonText: "[非文本消息]",
  historyIncomplete: "更早的消息尚未加载",
} as const;

export type ConversationOutlineLocaleKey =
  keyof typeof conversationOutlineZh;

export type ConversationOutlineTranslate = (
  key: ConversationOutlineLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const conversationOutlineEn: Record<
  ConversationOutlineLocaleKey,
  string
> = {
  label: "Conversation outline",
  messagePosition: "Loaded message {index} of {total}",
  messageAction:
    "Jump to loaded message {index} of {total}",
  image: "[Image]",
  nonText: "[Non-text message]",
  historyIncomplete: "Earlier messages have not been loaded",
};
