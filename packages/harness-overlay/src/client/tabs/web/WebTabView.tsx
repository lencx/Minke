import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag,
} from "electron";
import {
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import {
  ExternalIcon,
  WebIcon,
} from "./icons.tsx";
import type {
  WebTabsController,
} from "./controller.ts";
import {
  isWebTab,
  type WebTabPayload,
  type WebTabStatePatch,
} from "./types.ts";
import type {
  WebTabsTranslate,
} from "./locales.ts";

function syncNavigation(
  controller: WebTabsController,
  id: string,
  patch: WebTabStatePatch = {},
): void {
  controller.syncFromView(id, patch);
}

export interface WebTabViewProps {
  tab: ManagedTab<WebTabPayload>;
  active: boolean;
  controller: WebTabsController;
  t: WebTabsTranslate;
}

/** One persistent Electron guest and its local failure recovery surface. */
export function WebTabView({
  tab,
  active,
  controller,
  t,
}: WebTabViewProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const canCreateView = tab.payload.url !== undefined;

  useEffect(() => {
    const host = hostRef.current;
    const initialUrl = tab.payload.url;
    if (
      host === null ||
      initialUrl === undefined ||
      !canCreateView
    ) {
      return;
    }

    const view = host.ownerDocument.createElement(
      "webview",
    ) as WebviewTag;
    view.className = "minke-tabs-view__guest";
    view.setAttribute("src", initialUrl);
    view.setAttribute("partition", TABS_WEB_PARTITION);
    view.setAttribute(
      "webpreferences",
      [
        "contextIsolation=yes",
        "nodeIntegration=no",
        "sandbox=yes",
        "webSecurity=yes",
      ].join(","),
    );
    view.setAttribute("aria-label", tab.title);
    viewRef.current = view;

    const detach = controller.attach(tab.id, view);
    const handleStart = (): void => {
      syncNavigation(controller, tab.id, {
        loading: true,
        error: null,
      });
    };
    const handleStop = (): void => {
      syncNavigation(controller, tab.id, { loading: false });
    };
    const handleTitle = (
      event: PageTitleUpdatedEvent,
    ): void => {
      syncNavigation(controller, tab.id, {
        title: event.title,
      });
    };
    const handleFavicon = (
      event: PageFaviconUpdatedEvent,
    ): void => {
      controller.updateFavicon(tab.id, event.favicons);
    };
    const handleNavigate = (
      event: DidNavigateEvent,
    ): void => {
      syncNavigation(controller, tab.id, {
        url: event.url,
        error: null,
      });
    };
    const handleNavigateInPage = (
      event: DidNavigateInPageEvent,
    ): void => {
      if (!event.isMainFrame) return;
      syncNavigation(controller, tab.id, { url: event.url });
    };
    const handleFailure = (
      event: DidFailLoadEvent,
    ): void => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      syncNavigation(controller, tab.id, {
        loading: false,
        url: event.validatedURL,
        error: event.errorDescription,
      });
    };

    view.addEventListener("did-start-loading", handleStart);
    view.addEventListener("did-stop-loading", handleStop);
    view.addEventListener("page-title-updated", handleTitle);
    view.addEventListener(
      "page-favicon-updated",
      handleFavicon,
    );
    view.addEventListener("did-navigate", handleNavigate);
    view.addEventListener(
      "did-navigate-in-page",
      handleNavigateInPage,
    );
    view.addEventListener("did-fail-load", handleFailure);
    host.append(view);

    return () => {
      view.removeEventListener("did-start-loading", handleStart);
      view.removeEventListener("did-stop-loading", handleStop);
      view.removeEventListener("page-title-updated", handleTitle);
      view.removeEventListener(
        "page-favicon-updated",
        handleFavicon,
      );
      view.removeEventListener("did-navigate", handleNavigate);
      view.removeEventListener(
        "did-navigate-in-page",
        handleNavigateInPage,
      );
      view.removeEventListener("did-fail-load", handleFailure);
      detach();
      view.remove();
      viewRef.current = null;
    };
  }, [canCreateView, controller, tab.id]);

  useEffect(() => {
    viewRef.current?.setAttribute("aria-label", tab.title);
  }, [tab.title]);

  return (
    <div
      ref={hostRef}
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view"
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      hidden={!active}
    >
      {tab.payload.url === undefined && (
        <div className="minke-tabs-blank">
          <span className="minke-tabs-blank__icon">
            <WebIcon size={34} />
          </span>
          <h2>{t("web.blank.title")}</h2>
          <p>{t("web.blank.body")}</p>
        </div>
      )}
      {tab.payload.error !== undefined && (
        <div className="minke-tabs-error" role="alert">
          <span className="minke-tabs-error__icon">
            <WebIcon />
          </span>
          <h2>{t("web.error.title")}</h2>
          <p>{t("web.error.body")}</p>
          <code>{tab.payload.error}</code>
          <div className="minke-tabs-error__actions">
            <button
              type="button"
              onClick={() => controller.retry(tab.id)}
            >
              {t("web.error.retry")}
            </button>
            <button
              type="button"
              onClick={() => controller.openExternal(tab.id)}
            >
              <ExternalIcon />
              {t("web.error.external")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function renderWebTabView(
  tab: ManagedTab,
  active: boolean,
  controller: WebTabsController,
  t: WebTabsTranslate,
): ReactNode {
  if (!isWebTab(tab)) return null;
  return (
    <WebTabView
      key={tab.id}
      tab={tab}
      active={active}
      controller={controller}
      t={t}
    />
  );
}
