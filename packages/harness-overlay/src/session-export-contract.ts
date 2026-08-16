export const SESSION_LOG_EXPORT_CHANNEL =
  "minke:session-log-export";

export const SESSION_LOG_EXPORT_PATH = "/api/session.export";

export const SESSION_LOG_EXPORT_TOKEN_PARAMETER = "minkeExport";

const MAX_SESSION_ID_LENGTH = 512;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * Validate the opaque Harness Session id before it crosses the desktop IPC
 * boundary. The Host accepts any non-empty string; the desktop additionally
 * rejects control characters and bounds the message size.
 */
export function parseSessionLogExportId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SESSION_ID_LENGTH ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw new TypeError("invalid Session id");
  }
  return value;
}

/** Derive a portable suggested ZIP filename without interpreting the id. */
export function sessionLogExportFilename(sessionId: unknown): string {
  const value = parseSessionLogExportId(sessionId);
  const segment = value
    .replace(/[^A-Za-z0-9_-]/gu, "_")
    .slice(0, 96);
  return `dsh-session-${segment || "session"}.zip`;
}
