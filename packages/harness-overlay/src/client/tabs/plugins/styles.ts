import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import PLUGIN_STYLES from "./styles.css";

export { PLUGIN_STYLES };

/** Install desktop plugin recovery styles inside DSH's Plugins page. */
export const installPluginStyles = defineOverlayStyle(
  "tabs-plugins",
  PLUGIN_STYLES,
);
