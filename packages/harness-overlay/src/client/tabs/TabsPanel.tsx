import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  CloseIcon,
  PlusIcon,
} from "./components/Icons.tsx";
import {
  ToolbarButton,
} from "./components/ToolbarButton.tsx";
import { TABS_PANEL_ID } from "./constants.ts";
import type {
  TabsTranslate,
} from "./locales.ts";
import type {
  TabRendererRegistry,
} from "./registry.ts";
import type {
  TabsRuntime,
} from "./runtime.ts";
import {
  TabsPanelResizeController,
} from "./resize.ts";
import {
  TabsEmptyState,
} from "./TabsEmptyState.tsx";
import type {
  ManagedTab,
} from "./types.ts";

interface SessionListSelection {
  current: string | undefined;
  byId: Readonly<
    Record<string, { readonly cwd?: string } | undefined>
  >;
}

interface DropTarget {
  readonly id: string;
  readonly edge: "before" | "after";
}

export interface TabsPanelProps {
  runtime: TabsRuntime;
  renderers: TabRendererRegistry;
  useSessions: <T>(
    selector: (state: SessionListSelection) => T,
  ) => T;
  t: TabsTranslate;
}

function UnsupportedTabView(props: {
  tab: ManagedTab;
  active: boolean;
  t: TabsTranslate;
}): ReactNode {
  return (
    <div
      id={`minke-tab-view-${props.tab.id}`}
      className="minke-tabs-view"
      role="tabpanel"
      aria-labelledby={`minke-tab-${props.tab.id}`}
      hidden={!props.active}
    >
      <div className="minke-tabs-error" role="alert">
        <h2>{props.t("error.unsupported.title")}</h2>
        <p>
          {props.t("error.unsupported.body", {
            kind: props.tab.kind,
          })}
        </p>
      </div>
    </div>
  );
}

