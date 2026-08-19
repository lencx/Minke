import { RadioTower } from "@lucide/icons";
import { buildLucideDataUri } from "@lucide/icons/build";
import {
  installSettingsNavigationIcon,
} from "../shared/settings-navigation.ts";
import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import REMOTE_STYLES from "./styles.css";

const REMOTE_NAV_ICON_DATA_URL = buildLucideDataUri(
  RadioTower,
  { size: 16 },
);

export const installRemoteStyles = defineOverlayStyle(
  "remote-settings",
  REMOTE_STYLES,
);

/** Keep the remote Settings navigation icon synchronized across mounts. */
export function installRemoteNavigationIcon(
  label: () => string,
): () => void {
  return installSettingsNavigationIcon(
    "data-minke-remote-nav",
    label,
    document,
    {
      "--minke-remote-nav-icon":
        `url("${REMOTE_NAV_ICON_DATA_URL}")`,
    },
  );
}
