import type {
  ReactNode,
} from "react";
import {
  useSyncExternalStore,
} from "react";
import {
  History,
  Send,
} from "@lucide/icons";
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
import {
  BackIcon,
  ForwardIcon,
  ReloadIcon,
  StopIcon,
  WebIcon,
} from "@minke/harness-overlay/client/tabs/web/icons.tsx";
import {
  BrowserAnnotateIcon,
  BrowserControlIcon,
} from "./icons.tsx";
import {
  renderAgentBrowserTabView,
} from "./AgentBrowserTabView.tsx";
import type {
  AgentBrowserTabsController,
} from "./controller.ts";
import type {
  AgentBrowserTabsTranslate,
} from "./locales.ts";
import {
  AGENT_BROWSER_TAB_KIND,
  hasStableAgentControl,
  hasStableHumanControl,
  isAgentBrowserTab,
  type AgentBrowserTab,
} from "./types.ts";

export interface AgentBrowserTabRendererDependencies {
  readonly openHistory?: () => void;
}

function statusLabel(
  tab: ManagedTab,
  t: AgentBrowserTabsTranslate,
): string | undefined {
  if (!isAgentBrowserTab(tab)) return undefined;
  if (tab.payload.status === "crashed") {
    return t("agentBrowser.state.crashed");
  }
  if (tab.payload.controlPending) {
    return t("agentBrowser.state.pending");
  }
  return tab.payload.owner === "agent"
    ? t("agentBrowser.state.agent")
    : t("agentBrowser.state.human");
}

function AgentBrowserIdentity({
  tab,
  controller,
  t,
}: {
  readonly tab: AgentBrowserTab;
  readonly controller: AgentBrowserTabsController;
  readonly t: AgentBrowserTabsTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribeAnnotation(tab.id, listener),
    () => controller.getAnnotationSnapshot(tab.id),
    () => controller.getAnnotationSnapshot(tab.id),
  );
  const annotating =
    snapshot.phase === "active" ||
    snapshot.phase === "sending";

  return (
    <div className="minke-agent-browser__identity">
      <span
        className="minke-agent-browser__url"
        title={tab.payload.url}
      >
        {tab.payload.url ?? t("agentBrowser.tab.defaultTitle")}
      </span>
      <span
        className="minke-agent-browser__owner"
        data-annotation-active={annotating || undefined}
      >
        {annotating
          ? (
              <>
                <span className="minke-agent-browser__owner-label">
                  {t("agentBrowser.annotation.status.active")}
                </span>
                <span
                  className={
                    "minke-agent-browser__annotation-status-separator"
                  }
                  aria-hidden="true"
                >
                  ·
                </span>
                <span
                  className={
                    "minke-agent-browser__annotation-status-summary"
                  }
                  role="status"
                >
                  {snapshot.count === 0
                    ? t("agentBrowser.annotation.status.pick")
                    : t("agentBrowser.annotation.status.count")
                        .replace(
                          "{count}",
                          String(snapshot.count),
                        )}
                </span>
              </>
            )
          : (
              <span className="minke-agent-browser__owner-label">
                {statusLabel(tab, t)}
              </span>
            )}
        {tab.payload.controlError !== undefined && (
          <span
            className="minke-agent-browser__control-error"
            role="alert"
            title={tab.payload.controlError}
          >
            {tab.payload.controlError}
          </span>
        )}
      </span>
    </div>
  );
}

function controlSignal(tab: ManagedTab): ReactNode {
  if (!isAgentBrowserTab(tab)) return null;
  const agentActive = hasStableAgentControl(tab.payload);
  return (
    <span
      className="minke-agent-browser__tab-signal"
      data-agent-active={agentActive || undefined}
      data-owner={tab.payload.owner}
      data-status={tab.payload.status}
      data-control-pending={
        tab.payload.controlPending || undefined
      }
      aria-hidden="true"
    >
      <WebIcon size={12} />
    </span>
  );
}

