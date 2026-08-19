import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import SESSION_HEADER_ACTION_STYLES from "./HeaderActions.css";

export { SESSION_HEADER_ACTION_STYLES };

/** Install styles shared by Minke-owned Session Header utilities. */
export const installSessionHeaderActionStyles =
  defineOverlayStyle(
    "session-header-actions",
    SESSION_HEADER_ACTION_STYLES,
  );
