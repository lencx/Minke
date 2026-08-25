import type {
  WebContents,
  WebPreferences,
} from "electron";
import {
  normalizeWebTabUrl,
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  normalizeExternalLinkUrl,
  normalizeUserGestureExternalLinkUrl,
} from "@minke/harness-overlay/tabs/web-link-contract.ts";
import type {
  ExternalTabOpener,
} from "./types.ts";

export function canGrantTabWebPermission(
  permission: string,
  candidate: string | undefined,
): boolean {
  if (
    permission !== "clipboard-sanitized-write" ||
    candidate === undefined
  ) {
    return false;
  }
  const url = normalizeWebTabUrl(candidate);
  return url !== undefined && new URL(url).protocol === "https:";
}

function openWithHost(
  external: ExternalTabOpener,
  url: string,
): void {
  void external.openExternal(url).catch((error: unknown) => {
    console.error("Minke could not open the external URL:", error);
  });
}

/**
 * Validate the initial guest URL and overwrite every security-sensitive
 * preference. This runs at Electron's last trusted boundary before a webview
 * guest is created.
 */
export function secureTabWebview(
  webPreferences: WebPreferences,
  params: Record<string, string>,
  trustedPreload: string,
): boolean {
  const url = normalizeWebTabUrl(params.src ?? "");
  if (url === undefined) return false;

  params.src = url;
  params.partition = TABS_WEB_PARTITION;
  delete params.preload;
  delete params.useragent;
  delete params.webpreferences;

  webPreferences.preload = trustedPreload;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.contextIsolation = true;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.partition = TABS_WEB_PARTITION;
  webPreferences.safeDialogs = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.webviewTag = false;
  return true;
}

/** Apply navigation and popup policy to one successfully attached guest. */
export function protectTabWebviewGuest(
  guest: WebContents,
  external: ExternalTabOpener,
): void {
  const keepWebNavigationInsideGuest = (
    event: Electron.Event<
      | Electron.WebContentsWillNavigateEventParams
      | Electron.WebContentsWillRedirectEventParams
    >,
  ): void => {
    if (
      !event.isMainFrame ||
      normalizeWebTabUrl(event.url) !== undefined
    ) {
      return;
    }
    event.preventDefault();
    const externalUrl = normalizeExternalLinkUrl(event.url);
    if (externalUrl !== undefined) {
      openWithHost(external, externalUrl);
    }
  };

  guest.on("will-navigate", keepWebNavigationInsideGuest);
  guest.on("will-redirect", keepWebNavigationInsideGuest);
  guest.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalLinkUrl(url);
    if (externalUrl !== undefined) {
      openWithHost(external, externalUrl);
    }
    return { action: "deny" };
  });
}

export function openUserGestureTabLinkExternally(
  external: ExternalTabOpener,
  candidate: unknown,
): void {
  if (typeof candidate !== "string") return;
  const url = normalizeUserGestureExternalLinkUrl(candidate);
  if (url !== undefined) openWithHost(external, url);
}

export function openNormalizedTabExternally(
  external: ExternalTabOpener,
  candidate: unknown,
): void {
  if (typeof candidate !== "string") return;
  const url = normalizeWebTabUrl(candidate);
  if (url !== undefined) openWithHost(external, url);
}
