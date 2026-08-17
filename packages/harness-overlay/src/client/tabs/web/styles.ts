import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/style-runtime.ts";
import WEB_TAB_STYLES from "./styles.css";

/** Install the Web tab stylesheet. */
export const installWebTabStyles = defineOverlayStyle(
  "tabs-web",
  WEB_TAB_STYLES,
);
