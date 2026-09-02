/** Shared desktop/client contract for durable Minke keyboard shortcuts. */

export const SHORTCUT_SETTINGS_READ_CHANNEL =
  "minke:shortcut-settings:read";
export const SHORTCUT_SETTINGS_WRITE_CHANNEL =
  "minke:shortcut-settings:write";
export const SHORTCUT_INVOKE_CHANNEL = "minke:shortcut:invoke";

export const DEFAULT_SHORTCUT_BINDINGS = Object.freeze({
  "palette.open": "Mod+K",
  "settings.open": "Mod+Comma",
  "session.new": "Mod+N",
  "composer.focus": null,
  "session.back": "Mod+BracketLeft",
  "session.forward": "Mod+BracketRight",
  "sidebar.toggle": "Mod+S",
  "tabs.toggle": "Mod+P",
  "tabs.bottom.toggle": "Mod+B",
  // Keep each bottom action as the right-panel binding plus Shift. Digits
  // 3–6 are intentionally skipped because macOS reserves Mod+Shift+3–6
  // for screenshots and Touch Bar capture.
  "tabs.right.open.files": "Mod+1",
  "tabs.right.open.terminal": "Mod+2",
  "tabs.right.open.browser": "Mod+7",
  "tabs.right.open.browser-history": "Mod+8",
  "tabs.right.open.plugins": "Mod+9",
  "tabs.bottom.open.files": "Mod+Shift+1",
  "tabs.bottom.open.terminal": "Mod+Shift+2",
  "tabs.bottom.open.browser": "Mod+Shift+7",
  "tabs.bottom.open.browser-history": "Mod+Shift+8",
  "tabs.bottom.open.plugins": "Mod+Shift+9",
} as const);

export type ProductShortcutActionId =
  keyof typeof DEFAULT_SHORTCUT_BINDINGS;

export type TabCreateShortcutCreatorId =
  | "files"
  | "terminal"
  | "browser"
  | "browser-history"
  | "plugins";

export interface TabCreateShortcutDescriptor {
  readonly actionId: ProductShortcutActionId;
  readonly creatorId: TabCreateShortcutCreatorId;
  readonly defaultBinding: string;
  readonly placement: "right" | "bottom";
}

/**
 * Stable placement-specific shortcuts shared by the native menu, Settings,
 * and the in-product new-tab chooser.
 */
export const TAB_CREATE_SHORTCUT_DESCRIPTORS = Object.freeze([
  {
    actionId: "tabs.right.open.files",
    creatorId: "files",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.right.open.files"],
    placement: "right",
  },
  {
    actionId: "tabs.right.open.terminal",
    creatorId: "terminal",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.right.open.terminal"],
    placement: "right",
  },
  {
    actionId: "tabs.right.open.browser",
    creatorId: "browser",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.right.open.browser"],
    placement: "right",
  },
  {
    actionId: "tabs.right.open.browser-history",
    creatorId: "browser-history",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS[
        "tabs.right.open.browser-history"
      ],
    placement: "right",
  },
  {
    actionId: "tabs.right.open.plugins",
    creatorId: "plugins",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.right.open.plugins"],
    placement: "right",
  },
  {
    actionId: "tabs.bottom.open.files",
    creatorId: "files",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.bottom.open.files"],
    placement: "bottom",
  },
  {
    actionId: "tabs.bottom.open.terminal",
    creatorId: "terminal",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.bottom.open.terminal"],
    placement: "bottom",
  },
  {
    actionId: "tabs.bottom.open.browser",
    creatorId: "browser",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.bottom.open.browser"],
    placement: "bottom",
  },
  {
    actionId: "tabs.bottom.open.browser-history",
    creatorId: "browser-history",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS[
        "tabs.bottom.open.browser-history"
      ],
    placement: "bottom",
  },
  {
    actionId: "tabs.bottom.open.plugins",
    creatorId: "plugins",
    defaultBinding:
      DEFAULT_SHORTCUT_BINDINGS["tabs.bottom.open.plugins"],
    placement: "bottom",
  },
] satisfies readonly TabCreateShortcutDescriptor[]);

export type TabCreateShortcutActionId =
  (typeof TAB_CREATE_SHORTCUT_DESCRIPTORS)[number]["actionId"];

const PRODUCT_SHORTCUT_ACTION_IDS = new Set<string>(
  Object.keys(DEFAULT_SHORTCUT_BINDINGS),
);

export const MAX_SHORTCUT_ACTIONS = 128;

const ACTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const MODIFIER_SEQUENCE_PATTERN = [
  "Mod\\+(?:Ctrl\\+)?(?:Meta\\+)?(?:Alt\\+)?",
  "Ctrl\\+(?:Meta\\+)?(?:Alt\\+)?",
  "Meta\\+(?:Alt\\+)?",
  "Alt\\+",
].join("|");
const SHORTCUT_KEY_PATTERN = [
  "[A-Z]",
  "[0-9]",
  "F(?:[1-9]|1[0-9]|2[0-4])",
  "Space",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Comma",
  "Period",
  "Slash",
  "Semicolon",
  "Quote",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Minus",
  "Equal",
  "Backquote",
].join("|");

export const SHORTCUT_BINDING_PATTERN = new RegExp(
  `^(?:|(?:${MODIFIER_SEQUENCE_PATTERN})(?:Shift\\+)?(?:${SHORTCUT_KEY_PATTERN}))$`,
  "u",
);

export type ShortcutBindings = Record<string, string>;

/** Narrow untrusted native-menu messages to Minke-owned shortcut actions. */
export function isProductShortcutActionId(
  value: unknown,
): value is ProductShortcutActionId {
  return (
    typeof value === "string" &&
    PRODUCT_SHORTCUT_ACTION_IDS.has(value)
  );
}

/** Return whether a value is one canonical enabled binding. */
export function isShortcutBinding(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    SHORTCUT_BINDING_PATTERN.test(value)
  );
}

/** Validate and copy an untrusted action-to-binding record. */
export function parseShortcutBindings(value: unknown): ShortcutBindings {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("shortcut bindings must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_SHORTCUT_ACTIONS) {
    throw new RangeError(
      `shortcut bindings exceed ${String(MAX_SHORTCUT_ACTIONS)} actions`,
    );
  }

  const bindings: ShortcutBindings = {};
  for (const [id, binding] of entries) {
    if (id.length > 80 || !ACTION_ID_PATTERN.test(id)) {
      throw new TypeError(`invalid shortcut action id ${JSON.stringify(id)}`);
    }
    if (
      typeof binding !== "string" ||
      !SHORTCUT_BINDING_PATTERN.test(binding)
    ) {
      throw new TypeError(
        `invalid shortcut binding for ${JSON.stringify(id)}`,
      );
    }
    bindings[id] = binding;
  }
  return bindings;
}
