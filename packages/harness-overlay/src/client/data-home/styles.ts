import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import DATA_HOME_STYLES from "./styles.css";

export { DATA_HOME_STYLES };

/** Install the data-home Settings stylesheet. */
export const installDataHomeStyles = defineOverlayStyle(
  "data-home-settings",
  DATA_HOME_STYLES,
);
