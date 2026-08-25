import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface WebTabPayload {
  readonly url?: string;
  readonly faviconUrl?: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly error?: string;
}

export interface WebviewHandle {
  capturePage(): Promise<{
    toDataURL(): string;
  }>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(
    code: string,
    userGesture?: boolean,
  ): Promise<unknown>;
  getTitle(): string;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void> | void;
  reload(): void;
  stop(): void;
}

export interface WebTabStatePatch {
  url?: string;
  title?: string;
  faviconUrl?: string | null;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string | null;
}

export function isWebTab(
  tab: ManagedTab,
): tab is ManagedTab<WebTabPayload> {
  return tab.kind === "web";
}
