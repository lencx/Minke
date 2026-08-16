import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  DesktopTabsPort,
} from "@minke/harness-overlay/client/bridge.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  isWebTab,
  type WebTabPayload,
  type WebTabStatePatch,
  type WebviewHandle,
} from "./types.ts";

export function fallbackWebTabTitle(value: string): string {
  const url = new URL(value);
  return url.hostname.replace(/^www\./u, "") || url.href;
}

const EXPLICIT_ADDRESS_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const HOST_LIKE_ADDRESS =
  /^(?:localhost|\[[\da-f:.]+\]|(?:\d{1,3}\.){3}\d{1,3}|[^\s./?#:]+(?:\.[^\s./?#:]+)+)(?::\d{1,5})?(?:[/?#].*)?$/iu;
const GOOGLE_SEARCH_URL = "https://www.google.com/search";

export function normalizeWebFaviconUrl(
  candidate: string,
  pageUrl: string,
): string | undefined {
  const faviconUrl = normalizeWebTabUrl(candidate);
  const normalizedPageUrl = normalizeWebTabUrl(pageUrl);
  if (
    faviconUrl === undefined ||
    normalizedPageUrl === undefined
  ) {
    return undefined;
  }
  return faviconUrl;
}

function googleSearchUrl(query: string): string {
  const url = new URL(GOOGLE_SEARCH_URL);
  url.searchParams.set("q", query);
  return url.toString();
}

export function normalizeWebAddressInput(
  candidate: string,
): string | undefined {
  const value = candidate.trim();
  if (value === "") return undefined;
  const explicitUrl = normalizeWebTabUrl(value);
  if (explicitUrl !== undefined) return explicitUrl;
  if (HOST_LIKE_ADDRESS.test(value)) {
    return normalizeWebTabUrl(`https://${value}`);
  }
  if (EXPLICIT_ADDRESS_SCHEME.test(value)) return undefined;
  return googleSearchUrl(value);
}

function readableWebTitle(
  candidate: string | undefined,
  url: string,
): string {
  const title = candidate?.replace(/\s+/gu, " ").trim();
  return title === undefined || title === ""
    ? fallbackWebTabTitle(url)
    : title.slice(0, 160);
}

/** Browser-specific state and commands layered on the generic Tabs runtime. */
export class WebTabsController {
  readonly #tabs: TabsRuntime;
  readonly #desktop: DesktopTabsPort;
  readonly #views = new Map<string, WebviewHandle>();
  #nextBlankId = 0;

  constructor(tabs: TabsRuntime, desktop: DesktopTabsPort) {
    this.#tabs = tabs;
    this.#desktop = desktop;
  }

  open(
    candidate: string,
    title?: string,
    options: { activate?: boolean } = {},
  ): string | undefined {
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) return undefined;
    return this.#tabs.open<WebTabPayload>(
      {
        kind: "web",
        key: url,
        title: readableWebTitle(title, url),
        payload: {
          url,
          loading: true,
          canGoBack: false,
          canGoForward: false,
        },
      },
      options,
    );
  }

  createBlank(title: string): string | undefined {
    return this.#tabs.open<WebTabPayload>({
      kind: "web",
      key: `blank:${++this.#nextBlankId}`,
      title,
      payload: {
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
  }

  attach(id: string, view: WebviewHandle): () => void {
    this.#views.set(id, view);
    return () => {
      if (this.#views.get(id) === view) this.#views.delete(id);
    };
  }

  update(id: string, patch: WebTabStatePatch): void {
    const tab = this.#tabs.tab(id);
    if (tab === undefined || !isWebTab(tab)) return;
    const nextUrl =
      patch.url === undefined
        ? tab.payload.url
        : normalizeWebTabUrl(patch.url) ?? tab.payload.url;
    const error =
      patch.error === undefined
        ? tab.payload.error
        : patch.error === null
          ? undefined
          : patch.error;
    const originChanged =
      patch.url !== undefined &&
      tab.payload.url !== undefined &&
      new URL(tab.payload.url).origin !== new URL(nextUrl).origin;
    const faviconUrl =
      patch.faviconUrl === undefined
        ? originChanged
          ? undefined
          : tab.payload.faviconUrl
        : patch.faviconUrl === null || nextUrl === undefined
          ? undefined
          : normalizeWebFaviconUrl(patch.faviconUrl, nextUrl);
    const payload: WebTabPayload = {
      ...(nextUrl === undefined ? {} : { url: nextUrl }),
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      loading: patch.loading ?? tab.payload.loading,
      canGoBack: patch.canGoBack ?? tab.payload.canGoBack,
      canGoForward: patch.canGoForward ?? tab.payload.canGoForward,
      ...(error === undefined ? {} : { error }),
    };
    this.#tabs.update<WebTabPayload>(id, {
      ...(nextUrl === undefined ? {} : { key: nextUrl }),
      ...(patch.title === undefined
        ? {}
        : { title: readableWebTitle(patch.title, nextUrl) }),
      payload,
    });
  }

  updateFavicon(id: string, candidates: readonly string[]): void {
    const tab = this.#tabs.tab(id);
    if (tab === undefined || !isWebTab(tab)) return;
    const pageUrl = tab.payload.url;
    if (pageUrl === undefined) return;
    const faviconUrl = candidates
      .map((candidate) =>
        normalizeWebFaviconUrl(candidate, pageUrl))
      .find((candidate) => candidate !== undefined);
    if (faviconUrl !== undefined) {
      this.update(id, { faviconUrl });
    }
  }

  syncFromView(
    id: string,
    patch: WebTabStatePatch = {},
  ): void {
    const view = this.#views.get(id);
    if (view === undefined) return;
    let url: string | undefined;
    let title: string | undefined;
    let canGoBack = false;
    let canGoForward = false;
    try {
      url = view.getURL() || undefined;
      title = view.getTitle() || undefined;
      canGoBack = view.canGoBack();
      canGoForward = view.canGoForward();
    } catch {
      // Guest events can race detach; keep the last good tab snapshot.
    }
    this.update(id, {
      url,
      title,
      canGoBack,
      canGoForward,
      ...patch,
    });
  }

  goBack(id: string): void {
    this.#withView(id, (view) => {
      if (view.canGoBack()) view.goBack();
    });
  }

  goForward(id: string): void {
    this.#withView(id, (view) => {
      if (view.canGoForward()) view.goForward();
    });
  }

  navigate(id: string, candidate: string): boolean {
    const url = normalizeWebAddressInput(candidate);
    if (url === undefined) return false;
    const tab = this.#tabs.tab(id);
    if (tab === undefined || !isWebTab(tab)) return false;
    this.update(id, {
      url,
      loading: true,
      error: null,
    });
    const view = this.#views.get(id);
    if (view === undefined) return true;
    try {
      const pending = view.loadURL(url);
      if (
        pending !== undefined &&
        typeof pending.catch === "function"
      ) {
        void pending.catch((error: unknown) => {
          this.update(id, {
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  reloadOrStop(id: string): void {
    const tab = this.#tabs.tab(id);
    if (tab === undefined || !isWebTab(tab)) return;
    this.#withView(id, (view) => {
      if (tab.payload.loading) view.stop();
      else view.reload();
    });
  }

  retry(id: string): void {
    this.#withView(id, (view) => view.reload());
  }

  openExternal(id: string): void {
    const tab = this.#tabs.tab(id);
    if (
      tab !== undefined &&
      isWebTab(tab) &&
      tab.payload.url !== undefined
    ) {
      this.#desktop.openExternal(tab.payload.url);
    }
  }

  dispose(): void {
    this.#views.clear();
  }

  #withView(
    id: string,
    run: (view: WebviewHandle) => void,
  ): boolean {
    const view = this.#views.get(id);
    if (view === undefined) return false;
    try {
      run(view);
      return true;
    } catch {
      // Controls are inert while a guest is attaching or detaching.
      return false;
    }
  }
}
