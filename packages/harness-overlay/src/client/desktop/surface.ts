import {
  installDesktopSurfaceStyles,
} from "./surface.styles.ts";
import {
  installDesktopTopDragRegion,
} from "./top-drag-region.ts";

const DESKTOP_MARKERS = [
  "data-dsh-desktop-frame",
  "data-dsh-desktop-titlebar-anchor",
  "data-dsh-desktop-sidebar-toggle",
  "data-dsh-desktop-new-session",
  "data-dsh-desktop-composer-add",
  "data-dsh-desktop-composer-primary",
  "data-dsh-desktop-base-surface",
  "data-dsh-desktop-sidebar-fade",
  "data-dsh-desktop-hero-glow",
  "data-dsh-desktop-resize-handle",
] as const;

const DESKTOP_MARKER_SELECTOR = DESKTOP_MARKERS
  .map((marker) => `[${marker}]`)
  .join(",");

const DESKTOP_DRAG_ENABLED_ATTRIBUTE =
  "data-dsh-desktop-drag-enabled";
// Re-check through one short mount/transition without leaving a polling loop.
const DESKTOP_DRAG_SETTLE_DURATION_MS = 250;
// The Tabs resize hit strip intentionally overhangs the panel edge. It keeps
// its own no-drag region, so treat that overlap like the host resize handles
// instead of revoking the adjacent window-drag target.
const DESKTOP_RESIZE_HANDLE_SELECTOR =
  [
    "[data-dsh-desktop-resize-handle]",
    "[data-minke-tabs-resize-handle]",
  ].join(",");
const DESKTOP_DRAG_TARGET_SELECTOR = [
  "[data-dsh-desktop-top-drag-region]",
  "[data-dsh-desktop-titlebar-anchor]",
  "[data-minke-tabs-window-drag]",
].join(",");
const INTERACTION_LAYER_SELECTOR = [
  "dialog[open]",
  '[aria-modal="true"]',
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(",");

type DesktopSurfaceView = Window & {
  readonly HTMLElement: typeof HTMLElement;
  readonly HTMLButtonElement: typeof HTMLButtonElement;
  readonly MutationObserver: typeof MutationObserver;
  readonly ResizeObserver: typeof ResizeObserver;
};

function markShell(root: Document, view: DesktopSurfaceView): void {
  const overlay = root.querySelector("[data-shell-overlay]");
  const frame = overlay?.parentElement;
  if (frame === undefined || frame === null) return;
  frame.setAttribute("data-dsh-desktop-frame", "");

  const sidebarColumn = frame.firstElementChild;
  const sidebarSlot = sidebarColumn?.querySelector(
    ':scope > [data-slot="sidebar"]',
  );
  const sidebarRoot = sidebarSlot?.firstElementChild;
  const anchor = sidebarRoot?.firstElementChild;
  const newSession = anchor?.nextElementSibling;
  if (
    anchor instanceof view.HTMLElement &&
    newSession instanceof view.HTMLButtonElement
  ) {
    anchor.setAttribute("data-dsh-desktop-titlebar-anchor", "");
    const toggle = anchor.querySelector(":scope > button:last-of-type");
    toggle?.setAttribute("data-dsh-desktop-sidebar-toggle", "");
    newSession.setAttribute("data-dsh-desktop-new-session", "");
  }

  const detailsColumn = frame.children.item(2);
  const detailsSlot = detailsColumn?.querySelector(
    ':scope > [data-slot="details"]',
  );
  const detailsSurface = detailsSlot?.firstElementChild;
  if (detailsSurface instanceof view.HTMLElement) {
    detailsSurface.setAttribute("data-dsh-desktop-base-surface", "");
  }

  for (const candidate of frame.children) {
    if (
      candidate instanceof view.HTMLElement &&
      (candidate.dataset.side === "sidebar" ||
        candidate.dataset.side === "details")
    ) {
      candidate.setAttribute(
        "data-dsh-desktop-resize-handle",
        "",
      );
    }
  }

  if (sidebarRoot instanceof view.HTMLElement) {
    for (const candidate of sidebarRoot.querySelectorAll("span:empty")) {
      const style = view.getComputedStyle(candidate);
      if (
        style.position === "absolute" &&
        style.pointerEvents === "none" &&
        style.backgroundImage.includes("linear-gradient")
      ) {
        candidate.setAttribute("data-dsh-desktop-sidebar-fade", "");
      }
    }
  }
}

function markHeroGlow(root: Document): void {
  for (const candidate of root.querySelectorAll(
    'svg[viewBox="0 0 1051 468"][aria-hidden="true"]',
  )) {
    candidate.setAttribute("data-dsh-desktop-hero-glow", "");
  }
}

function markComposerActions(
  root: Document,
  view: DesktopSurfaceView,
): void {
  for (const card of root.querySelectorAll("[data-composer-card]")) {
    const row = card.querySelector("[data-input-scroll]")
      ?.nextElementSibling;
    if (!(row instanceof view.HTMLElement)) continue;

    const add = row.firstElementChild?.querySelector(
      'button[aria-haspopup="listbox"]',
    );
    if (add instanceof view.HTMLButtonElement) {
      add.setAttribute("data-dsh-desktop-composer-add", "");
    }

    const primaryButtons =
      row.lastElementChild?.querySelectorAll("button");
    const primary =
      primaryButtons === undefined
        ? null
        : primaryButtons.item(primaryButtons.length - 1);
    if (primary instanceof view.HTMLButtonElement) {
      primary.setAttribute(
        "data-dsh-desktop-composer-primary",
        "",
      );
    }
  }
}

function hasRenderedBox(element: Element, view: Window): boolean {
  if (element.hasAttribute("hidden")) return false;
  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    style.getPropertyValue("content-visibility") !== "hidden" &&
    element.getClientRects().length > 0
  );
}

