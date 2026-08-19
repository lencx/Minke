import { buildLucideDataUri } from "@lucide/icons/build";
import { Keyboard } from "@lucide/icons";
import {
  installSettingsNavigationIcon,
  reconcileSettingsNavigationIcon,
  type SettingsNavigationRoot,
} from "../shared/settings-navigation.ts";
import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import SHORTCUT_STYLES from "./styles.css";

const SHORTCUT_NAV_ICON_DATA_URL = buildLucideDataUri(Keyboard, {
  size: 16,
});
const SHORTCUT_NAV_ICON_VARIABLES = {
  "--minke-shortcuts-nav-icon":
    `url("${SHORTCUT_NAV_ICON_DATA_URL}")`,
} as const;
const SHORTCUT_NAV_MARKER = "data-minke-shortcuts-nav";

export { SHORTCUT_STYLES };

/**
 * Mark the localized shortcuts navigation row without depending on its order
 * or on Harness's private CSS-module class names.
 */
export function reconcileShortcutNavigationIcon(
  root: SettingsNavigationRoot,
  label: string,
): void {
  reconcileSettingsNavigationIcon(root, SHORTCUT_NAV_MARKER, label);
}

/**
 * Adapt the upstream settings shell until its section contract accepts icons.
 * The observer follows modal mounts and locale-driven label changes.
 */
export function installShortcutNavigationIcon(
  label: () => string,
  root: SettingsNavigationRoot = document,
): () => void {
  return installSettingsNavigationIcon(
    SHORTCUT_NAV_MARKER,
    label,
    root,
    SHORTCUT_NAV_ICON_VARIABLES,
  );
}

/** Install one plugin-owned stylesheet and return its disposer. */
export const installShortcutStyles = defineOverlayStyle(
  "shortcuts",
  SHORTCUT_STYLES,
);
