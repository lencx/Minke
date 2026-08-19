import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import LOCAL_MODEL_SETTINGS_STYLES from "./styles.css";

export { LOCAL_MODEL_SETTINGS_STYLES };

/** Install the Local Models settings stylesheet. */
export const installLocalModelSettingsStyles =
  defineOverlayStyle(
    "local-model-settings",
    LOCAL_MODEL_SETTINGS_STYLES,
  );