function isRendered(element: Element, view: Window): boolean {
  return (
    element.getAttribute("aria-hidden") !== "true" &&
    hasRenderedBox(element, view)
  );
}

function hasOpenPopover(root: Document, view: Window): boolean {
  try {
    const popover = root.querySelector(":popover-open");
    return popover !== null && isRendered(popover, view);
  } catch {
    return false;
  }
}

function hasPortaledInteractionLayer(
  root: Document,
  view: Window,
): boolean {
  const body = root.body;
  if (body === null) return false;

  const appRoot = root.getElementById("root");
  for (const candidate of body.children) {
    if (
      candidate === appRoot ||
      candidate.matches("script, style, link")
    ) {
      continue;
    }

    const style = view.getComputedStyle(candidate);
    if (
      style.position === "fixed" &&
      style.pointerEvents !== "none" &&
      isRendered(candidate, view)
    ) {
      return true;
    }
  }
  return false;
}

function hasDeclaredInteractionLayer(
  root: Document,
  view: Window,
): boolean {
  const appRoot = root.getElementById("root");
  if (
    root.fullscreenElement !== null ||
    (appRoot !== null && appRoot.inert)
  ) {
    return true;
  }

  for (const candidate of root.querySelectorAll(
    INTERACTION_LAYER_SELECTOR,
  )) {
    if (isRendered(candidate, view)) return true;
  }

  return (
    hasOpenPopover(root, view) ||
    hasPortaledInteractionLayer(root, view)
  );
}

