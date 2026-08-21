/** Shortcut action adapters kept outside the upstream Harness source tree. */

interface Clickable {
  click(): void;
}

interface SettingsQueryRoot {
  querySelectorAll(
    selector: string,
  ): Iterable<Clickable>;
}

interface ModalQueryRoot {
  querySelector(selector: string): Element | null;
}

export const SETTINGS_TRIGGER_SELECTOR =
  '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"][aria-expanded]';

export const MODAL_SURFACE_SELECTOR = [
  "dialog[open]",
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"]',
].join(",");

/** Whether another modal surface currently owns keyboard focus. */
export function hasOpenModalSurface(
  root: ModalQueryRoot = document,
): boolean {
  return root.querySelector(MODAL_SURFACE_SELECTOR) !== null;
}

/**
 * Open the Harness Settings shell through its accessible trigger contract.
 * Keeping this DOM dependency in one adapter makes upstream drift fail in one
 * place instead of spreading selectors through shortcut behavior.
 */
export function openHarnessSettings(
  root: SettingsQueryRoot = document,
): boolean {
  const trigger = [...root.querySelectorAll(SETTINGS_TRIGGER_SELECTOR)][0];
  if (trigger === undefined) return false;
  trigger.click();
  return true;
}
