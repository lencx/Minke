const DESKTOP_MARKERS = [
  "data-dsh-desktop-titlebar-anchor",
  "data-dsh-desktop-sidebar-toggle",
  "data-dsh-desktop-new-session",
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
const DESKTOP_RESIZE_HANDLE_SELECTOR =
  "[data-dsh-desktop-resize-handle]";
const DESKTOP_DRAG_TARGET_SELECTOR = [
  '[data-slot="conversation.session.header"]',
  "[data-dsh-desktop-titlebar-anchor]",
].join(",");
const INTERACTION_LAYER_SELECTOR = [
  "dialog[open]",
  '[aria-modal="true"]',
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(",");

export const DESKTOP_SURFACE_STYLES = `
#root :has(> [data-dsh-desktop-titlebar-anchor]),
[data-dsh-desktop-base-surface] {
  background-color: transparent !important;
}

[data-dsh-desktop-sidebar-fade],
[data-dsh-desktop-hero-glow] {
  display: none !important;
}

[data-dsh-desktop-titlebar-anchor] {
  height: 28px !important;
  margin-top: -4px !important;
  padding-left: 56px !important;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

[data-slot="conversation.session.header"] {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

[data-dsh-desktop-resize-handle] {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

:root[${DESKTOP_DRAG_ENABLED_ATTRIBUTE}]
  [data-dsh-desktop-titlebar-anchor],
:root[${DESKTOP_DRAG_ENABLED_ATTRIBUTE}]
  [data-slot="conversation.session.header"] {
  -webkit-app-region: drag;
  app-region: drag;
}

[data-dsh-desktop-titlebar-anchor]
  > button:first-child:not(:last-child) {
  display: none !important;
}

[data-dsh-desktop-sidebar-toggle]
  > svg:first-child:not(:last-child) {
  display: none !important;
}

[data-dsh-desktop-sidebar-toggle] > svg:last-child {
  display: inline !important;
}

[data-sidebar-collapsed] [data-dsh-desktop-sidebar-toggle] {
  animation: none !important;
  transform: none !important;
  transition: none !important;
}

[data-sidebar-collapsed] [data-dsh-desktop-titlebar-anchor] {
  height: 36px !important;
  margin-top: 12px !important;
  padding-left: 0 !important;
}

[data-dsh-desktop-new-session] {
  background: color-mix(
    in srgb,
    var(--dsw-alias-button-elevated-fill) 28%,
    transparent
  ) !important;
}

[data-dsh-desktop-new-session]:hover {
  background: color-mix(
    in srgb,
    var(--dsw-alias-button-floating-hover) 44%,
    transparent
  ) !important;
}

[data-sidebar-collapsed] [data-dsh-desktop-new-session] {
  background: transparent !important;
}

[data-sidebar-collapsed] [data-dsh-desktop-new-session]:hover {
  background: var(--dsw-alias-interactive-bg-hover) !important;
}

[data-phase="hero"] [data-composer-card] {
  background-color: transparent !important;
  box-shadow: none !important;
}

[data-phase="active"] [data-composer-card] {
  background: var(--dsw-specific-input-major) !important;
}
`;

function installDesktopSurfaceStyles(root: Document): HTMLStyleElement {
  const style = root.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeDesktopSurface = "";
  style.textContent = DESKTOP_SURFACE_STYLES;
  (root.head ?? root.documentElement).append(style);
  return style;
}

function markShell(root: Document, view: Window): void {
  const overlay = root.querySelector("[data-shell-overlay]");
  const frame = overlay?.parentElement;
  if (frame === undefined || frame === null) return;

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

function isRendered(element: Element, view: Window): boolean {
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }

  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    style.getPropertyValue("content-visibility") !== "hidden" &&
    element.getClientRects().length > 0
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
  view: Window,
): boolean {
  const targets = [
    ...root.querySelectorAll(DESKTOP_DRAG_TARGET_SELECTOR),
  ].filter((target) => isRendered(target, view));

  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

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
  }
  return false;
}

function dragIsSafe(root: Document, view: Window): boolean {
  return (
    !hasDeclaredInteractionLayer(root, view) &&
    !hasOccludedDragTarget(root, view)
  );
}

function suspendDesktopDrag(root: Document): void {
  root.documentElement.removeAttribute(
    DESKTOP_DRAG_ENABLED_ATTRIBUTE,
  );
}

function reconcileDesktopDrag(root: Document, view: Window): void {
  root.documentElement.toggleAttribute(
    DESKTOP_DRAG_ENABLED_ATTRIBUTE,
    dragIsSafe(root, view),
  );
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
 * no-drag default. This adapter enables native drag only while the current
 * DOM has no interactive layer over it, and releases all state through the
 * Harness plugin lifecycle.
 */
export function installDesktopSurface(
  root: Document = document,
): () => void {
  const view = root.defaultView;
  if (view === null) return () => {};

  const style = installDesktopSurfaceStyles(root);
  let frame: number | undefined;
  let disposed = false;

  const reconcile = (): void => {
    frame = undefined;
    if (disposed) return;
    markShell(root, view);
    markHeroGlow(root);
    reconcileDesktopDrag(root, view);
  };
  const scheduleReconcile = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };

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
    clearDesktopMarkers(root);
    style.remove();
  };
}
