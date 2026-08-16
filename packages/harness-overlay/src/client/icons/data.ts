export const KEYBOARD_ICON_PATHS = [
  "M10 8h.01",
  "M12 12h.01",
  "M14 8h.01",
  "M16 12h.01",
  "M18 8h.01",
  "M6 8h.01",
  "M7 16h10",
  "M8 12h.01",
] as const;

const keyboardPathsMarkup = KEYBOARD_ICON_PATHS
  .map((path) => `<path d="${path}"/>`)
  .join("");

/** Exact product-selected Lucide Keyboard source used by every projection. */
export const KEYBOARD_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-keyboard-icon lucide-keyboard">' +
  keyboardPathsMarkup +
  '<rect width="20" height="16" x="2" y="4" rx="2"/></svg>';

export const KEYBOARD_ICON_DATA_URL =
  `data:image/svg+xml,${encodeURIComponent(KEYBOARD_ICON_SVG)}`;
