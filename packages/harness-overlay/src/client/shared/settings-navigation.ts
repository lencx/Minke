import {
  bindCssVars,
} from "./style-runtime.ts";

const SETTINGS_NAV_BUTTON_SELECTOR = '[role="dialog"] nav button';
const SETTINGS_NAV_LABEL_SELECTOR = ":scope > span:last-child";

export interface SettingsNavigationButton {
  querySelector(selector: string): { textContent: string | null } | null;
  readonly style?: CSSStyleDeclaration;
  toggleAttribute(name: string, force?: boolean): boolean | void;
}

export interface SettingsNavigationView {
  readonly MutationObserver: typeof MutationObserver;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export interface SettingsNavigationRoot {
  defaultView?: SettingsNavigationView | null;
  documentElement?: Node;
  querySelectorAll(
    selector: string,
  ): Iterable<SettingsNavigationButton>;
}

type SettingsNavigationIconVariables = Readonly<
  Record<`--minke-${string}`, string>
>;

function reconcileSettingsNavigationButtons(
  root: SettingsNavigationRoot,
  marker: string,
  label: string,
): SettingsNavigationButton[] {
  const matches: SettingsNavigationButton[] = [];
  for (
    const button of root.querySelectorAll(
      SETTINGS_NAV_BUTTON_SELECTOR,
    )
  ) {
    const rowLabel = button
      .querySelector(SETTINGS_NAV_LABEL_SELECTOR)
      ?.textContent
      ?.trim();
    const matched = rowLabel === label;
    button.toggleAttribute(marker, matched);
    if (matched) matches.push(button);
  }
  return matches;
}

/** Mark one localized settings row without depending on private class names. */
export function reconcileSettingsNavigationIcon(
  root: SettingsNavigationRoot,
  marker: string,
  label: string,
): void {
  reconcileSettingsNavigationButtons(root, marker, label);
}

/**
 * Follow Settings modal mounts and locale changes until the owning plugin
 * unloads. This adapter can disappear once the upstream slot accepts icons.
 */
export function installSettingsNavigationIcon(
  marker: string,
  label: () => string,
  root: SettingsNavigationRoot | undefined = globalThis.document,
  variables?: SettingsNavigationIconVariables,
): () => void {
  if (root === undefined) return () => {};
  const view = root.defaultView;
  const documentElement = root.documentElement;
  if (view === undefined || view === null || documentElement === undefined) {
    return () => {};
  }

  let frame: number | undefined;
  let disposed = false;
  const variableBindings = new Map<
    SettingsNavigationButton,
    () => void
  >();
  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    const matchingButtons = new Set(
      reconcileSettingsNavigationButtons(root, marker, label()),
    );

    for (const [button, dispose] of variableBindings) {
      if (matchingButtons.has(button)) continue;
      dispose();
      variableBindings.delete(button);
    }
    if (variables === undefined) return;
    for (const button of matchingButtons) {
      if (
        button.style === undefined ||
        variableBindings.has(button)
      ) {
        continue;
      }
      variableBindings.set(
        button,
        bindCssVars(
          button as SettingsNavigationButton & {
            readonly style: CSSStyleDeclaration;
          },
          variables,
        ),
      );
    }
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
    for (const dispose of variableBindings.values()) {
      dispose();
    }
    variableBindings.clear();
    reconcileSettingsNavigationIcon(root, marker, "\u0000");
  };
}
