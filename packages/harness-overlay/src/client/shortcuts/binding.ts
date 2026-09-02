/** Normalize keyboard events and present platform-native shortcuts. */

export type ShortcutPlatform = "apple" | "other";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
const PRINTABLE_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  ",": "Comma",
  "<": "Comma",
  ".": "Period",
  ">": "Period",
  "/": "Slash",
  "?": "Slash",
  ";": "Semicolon",
  ":": "Semicolon",
  "'": "Quote",
  "\"": "Quote",
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  "\\": "Backslash",
  "|": "Backslash",
  "-": "Minus",
  "_": "Minus",
  "=": "Equal",
  "+": "Equal",
  "`": "Backquote",
  "~": "Backquote",
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};
const NAMED_KEYS = new Set([
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
]);
const KEY_LABELS: Readonly<Record<string, string>> = {
  Space: "Space",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
};
const APPLE_MODIFIER_LABELS: Readonly<Record<string, string>> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Meta: "⌘",
  Alt: "⌥",
  Shift: "⇧",
};
const APPLE_MODIFIER_ORDER: Readonly<Record<string, number>> = {
  Ctrl: 0,
  Alt: 1,
  Shift: 2,
  Mod: 3,
  Meta: 3,
};
const OTHER_MODIFIER_LABELS: Readonly<Record<string, string>> = {
  Mod: "Ctrl",
  Ctrl: "Ctrl",
  Meta: "Meta",
  Alt: "Alt",
  Shift: "Shift",
};
const ARIA_KEY_LABELS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** Detect the browser platform used for logical Mod semantics. */
export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const modern = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData?.platform;
  const platform = modern ?? navigator.platform;
  return /Mac|iPhone|iPad|iPod/iu.test(platform) ? "apple" : "other";
}

/** Convert one keydown event into a canonical logical shortcut. */
export function shortcutBindingFromEvent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "altKey"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "repeat"
    | "isComposing"
    | "defaultPrevented"
  > &
    Partial<Pick<KeyboardEvent, "code" | "getModifierState">>,
  platform: ShortcutPlatform,
): string | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (
    event.getModifierState?.("AltGraph") === true ||
    MODIFIER_KEYS.has(event.key)
  ) {
    return null;
  }

  const modifiers: string[] = [];
  if (platform === "apple") {
    if (event.metaKey) modifiers.push("Mod");
    if (event.ctrlKey) modifiers.push("Ctrl");
  } else {
    if (event.ctrlKey) modifiers.push("Mod");
    if (event.metaKey) modifiers.push("Meta");
  }
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.some((modifier) => modifier !== "Shift")) return null;

  const key = normalizeKey(event.key, event.code);
  return key === null ? null : [...modifiers, key].join("+");
}

/** Split a canonical shortcut into platform-native keys for visual keycaps. */
export function formatShortcutBindingParts(
  binding: string,
  platform: ShortcutPlatform,
): readonly string[] {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  const labels = platform === "apple"
    ? APPLE_MODIFIER_LABELS
    : OTHER_MODIFIER_LABELS;
  const modifiers = platform === "apple"
    ? [...parts].sort(
        (left, right) =>
          (APPLE_MODIFIER_ORDER[left] ?? Number.MAX_SAFE_INTEGER) -
          (APPLE_MODIFIER_ORDER[right] ?? Number.MAX_SAFE_INTEGER),
      )
    : parts;
  return [
    ...modifiers.map((part) => labels[part] ?? part),
    KEY_LABELS[key] ?? key,
  ];
}

/** Format a canonical shortcut for compact text and assistive output. */
export function formatShortcutBinding(
  binding: string,
  platform: ShortcutPlatform,
): string {
  const parts = formatShortcutBindingParts(binding, platform);
  return parts.join(platform === "apple" ? "" : " + ");
}

/** Format a canonical binding using valid aria-keyshortcuts key names. */
export function formatShortcutBindingAria(
  binding: string,
  platform: ShortcutPlatform,
): string {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  return [
    ...parts.map((part) => {
      if (part === "Mod") {
        return platform === "apple" ? "Meta" : "Control";
      }
      return part === "Ctrl" ? "Control" : part;
    }),
    ARIA_KEY_LABELS[key] ?? key,
  ].join("+");
}

function normalizeKey(
  key: string,
  code?: string,
): string | null {
  const physicalDigit = /^Digit([0-9])$/u.exec(code ?? "");
  if (physicalDigit?.[1] !== undefined) {
    return physicalDigit[1];
  }
  if (/^[a-z]$/iu.test(key)) return key.toUpperCase();
  if (/^[0-9]$/u.test(key)) return key;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key)) return key;
  if (NAMED_KEYS.has(key)) return key;
  return PRINTABLE_KEYS[key] ?? null;
}
