import type {
  Session,
  WebContents,
} from "electron";

export const HARNESS_CLIPBOARD_WRITE_PERMISSION =
  "clipboard-sanitized-write";

export interface HarnessPermissionRequest {
  permission: string;
  candidateUrl: string | undefined;
  harnessUrl: string | undefined;
  requestingWebContents: unknown;
  activeWebContents: unknown;
}

/**
 * Grant the one browser permission Minke needs only to the active Harness
 * renderer. Same-origin popups and every other permission remain untrusted.
 */
export function canGrantHarnessPermission(
  request: HarnessPermissionRequest,
): boolean {
  if (
    request.permission !== HARNESS_CLIPBOARD_WRITE_PERMISSION ||
    request.candidateUrl === undefined ||
    request.harnessUrl === undefined ||
    request.requestingWebContents === null ||
    request.requestingWebContents === undefined ||
    request.requestingWebContents !== request.activeWebContents
  ) {
    return false;
  }

  try {
    return new URL(request.candidateUrl).origin ===
      new URL(request.harnessUrl).origin;
  } catch {
    return false;
  }
}

export interface HarnessPermissionSources {
  harnessUrl(): string | undefined;
  activeWebContents(): WebContents | undefined;
}

/** Install the fail-closed main-renderer policy on one Electron session. */
export function installHarnessPermissionPolicy(
  target: Pick<
    Session,
    "setPermissionCheckHandler" | "setPermissionRequestHandler"
  >,
  sources: HarnessPermissionSources,
): void {
  target.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      canGrantHarnessPermission({
        permission,
        candidateUrl:
          details.requestingUrl ?? requestingOrigin,
        harnessUrl: sources.harnessUrl(),
        requestingWebContents: webContents,
        activeWebContents: sources.activeWebContents(),
      }),
  );
  target.setPermissionRequestHandler(
    (webContents, permission, callback, details) =>
      callback(
        canGrantHarnessPermission({
          permission,
          candidateUrl: details.requestingUrl,
          harnessUrl: sources.harnessUrl(),
          requestingWebContents: webContents,
          activeWebContents: sources.activeWebContents(),
        }),
      ),
  );
}
