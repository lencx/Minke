import type {
  ManagedTab,
} from "../types.ts";

export interface WebTabPayload {
  readonly url?: string;
  readonly faviconUrl?: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly error?: string;
}

export interface WebviewHandle {
  canGoBack(): boolean;
  canGoForward(): boolean;
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
