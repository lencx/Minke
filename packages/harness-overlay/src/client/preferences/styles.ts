import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import PREFERENCES_SETTINGS_STYLES from "./styles.css";

export { PREFERENCES_SETTINGS_STYLES };

/** Install Personal Preferences styles and return the disposer. */
export const installPreferencesSettingsStyles = defineOverlayStyle(
  "preferences-settings",
  PREFERENCES_SETTINGS_STYLES,
);