/** Generic right-side tab shell; content behavior arrives through renderers. */
export function TabsPanel({
  runtime,
  renderers,
  useSessions,
  t,
}: TabsPanelProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  useSyncExternalStore(
    renderers.subscribe,
    renderers.getSnapshot,
    renderers.getSnapshot,
  );
  const sessionId = useSessions((state) => state.current);
  const cwd = useSessions((state) => {
    const current = state.current;
    return current === undefined
      ? undefined
      : state.byId[current]?.cwd;
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<TabsPanelResizeController | null>(
    null,
  );
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);
  const [choosingType, setChoosingType] = useState(false);
  const [draggingId, setDraggingId] = useState<
    string | undefined
  >();
  const [dropTarget, setDropTarget] = useState<
    DropTarget | undefined
  >();
  const activeTab = snapshot.tabs.find(
    (tab) => tab.id === snapshot.activeId,
  );
  const activeRenderer =
    activeTab === undefined
      ? undefined
      : renderers.get(activeTab.kind);
  const hasTabs = snapshot.tabs.length > 0;
  const showCreateChooser = !hasTabs || choosingType;
  const canCreateTabs = renderers.creators().length > 0;
  const hasToolbar =
    !showCreateChooser &&
    (activeRenderer?.renderLeadingActions !== undefined ||
      activeRenderer?.renderTrailingActions !== undefined ||
      activeRenderer?.renderToolbarCenter !== undefined);
  const loading =
    !showCreateChooser &&
    activeTab !== undefined &&
    activeRenderer?.loading?.(activeTab) === true;

  useEffect(() => {
    if (snapshot.visible) runtime.syncPanel();
  }, [runtime, sessionId, snapshot.visible]);

  const panelRendered = hasTabs || snapshot.visible;

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null || !panelRendered) return;
    const resize = new TabsPanelResizeController(panel);
    resizeRef.current = resize;
    return () => {
      if (resizeRef.current === resize) {
        resizeRef.current = null;
      }
      resize.dispose();
    };
  }, [panelRendered]);

  useEffect(() => {
    resizeRef.current?.sync();
  }, [snapshot.visible]);

  useEffect(() => {
    if (!snapshot.visible && choosingType) {
      setChoosingType(false);
    }
  }, [choosingType, snapshot.visible]);

  useEffect(() => {
    if (!snapshot.visible || !choosingType) return;
    const panel = panelRef.current;
    const focusFirstOption = (): void => {
      panel
        ?.querySelector<HTMLButtonElement>(
          ".minke-tabs-empty__option",
        )
        ?.focus({ preventScroll: true });
    };
    const view = panel?.ownerDocument.defaultView;
    if (view === undefined || view === null) {
      queueMicrotask(focusFirstOption);
      return;
    }
    const frame = view.requestAnimationFrame(focusFirstOption);
    return () => view.cancelAnimationFrame(frame);
  }, [choosingType, snapshot.visible]);

  useEffect(() => {
    const panel = panelRef.current;
    const wasVisible = wasVisibleRef.current;
    if (snapshot.visible && !wasVisible && panel !== null) {
      const focused = panel.ownerDocument.activeElement;
      if (
        focused instanceof HTMLElement &&
        !panel.contains(focused)
      ) {
        returnFocusRef.current = focused;
      }
    } else if (!snapshot.visible && wasVisible) {
      const target = returnFocusRef.current;
      if (target?.isConnected === true) {
        target.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    }
    wasVisibleRef.current = snapshot.visible;
  }, [snapshot.visible]);

  useEffect(() => {
    if (!snapshot.visible || snapshot.activeId === undefined) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>(
        `#minke-tab-${snapshot.activeId}`,
      )
      ?.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "nearest",
      });
  }, [
    snapshot.activeId,
    snapshot.tabs.length,
    snapshot.visible,
  ]);

  const focusActiveTab = (): void => {
    const view = panelRef.current?.ownerDocument.defaultView;
    const focus = (): void => {
      const activeId = runtime.getSnapshot().activeId;
      if (activeId === undefined) return;
      panelRef.current
        ?.querySelector<HTMLButtonElement>(
          `#minke-tab-${activeId}`,
        )
        ?.focus({ preventScroll: true });
    };
    if (view === undefined || view === null) {
      queueMicrotask(focus);
    } else {
      view.requestAnimationFrame(focus);
    }
  };

  const closeTab = (id: string): void => {
    const tab = runtime.tab(id);
    if (
      tab !== undefined &&
      renderers.get(tab.kind)?.beforeClose?.(tab) === false
    ) {
      return;
    }
    runtime.close(id);
    if (runtime.getSnapshot().activeId !== undefined) {
      focusActiveTab();
    }
  };

  const moveTabFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let next = index;
    if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") {
      next = Math.min(snapshot.tabs.length - 1, index + 1);
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = snapshot.tabs.length - 1;
    else return;

    event.preventDefault();
    const tab = snapshot.tabs[next];
    if (tab === undefined) return;
    setChoosingType(false);
    runtime.activate(tab.id);
    panelRef.current
      ?.querySelector<HTMLButtonElement>(`#minke-tab-${tab.id}`)
      ?.focus();
  };

  const clearTabDrag = (): void => {
    setDraggingId(undefined);
    setDropTarget(undefined);
  };

  const dragTabOver = (
    event: DragEvent<HTMLDivElement>,
    id: string,
  ): void => {
    if (draggingId === undefined || draggingId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge =
      event.clientX < bounds.left + bounds.width / 2
        ? "before"
        : "after";
    if (dropTarget?.id !== id || dropTarget.edge !== edge) {
      setDropTarget({ id, edge });
    }
  };

  if (!panelRendered) return null;

  const releaseResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current?.endExtendedDrag();
  };

  return (
    <aside
      id={TABS_PANEL_ID}
      ref={panelRef}
      className="minke-tabs-panel"
      data-minke-tabs
      data-open={snapshot.visible || undefined}
      aria-label={t("panel.label")}
      aria-hidden={!snapshot.visible}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          !choosingType ||
          !hasTabs
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setChoosingType(false);
        focusActiveTab();
      }}
    >
      <div
        className="minke-tabs-resize-handle"
        role="separator"
        aria-label={t("panel.resize")}
        aria-orientation="vertical"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current?.beginExtendedDrag(event.clientX);
        }}
        onPointerMove={(event) => {
          if (
            !event.currentTarget.hasPointerCapture(event.pointerId)
          ) {
            return;
          }
          resizeRef.current?.moveExtendedDrag(event.clientX);
        }}
        onPointerUp={releaseResize}
        onPointerCancel={releaseResize}
        onKeyDown={(event) => {
          if (
            event.key !== "ArrowLeft" &&
            event.key !== "ArrowRight"
          ) {
            return;
          }
          event.preventDefault();
          const step = event.shiftKey ? 32 : 16;
          resizeRef.current?.adjustExtendedWidth(
            event.key === "ArrowLeft" ? step : -step,
          );
        }}
      />

      {hasTabs && (
      <div
        className="minke-tabs-chrome"
        data-single-row={!hasToolbar || undefined}
      >
        <div className="minke-tabs-tabbar">
          <div
            className="minke-tabs-strip"
            role="tablist"
            aria-label={t("panel.label")}
          >
            {snapshot.tabs.map((tab, index) => {
              const active = tab.id === snapshot.activeId;
              const renderer = renderers.get(tab.kind);
              return (
              <div
                key={tab.id}
                className="minke-tab"
                data-active={active || undefined}
                data-dragging={
                  draggingId === tab.id || undefined
                }
                data-drop-before={
                  dropTarget?.id === tab.id &&
                  dropTarget.edge === "before"
                    ? true
                    : undefined
                }
                data-drop-after={
                  dropTarget?.id === tab.id &&
                  dropTarget.edge === "after"
                    ? true
                    : undefined
                }
                draggable
                title={t("tab.reorder", { title: tab.title })}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "text/plain",
                    tab.id,
                  );
                  setDraggingId(tab.id);
                  setDropTarget(undefined);
                }}
                onDragOver={(event) =>
                  dragTabOver(event, tab.id)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (
                    draggingId !== undefined &&
                    dropTarget !== undefined
                  ) {
                    runtime.place(
                      draggingId,
                      dropTarget.id,
                      dropTarget.edge,
                    );
                    focusActiveTab();
                  }
                  clearTabDrag();
                }}
                onDragEnd={clearTabDrag}
              >
                  <button
                    type="button"
                    id={`minke-tab-${tab.id}`}
                    className="minke-tab__target"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`minke-tab-view-${tab.id}`}
                    aria-keyshortcuts="Delete Alt+ArrowLeft Alt+ArrowRight"
                    tabIndex={active ? 0 : -1}
                    title={tab.title}
                    onClick={() => {
                      setChoosingType(false);
                      runtime.activate(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.altKey &&
                        (event.key === "ArrowLeft" ||
                          event.key === "ArrowRight")
                      ) {
                        event.preventDefault();
                        runtime.move(
                          tab.id,
                          event.key === "ArrowLeft" ? -1 : 1,
                        );
                        focusActiveTab();
                        return;
                      }
                      if (event.key === "Delete") {
                        event.preventDefault();
                        closeTab(tab.id);
                        return;
                      }
                      moveTabFocus(event, index);
                    }}
                  >
                    <span className="minke-tab__mark">
                      {renderer?.renderIcon(tab)}
                    </span>
                    <span className="minke-tab__title">
                      {tab.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="minke-tab__close"
                    aria-label={t("tab.close", {
                      title: tab.title,
                    })}
                    title={t("tab.close", {
                      title: tab.title,
                    })}
                    tabIndex={-1}
                    onClick={() => closeTab(tab.id)}
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="minke-tabs-tabbar__actions">
            <ToolbarButton
              label={t("tab.new")}
              disabled={!canCreateTabs}
              pressed={choosingType}
              onClick={() => setChoosingType((open) => !open)}
            >
              <PlusIcon />
            </ToolbarButton>
          </div>
        </div>

        {hasToolbar && (
        <div className="minke-tabs-toolbar">
          <div className="minke-tabs-toolbar__nav">
            {activeTab !== undefined &&
              activeRenderer?.renderLeadingActions?.(activeTab)}
          </div>

          <div className="minke-tabs-toolbar__center">
            {activeTab !== undefined &&
            activeRenderer?.renderToolbarCenter !== undefined
              ? activeRenderer.renderToolbarCenter(activeTab)
              : (
                <div className="minke-tabs-toolbar__identity">
                  <span className="minke-tabs-toolbar__title">
                    {activeTab?.title ?? t("panel.label")}
                  </span>
                  {activeTab !== undefined &&
                    activeRenderer?.subtitle !== undefined && (
                      <span className="minke-tabs-toolbar__site">
                        {activeRenderer.subtitle(activeTab)}
                      </span>
                    )}
                </div>
              )}
          </div>

          <div className="minke-tabs-toolbar__actions">
            {activeTab !== undefined &&
              activeRenderer?.renderTrailingActions?.(activeTab)}
          </div>
        </div>
        )}
      </div>
      )}

      {hasTabs && (
      <div
        className="minke-tabs-progress"
        data-loading={loading || undefined}
        role={loading ? "status" : undefined}
        aria-label={
          loading && activeTab !== undefined
            ? activeRenderer?.loadingLabel?.(activeTab)
            : undefined
        }
      >
        <span />
      </div>
      )}

      <div className="minke-tabs-content">
        {showCreateChooser && (
          <TabsEmptyState
            renderers={renderers}
            context={{ cwd }}
            t={t}
            onCreated={() => setChoosingType(false)}
          />
        )}
        {hasTabs && snapshot.tabs.map((tab) => {
          const renderer = renderers.get(tab.kind);
          const active = tab.id === snapshot.activeId;
          return renderer === undefined
            ? (
              <UnsupportedTabView
                key={tab.id}
                tab={tab}
                active={active && !showCreateChooser}
                t={t}
              />
            )
            : renderer.renderView(
              tab,
              active && !showCreateChooser,
            );
        })}
      </div>
    </aside>
  );
}
