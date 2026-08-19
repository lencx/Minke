import {
  LOCAL_MODEL_RUNTIMES,
  type LocalModelRuntimeId,
} from "@lencx/minke-model-runtime/contract";
import type {
  LocalModelTranslate,
} from "./locales.ts";
import type {
  LocalModelSettingsRuntime,
} from "./runtime.ts";
import {
  installLocalModelSettingsStyles,
} from "./styles.ts";

const MARKER = "data-minke-local-model-settings";
const LOCAL_TAG_MARKER = "data-minke-local-model-tag";
const LOCAL_DETAILS_MARKER = "data-minke-local-model-details";
const LOCAL_TOKEN_MARKER = "data-minke-local-model-token";
const LOCAL_HIDDEN_FIELD_MARKER =
  "data-minke-local-model-hidden-field";
const LOCAL_TOKEN_HINT_MARKER =
  "data-minke-local-model-token-hint";
const LOCAL_CONFIGURE_CARD_MARKER =
  "data-minke-local-model-configure-card";
const ORIGINAL_TEXT_MARKER = "data-minke-original-text";
const ORIGINAL_ARIA_LABEL_MARKER =
  "data-minke-original-aria-label";
const ORIGINAL_PLACEHOLDER_MARKER =
  "data-minke-original-placeholder";
const ORIGINAL_OPEN_MARKER = "data-minke-original-open";
const ORIGINAL_HIDDEN_MARKER = "data-minke-original-hidden";

interface SwitchElements {
  container: HTMLSpanElement;
  control: HTMLLabelElement;
  input: HTMLInputElement;
  label: HTMLSpanElement;
  status: HTMLSpanElement;
}

interface SyntheticRowElements {
  row: HTMLLIElement;
  name: HTMLSpanElement;
  tag: HTMLSpanElement;
  note: HTMLSpanElement;
  actions: HTMLSpanElement;
  configure: HTMLButtonElement;
}

type LocalModelRuntimeDescriptor =
  (typeof LOCAL_MODEL_RUNTIMES)[number];

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function providerEditButton(
  root: Document,
  providerId: string,
): HTMLButtonElement | undefined {
  for (
    const button of root.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button[aria-label]',
    )
  ) {
    if (
      button.getAttribute("aria-label")?.includes(
        `(${providerId})`,
      )
    ) {
      return button;
    }
  }
  return undefined;
}

function modelsSection(
  root: Document,
  t: LocalModelTranslate,
): HTMLElement | undefined {
  const expectedTitle = t("modelsTitle");
  for (
    const heading of root.querySelectorAll<HTMLElement>(
      '[role="dialog"] h2',
    )
  ) {
    if (heading.textContent?.trim() === expectedTitle) {
      return heading.parentElement ?? undefined;
    }
  }
  return undefined;
}

function providerList(section: HTMLElement): HTMLUListElement | undefined {
  return [...section.children].find(
    (child) => child.tagName === "UL",
  ) as HTMLUListElement | undefined;
}

function customProviderButton(
  section: HTMLElement,
  t: LocalModelTranslate,
): HTMLButtonElement | undefined {
  const expectedLabel = t("customProviderAction");
  return [...section.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent?.trim() === expectedLabel &&
      !button.classList.contains(
        "minke-local-model-row__configure",
      ),
  );
}

function ownText(
  element: HTMLElement,
  sourceText: string,
  targetText: string,
  marker: string,
): void {
  if (!element.hasAttribute(marker)) {
    element.setAttribute(marker, "");
    element.setAttribute(
      ORIGINAL_TEXT_MARKER,
      element.textContent ?? "",
    );
  } else if (element.textContent === sourceText) {
    element.setAttribute(ORIGINAL_TEXT_MARKER, sourceText);
  }
  setText(element, targetText);
}

function fieldWithAccessibleLabel(
  container: HTMLElement,
  selector: "input" | "select",
  label: string,
): HTMLElement | undefined {
  const control = [...container.querySelectorAll<HTMLElement>(selector)]
    .find((candidate) =>
      candidate.getAttribute("aria-label") === label
    );
  return control?.parentElement ?? undefined;
}

