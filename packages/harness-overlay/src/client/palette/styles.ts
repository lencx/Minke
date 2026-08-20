import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/style-runtime.ts";
import PALETTE_STYLES from "./styles.css";

export { PALETTE_STYLES };

export const installCommandPaletteStyles = defineOverlayStyle(
  "command-palette",
  PALETTE_STYLES,
);
