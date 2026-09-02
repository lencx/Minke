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
  tabsPanelId,
  type TabsPanelPlacement,
} from "./constants.ts";
import type {
  TabsTranslate,
} from "./locales.ts";
import type {
  TabsLayoutStateRuntime,
} from "./layout-state.ts";
import type {
  TabRendererRegistry,
} from "./registry.ts";
import type {
  RightTabsPresentationPort,
} from "./responsive-right-host.ts";
import type {
  TabsRuntime,
} from "./runtime.ts";
import {
  TabsPanelResizeController,
} from "./resize.ts";
import {
  TabsEmptyState,
} from "./TabsEmptyState.tsx";
import {
  TabsCreateMenu,
} from "./TabsCreateMenu.tsx";
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

const dockedPresentation = () => "docked" as const;
const ignorePresentationChanges = () => () => {};
const drawerFocusableSelector = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface TabsPanelProps {
  placement: TabsPanelPlacement;
  runtime: TabsRuntime;
  renderers: TabRendererRegistry;
  layoutState: TabsLayoutStateRuntime;
  presentation?: RightTabsPresentationPort;
  setRightTrackWidth?: (width: number) => void;
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

/** Generic dockable tab shell; content behavior arrives through renderers. */
export function TabsPanel({
  placement,
  runtime,
  renderers,
  layoutState,
  presentation,
  setRightTrackWidth,
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
  const responsivePresentation = useSyncExternalStore(
    presentation?.subscribe ?? ignorePresentationChanges,
    presentation?.getSnapshot ?? dockedPresentation,
    dockedPresentation,
  );
  const drawer =
    placement === "right" &&
    responsivePresentation === "drawer";
  const sessionId = useSessions((state) => state.current);
  const cwd = useSessions((state) => {
    const current = state.current;
    return current === undefined
      ? undefined
      : state.byId[current]?.cwd;
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const newTabButtonRef =
    useRef<HTMLButtonElement | null>(null);
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
  const createMenuId = `${tabsPanelId(placement)}-create-menu`;
  const showCreateChooser = !hasTabs;
  const createOptions = renderers.creators();
  const canCreateTabs = createOptions.length > 0;
  const hasToolbar =
    !showCreateChooser &&
    (activeRenderer?.renderLeadingActions !== undefined ||
      activeRenderer?.renderTrailingActions !== undefined ||
      activeRenderer?.renderToolbarCenter !== undefined);
  const loading =
    !showCreateChooser &&
    activeTab !== undefined &&
    activeRenderer?.loading?.(activeTab) === true;
  const hidePanelLabel = t("panel.hide");

  useEffect(() => {
    if (snapshot.visible) runtime.syncPanel();
  }, [runtime, sessionId, snapshot.visible]);

  const panelRendered = hasTabs || snapshot.visible;

  useEffect(() => {
    const panel = panelRef.current;
    if (
      panel === null ||
      !panelRendered ||
      drawer
    ) return;
    let active = true;
    const resize = new TabsPanelResizeController(panel, {
      applyRightTrackWidth:
        placement === "right"
          ? setRightTrackWidth
          : undefined,
      onSizeCommit: (size) => {
        layoutState.setSize(placement, size);
      },
    });
    resizeRef.current = resize;
    void layoutState.size(placement).then((size) => {
      if (active && size !== undefined) {
        resize.restoreSize(size);
      }
    });
    return () => {
      active = false;
      if (resizeRef.current === resize) {
        resizeRef.current = null;
      }
      resize.dispose();
    };
  }, [
    layoutState,
    drawer,
    panelRendered,
    placement,
    setRightTrackWidth,
  ]);

  useEffect(() => {
    resizeRef.current?.sync();
  }, [snapshot.visible]);

  useEffect(() => {
    if (!snapshot.visible && choosingType) {
      setChoosingType(false);
    }
  }, [choosingType, snapshot.visible]);

  useEffect(() => {
    const panel = panelRef.current;
    const wasVisible = wasVisibleRef.current;
    let cancelScheduledFocus: (() => void) | undefined;
    if (
      snapshot.visible &&
      !wasVisible &&
      panel !== null
    ) {
      const focused = panel.ownerDocument.activeElement;
      if (
        focused instanceof HTMLElement &&
        !panel.contains(focused)
      ) {
        returnFocusRef.current = focused;
      }
      if (drawer) {
        const focusPanel = (): void => {
          if (!runtime.getSnapshot().visible) return;
          panel
            .querySelector<HTMLElement>(
              [
                '.minke-tab__target[aria-selected="true"]',
                ".minke-tabs-empty__option",
                drawerFocusableSelector,
              ].join(","),
            )
            ?.focus({ preventScroll: true });
        };
        const view = panel.ownerDocument.defaultView;
        if (view === null) {
          queueMicrotask(focusPanel);
        } else {
          const frame = view.requestAnimationFrame(focusPanel);
          cancelScheduledFocus = () =>
            view.cancelAnimationFrame(frame);
        }
      }
    } else if (!snapshot.visible && wasVisible) {
      const target = returnFocusRef.current;
      if (target?.isConnected === true) {
        target.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    }
    wasVisibleRef.current = snapshot.visible;
    return cancelScheduledFocus;
  }, [drawer, runtime, snapshot.visible]);

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
    resizeRef.current?.endDrag();
  };

  return (
    <>
    {drawer && (
      <button
        type="button"
        className="minke-tabs-mobile-scrim"
        data-open={snapshot.visible || undefined}
        aria-label={hidePanelLabel}
        tabIndex={-1}
        onClick={() => runtime.hide()}
      />
    )}
    <aside
      id={tabsPanelId(placement)}
      ref={panelRef}
      className="minke-tabs-panel"
      data-minke-tabs
      data-placement={placement}
      data-presentation={drawer ? "drawer" : "docked"}
      data-open={snapshot.visible || undefined}
      role={drawer ? "dialog" : undefined}
      aria-modal={
        drawer && snapshot.visible ? true : undefined
      }
      aria-label={t("panel.label")}
      aria-hidden={!snapshot.visible}
      aria-owns={
        drawer && choosingType ? createMenuId : undefined
      }
      onKeyDown={(event) => {
        if (
          drawer &&
          snapshot.visible &&
          event.key === "Escape"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setChoosingType(false);
          runtime.hide();
          return;
        }
        if (
          drawer &&
          snapshot.visible &&
          event.key === "Tab"
        ) {
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              drawerFocusableSelector,
            ),
          ).filter(
            (element) =>
              element.closest('[hidden], [aria-hidden="true"]') ===
              null,
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (first === undefined || last === undefined) {
            event.preventDefault();
            return;
          }
          const active =
            event.currentTarget.ownerDocument.activeElement;
          if (
            event.shiftKey &&
            (active === first ||
              !event.currentTarget.contains(active))
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (active === last ||
              !event.currentTarget.contains(active))
          ) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
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
      {drawer && (
        <button
          type="button"
          className="minke-tabs-panel__close"
          aria-label={hidePanelLabel}
          title={hidePanelLabel}
          onClick={() => {
            setChoosingType(false);
            runtime.hide();
          }}
        >
          <CloseIcon size={18} />
        </button>
      )}
      <div
        className="minke-tabs-resize-handle"
        data-minke-tabs-resize-handle=""
        role="separator"
        aria-hidden={drawer || undefined}
        aria-label={t(
          placement === "bottom"
            ? "panel.resizeBottom"
            : "panel.resizeRight",
        )}
        aria-orientation={
          placement === "bottom"
            ? "horizontal"
            : "vertical"
        }
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current?.beginDrag(
            placement === "bottom"
              ? event.clientY
              : event.clientX,
          );
        }}
        onPointerMove={(event) => {
          if (
            !event.currentTarget.hasPointerCapture(event.pointerId)
          ) {
            return;
          }
          resizeRef.current?.moveDrag(
            placement === "bottom"
              ? event.clientY
              : event.clientX,
          );
        }}
        onPointerUp={releaseResize}
        onPointerCancel={releaseResize}
        onKeyDown={(event) => {
          const bottom = placement === "bottom";
          const decreaseKey = bottom ? "ArrowDown" : "ArrowRight";
          const increaseKey = bottom ? "ArrowUp" : "ArrowLeft";
          if (
            event.key !== decreaseKey &&
            event.key !== increaseKey
          ) return;
          event.preventDefault();
          const step = event.shiftKey ? 32 : 16;
          resizeRef.current?.adjustSize(
            event.key === increaseKey ? step : -step,
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
          {placement === "right" && (
            <div
              className="minke-tabs-tabbar__window-drag"
              data-minke-tabs-window-drag=""
              aria-hidden="true"
            />
          )}
          <div className="minke-tabs-tabbar__actions">
            <button
              ref={newTabButtonRef}
              type="button"
              className="minke-tabs-toolbar__button"
              aria-label={t("tab.new")}
              aria-haspopup="menu"
              aria-expanded={choosingType}
              aria-pressed={choosingType}
              aria-controls={
                choosingType ? createMenuId : undefined
              }
              title={t("tab.new")}
              disabled={!canCreateTabs}
              onClick={() => setChoosingType((open) => !open)}
            >
              <PlusIcon />
            </button>
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
            windowDrag={placement === "right"}
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
              snapshot.visible,
            );
        })}
      </div>
    </aside>
    <TabsCreateMenu
      anchor={newTabButtonRef.current}
      context={{ cwd }}
      focusBoundary={drawer ? panelRef.current : undefined}
      id={createMenuId}
      label={t("tab.new")}
      onClose={() => setChoosingType(false)}
      onCreated={focusActiveTab}
      open={
        snapshot.visible &&
        hasTabs &&
        choosingType
      }
      options={createOptions}
      placement={placement}
    />
    </>
  );
}
