import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import REMOTE_STYLES from "./styles.css";

export const installRemoteStyles = defineOverlayStyle(
  "remote-settings",
  REMOTE_STYLES,
);
