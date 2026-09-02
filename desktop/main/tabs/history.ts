import type {
  WebContents,
} from "electron";
import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  normalizeAgentBrowserHistoryFaviconUrl,
  type AgentBrowserNavigationKind,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";

export interface BrowserHistoryNavigationRecorder {
  recordHumanNavigation(
    sourceId: string,
    url: string,
    navigationKind: AgentBrowserNavigationKind,
  ): number | undefined;
  updateVisitTitle(visitId: number, title: string): void;
  updateVisitFavicon(
    visitId: number,
    pageUrl: string,
    faviconUrl: string,
  ): void;
}

/**
 * Observe committed main-frame navigations for one ordinary Web Tab.
 *
 * This intentionally lives in the main process. A web page cannot forge a
 * visit or choose its actor through preload/IPC traffic.
 */
export function bindWebTabHistory(
  guest: WebContents,
  history: BrowserHistoryNavigationRecorder,
): () => void {
  const sourceId = `web:${String(guest.id)}`;
  let activeVisitId: number | undefined;
  let activeVisitUrl: string | undefined;
  const updateTitle = (title: string): void => {
    if (activeVisitId === undefined || title.trim() === "") return;
    history.updateVisitTitle(activeVisitId, title);
  };
  const record = (
    candidate: string,
    navigationKind: AgentBrowserNavigationKind,
  ): void => {
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) {
      activeVisitId = undefined;
      activeVisitUrl = undefined;
      return;
    }
    activeVisitId = history.recordHumanNavigation(
      sourceId,
      url,
      navigationKind,
    );
    activeVisitUrl =
      activeVisitId === undefined ? undefined : url;
    if (
      activeVisitId === undefined ||
      navigationKind !== "same-document"
    ) return;
    try {
      updateTitle(guest.getTitle());
    } catch {
      // The committed visit remains valid if the guest detaches mid-read.
    }
  };
  const handleDidNavigate = (
    _event: Electron.Event,
    url: string,
  ): void => {
    record(url, "document");
  };
  const handleDidNavigateInPage = (
    _event: Electron.Event,
    url: string,
    isMainFrame: boolean,
  ): void => {
    if (isMainFrame) record(url, "same-document");
  };
  const handleTitle = (
    _event: Electron.Event,
    title: string,
  ): void => {
    updateTitle(title);
  };
  const handleFavicon = (
    _event: Electron.Event,
    favicons: string[],
  ): void => {
    const visitId = activeVisitId;
    const pageUrl = activeVisitUrl;
    if (visitId === undefined || pageUrl === undefined) return;
    let currentUrl: string | undefined;
    try {
      currentUrl = normalizeWebTabUrl(guest.getURL());
    } catch {
      return;
    }
    if (currentUrl !== pageUrl) return;
    const faviconUrl = favicons
      .map((candidate) =>
        normalizeAgentBrowserHistoryFaviconUrl(
          candidate,
          pageUrl,
        ))
      .find((candidate) => candidate !== undefined);
    if (faviconUrl === undefined) return;
    history.updateVisitFavicon(visitId, pageUrl, faviconUrl);
  };

  guest.on("did-navigate", handleDidNavigate);
  guest.on("did-navigate-in-page", handleDidNavigateInPage);
  guest.on("page-title-updated", handleTitle);
  guest.on("page-favicon-updated", handleFavicon);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    guest.removeListener("did-navigate", handleDidNavigate);
    guest.removeListener(
      "did-navigate-in-page",
      handleDidNavigateInPage,
    );
    guest.removeListener("page-title-updated", handleTitle);
    guest.removeListener("page-favicon-updated", handleFavicon);
  };
}
