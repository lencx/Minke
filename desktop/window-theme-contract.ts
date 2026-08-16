/** Renderer-to-main channel carrying the app's native window appearance. */
export const WINDOW_THEME_CHANNEL = "minke:window-theme";

/** Resolved color schemes supported by Electron's native theme bridge. */
export type WindowColorScheme = "light" | "dark";

/** Built-in preference owned by Harness's theme service. */
export type WindowThemePreference = "light" | "dark" | "system";

/** Early boot projection, before the Harness theme service is available. */
export type ResolvedWindowThemeMessage = Readonly<{
  colorScheme: WindowColorScheme;
}>;

/** Authoritative Harness snapshot, including whether the OS stays in charge. */
export type HarnessWindowThemeMessage = Readonly<{
  preference: WindowThemePreference;
  colorScheme: WindowColorScheme;
}>;

export type WindowThemeMessage =
  | ResolvedWindowThemeMessage
  | HarnessWindowThemeMessage;

/** Validate untrusted renderer data before it can change process-wide native UI. */
export function isWindowThemeMessage(
  value: unknown,
): value is WindowThemeMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const colorScheme = record.colorScheme;
  if (colorScheme !== "light" && colorScheme !== "dark") return false;
  if (keys.length === 1) return true;
  if (keys.length !== 2) return false;
  const preference = record.preference;
  return (
    preference === "system" ||
    preference === colorScheme
  );
}
