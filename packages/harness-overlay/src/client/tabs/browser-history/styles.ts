import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import BROWSER_HISTORY_STYLES from "./styles.css";

export { BROWSER_HISTORY_STYLES };

export const installBrowserHistoryStyles = defineOverlayStyle(
  "tabs-browser-history",
  BROWSER_HISTORY_STYLES,
);
