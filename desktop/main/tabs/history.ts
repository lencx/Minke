import type {
  WebContents,
} from "electron";
import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  AgentBrowserNavigationKind,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";

export interface BrowserHistoryNavigationRecorder {
  recordHumanNavigation(
    sourceId: string,
    url: string,
    navigationKind: AgentBrowserNavigationKind,
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
  const record = (
    candidate: string,
    navigationKind: AgentBrowserNavigationKind,
  ): void => {
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) return;
    history.recordHumanNavigation(
      sourceId,
      url,
      navigationKind,
    );
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

  guest.on("did-navigate", handleDidNavigate);
  guest.on("did-navigate-in-page", handleDidNavigateInPage);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    guest.removeListener("did-navigate", handleDidNavigate);
    guest.removeListener(
      "did-navigate-in-page",
      handleDidNavigateInPage,
    );
  };
}
