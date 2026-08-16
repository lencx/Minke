/** Keyboard-event normalization and platform-native shortcut presentation. */

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
    Partial<Pick<KeyboardEvent, "getModifierState">>,
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

  const key = normalizeKey(event.key);
  return key === null ? null : [...modifiers, key].join("+");
}

/** Format a canonical shortcut for the active platform. */
export function formatShortcutBinding(
  binding: string,
  platform: ShortcutPlatform,
): string {
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  if (platform === "apple") {
    const glyphs: Readonly<Record<string, string>> = {
      Mod: "⌘",
      Ctrl: "⌃",
      Meta: "⌘",
      Alt: "⌥",
      Shift: "⇧",
    };
    return `${parts.map((part) => glyphs[part] ?? part).join("")}${
      KEY_LABELS[key] ?? key
    }`;
  }
  const labels: Readonly<Record<string, string>> = {
    Mod: "Ctrl",
    Ctrl: "Ctrl",
    Meta: "Meta",
    Alt: "Alt",
    Shift: "Shift",
  };
  return [...parts.map((part) => labels[part] ?? part), KEY_LABELS[key] ?? key]
    .join(" + ");
}

function normalizeKey(key: string): string | null {
  if (/^[a-z]$/iu.test(key)) return key.toUpperCase();
  if (/^[0-9]$/u.test(key)) return key;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key)) return key;
  if (NAMED_KEYS.has(key)) return key;
  return PRINTABLE_KEYS[key] ?? null;
}
