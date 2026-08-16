/** Renderer-to-main channel carrying Harness's active locale. */
export const WINDOW_LOCALE_CHANNEL = "minke:window-locale";

/** Locale identifiers currently shipped by DeepSeek Harness. */
export type DesktopLocale = "zh" | "en";

/** Validate untrusted locale data crossing the preload boundary. */
export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return value === "zh" || value === "en";
}

/**
 * Resolve Electron's application locale to one of Harness's shipped locales.
 * Chinese variants stay Chinese; every other or absent value falls back to
 * English as the desktop bootstrap default.
 */
export function resolveDesktopLocale(
  value: string | null | undefined,
): DesktopLocale {
  const primary = value
    ?.trim()
    .toLowerCase()
    .split(/[-_]/u, 1)[0];
  return primary === "zh" ? "zh" : "en";
}
