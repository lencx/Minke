/** Renderer-to-main channel carrying Harness's active locale. */
export const WINDOW_LOCALE_CHANNEL = "minke:window-locale";

/** Open BCP 47-style locale identifier projected from DeepSeek Harness. */
export type DesktopLocale = string;

/** The two native-copy dictionaries owned by Minke. */
export type DesktopDictionaryLocale = "zh" | "en";

/** Keep preload/main validation aligned with Harness alpha.2 LocaleId. */
export const DESKTOP_LOCALE_ID_PATTERN =
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/** Validate untrusted locale data crossing the preload boundary. */
export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return (
    typeof value === "string" &&
    DESKTOP_LOCALE_ID_PATTERN.test(value)
  );
}

/**
 * Resolve any system or Harness locale to one of Minke's native dictionaries.
 * Chinese variants stay Chinese; every other or absent value falls back to
 * English.
 */
export function resolveDesktopLocale(
  value: string | null | undefined,
): DesktopDictionaryLocale {
  const primary = value
    ?.trim()
    .toLowerCase()
    .split(/[-_]/u, 1)[0];
  return primary === "zh" ? "zh" : "en";
}
