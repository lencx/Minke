const DESKTOP_MARKERS = [
  "data-dsh-desktop-titlebar-anchor",
  "data-dsh-desktop-sidebar-toggle",
  "data-dsh-desktop-new-session",
  "data-dsh-desktop-base-surface",
  "data-dsh-desktop-sidebar-fade",
  "data-dsh-desktop-hero-glow",
  "data-dsh-desktop-composer-add",
  "data-dsh-desktop-composer-primary",
] as const;

const DESKTOP_MARKER_SELECTOR = DESKTOP_MARKERS
  .map((marker) => `[${marker}]`)
  .join(",");

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
  margin-top: 34px !important;
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

[data-dsh-desktop-composer-add] {
  background: color-mix(
    in srgb,
    var(--dsw-specific-selector) 58%,
    transparent
  ) !important;
}

[data-dsh-desktop-composer-add]:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--dsw-alias-interactive-bg-hover-solid) 72%,
    transparent
  ) !important;
}

[data-dsh-desktop-composer-add]:active:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--dsw-alias-interactive-bg-hover-solid) 82%,
    transparent
  ) !important;
}

[data-dsh-desktop-composer-primary] {
  background: color-mix(
    in srgb,
    var(--dsw-alias-button-info-fill) 78%,
    transparent
  ) !important;
}

[data-dsh-desktop-composer-primary]:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--dsw-alias-button-info-hover) 90%,
    transparent
  ) !important;
}

[data-dsh-desktop-composer-primary]:active:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--dsw-alias-button-info-hover) 95%,
    transparent
  ) !important;
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

function markComposerActions(root: Document, view: Window): void {
  for (const card of root.querySelectorAll("[data-composer-card]")) {
    const scroll = card.querySelector(
      ':scope > [data-input-scroll]',
    );
    const row = scroll?.nextElementSibling;
    const tools = row?.firstElementChild;
    const add = tools?.querySelector(
      ":scope > button:first-of-type",
    );
    if (add instanceof view.HTMLButtonElement) {
      add.setAttribute("data-dsh-desktop-composer-add", "");
    }

    const trailing = row?.lastElementChild;
    const primary = trailing?.querySelector(
      ":scope > button:last-of-type",
    );
    if (primary instanceof view.HTMLButtonElement) {
      primary.setAttribute("data-dsh-desktop-composer-primary", "");
    }
  }
}

function clearDesktopMarkers(root: Document): void {
  for (const element of root.querySelectorAll(DESKTOP_MARKER_SELECTOR)) {
    for (const marker of DESKTOP_MARKERS) {
      element.removeAttribute(marker);
    }
  }
}

/**
 * Project Minke's macOS surface onto the upstream Harness DOM.
 *
 * The document-start extension owns only first-paint and native drag rules.
 * This adapter owns every post-boot selector and releases all of its state
 * through the Harness plugin lifecycle.
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
    markComposerActions(root, view);
  };
  const scheduleReconcile = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  };

  const observer = new view.MutationObserver(scheduleReconcile);
  observer.observe(root.documentElement, {
    childList: true,
    subtree: true,
  });
  scheduleReconcile();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    clearDesktopMarkers(root);
    style.remove();
  };
}
