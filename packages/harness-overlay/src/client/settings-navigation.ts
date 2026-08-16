const SETTINGS_NAV_BUTTON_SELECTOR = '[role="dialog"] nav button';
const SETTINGS_NAV_LABEL_SELECTOR = ":scope > span:last-child";

export interface SettingsNavigationButton {
  querySelector(selector: string): { textContent: string | null } | null;
  toggleAttribute(name: string, force?: boolean): boolean | void;
}

export interface SettingsNavigationRoot {
  defaultView?: Pick<
    Window,
    "MutationObserver" | "requestAnimationFrame" | "cancelAnimationFrame"
  > | null;
  documentElement?: Node;
  querySelectorAll(
    selector: string,
  ): Iterable<SettingsNavigationButton>;
}

/** Mark one localized settings row without depending on private class names. */
export function reconcileSettingsNavigationIcon(
  root: SettingsNavigationRoot,
  marker: string,
  label: string,
): void {
  for (
    const button of root.querySelectorAll(
      SETTINGS_NAV_BUTTON_SELECTOR,
    )
  ) {
    const rowLabel = button
      .querySelector(SETTINGS_NAV_LABEL_SELECTOR)
      ?.textContent
      ?.trim();
    button.toggleAttribute(marker, rowLabel === label);
  }
}

/**
 * Follow Settings modal mounts and locale changes until the owning plugin
 * unloads. This adapter can disappear once the upstream slot accepts icons.
 */
export function installSettingsNavigationIcon(
  marker: string,
  label: () => string,
  root: SettingsNavigationRoot = document,
): () => void {
  const view = root.defaultView;
  const documentElement = root.documentElement;
  if (view === undefined || view === null || documentElement === undefined) {
    return () => {};
  }

  let frame: number | undefined;
  let disposed = false;
  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    reconcileSettingsNavigationIcon(root, marker, label());
  };
  const scheduleReconcile = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };

  const observer = new view.MutationObserver(scheduleReconcile);
  observer.observe(documentElement, {
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
    reconcileSettingsNavigationIcon(root, marker, "\u0000");
  };
}
