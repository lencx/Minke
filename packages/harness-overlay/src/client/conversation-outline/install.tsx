import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import { ConversationOutline } from "./ConversationOutline.tsx";
import {
  conversationOutlineEn,
  conversationOutlineZh,
  type ConversationOutlineLocaleKey,
} from "./locales.ts";
import {
  installConversationOutlineStyles,
} from "./styles.ts";

const CONVERSATION_OUTLINE_NAMESPACE =
  "minke.conversationOutline";

/** Install the loaded-message outline without replacing Harness chat UI. */
export function installConversationOutline(
  ctx: HarnessClientContext,
): void {
  ctx.effect(
    () =>
      ctx.locale.register<ConversationOutlineLocaleKey>(
        CONVERSATION_OUTLINE_NAMESPACE,
        {
          zh: conversationOutlineZh,
          en: conversationOutlineEn,
        },
      ),
    "minke-overlay: conversation outline dictionaries",
  );
  ctx.effect(
    () => installConversationOutlineStyles(),
    "minke-overlay: conversation outline styles",
  );
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () =>
      ctx.slots.register(
        {
          name: "conversation.session.header.utilities",
          id: "minke-conversation-outline",
          order: -100,
          locale: CONVERSATION_OUTLINE_NAMESPACE,
        },
        ConversationOutline as ComponentType<never>,
      ),
  );
}
