import XTERM_STYLES from "@xterm/xterm/css/xterm.css";
import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import TERMINAL_TAB_STYLES from "./styles.css";

export { TERMINAL_TAB_STYLES };

/** Install xterm and Minke's Terminal tab styles as one capability. */
export const installTerminalTabStyles = defineOverlayStyle(
  "tabs-terminal",
  [XTERM_STYLES, TERMINAL_TAB_STYLES],
);
