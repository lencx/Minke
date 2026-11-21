import {
  installDesktopSurfaceStyles,
} from "./surface.styles.ts";
import { isContentTextMutation } from "./surface-mutations.ts";

const DESKTOP_MARKERS = [
  "data-dsh-desktop-frame",
  "data-dsh-desktop-titlebar-anchor",
  "data-dsh-desktop-sidebar-toggle",
  "data-dsh-desktop-new-session",
  "data-dsh-desktop-composer-add",
  "data-dsh-desktop-composer-primary",
  "data-dsh-desktop-base-surface",
  "data-dsh-desktop-sidebar-fade",
  "data-dsh-desktop-resize-handle",
] as const;

const DESKTOP_MARKER_SELECTOR = DESKTOP_MARKERS
  .map((marker) => `[${marker}]`)
  .join(",");

type DesktopSurfaceView = Window & {
  readonly HTMLElement: typeof HTMLElement;
  readonly HTMLButtonElement: typeof HTMLButtonElement;
  readonly MutationObserver: typeof MutationObserver;
};

function markShell(root: Document, view: DesktopSurfaceView): void {
  const overlay = root.querySelector("[data-shell-overlay]");
  const frame = overlay?.parentElement;
  if (frame === undefined || frame === null) return;
  // Do not wake native layout observers when a marker is already present.
  frame.toggleAttribute("data-dsh-desktop-frame", true);

  const sidebarColumn = frame.firstElementChild;
  const sidebarSlot = sidebarColumn?.querySelector(
    ':scope > [data-slot="sidebar"]',
  );
  const sidebarRoot = sidebarSlot?.firstElementChild;
  const anchor = sidebarRoot?.firstElementChild;
  const newSession = sidebarRoot?.querySelector(":scope > button");
  if (anchor instanceof view.HTMLElement) {
    anchor.toggleAttribute("data-dsh-desktop-titlebar-anchor", true);

  }
  const toggle = frame.querySelector("[data-shell-leading] button")
    ?? anchor?.querySelector(":scope > button:last-of-type");
  for (const previous of root.querySelectorAll("[data-dsh-desktop-sidebar-toggle]")) {
    if (previous !== toggle) previous.removeAttribute("data-dsh-desktop-sidebar-toggle");
  }
  toggle?.toggleAttribute("data-dsh-desktop-sidebar-toggle", true);
  if (newSession instanceof view.HTMLButtonElement) {
    newSession.toggleAttribute("data-dsh-desktop-new-session", true);
  }

  const rightbarColumn = frame.children.item(2);
  const rightbarSlot = rightbarColumn?.querySelector(
    ':scope > [data-slot="rightbar"]',
  );
  const rightbarSurface = rightbarSlot?.querySelector("[data-sidebar-right-panel]");
  if (rightbarSurface instanceof view.HTMLElement) {
    rightbarSurface.toggleAttribute("data-dsh-desktop-base-surface", true);
  }

  for (const candidate of frame.children) {
    if (
      candidate instanceof view.HTMLElement &&
      (candidate.dataset.side === "sidebar" ||
        candidate.dataset.side === "rightbar")
    ) {
      candidate.toggleAttribute(
        "data-dsh-desktop-resize-handle",
        true,
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
        candidate.toggleAttribute("data-dsh-desktop-sidebar-fade", true);
      }
    }
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

    const tools = row.firstElementChild;
    const addActions = [
      tools?.querySelector('button[aria-haspopup="listbox"]'),
      // Anchor the attachment action to its file input across locales.
      tools?.querySelector('input[type="file"]')?.previousElementSibling,
    ];
    for (const add of addActions) {
      if (add instanceof view.HTMLButtonElement) {
        add.toggleAttribute("data-dsh-desktop-composer-add", true);
      }
    }

    const primaryButtons =
      row.lastElementChild?.querySelectorAll("button");
    const primary =
      primaryButtons === undefined
        ? null
        : primaryButtons.item(primaryButtons.length - 1);
    if (primary instanceof view.HTMLButtonElement) {
      primary.toggleAttribute(
        "data-dsh-desktop-composer-primary",
        true,
      );
    }
  }
}

/** Apply Minke's surface styling; DSH owns window drag and its geometry refresh. */
export function installDesktopSurface(root: Document = document): () => void {
  const view = root.defaultView as DesktopSurfaceView | null;
  if (view === null) return () => {};
  const disposeStyles = installDesktopSurfaceStyles(root);
  let frame: number | undefined;
  const reconcile = (): void => {
    frame = undefined;
    markShell(root, view);
    markComposerActions(root, view);
  };
  const observer = new view.MutationObserver((records) => {
    if (records.every(isContentTextMutation) || frame !== undefined) return;
    frame = view.requestAnimationFrame(reconcile);
  });
  observer.observe(root.documentElement, { childList: true, subtree: true });
  reconcile();
  return () => {
    observer.disconnect();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    for (const element of root.querySelectorAll(DESKTOP_MARKER_SELECTOR)) {
      for (const marker of DESKTOP_MARKERS) element.removeAttribute(marker);
    }
    disposeStyles();
  };
}
