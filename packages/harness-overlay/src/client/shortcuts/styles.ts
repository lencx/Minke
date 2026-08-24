import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import SHORTCUT_STYLES from "./styles.css";

export { SHORTCUT_STYLES };

/** Install one plugin-owned stylesheet and return its disposer. */
export const installShortcutStyles = defineOverlayStyle(
  "shortcuts",
  SHORTCUT_STYLES,
);
