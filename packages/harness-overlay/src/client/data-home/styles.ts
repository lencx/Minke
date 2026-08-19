import { DatabaseBackup } from "@lucide/icons";
import { buildLucideDataUri } from "@lucide/icons/build";
import {
  installSettingsNavigationIcon,
  reconcileSettingsNavigationIcon,
  type SettingsNavigationRoot,
} from "@minke/harness-overlay/client/shared/settings-navigation.ts";
import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import DATA_HOME_STYLES from "./styles.css";

const DATA_HOME_NAV_MARKER = "data-minke-data-home-nav";
const DATA_HOME_NAV_ICON_DATA_URL = buildLucideDataUri(
  DatabaseBackup,
  { size: 16 },
);
const DATA_HOME_NAV_ICON_VARIABLES = {
  "--minke-data-home-nav-icon":
    `url("${DATA_HOME_NAV_ICON_DATA_URL}")`,
} as const;

export { DATA_HOME_STYLES };

/** Mark the localized data-home Settings row for its product icon. */
export function reconcileDataHomeNavigationIcon(
  root: SettingsNavigationRoot,
  label: string,
): void {
  reconcileSettingsNavigationIcon(
    root,
    DATA_HOME_NAV_MARKER,
    label,
  );
}

/** Keep the data-home Settings icon synchronized across modal mounts. */
export function installDataHomeNavigationIcon(
  label: () => string,
  root: SettingsNavigationRoot = document,
): () => void {
  return installSettingsNavigationIcon(
    DATA_HOME_NAV_MARKER,
    label,
    root,
    DATA_HOME_NAV_ICON_VARIABLES,
  );
}

/** Install the data-home Settings stylesheet. */
export const installDataHomeStyles = defineOverlayStyle(
  "data-home-settings",
  DATA_HOME_STYLES,
);
