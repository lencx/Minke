/** Product action adapters kept outside the upstream Harness source tree. */

interface Clickable {
  click(): void;
}

interface SettingsQueryRoot {
  querySelectorAll(
    selector: string,
  ): Iterable<Clickable>;
}

export const SETTINGS_TRIGGER_SELECTOR =
  '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"][aria-expanded]';

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
