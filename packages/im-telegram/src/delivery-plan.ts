import {
  TELEGRAM_MAX_DELIVERY_MESSAGES,
  type TelegramDeliveryIntent,
  type TelegramSendRichMarkdownInput,
} from "./contract.ts";
import { splitTelegramRichMarkdown } from "./chunk.ts";

const COMPLETE_RESPONSE_FILE_NAME = "minke-response.md";
const COMPLETE_RESPONSE_NOTICE =
  "⚠️ This reply is too long for Telegram. The complete response is attached as `minke-response.md`.";

function richIntent(
  input: TelegramSendRichMarkdownInput,
  markdown: string,
  index: number,
): TelegramDeliveryIntent {
  return Object.freeze({
    ...input,
    allowSendingWithoutReply:
      index === 0
        ? input.allowSendingWithoutReply
        : undefined,
    kind: "rich-markdown",
    markdown,
    replyToMessageId:
      index === 0 ? input.replyToMessageId : undefined,
  });
}

/**
 * Produce the bounded, durable Telegram message plan used by both Gateway
 * preparation and direct transport callers.
 */
export function planTelegramDeliveryIntents(
  intent: TelegramDeliveryIntent,
): readonly TelegramDeliveryIntent[] {
  if (intent.kind !== "rich-markdown") {
    return Object.freeze([
      Object.freeze({ ...intent }) as TelegramDeliveryIntent,
    ]);
  }
  const chunks = splitTelegramRichMarkdown(intent.markdown);
  if (chunks.length === 0) {
    throw new TypeError(
      "Telegram Rich Markdown must not be empty",
    );
  }
  if (chunks.length <= TELEGRAM_MAX_DELIVERY_MESSAGES) {
    return Object.freeze(
      chunks.map((chunk, index) =>
        richIntent(intent, chunk, index)
      ),
    );
  }
  const visible = chunks
    .slice(0, TELEGRAM_MAX_DELIVERY_MESSAGES - 1)
    .map((chunk, index) =>
      richIntent(intent, chunk, index)
    );
  const attachment: TelegramDeliveryIntent = Object.freeze({
    allowSendingWithoutReply: undefined,
    caption: COMPLETE_RESPONSE_NOTICE,
    chatId: intent.chatId,
    disableNotification: intent.disableNotification,
    document: Object.freeze({
      bytes: new TextEncoder().encode(intent.markdown),
      fileName: COMPLETE_RESPONSE_FILE_NAME,
      kind: "bytes",
      mimeType: "text/markdown;charset=utf-8",
    }),
    kind: "document",
    messageThreadId: intent.messageThreadId,
    protectContent: intent.protectContent,
    replyToMessageId: undefined,
  });
  return Object.freeze([...visible, attachment]);
}
