import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import FILES_TAB_STYLES from "./styles.css";

export { FILES_TAB_STYLES };

/** Install the Files tab stylesheet. */
export const installFilesTabStyles = defineOverlayStyle(
  "tabs-files",
  FILES_TAB_STYLES,
);
