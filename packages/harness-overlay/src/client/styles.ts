import { KEYBOARD_ICON_DATA_URL } from "./icons/data.ts";

export const SHORTCUT_STYLES = `
.minke-shortcuts {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}
.minke-shortcuts__intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.minke-shortcuts__title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.minke-shortcuts__description,
.minke-shortcuts__hint {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.minke-shortcuts__error {
  margin: 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.minke-shortcuts__rows {
  display: flex;
  flex-direction: column;
}
.minke-shortcuts__row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(150px, auto) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.minke-shortcuts__action {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.minke-shortcuts__action-label {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.minke-shortcuts__conflict {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.minke-shortcuts__binding,
.minke-shortcuts__reset {
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.minke-shortcuts__binding {
  min-width: 150px;
  font-family: var(--ds-font-family-code);
}
.minke-shortcuts__binding:hover,
.minke-shortcuts__reset:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.minke-shortcuts__binding--recording {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-module-platform);
}
.minke-shortcuts__reset {
  color: var(--dsw-alias-label-secondary);
}
.minke-shortcuts__binding:disabled,
.minke-shortcuts__reset:disabled {
  cursor: default;
  opacity: 0.45;
}
.minke-shortcuts__hint {
  grid-column: 2 / -1;
}
[data-minke-shortcuts-nav] > svg:first-child {
  display: none !important;
}
[data-minke-shortcuts-nav]::before {
  --minke-shortcuts-nav-icon: url("${KEYBOARD_ICON_DATA_URL}");
  content: "";
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--minke-shortcuts-nav-icon) center / 16px 16px no-repeat;
  mask: var(--minke-shortcuts-nav-icon) center / 16px 16px no-repeat;
}
@media (max-width: 760px) {
  .minke-shortcuts__row {
    grid-template-columns: 1fr auto;
  }
  .minke-shortcuts__action,
  .minke-shortcuts__hint {
    grid-column: 1 / -1;
  }
}
`;

const SHORTCUT_NAV_MARKER = "data-minke-shortcuts-nav";
const SHORTCUT_NAV_BUTTON_SELECTOR = '[role="dialog"] nav button';
const SHORTCUT_NAV_LABEL_SELECTOR = ":scope > span:last-child";

interface ShortcutNavigationButton {
  querySelector(selector: string): { textContent: string | null } | null;
  toggleAttribute(name: string, force?: boolean): boolean | void;
}

interface ShortcutNavigationRoot {
  querySelectorAll(selector: string): Iterable<ShortcutNavigationButton>;
}

/**
 * Mark the localized shortcuts navigation row without depending on its order
 * or on Harness's private CSS-module class names.
 */
export function reconcileShortcutNavigationIcon(
  root: ShortcutNavigationRoot,
  label: string,
): void {
  for (const button of root.querySelectorAll(SHORTCUT_NAV_BUTTON_SELECTOR)) {
    const rowLabel = button
      .querySelector(SHORTCUT_NAV_LABEL_SELECTOR)
      ?.textContent
      ?.trim();
    button.toggleAttribute(
      SHORTCUT_NAV_MARKER,
      rowLabel === label,
    );
  }
}

/**
 * Adapt the upstream settings shell until its section contract accepts icons.
 * The observer follows modal mounts and locale-driven label changes.
 */
export function installShortcutNavigationIcon(
  label: () => string,
  root: Document = document,
): () => void {
  const view = root.defaultView;
  if (view === null) return () => {};

  let frame: number | undefined;
  let disposed = false;
  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    reconcileShortcutNavigationIcon(root, label());
  };
  const scheduleReconcile = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };

  const observer = new view.MutationObserver(scheduleReconcile);
  observer.observe(root.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  scheduleReconcile();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    reconcileShortcutNavigationIcon(root, "\u0000");
  };
}

/** Install one plugin-owned stylesheet and return its disposer. */
export function installShortcutStyles(): () => void {
  const style = document.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeShortcuts = "";
  style.textContent = SHORTCUT_STYLES;
  document.head.append(style);
  return () => {
    style.remove();
  };
}
