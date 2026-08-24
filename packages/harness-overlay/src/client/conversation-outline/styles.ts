import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import CONVERSATION_OUTLINE_STYLES from "./styles.css";

export { CONVERSATION_OUTLINE_STYLES };

/** Install the responsive conversation outline stylesheet. */
export const installConversationOutlineStyles =
  defineOverlayStyle(
    "conversation-outline",
    CONVERSATION_OUTLINE_STYLES,
  );
