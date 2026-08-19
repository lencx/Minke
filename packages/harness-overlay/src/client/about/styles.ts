import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import ABOUT_STYLES from "./styles.css";

export { ABOUT_STYLES };

/** Install the About action and dialog stylesheet. */
export const installAboutStyles = defineOverlayStyle(
  "about",
  ABOUT_STYLES,
);
