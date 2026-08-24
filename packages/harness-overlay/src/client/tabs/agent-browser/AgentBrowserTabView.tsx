import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  WebviewTag,
} from "electron";
import type {
  AgentBrowserTabsController,
} from "./controller.ts";
import type {
  AgentBrowserTabsTranslate,
} from "./locales.ts";
import {
  hasStableAgentControl,
  isAgentBrowserTab,
  type AgentBrowserTab,
} from "./types.ts";
import {
  configureAgentBrowserWebview,
} from "./webview.ts";
import {
  DomAnnotationOverlay,
} from "./DomAnnotationOverlay.tsx";
import {
  AgentCursorOverlay,
} from "./AgentCursorOverlay.tsx";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface AgentBrowserTabViewProps {
  readonly tab: AgentBrowserTab;
  readonly active: boolean;
  readonly controller: AgentBrowserTabsController;
  readonly t: AgentBrowserTabsTranslate;
}

/** Electron `<webview>` projection with exclusive agent/human input ownership. */
export function AgentBrowserTabView({
  tab,
  active,
  controller,
  t,
}: AgentBrowserTabViewProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const takeoverRef = useRef<HTMLButtonElement | null>(null);
  const annotation = useSyncExternalStore(
    (listener) => controller.subscribeAnnotation(tab.id, listener),
    () => controller.getAnnotationSnapshot(tab.id),
    () => controller.getAnnotationSnapshot(tab.id),
  );
  const crashed = tab.payload.status === "crashed";
  const shielded =
    crashed ||
    tab.payload.controlPending ||
    tab.payload.owner === "agent";
  const agentActive = hasStableAgentControl(tab.payload);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = host.ownerDocument.createElement(
      "webview",
    ) as WebviewTag;
    configureAgentBrowserWebview(view, {
      partition: tab.payload.partition,
      label: tab.title,
      userAgent: globalThis.navigator.userAgent,
    });
    viewRef.current = view;
    host.append(view);
    return () => {
      view.remove();
      viewRef.current = null;
    };
  }, [tab.id, tab.payload.partition]);

  useEffect(() => {
    viewRef.current?.setAttribute("aria-label", tab.title);
  }, [tab.title]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const interactive =
      tab.payload.owner === "human" &&
      !tab.payload.controlPending &&
      !crashed;
    if (interactive) {
      view.removeAttribute("inert");
      view.setAttribute("tabindex", "0");
      return;
    }
    const heldFocus = view.ownerDocument.activeElement === view;
    view.setAttribute("inert", "");
    view.setAttribute("tabindex", "-1");
    view.blur();
    if (heldFocus) takeoverRef.current?.focus();
  }, [
    crashed,
    tab.payload.controlPending,
    tab.payload.owner,
    tab.payload.partition,
  ]);

  const shieldLabel = crashed
    ? t("agentBrowser.state.crashed")
    : tab.payload.controlPending
      ? t("agentBrowser.state.pending")
      : t("agentBrowser.state.agent");

  return (
    <div
      ref={hostRef}
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view minke-agent-browser__view"
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      hidden={!active}
      data-owner={tab.payload.owner}
      data-status={tab.payload.status}
      data-control-pending={
        tab.payload.controlPending || undefined
      }
      data-agent-active={agentActive || undefined}
      data-annotation-phase={
        annotation.phase === "idle" ? undefined : annotation.phase
      }
    >
      {shielded && (
        <div
          className="minke-agent-browser__shield"
          data-agent-input-shield=""
          role="status"
          aria-label={shieldLabel}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => event.preventDefault()}
        >
          <div className="minke-agent-browser__shield-card">
            <span>{shieldLabel}</span>
            {!crashed && !tab.payload.controlPending && (
              <button
                ref={takeoverRef}
                type="button"
                onClick={() => {
                  void controller.setOwner(tab.id, "human");
                }}
              >
                {t("agentBrowser.action.takeControl")}
              </button>
            )}
            {(tab.payload.error ?? tab.payload.controlError) !==
                undefined && (
              <small>
                {tab.payload.error ?? tab.payload.controlError}
              </small>
            )}
          </div>
        </div>
      )}
      {agentActive && tab.payload.cursor !== undefined && (
        <AgentCursorOverlay cursor={tab.payload.cursor} />
      )}
      <DomAnnotationOverlay
        tabId={tab.id}
        snapshot={annotation}
        controller={controller}
        t={t}
      />
    </div>
  );
}

export function renderAgentBrowserTabView(
  tab: ManagedTab,
  active: boolean,
  controller: AgentBrowserTabsController,
  t: AgentBrowserTabsTranslate,
): ReactNode {
  if (!isAgentBrowserTab(tab)) return null;
  return (
    <AgentBrowserTabView
      key={tab.id}
      tab={tab}
      active={active}
      controller={controller}
      t={t}
    />
  );
}
