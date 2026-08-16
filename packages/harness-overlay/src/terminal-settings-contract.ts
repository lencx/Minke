/** Shared desktop/client contract for durable Terminal rendering settings. */

export const TERMINAL_SETTINGS_READ_CHANNEL =
  "minke:terminal-settings:read";
export const TERMINAL_SETTINGS_WRITE_CHANNEL =
  "minke:terminal-settings:write";

export const TERMINAL_SETTINGS_DOCUMENT_VERSION = 1;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;
export const TERMINAL_LINE_HEIGHT_MIN = 1;
export const TERMINAL_LINE_HEIGHT_MAX = 2;
export const TERMINAL_FONT_FAMILY_MAX_LENGTH = 240;

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export interface TerminalSettingsDocument {
  version: typeof TERMINAL_SETTINGS_DOCUMENT_VERSION;
  settings: TerminalSettings;
}

export const DEFAULT_TERMINAL_SETTINGS: Readonly<TerminalSettings> =
  Object.freeze({
    fontFamily: "",
    fontSize: 12,
    lineHeight: 1.24,
  });

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SETTINGS_KEYS = new Set([
  "fontFamily",
  "fontSize",
  "lineHeight",
]);

/** Validate and normalize one untrusted Terminal rendering snapshot. */
export function parseTerminalSettings(value: unknown): TerminalSettings {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("terminal settings must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== SETTINGS_KEYS.size ||
    Object.keys(record).some((key) => !SETTINGS_KEYS.has(key))
  ) {
    throw new TypeError("terminal settings must contain only known fields");
  }

  const fontFamily =
    typeof record.fontFamily === "string"
      ? record.fontFamily.trim()
      : undefined;
  if (
    fontFamily === undefined ||
    fontFamily.length > TERMINAL_FONT_FAMILY_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(fontFamily)
  ) {
    throw new TypeError("invalid terminal font family");
  }

  const fontSize = record.fontSize;
  if (
    typeof fontSize !== "number" ||
    !Number.isInteger(fontSize) ||
    fontSize < TERMINAL_FONT_SIZE_MIN ||
    fontSize > TERMINAL_FONT_SIZE_MAX
  ) {
    throw new RangeError("invalid terminal font size");
  }

  const lineHeight = record.lineHeight;
  if (
    typeof lineHeight !== "number" ||
    !Number.isFinite(lineHeight) ||
    lineHeight < TERMINAL_LINE_HEIGHT_MIN ||
    lineHeight > TERMINAL_LINE_HEIGHT_MAX
  ) {
    throw new RangeError("invalid terminal line height");
  }

  return {
    fontFamily,
    fontSize,
    lineHeight: Math.round(lineHeight * 100) / 100,
  };
}

/** Validate one exact versioned Terminal settings document read from disk. */
export function parseTerminalSettingsDocument(
  value: unknown,
): TerminalSettingsDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("terminal settings document must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.version !== TERMINAL_SETTINGS_DOCUMENT_VERSION
  ) {
    throw new TypeError("unsupported terminal settings document");
  }
  return {
    version: TERMINAL_SETTINGS_DOCUMENT_VERSION,
    settings: parseTerminalSettings(record.settings),
  };
}
