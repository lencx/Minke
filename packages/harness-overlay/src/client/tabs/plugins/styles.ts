import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import PLUGIN_CATALOG_STYLES from "./styles.css";

export { PLUGIN_CATALOG_STYLES };

/** Install the local plugin catalog stylesheet. */
export const installPluginCatalogStyles = defineOverlayStyle(
  "tabs-plugin-catalog",
  PLUGIN_CATALOG_STYLES,
);
