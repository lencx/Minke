import { buildLucideDataUri } from "@lucide/icons/build";
import { Palette } from "@lucide/icons";
import {
  installSettingsNavigationIcon,
  reconcileSettingsNavigationIcon,
  type SettingsNavigationRoot,
} from "@minke/harness-overlay/client/shared/settings-navigation.ts";
import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";
import PREFERENCES_SETTINGS_STYLES from "./styles.css";

const PREFERENCES_NAV_MARKER =
  "data-minke-preferences-nav";
const PREFERENCES_NAV_ICON_DATA_URL = buildLucideDataUri(
  Palette,
  { size: 16 },
);
const PREFERENCES_NAV_ICON_VARIABLES = {
  "--minke-preferences-nav-icon":
    `url("${PREFERENCES_NAV_ICON_DATA_URL}")`,
} as const;

export { PREFERENCES_SETTINGS_STYLES };

/** Mark the localized Personal Preferences row for its product icon. */
export function reconcilePreferencesNavigationIcon(
  root: SettingsNavigationRoot,
  label: string,
): void {
  reconcileSettingsNavigationIcon(
    root,
    PREFERENCES_NAV_MARKER,
    label,
  );
}

/** Keep the Personal Preferences icon synced across modal mounts. */
export function installPreferencesNavigationIcon(
  label: () => string,
  root: SettingsNavigationRoot = document,
): () => void {
  return installSettingsNavigationIcon(
    PREFERENCES_NAV_MARKER,
    label,
    root,
    PREFERENCES_NAV_ICON_VARIABLES,
  );
}

/** Install Personal Preferences styles and return the disposer. */
export const installPreferencesSettingsStyles = defineOverlayStyle(
  "preferences-settings",
  PREFERENCES_SETTINGS_STYLES,
);
