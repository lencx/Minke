import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export const BROWSER_HISTORY_TAB_KIND = "browser-history";

export interface BrowserHistoryTabPayload {
  readonly scope: "global";
}

export type BrowserHistoryTab =
  ManagedTab<BrowserHistoryTabPayload>;

export function isBrowserHistoryTab(
  tab: ManagedTab,
): tab is BrowserHistoryTab {
  return tab.kind === BROWSER_HISTORY_TAB_KIND;
}
