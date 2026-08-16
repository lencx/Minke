import { buildLucideDataUri } from "@lucide/icons/build";
import SquareTerminal from "@lucide/icons/icons/square-terminal";
import {
  installSettingsNavigationIcon,
  reconcileSettingsNavigationIcon,
  type SettingsNavigationRoot,
} from "../../../settings-navigation.ts";

const TERMINAL_SETTINGS_NAV_MARKER =
  "data-minke-terminal-settings-nav";
const TERMINAL_SETTINGS_NAV_ICON_DATA_URL = buildLucideDataUri(
  SquareTerminal,
  { size: 16 },
);

export const TERMINAL_SETTINGS_STYLES = `
[data-minke-terminal-settings-nav] > svg:first-child {
  display: none !important;
}
[data-minke-terminal-settings-nav]::before {
  --minke-terminal-settings-nav-icon: url("${TERMINAL_SETTINGS_NAV_ICON_DATA_URL}");
  content: "";
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--minke-terminal-settings-nav-icon) center / 16px 16px no-repeat;
  mask: var(--minke-terminal-settings-nav-icon) center / 16px 16px no-repeat;
}
.minke-terminal-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 620px;
  color: var(--dsw-alias-label-primary);
}
.minke-terminal-settings ::selection {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.minke-terminal-settings__intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.minke-terminal-settings__title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.minke-terminal-settings__description,
.minke-terminal-settings__help {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.minke-terminal-settings__error,
.minke-terminal-settings__validation {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.minke-terminal-settings__error {
  margin: 0;
}
.minke-terminal-settings__fields {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.minke-terminal-settings__row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 280px);
  align-items: center;
  gap: 24px;
  min-height: 76px;
  padding: 12px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.minke-terminal-settings__copy,
.minke-terminal-settings__control {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.minke-terminal-settings__copy {
  gap: 2px;
}
.minke-terminal-settings__control {
  align-items: flex-end;
  gap: 4px;
}
.minke-terminal-settings__label {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.minke-terminal-settings__input {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  padding: 7px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  outline: none;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  transition:
    border-color 120ms ease-out,
    background-color 120ms ease-out;
}
.minke-terminal-settings__input::placeholder {
  color: var(--dsw-alias-label-tertiary);
  opacity: 1;
}
.minke-terminal-settings__input:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l1);
}
.minke-terminal-settings__input:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  outline: 2px solid
    color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent);
  outline-offset: 1px;
}
.minke-terminal-settings__input[aria-invalid="true"] {
  border-color: var(--dsw-alias-state-error-primary);
}
.minke-terminal-settings__input:disabled {
  cursor: default;
  opacity: 0.45;
}
.minke-terminal-settings__input--number {
  width: 128px;
  font-family: var(--ds-font-family-code);
  font-variant-numeric: tabular-nums;
}
.minke-terminal-settings__validation {
  width: 100%;
}
.minke-terminal-settings__preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
}
.minke-terminal-settings__preview-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.minke-terminal-settings__preview-code {
  display: flex;
  flex-direction: column;
  min-height: 44px;
  overflow-x: auto;
  color: var(--dsw-alias-label-primary);
  white-space: pre;
}
.minke-terminal-settings__preview-code > span:first-child {
  color: var(--dsw-alias-label-secondary);
}
.minke-terminal-settings__footer {
  display: flex;
  justify-content: flex-end;
}
.minke-terminal-settings__reset {
  box-sizing: border-box;
  min-height: 34px;
  padding: 6px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 17px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 120ms ease-out;
}
.minke-terminal-settings__reset:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.minke-terminal-settings__reset:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.minke-terminal-settings__reset:disabled {
  cursor: default;
  opacity: 0.45;
}
@media (max-width: 720px) {
  .minke-terminal-settings__row {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 14px 0;
  }
  .minke-terminal-settings__control {
    align-items: stretch;
  }
  .minke-terminal-settings__input--number {
    width: 100%;
  }
}
`;

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
  );
}

/** Install the Terminal settings stylesheet and return its disposer. */
export function installTerminalSettingsStyles(
  root: Document = document,
): () => void {
  const style = root.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeTerminalSettings = "";
  style.textContent = TERMINAL_SETTINGS_STYLES;
  (root.head ?? root.documentElement).append(style);
  return () => {
    style.remove();
  };
}