function hasOccludedDragTarget(
  root: Document,
  target: Element,
  targets: readonly Element[],
): boolean {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const xInset = Math.min(4, rect.width / 2);
  const yInset = Math.min(4, rect.height / 2);
  const xs = [
    rect.left + xInset,
    rect.left + rect.width / 2,
    rect.right - xInset,
  ];
  const ys = [
    rect.top + yInset,
    rect.top + rect.height / 2,
    rect.bottom - yInset,
  ];

  for (const x of xs) {
    for (const y of ys) {
      const top = root.elementFromPoint(x, y);
      if (
        top !== null &&
        top.closest(DESKTOP_RESIZE_HANDLE_SELECTOR) === null &&
        !targets.some(
          (candidate) =>
            candidate.contains(top) || top.contains(candidate),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function suspendDesktopDrag(root: Document): void {
  // Clear the former document-wide gate as well so a live upgrade cannot
  // leave stale drag state behind.
  root.documentElement.removeAttribute(
    DESKTOP_DRAG_ENABLED_ATTRIBUTE,
  );
  for (const target of root.querySelectorAll(
    `[${DESKTOP_DRAG_ENABLED_ATTRIBUTE}]`,
  )) {
    target.removeAttribute(DESKTOP_DRAG_ENABLED_ATTRIBUTE);
  }
}

function reconcileDesktopDrag(root: Document, view: Window): void {
  const targets = [
    ...root.querySelectorAll(DESKTOP_DRAG_TARGET_SELECTOR),
  ];
  const renderedTargets = targets.filter((target) =>
    hasRenderedBox(target, view)
  );
  const interactionLayerOpen = hasDeclaredInteractionLayer(
    root,
    view,
  );

  for (const target of targets) {
    target.toggleAttribute(
      DESKTOP_DRAG_ENABLED_ATTRIBUTE,
      !interactionLayerOpen &&
        renderedTargets.includes(target) &&
        !hasOccludedDragTarget(root, target, renderedTargets),
    );
  }
}

function clearDesktopMarkers(root: Document): void {
  suspendDesktopDrag(root);
  for (const element of root.querySelectorAll(DESKTOP_MARKER_SELECTOR)) {
    for (const marker of DESKTOP_MARKERS) {
      element.removeAttribute(marker);
    }
  }
}

/**
 * Project Minke's macOS surface onto the upstream Harness DOM.
 *
 * The document-start extension owns first-paint layout and a fail-safe
 * no-drag default. This adapter enables each native drag target only while
 * that target is unobstructed and no interactive layer is open, then releases
 * all state through the Harness plugin lifecycle.
 */
export function installDesktopSurface(
  root: Document = document,
): () => void {
  const view = root.defaultView as DesktopSurfaceView | null;
  if (view === null) return () => {};

  suspendDesktopDrag(root);
  const disposeStyles = installDesktopSurfaceStyles(root);
  const disposeTopDragRegion =
    installDesktopTopDragRegion(root);
  const observedDragTargets = new Set<Element>();
  let dragSettleUntil = 0;
  let frame: number | undefined;
  let disposed = false;

  const requestDesktopDragSettle = (): void => {
    dragSettleUntil = Math.max(
      dragSettleUntil,
      view.performance.now() + DESKTOP_DRAG_SETTLE_DURATION_MS,
    );
  };
  const syncDragTargetResizeObservation = (): void => {
    const dragTargets = new Set(
      root.querySelectorAll(DESKTOP_DRAG_TARGET_SELECTOR),
    );
    for (const target of observedDragTargets) {
      if (dragTargets.has(target)) continue;
      resizeObserver.unobserve(target);
      observedDragTargets.delete(target);
    }
    for (const target of dragTargets) {
      if (observedDragTargets.has(target)) continue;
      observedDragTargets.add(target);
      resizeObserver.observe(target);
      requestDesktopDragSettle();
    }
  };
  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    markShell(root, view);
    markHeroGlow(root);
    markComposerActions(root, view);
    syncDragTargetResizeObservation();
    reconcileDesktopDrag(root, view);
    if (view.performance.now() < dragSettleUntil) scheduleReconcile();
  };
  const scheduleReconcile = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };
  const resizeObserver = new view.ResizeObserver(() => {
    requestDesktopDragSettle();
    scheduleReconcile();
  });

  const observer = new view.MutationObserver(() => {
    if (hasDeclaredInteractionLayer(root, view)) {
      suspendDesktopDrag(root);
    }
    scheduleReconcile();
  });
  observer.observe(root.documentElement, {
    attributes: true,
    attributeFilter: [
      "aria-hidden",
      "aria-modal",
      "class",
      "hidden",
      "inert",
      "open",
      "popover",
      "role",
      "style",
    ],
    childList: true,
    subtree: true,
  });

  const handleBeforeToggle = (event: Event): void => {
    if (Reflect.get(event, "newState") === "open") {
      suspendDesktopDrag(root);
    }
    scheduleReconcile();
  };
  const handleLayerStateChange = (): void => {
    if (
      root.fullscreenElement !== null ||
      hasOpenPopover(root, view)
    ) {
      suspendDesktopDrag(root);
    }
    scheduleReconcile();
  };
  root.addEventListener("beforetoggle", handleBeforeToggle, true);
  root.addEventListener("toggle", handleLayerStateChange, true);
  root.addEventListener(
    "fullscreenchange",
    handleLayerStateChange,
    true,
  );
  scheduleReconcile();

  return () => {
    disposed = true;
    observer.disconnect();
    resizeObserver.disconnect();
    observedDragTargets.clear();
    dragSettleUntil = 0;
    root.removeEventListener("beforetoggle", handleBeforeToggle, true);
    root.removeEventListener("toggle", handleLayerStateChange, true);
    root.removeEventListener(
      "fullscreenchange",
      handleLayerStateChange,
      true,
    );
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    disposeTopDragRegion();
    clearDesktopMarkers(root);
    disposeStyles();
  };
}