function hideLocalOnlyField(field: HTMLElement | undefined): void {
  if (field === undefined) return;
  if (!field.hasAttribute(LOCAL_HIDDEN_FIELD_MARKER)) {
    field.setAttribute(LOCAL_HIDDEN_FIELD_MARKER, "");
    field.setAttribute(
      ORIGINAL_HIDDEN_MARKER,
      field.hidden ? "true" : "false",
    );
  }
  field.hidden = true;
}

function decorateOptionalToken(
  container: HTMLElement,
  t: LocalModelTranslate,
  root: Document,
): void {
  const token = container.querySelector<HTMLInputElement>(
    `input[${LOCAL_TOKEN_MARKER}]`,
  ) ?? [...container.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  )].find((candidate) =>
    candidate.getAttribute("aria-label") === t("keyInput")
  );
  if (token === undefined) return;
  if (!token.hasAttribute(LOCAL_TOKEN_MARKER)) {
    token.setAttribute(LOCAL_TOKEN_MARKER, "");
    token.setAttribute(
      ORIGINAL_ARIA_LABEL_MARKER,
      token.getAttribute("aria-label") ?? "",
    );
  }
  token.setAttribute("aria-label", t("optionalToken"));
  if (!token.hasAttribute(ORIGINAL_PLACEHOLDER_MARKER)) {
    token.setAttribute(
      ORIGINAL_PLACEHOLDER_MARKER,
      token.getAttribute("placeholder") ?? "",
    );
  }
  token.setAttribute(
    "placeholder",
    t("optionalTokenPlaceholder"),
  );
  const tokenLabel = token.previousElementSibling;
  if (tokenLabel instanceof viewOf(root).HTMLElement) {
    ownText(
      tokenLabel,
      t("keyInput"),
      t("optionalToken"),
      LOCAL_TOKEN_MARKER,
    );
  }
  const field = token.parentElement;
  if (
    field !== null &&
    field.querySelector(`[${LOCAL_TOKEN_HINT_MARKER}]`) === null
  ) {
    const hint = root.createElement("span");
    hint.className = "minke-local-model-token-hint";
    hint.setAttribute(LOCAL_TOKEN_HINT_MARKER, "");
    setText(hint, t("optionalTokenHint"));
    field.append(hint);
  } else {
    const hint = field?.querySelector<HTMLElement>(
      `[${LOCAL_TOKEN_HINT_MARKER}]`,
    );
    if (hint !== undefined && hint !== null) {
      setText(hint, t("optionalTokenHint"));
    }
  }
}

function decorateLocalProvider(
  edit: HTMLButtonElement,
  t: LocalModelTranslate,
  root: Document,
): void {
  const row = edit.closest<HTMLElement>("li");
  if (row === null) return;

  const markedTag = row.querySelector<HTMLElement>(
    `[${LOCAL_TAG_MARKER}]`,
  );
  const tag = markedTag ??
    [...row.querySelectorAll<HTMLElement>("span")].find(
      (candidate) =>
        candidate.textContent?.trim() === t("customTag"),
    );
  if (tag !== undefined) {
    ownText(
      tag,
      t("customTag"),
      t("localTag"),
      LOCAL_TAG_MARKER,
    );
  }

  const details = row.querySelector<HTMLDetailsElement>("details");
  if (details === null) return;
  if (!details.hasAttribute(LOCAL_DETAILS_MARKER)) {
    details.setAttribute(LOCAL_DETAILS_MARKER, "");
    details.setAttribute(
      ORIGINAL_OPEN_MARKER,
      details.open ? "true" : "false",
    );
  }
  details.open = true;
  const summary = details.querySelector<HTMLElement>("summary");
  if (summary !== null) {
    ownText(
      summary,
      t("customized"),
      t("localSettings"),
      LOCAL_DETAILS_MARKER,
    );
  }

  hideLocalOnlyField(
    fieldWithAccessibleLabel(
      row,
      "input",
      t("customDisplayName"),
    ),
  );
  hideLocalOnlyField(
    fieldWithAccessibleLabel(row, "select", t("customApi")),
  );

  decorateOptionalToken(row, t, root);
}

function viewOf(root: Document): Window & typeof globalThis {
  return root.defaultView ?? window;
}

function setControlledValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string,
  root: Document,
): void {
  if (control.value === value) return;
  const view = viewOf(root);
  const prototype = control instanceof view.HTMLSelectElement
    ? view.HTMLSelectElement.prototype
    : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(
    prototype,
    "value",
  )?.set;
  if (setter === undefined) return;
  setter.call(control, value);
  control.dispatchEvent(
    new view.Event(
      control instanceof view.HTMLSelectElement ? "change" : "input",
      { bubbles: true },
    ),
  );
}

function prepareLocalConfigureCard(
  section: HTMLElement,
  descriptor: LocalModelRuntimeDescriptor,
  t: LocalModelTranslate,
  root: Document,
): boolean {
  const route = [...section.querySelectorAll<HTMLInputElement>("input")]
    .find((candidate) =>
      candidate.getAttribute("aria-label") === t("customRoute")
    );
  if (route === undefined) return false;
  const card = route.parentElement?.parentElement;
  if (card === undefined || card === null) return false;
  if (!card.hasAttribute(LOCAL_CONFIGURE_CARD_MARKER)) {
    card.setAttribute(
      LOCAL_CONFIGURE_CARD_MARKER,
      descriptor.id,
    );
    const displayName = [...card.querySelectorAll<HTMLInputElement>(
      "input",
    )].find((candidate) =>
      candidate.getAttribute("aria-label") ===
      t("customDisplayName")
    );
    const baseURL = [...card.querySelectorAll<HTMLInputElement>(
      "input",
    )].find((candidate) =>
      candidate.getAttribute("aria-label") === t("baseURL")
    );
    const protocol = [...card.querySelectorAll<HTMLSelectElement>(
      "select",
    )].find((candidate) =>
      candidate.getAttribute("aria-label") === t("customApi")
    );
    setControlledValue(route, descriptor.providerId, root);
    if (displayName !== undefined) {
      setControlledValue(
        displayName,
        descriptor.displayName,
        root,
      );
    }
    if (baseURL !== undefined) {
      setControlledValue(
        baseURL,
        descriptor.defaultBaseURL,
        root,
      );
    }
    if (protocol !== undefined) {
      setControlledValue(protocol, "openai-completions", root);
    }
    const routeField = route.parentElement ?? undefined;
    hideLocalOnlyField(routeField);
    hideLocalOnlyField(
      routeField?.nextElementSibling instanceof
        viewOf(root).HTMLElement
        ? routeField.nextElementSibling
        : undefined,
    );
    hideLocalOnlyField(displayName?.parentElement ?? undefined);
    hideLocalOnlyField(protocol?.parentElement ?? undefined);
  }

  const title = [...card.querySelectorAll<HTMLElement>("span")].find(
    (candidate) =>
      candidate.textContent?.trim() === t("customProviderTitle") ||
      candidate.hasAttribute(LOCAL_TAG_MARKER),
  );
  if (title !== undefined) {
    ownText(
      title,
      t("customProviderTitle"),
      `${descriptor.displayName} · ${t("localTag")}`,
      LOCAL_TAG_MARKER,
    );
  }
  decorateOptionalToken(card, t, root);
  return true;
}

function restoreLocalProviderDecorations(root: Document): void {
  for (
    const element of root.querySelectorAll<HTMLElement>(
      `[${ORIGINAL_TEXT_MARKER}]`,
    )
  ) {
    setText(
      element,
      element.getAttribute(ORIGINAL_TEXT_MARKER) ?? "",
    );
    element.removeAttribute(ORIGINAL_TEXT_MARKER);
    element.removeAttribute(LOCAL_TAG_MARKER);
    element.removeAttribute(LOCAL_DETAILS_MARKER);
    element.removeAttribute(LOCAL_TOKEN_MARKER);
    element.removeAttribute(LOCAL_CONFIGURE_CARD_MARKER);
  }
  for (
    const input of root.querySelectorAll<HTMLInputElement>(
      `input[${ORIGINAL_ARIA_LABEL_MARKER}]`,
    )
  ) {
    input.setAttribute(
      "aria-label",
      input.getAttribute(ORIGINAL_ARIA_LABEL_MARKER) ?? "",
    );
    input.removeAttribute(ORIGINAL_ARIA_LABEL_MARKER);
    input.setAttribute(
      "placeholder",
      input.getAttribute(ORIGINAL_PLACEHOLDER_MARKER) ?? "",
    );
    input.removeAttribute(ORIGINAL_PLACEHOLDER_MARKER);
    input.removeAttribute(LOCAL_TOKEN_MARKER);
  }
  for (
    const details of root.querySelectorAll<HTMLDetailsElement>(
      `details[${ORIGINAL_OPEN_MARKER}]`,
    )
  ) {
    details.open =
      details.getAttribute(ORIGINAL_OPEN_MARKER) === "true";
    details.removeAttribute(ORIGINAL_OPEN_MARKER);
    details.removeAttribute(LOCAL_DETAILS_MARKER);
  }
  for (
    const field of root.querySelectorAll<HTMLElement>(
      `[${LOCAL_HIDDEN_FIELD_MARKER}]`,
    )
  ) {
    field.hidden =
      field.getAttribute(ORIGINAL_HIDDEN_MARKER) === "true";
    field.removeAttribute(ORIGINAL_HIDDEN_MARKER);
    field.removeAttribute(LOCAL_HIDDEN_FIELD_MARKER);
  }
  for (
    const card of root.querySelectorAll<HTMLElement>(
      `[${LOCAL_CONFIGURE_CARD_MARKER}]`,
    )
  ) {
    card.removeAttribute(LOCAL_CONFIGURE_CARD_MARKER);
  }
  for (
    const hint of root.querySelectorAll<HTMLElement>(
      `[${LOCAL_TOKEN_HINT_MARKER}]`,
    )
  ) {
    hint.remove();
  }
}

