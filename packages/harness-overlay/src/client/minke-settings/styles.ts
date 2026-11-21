import { defineOverlayStyle } from "../shared/style-runtime.ts";
import MINKE_SETTINGS_STYLES from "./styles.css";

/** Install the unified Minke section and secondary-tab stylesheet. */
export const installMinkeSettingsStyles = defineOverlayStyle(
  "minke-settings",
  MINKE_SETTINGS_STYLES,
);
