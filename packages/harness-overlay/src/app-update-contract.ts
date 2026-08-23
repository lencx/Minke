export const APP_UPDATE_SETTINGS_READ_CHANNEL =
  "minke:app-update-settings:read";
export const APP_UPDATE_SETTINGS_WRITE_CHANNEL =
  "minke:app-update-settings:write";
export const APP_UPDATE_CHECK_CHANNEL =
  "minke:app-update:check";

export type AppUpdateCheckResult =
  | "up-to-date"
  | "update-available"
  | "busy"
  | "unavailable";

export interface AppUpdateSettings {
  autoDownload: boolean;
}

export const DEFAULT_APP_UPDATE_SETTINGS: Readonly<AppUpdateSettings> =
  Object.freeze({
    autoDownload: true,
  });

/** Validate the complete result returned by a manual update check. */
export function parseAppUpdateCheckResult(
  value: unknown,
): AppUpdateCheckResult {
  if (
    value !== "up-to-date" &&
    value !== "update-available" &&
    value !== "busy" &&
    value !== "unavailable"
  ) {
    throw new TypeError("invalid app update check result");
  }
  return value;
}

/** Validate the complete, deliberately small application-update preference. */
export function parseAppUpdateSettings(
  value: unknown,
): AppUpdateSettings {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("invalid app update settings");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.autoDownload !== "boolean"
  ) {
    throw new TypeError("invalid app update settings");
  }
  return {
    autoDownload: record.autoDownload,
  };
}
