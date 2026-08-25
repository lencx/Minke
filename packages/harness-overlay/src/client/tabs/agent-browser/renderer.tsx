import type {
  ReactNode,
} from "react";
import {
  useSyncExternalStore,
} from "react";
import {
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
  isAgentBrowserTab,
  type AgentBrowserTab,
} from "./types.ts";

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
): TabRenderer {
  return {
    kind: AGENT_BROWSER_TAB_KIND,
    renderIcon: controlSignal,
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
