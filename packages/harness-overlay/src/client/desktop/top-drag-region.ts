const TOP_DRAG_REGION_SELECTOR =
  '[data-slot="conversation.session.header"]';
const RIGHT_PANEL_SELECTOR =
  '.minke-tabs-panel[data-placement="right"][data-open]';
const TOP_DRAG_REGION_ATTRIBUTE =
  "data-dsh-desktop-top-drag-region";
const TOP_DRAG_REGION_BOUNDED_ATTRIBUTE =
  "data-dsh-desktop-top-drag-bounded";
const TOP_DRAG_REGION_WIDTH_PROPERTY =
  "--dsh-desktop-top-drag-width";
const TOP_DRAG_REGION_SETTLE_DURATION_MS = 300;

type TopDragRegionView = Window & {
  readonly MutationObserver: typeof MutationObserver;
  readonly ResizeObserver: typeof ResizeObserver;
};

function setBoundedWidth(
  target: HTMLElement,
  width: number | undefined,
): void {
  if (width === undefined) {
    if (target.hasAttribute(TOP_DRAG_REGION_BOUNDED_ATTRIBUTE)) {
      target.removeAttribute(TOP_DRAG_REGION_BOUNDED_ATTRIBUTE);
    }
    if (
      target.style.getPropertyValue(
        TOP_DRAG_REGION_WIDTH_PROPERTY,
      ) !== ""
    ) {
      target.style.removeProperty(TOP_DRAG_REGION_WIDTH_PROPERTY);
    }
    return;
  }

  const value = `${Math.max(0, Math.floor(width))}px`;
  if (
    target.style.getPropertyValue(
      TOP_DRAG_REGION_WIDTH_PROPERTY,
    ) !== value
  ) {
    target.style.setProperty(
      TOP_DRAG_REGION_WIDTH_PROPERTY,
      value,
    );
  }
  if (!target.hasAttribute(TOP_DRAG_REGION_BOUNDED_ATTRIBUTE)) {
    target.setAttribute(TOP_DRAG_REGION_BOUNDED_ATTRIBUTE, "");
  }
}

/**
 * Own the lifecycle and geometry of the stable top window-drag region.
 *
 * The region follows the host conversation header, but its actual box is
 * reduced to the visible center surface whenever an extended right panel
 * overlaps that surface. This keeps native hit testing out of the panel
 * instead of relying on an occluded full-width drag element.
 */
export function installDesktopTopDragRegion(
  root: Document = document,
): () => void {
  const view = root.defaultView as TopDragRegionView | null;
  if (view === null) return () => {};

  let target: HTMLElement | undefined;
  let frame: number | undefined;
  let settleUntil = 0;
  let disposed = false;
  const observed = new Set<Element>();

  const requestSettle = (): void => {
    settleUntil = Math.max(
      settleUntil,
      view.performance.now() +
        TOP_DRAG_REGION_SETTLE_DURATION_MS,
    );
  };

  const schedule = (): void => {
    if (disposed || frame !== undefined) return;
    frame = view.requestAnimationFrame(sync);
  };

  const resizeObserver = new view.ResizeObserver(() => {
    requestSettle();
    schedule();
  });

  const syncObservedElements = (
    next: readonly (Element | null | undefined)[],
  ): void => {
    const nextObserved = new Set(
      next.filter((element): element is Element => element != null),
    );
    for (const element of observed) {
      if (nextObserved.has(element)) continue;
      resizeObserver.unobserve(element);
      observed.delete(element);
    }
    for (const element of nextObserved) {
      if (observed.has(element)) continue;
      observed.add(element);
      resizeObserver.observe(element);
    }
  };

  const bindTarget = (next: HTMLElement | undefined): void => {
    if (target === next) return;
    if (target !== undefined) {
      target.removeAttribute(TOP_DRAG_REGION_ATTRIBUTE);
      setBoundedWidth(target, undefined);
    }
    target = next;
    target?.setAttribute(TOP_DRAG_REGION_ATTRIBUTE, "");
    requestSettle();
  };

  const sync = (): void => {
    frame = undefined;
    if (disposed) return;

    const nextTarget = root.querySelector<HTMLElement>(
      TOP_DRAG_REGION_SELECTOR,
    );
    bindTarget(nextTarget ?? undefined);
    const rightPanel =
      root.querySelector<HTMLElement>(RIGHT_PANEL_SELECTOR) ??
        undefined;
    syncObservedElements([
      target,
      target?.parentElement,
      rightPanel,
    ]);

    if (target === undefined || rightPanel === undefined) {
      if (target !== undefined) setBoundedWidth(target, undefined);
    } else {
      const targetRect = target.getBoundingClientRect();
      const surfaceRect =
        target.parentElement?.getBoundingClientRect() ?? targetRect;
      const panelRect = rightPanel.getBoundingClientRect();
      const overlapsVertically =
        panelRect.top < targetRect.bottom &&
        panelRect.bottom > targetRect.top;
      const naturalRight = Math.max(
        targetRect.left,
        surfaceRect.right,
      );
      const safeRight = overlapsVertically
        ? Math.min(naturalRight, panelRect.left)
        : naturalRight;
      const naturalWidth = naturalRight - targetRect.left;
      const safeWidth = Math.max(0, safeRight - targetRect.left);
      setBoundedWidth(
        target,
        safeWidth < naturalWidth ? safeWidth : undefined,
      );
    }

    if (view.performance.now() < settleUntil) schedule();
  };

  const mutationObserver = new view.MutationObserver(() => {
    requestSettle();
    schedule();
  });
  mutationObserver.observe(root.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-open",
      "data-placement",
      "hidden",
    ],
    childList: true,
    subtree: true,
  });
  const handleViewportChange = (): void => {
    requestSettle();
    schedule();
  };
  view.addEventListener("resize", handleViewportChange);
  root.addEventListener("transitionrun", handleViewportChange, true);
  root.addEventListener("transitionend", handleViewportChange, true);
  sync();

  return () => {
    disposed = true;
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    observed.clear();
    view.removeEventListener("resize", handleViewportChange);
    root.removeEventListener(
      "transitionrun",
      handleViewportChange,
      true,
    );
    root.removeEventListener(
      "transitionend",
      handleViewportChange,
      true,
    );
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    if (target !== undefined) {
      target.removeAttribute(TOP_DRAG_REGION_ATTRIBUTE);
      setBoundedWidth(target, undefined);
      target = undefined;
    }
    settleUntil = 0;
  };
}
