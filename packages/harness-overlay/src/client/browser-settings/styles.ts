import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import BROWSER_SETTINGS_STYLES from "./styles.css";

export { BROWSER_SETTINGS_STYLES };

/** Install Browser settings styles through the shared overlay lifecycle. */
export const installBrowserSettingsStyles = defineOverlayStyle(
  "browser-settings",
  BROWSER_SETTINGS_STYLES,
);
