import {
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Send,
} from "@lucide/icons";
import {
  BrowserAnnotationIcon,
} from "@minke/harness-overlay/client/tabs/browser-annotation/BrowserAnnotationIcon.tsx";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import {
  ToolbarButton,
} from "@minke/harness-overlay/client/tabs/components/ToolbarButton.tsx";
import type {
  ManagedTab,
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  WebTabsController,
} from "./controller.ts";
import {
  BackIcon,
  ExternalIcon,
  ForwardIcon,
  ReloadIcon,
  StopIcon,
  WebIcon,
} from "./icons.tsx";
import { WebTabIcon } from "./WebTabIcon.tsx";
import {
  renderWebTabView,
  type WebTabViewOptions,
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

function siteLabel(tab: ManagedTab): string | undefined {
  if (!isWebTab(tab)) return undefined;
  if (tab.payload.url === undefined) return undefined;
  try {
    return new URL(tab.payload.url).hostname.replace(/^www\./u, "");
  } catch {
    return tab.payload.url;
  }
}

export function renderWebNavigationActions(
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

function WebAnnotationActions({
  tab,
  controller,
  t,
}: {
  readonly tab: ManagedTab;
  readonly controller: WebTabsController;
  readonly t: WebTabsTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => controller.annotation.subscribe(
      tab.id,
      listener,
    ),
    () => controller.annotation.getSnapshot(tab.id),
    () => controller.annotation.getSnapshot(tab.id),
  );
  const active =
    snapshot.phase === "active" ||
    snapshot.phase === "sending";
  const busy =
    snapshot.phase === "starting" ||
    snapshot.phase === "sending";
  return (
    <>
      {active && snapshot.count > 0 && (
        <button
          type="button"
          className="minke-agent-browser__annotation-send-action"
          aria-label={
            busy
              ? t("web.annotation.action.sending")
              : t("web.annotation.action.sendCount")
                  .replace("{count}", String(snapshot.count))
          }
          aria-busy={busy || undefined}
          data-sending={busy || undefined}
          title={
            busy
              ? t("web.annotation.action.sending")
              : t("web.annotation.action.sendCount")
                  .replace("{count}", String(snapshot.count))
          }
          disabled={
            busy ||
            snapshot.draft !== undefined ||
            (snapshot.staleTargetIds?.length ?? 0) > 0
          }
          onClick={() => {
            void controller.annotation.send(tab.id);
          }}
        >
          <LucideIcon icon={Send} size={12} />
          <span
            className="minke-agent-browser__annotation-send-count"
          >
            {snapshot.count}
          </span>
        </button>
      )}
      <ToolbarButton
        label={
          active
            ? t("web.annotation.action.cancel")
            : t("web.annotation.action.start")
        }
        pressed={active}
        activeTone="success"
        disabled={
          !isWebTab(tab) ||
          tab.payload.url === undefined ||
          tab.payload.loading ||
          snapshot.phase === "starting"
        }
        onClick={() => {
          if (active) {
            void controller.annotation.cancel(tab.id);
          } else {
            void controller.annotation.start(tab.id);
          }
        }}
      >
        <BrowserAnnotationIcon />
      </ToolbarButton>
    </>
  );
}

/** Browser renderer registered beside, not inside, the generic Tabs core. */
export function createWebTabRenderer(
  controller: WebTabsController,
  t: WebTabsTranslate,
  options: WebTabViewOptions = {},
): TabRenderer {
  const createBlank = (): void => {
    controller.createBlank(t("web.tab.new"));
  };
  return {
    kind: "web",
    persistence: {
      save: tab => isWebTab(tab) ? { url: tab.payload.url } : undefined,
      restore: tab => controller.restore(tab),
    },
    createOptions: () => [
      {
        id: "browser",
        label: t("web.create.label"),
        order: 20,
        icon: <WebIcon size={20} />,
        create: createBlank,
      },
    ],
    renderIcon: (tab) => (
      <WebTabIcon
        faviconUrl={isWebTab(tab) ? tab.payload.faviconUrl : undefined}
        loading={isWebTab(tab) && tab.payload.loading}
      />
    ),
    renderLeadingActions: (tab) =>
      renderWebNavigationActions(tab, t, controller),
    renderTrailingActions: (tab) => (
      <>
        {options.annotations !== false && <WebAnnotationActions
          tab={tab}
          controller={controller}
          t={t}
        />}
        <ToolbarButton
          label={t("web.nav.external")}
          disabled={
            !isWebTab(tab) || tab.payload.url === undefined
          }
          onClick={() => controller.openExternal(tab.id)}
        >
          <ExternalIcon />
        </ToolbarButton>
      </>
    ),
    renderToolbarCenter: (tab, visible = true) =>
      isWebTab(tab)
        ? (
          <WebAddressBar
            tab={tab}
            visible={visible}
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
      renderWebTabView(tab, active, controller, t, options),
  };
}
