import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import TABS_STYLES from "./styles.css";

export { TABS_STYLES };

/** Install the shared tabs surface stylesheet. */
export const installTabsStyles = defineOverlayStyle(
  "tabs",
  TABS_STYLES,
);