function createSwitch(
  root: Document,
  id: LocalModelRuntimeId,
  runtime: LocalModelSettingsRuntime,
): SwitchElements {
  const container = root.createElement("span");
  container.setAttribute(MARKER, id);
  const control = root.createElement("label");
  control.className = "minke-local-model-switch";
  const label = root.createElement("span");
  label.className = "minke-local-model-switch__label";
  const input = root.createElement("input");
  input.className = "minke-local-model-switch__input";
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  const track = root.createElement("span");
  track.className = "minke-local-model-switch__track";
  track.setAttribute("aria-hidden", "true");
  const thumb = root.createElement("span");
  thumb.className = "minke-local-model-switch__thumb";
  track.append(thumb);
  const status = root.createElement("span");
  status.className = "minke-local-model-switch__status";
  status.setAttribute("aria-live", "polite");
  control.append(label, input, track);
  container.append(control, status);
  input.addEventListener("change", () => {
    try {
      runtime.setEnabled(id, input.checked);
    } catch {
      input.checked =
        runtime.getSnapshot().settings[id].enabled;
    }
  });
  return {
    container,
    control,
    input,
    label,
    status,
  };
}

function createSyntheticRow(
  root: Document,
  id: LocalModelRuntimeId,
  runtimeName: string,
  findConfigureTarget: () => HTMLButtonElement | undefined,
  onConfigure: () => void,
): SyntheticRowElements {
  const row = root.createElement("li");
  row.className = "minke-local-model-row";
  row.dataset.minkeLocalModelRow = id;
  const identity = root.createElement("span");
  identity.className = "minke-local-model-row__identity";
  const heading = root.createElement("span");
  heading.className = "minke-local-model-row__heading";
  const name = root.createElement("span");
  setText(name, runtimeName);
  const tag = root.createElement("span");
  tag.className = "minke-local-model-row__tag";
  heading.append(name, tag);
  const note = root.createElement("span");
  note.className = "minke-local-model-row__note";
  identity.append(heading, note);
  const actions = root.createElement("span");
  actions.className = "minke-local-model-row__actions";
  const configure = root.createElement("button");
  configure.type = "button";
  configure.className = "minke-local-model-row__configure";
  configure.addEventListener("click", () => {
    const target = findConfigureTarget();
    if (target === undefined || target.disabled) return;
    onConfigure();
    target.click();
  });
  actions.append(configure);
  row.append(identity, actions);
  return {
    row,
    name,
    tag,
    note,
    actions,
    configure,
  };
}

/**
 * Enhance the two provider rows in Harness's existing Models page. Provider
 * route ids in the Edit buttons are the stable seam; private CSS-module class
 * names remain deliberately ignored.
 */
