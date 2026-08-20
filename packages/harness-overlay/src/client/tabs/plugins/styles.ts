import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import PLUGIN_STYLES from "./styles.css";

export { PLUGIN_STYLES };

/** Install the command-and-browser Plugins tab stylesheet. */
export const installPluginStyles = defineOverlayStyle(
  "tabs-plugins",
  PLUGIN_STYLES,
);
