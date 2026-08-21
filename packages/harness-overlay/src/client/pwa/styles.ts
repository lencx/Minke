import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import PWA_STYLES from "./styles.css";

export { PWA_STYLES };

export const installPwaStyles = defineOverlayStyle(
  "pwa",
  PWA_STYLES,
);
