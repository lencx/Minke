import { buildLucideDataUri } from "@lucide/icons/build";
import { SquareTerminal } from "@lucide/icons";
import {
  installSettingsNavigationIcon,
  reconcileSettingsNavigationIcon,
  type SettingsNavigationRoot,
} from "@minke/harness-overlay/client/settings-navigation.ts";
import {
  defineOverlayStyle,
} from "@minke/harness-overlay/client/style-runtime.ts";
import TERMINAL_SETTINGS_STYLES from "./styles.css";

const TERMINAL_SETTINGS_NAV_MARKER =
  "data-minke-terminal-settings-nav";
const TERMINAL_SETTINGS_NAV_ICON_DATA_URL = buildLucideDataUri(
  SquareTerminal,
  { size: 16 },
);
const TERMINAL_SETTINGS_NAV_ICON_VARIABLES = {
  "--minke-terminal-settings-nav-icon":
    `url("${TERMINAL_SETTINGS_NAV_ICON_DATA_URL}")`,
} as const;

export { TERMINAL_SETTINGS_STYLES };

/** Mark the localized Terminal settings row for its product icon. */
export function reconcileTerminalSettingsNavigationIcon(
  root: SettingsNavigationRoot,
  label: string,
): void {
  reconcileSettingsNavigationIcon(
    root,
    TERMINAL_SETTINGS_NAV_MARKER,
    label,
  );
}

/** Keep the Terminal settings navigation icon synced across modal mounts. */
export function installTerminalSettingsNavigationIcon(
  label: () => string,
  root: SettingsNavigationRoot = document,
): () => void {
  return installSettingsNavigationIcon(
    TERMINAL_SETTINGS_NAV_MARKER,
    label,
    root,
    TERMINAL_SETTINGS_NAV_ICON_VARIABLES,
  );
}

/** Install the Terminal settings stylesheet and return its disposer. */
export const installTerminalSettingsStyles = defineOverlayStyle(
  "terminal-settings",
  TERMINAL_SETTINGS_STYLES,
);