export function installLocalModelSettings(
  runtime: LocalModelSettingsRuntime,
  t: LocalModelTranslate,
  root: Document = document,
): () => void {
  const view = root.defaultView;
  if (view === null || root.documentElement === null) {
    return () => {};
  }
  const disposeStyles = installLocalModelSettingsStyles(root);
  const controls = new Map<
    LocalModelRuntimeId,
    SwitchElements
  >();
  const syntheticRows = new Map<
    LocalModelRuntimeId,
    SyntheticRowElements
  >();
  let pendingConfigure: LocalModelRuntimeId | undefined;
  let frame: number | undefined;
  let disposed = false;

  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    const snapshot = runtime.getSnapshot();
    const section = modelsSection(root, t);
    const list =
      section === undefined ? undefined : providerList(section);
    if (section !== undefined && pendingConfigure !== undefined) {
      const descriptor = LOCAL_MODEL_RUNTIMES.find(
        ({ id }) => id === pendingConfigure,
      );
      if (
        descriptor !== undefined &&
        prepareLocalConfigureCard(
          section,
          descriptor,
          t,
          root,
        )
      ) {
        pendingConfigure = undefined;
      }
    }
    for (const descriptor of LOCAL_MODEL_RUNTIMES) {
      let elements = controls.get(descriptor.id);
      const edit = providerEditButton(
        root,
        descriptor.providerId,
      );
      const actions = edit?.parentElement;
      if (edit !== undefined) {
        decorateLocalProvider(edit, t, root);
      }
      let synthetic = syntheticRows.get(descriptor.id);
      if (actions !== undefined && actions !== null) {
        synthetic?.row.remove();
      } else if (section !== undefined && list !== undefined) {
        if (synthetic === undefined) {
          synthetic = createSyntheticRow(
            root,
            descriptor.id,
            descriptor.displayName,
            () =>
              section === undefined
                ? undefined
                : customProviderButton(section, t),
            () => {
              pendingConfigure = descriptor.id;
            },
          );
          syntheticRows.set(descriptor.id, synthetic);
        }
        if (synthetic.row.parentElement !== list) {
          list.append(synthetic.row);
        }
        setText(synthetic.name, descriptor.displayName);
        setText(synthetic.tag, t("localTag"));
        setText(
          synthetic.note,
          snapshot.available[descriptor.id]
            ? t("noModels")
            : t("commandNotFound"),
        );
        setText(synthetic.configure, t("configure"));
        const configureTarget = customProviderButton(section, t);
        synthetic.configure.disabled =
          configureTarget === undefined || configureTarget.disabled;
        synthetic.configure.setAttribute(
          "aria-label",
          `${t("configure")} ${descriptor.displayName}`,
        );
      } else {
        synthetic?.row.remove();
      }
      if (!snapshot.available[descriptor.id]) {
        elements?.container.remove();
        continue;
      }
      if (elements === undefined) {
        elements = createSwitch(root, descriptor.id, runtime);
        controls.set(descriptor.id, elements);
      }
      const controlHost =
        actions ?? synthetic?.actions;
      if (controlHost === undefined) {
        elements.container.remove();
        continue;
      }
      if (elements.container.parentElement !== controlHost) {
        controlHost.insertBefore(
          elements.container,
          controlHost.firstChild,
        );
      }
      const autoStart = t("autoStart");
      setText(elements.label, autoStart);
      elements.input.checked =
        snapshot.settings[descriptor.id].enabled;
      elements.input.disabled = !snapshot.editable;
      const accessibleName =
        `${descriptor.displayName}: ${autoStart}`;
      elements.input.setAttribute("aria-label", accessibleName);
      elements.control.title = t("restartRequired");
      const error = snapshot.error;
      setText(
        elements.status,
        error === "read"
          ? t("readError")
          : error === "write"
            ? t("writeError")
            : t("restartRequired"),
      );
      elements.status.toggleAttribute(
        "data-error",
        error === "read" || error === "write",
      );
    }
  };
  const schedule = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };
  const observer = new view.MutationObserver(schedule);
  observer.observe(root.documentElement, {
    attributes: true,
    attributeFilter: ["aria-label"],
    childList: true,
    characterData: true,
    subtree: true,
  });
  const unsubscribe = runtime.subscribe(schedule);
  schedule();

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    unsubscribe();
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    for (const elements of controls.values()) {
      elements.container.remove();
    }
    controls.clear();
    for (const elements of syntheticRows.values()) {
      elements.row.remove();
    }
    syntheticRows.clear();
    restoreLocalProviderDecorations(root);
    disposeStyles();
  };
}
