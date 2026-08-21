import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import DETAILS_TAB_STYLES from "./styles.css";

export { DETAILS_TAB_STYLES };

export const installDetailsTabStyles = defineOverlayStyle(
  "tabs-details",
  DETAILS_TAB_STYLES,
);
