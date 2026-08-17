/** Shared desktop/client contract for durable Minke keyboard shortcuts. */

export const SHORTCUT_SETTINGS_READ_CHANNEL =
  "minke:shortcut-settings:read";
export const SHORTCUT_SETTINGS_WRITE_CHANNEL =
  "minke:shortcut-settings:write";
export const SHORTCUT_INVOKE_CHANNEL = "minke:shortcut:invoke";

export const DEFAULT_SHORTCUT_BINDINGS = Object.freeze({
  "settings.open": "Mod+Comma",
  "session.new": "Mod+N",
  "sidebar.toggle": "Mod+S",
} as const);

export type ProductShortcutActionId =
  keyof typeof DEFAULT_SHORTCUT_BINDINGS;

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
