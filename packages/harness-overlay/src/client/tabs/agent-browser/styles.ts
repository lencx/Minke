import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import AGENT_BROWSER_TAB_STYLES from "./styles.css";

export const installAgentBrowserTabStyles = defineOverlayStyle(
  "tabs-agent-browser",
  AGENT_BROWSER_TAB_STYLES,
);
