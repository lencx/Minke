import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import REMOTE_HUB_STYLES from "./styles.css";

/** Install the Remote Hub surface styles through the shared style owner. */
export const installRemoteHubStyles = defineOverlayStyle(
  "remote-hub",
  REMOTE_HUB_STYLES,
);
