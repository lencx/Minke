import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ToolbarButton,
} from "../components/ToolbarButton.tsx";
import type {
  ManagedTab,
  TabRenderer,
} from "../types.ts";
import type {
  WebTabsController,
} from "./controller.ts";
import {
  BackIcon,
  ExternalIcon,
  ForwardIcon,
  ReloadIcon,
  PluginsIcon,
  StopIcon,
  WebIcon,
} from "./icons.tsx";
import {
  renderWebTabView,
} from "./WebTabView.tsx";
import {
  WebAddressBar,
} from "./WebAddressBar.tsx";
import {
  isWebTab,
} from "./types.ts";
import type {
  WebTabsTranslate,
} from "./locales.ts";
import {
  openDshPlugins,
} from "./plugins.ts";

function siteLabel(tab: ManagedTab): string | undefined {
  if (!isWebTab(tab)) return undefined;
  if (tab.payload.url === undefined) return undefined;
  try {
    return new URL(tab.payload.url).hostname.replace(/^www\./u, "");
  } catch {
    return tab.payload.url;
  }
}

function WebTabIcon(props: { tab: ManagedTab }): ReactNode {
  const webTab = isWebTab(props.tab) ? props.tab : undefined;
  const faviconUrl = webTab?.payload.faviconUrl;
  const loading = webTab?.payload.loading ?? false;
  const [displayedUrl, setDisplayedUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => {
    if (faviconUrl === undefined) {
      setFailedUrl(undefined);
      if (!loading) setDisplayedUrl(undefined);
      return;
    }
    if (!loading && faviconUrl === failedUrl) {
      setDisplayedUrl(undefined);
    }
  }, [failedUrl, faviconUrl, loading]);

  const pendingUrl =
    faviconUrl !== undefined &&
    faviconUrl !== displayedUrl &&
    faviconUrl !== failedUrl
      ? faviconUrl
      : undefined;
  const busy = loading || pendingUrl !== undefined;

  return (
    <span
      className="minke-tab__favicon-shell"
      data-loading={busy || undefined}
      aria-hidden="true"
    >
      {displayedUrl === undefined
        ? (
          <span className="minke-tab__favicon-fallback">
            <WebIcon size={12} />
          </span>
        )
        : (
          <img
            key={displayedUrl}
            className="minke-tab__favicon"
            src={displayedUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => {
              setFailedUrl(displayedUrl);
              setDisplayedUrl(undefined);
            }}
          />
        )}
      {pendingUrl !== undefined && (
        <img
          className="minke-tab__favicon-preload"
          src={pendingUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setDisplayedUrl(pendingUrl);
            setFailedUrl(undefined);
          }}
          onError={() => setFailedUrl(pendingUrl)}
        />
      )}
    </span>
  );
}

function leadingActions(
  tab: ManagedTab,
  t: WebTabsTranslate,
  controller: WebTabsController,
): ReactNode {
  if (!isWebTab(tab)) return null;
  return (
    <>
      <ToolbarButton
        label={t("web.nav.back")}
        disabled={!tab.payload.canGoBack}
        onClick={() => controller.goBack(tab.id)}
      >
        <BackIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("web.nav.forward")}
        disabled={!tab.payload.canGoForward}
        onClick={() => controller.goForward(tab.id)}
      >
        <ForwardIcon />
      </ToolbarButton>
      <ToolbarButton
        label={
          tab.payload.loading
            ? t("web.nav.stop")
            : t("web.nav.reload")
        }
        onClick={() => controller.reloadOrStop(tab.id)}
      >
        {tab.payload.loading ? <StopIcon /> : <ReloadIcon />}
      </ToolbarButton>
    </>
  );
}

/** Browser renderer registered beside, not inside, the generic Tabs core. */
export function createWebTabRenderer(
  controller: WebTabsController,
  t: WebTabsTranslate,
): TabRenderer {
  const createBlank = (): void => {
    controller.createBlank(t("web.tab.new"));
  };
  return {
    kind: "web",
    createOptions: () => [
      {
        id: "browser",
        label: t("web.create.label"),
        order: 20,
        icon: <WebIcon size={20} />,
        create: createBlank,
      },
      {
        id: "plugins",
        label: t("web.create.plugins"),
        order: 30,
        icon: <PluginsIcon size={20} />,
        create: () => {
          openDshPlugins(controller, t("web.create.plugins"));
        },
      },
    ],
    renderIcon: (tab) => <WebTabIcon tab={tab} />,
    renderLeadingActions: (tab) =>
      leadingActions(tab, t, controller),
    renderTrailingActions: (tab) => (
      <ToolbarButton
        label={t("web.nav.external")}
        disabled={
          !isWebTab(tab) || tab.payload.url === undefined
        }
        onClick={() => controller.openExternal(tab.id)}
      >
        <ExternalIcon />
      </ToolbarButton>
    ),
    renderToolbarCenter: (tab) =>
      isWebTab(tab)
        ? (
          <WebAddressBar
            tab={tab}
            controller={controller}
            t={t}
          />
        )
        : null,
    subtitle: siteLabel,
    loading: (tab) =>
      isWebTab(tab) && tab.payload.loading,
    loadingLabel: (tab) =>
      t("web.state.loading", { title: tab.title }),
    renderView: (tab, active) =>
      renderWebTabView(tab, active, controller, t),
  };
}