function AnnotationActions({
  tab,
  controller,
  t,
}: {
  readonly tab: AgentBrowserTab;
  readonly controller: AgentBrowserTabsController;
  readonly t: AgentBrowserTabsTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribeAnnotation(tab.id, listener),
    () => controller.getAnnotationSnapshot(tab.id),
    () => controller.getAnnotationSnapshot(tab.id),
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
              ? t("agentBrowser.annotation.action.sending")
              : t("agentBrowser.annotation.action.sendCount")
                  .replace("{count}", String(snapshot.count))
          }
          aria-busy={busy || undefined}
          data-sending={busy || undefined}
          title={
            busy
              ? t("agentBrowser.annotation.action.sending")
              : t("agentBrowser.annotation.action.sendCount")
                  .replace("{count}", String(snapshot.count))
          }
          disabled={
            busy ||
            snapshot.draft !== undefined ||
            (snapshot.staleTargetIds?.length ?? 0) > 0
          }
          onClick={() => {
            void controller.sendAnnotations(tab.id);
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
            ? t("agentBrowser.annotation.action.cancel")
            : t("agentBrowser.annotation.action.start")
        }
        pressed={active}
        activeTone="success"
        disabled={
          snapshot.phase === "starting" ||
          tab.payload.controlPending ||
          tab.payload.status === "crashed"
        }
        onClick={() => {
          if (active) {
            void controller.cancelAnnotation(tab.id);
          } else {
            void controller.startAnnotation(tab.id);
          }
        }}
      >
        <BrowserAnnotateIcon />
      </ToolbarButton>
    </>
  );
}

/** Renderer adapter for main-owned Agent Browser sessions. */
export function createAgentBrowserTabRenderer(
  controller: AgentBrowserTabsController,
  t: AgentBrowserTabsTranslate,
  dependencies?: AgentBrowserTabRendererDependencies,
): TabRenderer {
  return {
    kind: AGENT_BROWSER_TAB_KIND,
    renderIcon: controlSignal,
    renderLeadingActions: (tab) => {
      if (!isAgentBrowserTab(tab)) return null;
      const human = hasStableHumanControl(tab.payload);
      const navigation = tab.payload.navigation;
      const loading = navigation?.loading === true;
      return (
        <>
          <ToolbarButton
            label={t("agentBrowser.nav.back")}
            disabled={
              !human || navigation?.canGoBack !== true
            }
            onClick={() => {
              void controller.navigate(tab.id, "back");
            }}
          >
            <BackIcon />
          </ToolbarButton>
          <ToolbarButton
            label={t("agentBrowser.nav.forward")}
            disabled={
              !human || navigation?.canGoForward !== true
            }
            onClick={() => {
              void controller.navigate(tab.id, "forward");
            }}
          >
            <ForwardIcon />
          </ToolbarButton>
          <ToolbarButton
            label={t(
              loading
                ? "agentBrowser.nav.stop"
                : "agentBrowser.nav.reload",
            )}
            disabled={!human}
            onClick={() => {
              void controller.navigate(
                tab.id,
                loading ? "stop" : "reload",
              );
            }}
          >
            {loading ? <StopIcon /> : <ReloadIcon />}
          </ToolbarButton>
        </>
      );
    },
    renderToolbarCenter: (tab) =>
      isAgentBrowserTab(tab)
        ? (
            <AgentBrowserIdentity
              tab={tab}
              controller={controller}
              t={t}
            />
          )
        : null,
    renderTrailingActions: (tab) => {
      if (!isAgentBrowserTab(tab)) return null;
      const human = tab.payload.owner === "human";
      return (
        <>
          <ToolbarButton
            label={t("agentBrowser.history.action.open")}
            disabled={dependencies?.openHistory === undefined}
            onClick={() => dependencies?.openHistory?.()}
          >
            <LucideIcon icon={History} size={14} />
          </ToolbarButton>
          <AnnotationActions
            tab={tab}
            controller={controller}
            t={t}
          />
          <ToolbarButton
            label={t(
              human
                ? "agentBrowser.action.returnControl"
                : "agentBrowser.action.takeControl",
            )}
            disabled={
              tab.payload.controlPending ||
              tab.payload.status === "crashed"
            }
            onClick={() => {
              void controller.setOwner(
                tab.id,
                human ? "agent" : "human",
              );
            }}
          >
            <BrowserControlIcon />
          </ToolbarButton>
        </>
      );
    },
    subtitle: (tab) => statusLabel(tab, t),
    loading: (tab) =>
      isAgentBrowserTab(tab) &&
      (
        tab.payload.status === "pending" ||
        tab.payload.status === "loading" ||
        tab.payload.controlPending
      ),
    loadingLabel: (tab) =>
      statusLabel(tab, t) ?? tab.title,
    beforeClose: (tab) => controller.beforeClose(tab),
    renderView: (tab, active) =>
      renderAgentBrowserTabView(tab, active, controller, t),
  };
}
