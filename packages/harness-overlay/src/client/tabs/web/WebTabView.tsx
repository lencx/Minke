import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  IpcMessageEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag,
} from "electron";
import { mountPersistentBrowser } from "./guest.ts";
import {
  parseWebTabLocalPathRequest,
  TABS_WEB_LOCAL_PATH_CHANNEL,
} from "@minke/harness-overlay/tabs/web-link-contract.ts";
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
import {
  webAnnotationLabels,
} from "./locales.ts";
import {
  DomAnnotationOverlay,
} from "../agent-browser/DomAnnotationOverlay.tsx";

function syncNavigation(
  controller: WebTabsController,
  id: string,
  patch: WebTabStatePatch = {},
): void {
  controller.syncFromView(id, patch);
}

export interface WebTabViewOptions {
  allowPopups?: boolean;
  annotations?: boolean;
}

export interface WebTabViewProps extends WebTabViewOptions {
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
  allowPopups = true,
  annotations = true,
}: WebTabViewProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const currentTab = useRef(tab);
  currentTab.current = tab;
  const [attempt, setAttempt] = useState(0);
  const canCreateView = tab.payload.url !== undefined;
  const annotation = useSyncExternalStore(
    (listener) => controller.annotation.subscribe(
      tab.id,
      listener,
    ),
    () => controller.annotation.getSnapshot(tab.id),
    () => controller.annotation.getSnapshot(tab.id),
  );

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
    let detach = (): void => {};
    const disposeGuest = mountPersistentBrowser(host, view, {
      label: tab.title, allowPopups,
      ready() {
        viewRef.current = view;
        detach = controller.attach(tab.id, view);
        controller.navigate(tab.id, currentTab.current.payload.url ?? initialUrl);
      },
      openRequested: url => controller.openRequested(url),
      failed(error) {
        detach();
        viewRef.current = null;
        controller.update(tab.id, { loading: false, error: error instanceof Error ? error.message : String(error) });
      },
    });
    const handleStart = (): void => {
      controller.pageChanged(tab.id);
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
      controller.pageChanged(tab.id);
      syncNavigation(controller, tab.id, {
        url: event.url,
        error: null,
      });
    };
    const handleNavigateInPage = (
      event: DidNavigateInPageEvent,
    ): void => {
      if (!event.isMainFrame) return;
      controller.pageChanged(tab.id);
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
    const handleIpcMessage = (
      event: IpcMessageEvent,
    ): void => {
      if (event.channel !== TABS_WEB_LOCAL_PATH_CHANNEL) return;
      try {
        controller.openLocalPath(
          parseWebTabLocalPathRequest(event.args[0]),
        );
      } catch {
        // Invalid guest messages never gain access to Files tabs.
      }
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
    view.addEventListener("ipc-message", handleIpcMessage);
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
      view.removeEventListener("ipc-message", handleIpcMessage);
      detach();
      disposeGuest();
      viewRef.current = null;
    };
  }, [canCreateView, controller, tab.id, allowPopups, attempt]);

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
      data-annotation-phase={
        annotation.phase === "idle" ? undefined : annotation.phase
      }
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
              onClick={() => viewRef.current === null ? setAttempt(value => value + 1) : controller.retry(tab.id)}
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
      {annotations && <DomAnnotationOverlay
        tabId={tab.id}
        snapshot={annotation}
        controller={controller.annotation}
        labels={webAnnotationLabels(t)}
      />}
    </div>
  );
}

export function renderWebTabView(
  tab: ManagedTab,
  active: boolean,
  controller: WebTabsController,
  t: WebTabsTranslate,
  options: WebTabViewOptions = {},
): ReactNode {
  if (!isWebTab(tab)) return null;
  return (
    <WebTabView
      {...options}
      key={tab.id}
      tab={tab}
      active={active}
      controller={controller}
      t={t}
    />
  );
}
