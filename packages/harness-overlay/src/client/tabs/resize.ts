export const TABS_PANEL_MIN_WIDTH = 300;
export const TABS_PANEL_DEFAULT_WIDTH = 360;
export const TABS_PANEL_MAX_WIDTH = 4_096;
export const TABS_PANEL_OVERLAY_REMAINDER = 20;
export const TABS_PANEL_REFLOW_RATIO = 2 / 3;
export const TABS_PANEL_MIN_HEIGHT = 180;
export const TABS_PANEL_DEFAULT_HEIGHT = 320;
export const TABS_PANEL_MAX_HEIGHT = 640;
export const TABS_PANEL_MIN_VERTICAL_REMAINDER = 200;

const TABS_RESIZE_HANDLE_SELECTOR =
  "[data-minke-tabs-resize-handle]";

export function tabsPanelReflowMaxWidth(
  viewport: number,
  sidebar = 0,
): number {
  const available = Math.max(
    TABS_PANEL_MIN_WIDTH,
    Math.round(viewport) - Math.max(0, Math.round(sidebar)),
  );
  return Math.max(
    TABS_PANEL_MIN_WIDTH,
    Math.floor(available * TABS_PANEL_REFLOW_RATIO),
  );
}

export function clampTabsPanelWidth(
  requested: number,
  viewport: number,
  sidebar = 0,
): number {
  const viewportMaximum = Math.max(
    TABS_PANEL_MIN_WIDTH,
    Math.round(viewport) -
      Math.max(0, Math.round(sidebar)) -
      TABS_PANEL_OVERLAY_REMAINDER,
  );
  const maximum = Math.min(
    TABS_PANEL_MAX_WIDTH,
    viewportMaximum,
  );
  return Math.min(
    maximum,
    Math.max(TABS_PANEL_MIN_WIDTH, Math.round(requested)),
  );
}

export function clampTabsPanelHeight(
  requested: number,
  viewport: number,
): number {
  const viewportMaximum = Math.max(
    TABS_PANEL_MIN_HEIGHT,
    Math.round(viewport) - TABS_PANEL_MIN_VERTICAL_REMAINDER,
  );
  const maximum = Math.min(
    TABS_PANEL_MAX_HEIGHT,
    viewportMaximum,
  );
  return Math.min(
    maximum,
    Math.max(TABS_PANEL_MIN_HEIGHT, Math.round(requested)),
  );
}

interface DragOrigin {
  readonly x: number;
  readonly width: number;
}

interface PanelDragOrigin {
  readonly position: number;
  readonly size: number;
}

interface InlineStyleSnapshot {
  readonly value: string;
  readonly priority: string;
}

export interface TabsPanelResizeOptions {
  readonly applyRightTrackWidth?: (width: number) => void;
  readonly onSizeCommit?: (size: number) => void;
}

type TabsPanelView = Window & {
  readonly ResizeObserver: typeof ResizeObserver;
  readonly MutationObserver: typeof MutationObserver;
};

/** One layer above the host shell overlay (`z-index: 20`). */
const NATIVE_HANDLE_ACTIVE_Z_INDEX = "21";

function detailsColumnFor(
  panel: HTMLDivElement,
): HTMLElement | undefined {
  const detailsSlot = panel.ownerDocument.querySelector(
    '[data-slot="details"]',
  );
  return detailsSlot?.parentElement ?? undefined;
}

function frameFor(
  panel: HTMLDivElement,
): HTMLElement | undefined {
  const overlay = panel.closest<HTMLElement>(
    "[data-shell-overlay]",
  );
  return overlay?.parentElement ?? undefined;
}

function sidebarColumnFor(
  frame: HTMLElement | undefined,
): HTMLElement | undefined {
  const first = Array.from(frame?.children ?? [])[0];
  return first instanceof HTMLElement ? first : undefined;
}

/**
 * Keeps the right panel in the host grid through two thirds of the content
 * area, then lets the overlay continue to a 20px conversation remainder.
 */
export class TabsPanelResizeController {
  readonly #panel: HTMLDivElement;
  readonly #overlay: HTMLElement | undefined;
  readonly #detailsColumn: HTMLElement | undefined;
  readonly #frame: HTMLElement | undefined;
  readonly #sidebarColumn: HTMLElement | undefined;
  readonly #view: TabsPanelView | null;
  readonly #applyRightTrackWidth:
    | ((width: number) => void)
    | undefined;
  readonly #onSizeCommit: ((size: number) => void) | undefined;
  readonly #observer: ResizeObserver | undefined;
  readonly #mutationObserver: MutationObserver | undefined;
  #nativeHandle: HTMLElement | undefined;
  #nativeHandleZIndex: InlineStyleSnapshot | undefined;
  #detachNative: (() => void) | undefined;
  #nativeOrigin: DragOrigin | undefined;
  #extendedOrigin: DragOrigin | undefined;
  #extendedWidth: number | undefined;
  #preferredRightWidth: number | undefined;
  #rightTrackAppliedWidth: number | undefined;
  #bottomOrigin: PanelDragOrigin | undefined;
  #bottomHeight = TABS_PANEL_DEFAULT_HEIGHT;
  #interacted = false;
  #disposed = false;

  constructor(
    panel: HTMLDivElement,
    options: TabsPanelResizeOptions = {},
  ) {
    this.#panel = panel;
    this.#applyRightTrackWidth =
      options.applyRightTrackWidth;
    this.#onSizeCommit = options.onSizeCommit;
    this.#overlay =
      panel.closest<HTMLElement>("[data-shell-overlay]") ??
      undefined;
    this.#detailsColumn = detailsColumnFor(panel);
    this.#frame = frameFor(panel);
    this.#sidebarColumn = sidebarColumnFor(this.#frame);
    this.#view =
      panel.ownerDocument.defaultView as TabsPanelView | null;

    if (
      this.#view !== null &&
      this.#frame !== undefined
    ) {
      const observer = new this.#view.ResizeObserver(
        this.#reconcile,
      );
      this.#observer = observer;
      if (this.#detailsColumn !== undefined) {
        observer.observe(this.#detailsColumn);
      }
      if (this.#sidebarColumn !== undefined) {
        observer.observe(this.#sidebarColumn);
      }
      observer.observe(this.#frame);
      if (!this.#isBottom()) {
        const mutationObserver =
          new this.#view.MutationObserver(
            this.#bindNativeHandle,
          );
        this.#mutationObserver = mutationObserver;
        mutationObserver.observe(this.#frame, {
          childList: true,
        });
      }
      this.#view.addEventListener("resize", this.#reconcile);
      if (!this.#isBottom()) {
        this.#bindNativeHandle();
      }
    }
    this.#reconcile();
  }

  beginDrag(position: number): void {
    this.#interacted = true;
    if (this.#isBottom()) {
      this.#bottomOrigin = {
        position,
        size: this.#bottomHeight,
      };
      this.#panel.toggleAttribute("data-resizing", true);
      this.#reconcile();
      return;
    }
    this.beginExtendedDrag(position);
  }

  moveDrag(position: number): void {
    if (this.#isBottom()) {
      const origin = this.#bottomOrigin;
      if (origin === undefined) return;
      this.#setBottomHeight(
        origin.size - (position - origin.position),
      );
      return;
    }
    this.moveExtendedDrag(position);
  }

  endDrag(): void {
    if (this.#isBottom()) {
      this.#bottomOrigin = undefined;
      this.#panel.removeAttribute("data-resizing");
      this.#reconcile();
      this.#onSizeCommit?.(this.#bottomHeight);
      return;
    }
    this.endExtendedDrag();
  }

  adjustSize(delta: number): void {
    this.#interacted = true;
    if (this.#isBottom()) {
      this.#setBottomHeight(this.#bottomHeight + delta);
      this.#onSizeCommit?.(this.#bottomHeight);
      return;
    }
    this.adjustExtendedWidth(delta);
  }

  beginExtendedDrag(clientX: number): void {
    if (!this.#ownsResizeHandle()) return;
    this.#interacted = true;
    this.#extendedOrigin = {
      x: clientX,
      width:
        this.#preferredRightWidth ??
        this.#extendedWidth ??
        this.#measuredTrackWidth(),
    };
    this.#panel.toggleAttribute("data-resizing", true);
  }

  moveExtendedDrag(clientX: number): void {
    const origin = this.#extendedOrigin;
    if (origin === undefined) return;
    this.#setExtendedWidth(
      origin.width - (clientX - origin.x),
    );
  }

  endExtendedDrag(): void {
    this.#extendedOrigin = undefined;
    this.#panel.removeAttribute("data-resizing");
    this.#commitRightWidth(true);
  }

  adjustExtendedWidth(delta: number): void {
    const width =
      this.#preferredRightWidth ??
      this.#extendedWidth ??
      this.#measuredTrackWidth();
    this.#setExtendedWidth(width + delta);
    this.#commitRightWidth(true);
  }

  restoreSize(size: number): void {
    if (this.#interacted || !Number.isFinite(size)) return;
    if (this.#isBottom()) {
      this.#bottomHeight = Math.min(
        TABS_PANEL_MAX_HEIGHT,
        Math.max(TABS_PANEL_MIN_HEIGHT, Math.round(size)),
      );
      this.#reconcile();
      return;
    }
    this.#preferredRightWidth = Math.min(
      TABS_PANEL_MAX_WIDTH,
      Math.max(TABS_PANEL_MIN_WIDTH, Math.round(size)),
    );
    this.#rightTrackAppliedWidth = undefined;
    this.#reconcile();
  }

  sync(): void {
    this.#reconcile();
  }

  dispose(): void {
    this.#disposed = true;
    this.#observer?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#detachNative?.();
    this.#view?.removeEventListener(
      "resize",
      this.#reconcile,
    );
    if (this.#isBottom()) {
      this.#panel.style.removeProperty(
        "--minke-tabs-panel-height",
      );
      this.#panel.style.removeProperty(
        "--minke-tabs-panel-left",
      );
      this.#overlay?.style.removeProperty(
        "--minke-tabs-panel-height",
      );
      this.#overlay?.style.removeProperty(
        "--minke-tabs-panel-left",
      );
      this.#frame?.style.removeProperty(
        "--minke-tabs-panel-height",
      );
      this.#frame?.removeAttribute(
        "data-minke-tabs-bottom-open",
      );
      this.#frame?.removeAttribute(
        "data-minke-tabs-bottom-resizing",
      );
    } else {
      this.#panel.style.removeProperty(
        "--minke-tabs-panel-width",
      );
      this.#overlay?.style.removeProperty(
        "--minke-tabs-panel-width",
      );
      this.#frame?.removeAttribute(
        "data-minke-tabs-right-open",
      );
    }
    this.#panel.removeAttribute("data-extended");
    this.#panel.removeAttribute("data-overlay");
    this.#panel.removeAttribute("data-resizing");
  }

  readonly #bindNativeHandle = (): void => {
    const next = Array.from(this.#frame?.children ?? []).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.dataset.side === "details",
    );
    if (next === this.#nativeHandle) return;
    this.#detachNative?.();
    this.#nativeHandle = next;
    if (next === undefined) {
      this.#nativeHandleZIndex = undefined;
      this.#detachNative = undefined;
      this.#reconcile();
      return;
    }

    const previousZIndex = {
      value: next.style.getPropertyValue("z-index"),
      priority: next.style.getPropertyPriority("z-index"),
    };
    this.#nativeHandleZIndex = previousZIndex;
    next.addEventListener("pointerdown", this.#onNativeDown);
    next.addEventListener("pointermove", this.#onNativeMove);
    next.addEventListener("pointerup", this.#onNativeUp);
    next.addEventListener("pointercancel", this.#onNativeCancel);
    this.#detachNative = () => {
      next.removeEventListener(
        "pointerdown",
        this.#onNativeDown,
      );
      next.removeEventListener(
        "pointermove",
        this.#onNativeMove,
      );
      next.removeEventListener("pointerup", this.#onNativeUp);
      next.removeEventListener(
        "pointercancel",
        this.#onNativeCancel,
      );
      this.#restoreNativeHandleZIndex(next, previousZIndex);
      if (this.#nativeHandle === next) {
        this.#nativeHandleZIndex = undefined;
      }
    };
    this.#syncNativeHandleStacking();
    this.#reconcile();
  };

  #restoreNativeHandleZIndex(
    handle: HTMLElement,
    snapshot: InlineStyleSnapshot,
  ): void {
    if (snapshot.value === "") {
      handle.style.removeProperty("z-index");
      return;
    }
    handle.style.setProperty(
      "z-index",
      snapshot.value,
      snapshot.priority,
    );
  }

  #syncNativeHandleStacking(): void {
    const handle = this.#nativeHandle;
    const previous = this.#nativeHandleZIndex;
    if (handle === undefined || previous === undefined) return;
    const active =
      this.#panel.hasAttribute("data-open") &&
      !this.#isBottom() &&
      !this.#panel.hasAttribute("data-extended");
    if (active) {
      handle.style.setProperty(
        "z-index",
        NATIVE_HANDLE_ACTIVE_Z_INDEX,
      );
      return;
    }
    this.#restoreNativeHandleZIndex(handle, previous);
  }

  readonly #onNativeDown = (event: PointerEvent): void => {
    if (this.#isBottom()) return;
    this.#interacted = true;
    const measured = this.#measuredTrackWidth();
    this.#nativeOrigin = {
      x: event.clientX,
      width:
        this.#preferredRightWidth ??
        this.#extendedWidth ??
        measured,
    };
  };

  readonly #onNativeMove = (event: PointerEvent): void => {
    const origin = this.#nativeOrigin;
    if (origin === undefined) return;
    const requested =
      origin.width - (event.clientX - origin.x);
    const trackMaximum = this.#detailsTrackMaximum();
    if (
      requested > trackMaximum ||
      origin.width > trackMaximum
    ) {
      this.#setExtendedWidth(requested);
    }
  };

  readonly #onNativeUp = (event: PointerEvent): void => {
    this.#onNativeMove(event);
    this.#nativeOrigin = undefined;
    queueMicrotask(() => {
      if (!this.#disposed) this.#commitRightWidth();
    });
  };

  readonly #onNativeCancel = (): void => {
    this.#nativeOrigin = undefined;
  };

  #ownsResizeHandle(): boolean {
    return (
      this.#nativeHandle === undefined ||
      this.#extendedWidth !== undefined
    );
  }

  #setExtendedWidth(requested: number): void {
    const next = clampTabsPanelWidth(
      requested,
      this.#viewportWidth(),
      this.#sidebarWidth(),
    );
    this.#preferredRightWidth = next;
    this.#rightTrackAppliedWidth = undefined;
    this.#extendedWidth =
      this.#nativeHandle === undefined ||
      next > this.#detailsTrackMaximum()
        ? next
        : undefined;
    this.#reconcile();
  }

  #commitRightWidth(preferRequested = false): void {
    const candidate = preferRequested
      ? this.#preferredRightWidth ??
        this.#extendedWidth ??
        this.#measuredTrackWidth()
      : this.#extendedWidth ?? this.#measuredTrackWidth();
    const next = clampTabsPanelWidth(
      candidate,
      this.#viewportWidth(),
      this.#sidebarWidth(),
    );
    this.#preferredRightWidth = next;
    if (this.#extendedWidth === undefined) {
      this.#rightTrackAppliedWidth = next;
    }
    this.#onSizeCommit?.(next);
    this.#reconcile();
  }

  #setBottomHeight(requested: number): void {
    this.#bottomHeight = clampTabsPanelHeight(
      requested,
      this.#viewportHeight(),
    );
    this.#reconcile();
  }

  #measuredTrackWidth(): number {
    const measured = Math.round(
      this.#detailsColumn?.getBoundingClientRect().width ?? 0,
    );
    return measured >= TABS_PANEL_MIN_WIDTH
      ? measured
      : Math.min(
        TABS_PANEL_DEFAULT_WIDTH,
        Math.max(
          TABS_PANEL_MIN_WIDTH,
          this.#viewportWidth() - 96,
        ),
      );
  }

  #viewportWidth(): number {
    const measured =
      this.#frame?.getBoundingClientRect().width ?? 0;
    return measured > 0
      ? measured
      : this.#view?.innerWidth ?? TABS_PANEL_DEFAULT_WIDTH;
  }

  #sidebarWidth(): number {
    return Math.max(
      0,
      Math.round(
        this.#sidebarColumn?.getBoundingClientRect().width ?? 0,
      ),
    );
  }

  #detailsTrackMaximum(): number {
    return tabsPanelReflowMaxWidth(
      this.#viewportWidth(),
      this.#sidebarWidth(),
    );
  }

  #viewportHeight(): number {
    const measured =
      this.#frame?.getBoundingClientRect().height ?? 0;
    return measured > 0
      ? measured
      : this.#view?.innerHeight ?? TABS_PANEL_DEFAULT_HEIGHT;
  }

  #isBottom(): boolean {
    return this.#panel.dataset.placement === "bottom";
  }

  readonly #reconcile = (): void => {
    if (this.#isBottom()) {
      this.#reconcileBottom();
      return;
    }
    const viewport = this.#viewportWidth();
    const sidebar = this.#sidebarWidth();
    const trackMaximum = tabsPanelReflowMaxWidth(
      viewport,
      sidebar,
    );
    const preferred =
      this.#preferredRightWidth === undefined
        ? undefined
        : clampTabsPanelWidth(
            this.#preferredRightWidth,
            viewport,
            sidebar,
          );
    this.#extendedWidth =
      preferred !== undefined &&
      (this.#nativeHandle === undefined ||
        preferred > trackMaximum)
        ? preferred
        : undefined;

    const open = this.#panel.hasAttribute("data-open");
    if (!open) {
      this.#rightTrackAppliedWidth = undefined;
    } else if (
      preferred !== undefined &&
      this.#applyRightTrackWidth !== undefined &&
      this.#nativeOrigin === undefined
    ) {
      const trackWidth = Math.min(preferred, trackMaximum);
      if (this.#rightTrackAppliedWidth !== trackWidth) {
        this.#rightTrackAppliedWidth = trackWidth;
        this.#applyRightTrackWidth(trackWidth);
      }
    }

    const measured = this.#measuredTrackWidth();
    const width = this.#extendedWidth ?? measured;
    this.#panel.style.setProperty(
      "--minke-tabs-panel-width",
      `${width}px`,
    );
    this.#overlay?.style.setProperty(
      "--minke-tabs-panel-width",
      `${width}px`,
    );
    const extended =
      this.#extendedWidth !== undefined &&
      this.#extendedWidth > trackMaximum;
    const overlayOwned = this.#nativeHandle === undefined;
    const ownsResizeHandle = this.#ownsResizeHandle();
    this.#panel.toggleAttribute("data-extended", extended);
    this.#syncNativeHandleStacking();
    this.#panel.toggleAttribute(
      "data-overlay",
      overlayOwned ||
        measured < TABS_PANEL_MIN_WIDTH ||
        extended,
    );
    this.#frame?.toggleAttribute(
      "data-minke-tabs-right-open",
      open,
    );

    const handle = this.#panel.querySelector<HTMLElement>(
      TABS_RESIZE_HANDLE_SELECTOR,
    );
    if (handle === null) return;
    handle.tabIndex =
      ownsResizeHandle &&
      this.#panel.hasAttribute("data-open")
        ? 0
        : -1;
    handle.setAttribute(
      "aria-valuemin",
      String(
        overlayOwned
          ? TABS_PANEL_MIN_WIDTH
          : trackMaximum,
      ),
    );
    handle.setAttribute(
      "aria-valuemax",
      String(
        clampTabsPanelWidth(
          TABS_PANEL_MAX_WIDTH,
          viewport,
          sidebar,
        ),
      ),
    );
    handle.setAttribute("aria-valuenow", String(width));
  };

  #reconcileBottom(): void {
    this.#bottomHeight = clampTabsPanelHeight(
      this.#bottomHeight,
      this.#viewportHeight(),
    );
    const height = `${this.#bottomHeight}px`;
    const left = `${Math.max(
      0,
      Math.round(
        this.#sidebarColumn?.getBoundingClientRect().width ?? 0,
      ),
    )}px`;
    this.#panel.style.setProperty(
      "--minke-tabs-panel-height",
      height,
    );
    this.#panel.style.setProperty(
      "--minke-tabs-panel-left",
      left,
    );
    this.#overlay?.style.setProperty(
      "--minke-tabs-panel-height",
      height,
    );
    this.#overlay?.style.setProperty(
      "--minke-tabs-panel-left",
      left,
    );
    this.#frame?.style.setProperty(
      "--minke-tabs-panel-height",
      height,
    );
    this.#panel.removeAttribute("data-extended");
    this.#panel.removeAttribute("data-overlay");
    this.#syncNativeHandleStacking();

    const open = this.#panel.hasAttribute("data-open");
    this.#frame?.toggleAttribute(
      "data-minke-tabs-bottom-open",
      open,
    );
    this.#frame?.toggleAttribute(
      "data-minke-tabs-bottom-resizing",
      open && this.#panel.hasAttribute("data-resizing"),
    );

    const handle = this.#panel.querySelector<HTMLElement>(
      TABS_RESIZE_HANDLE_SELECTOR,
    );
    if (handle === null) return;
    handle.tabIndex = open ? 0 : -1;
    handle.setAttribute(
      "aria-valuemin",
      String(TABS_PANEL_MIN_HEIGHT),
    );
    handle.setAttribute(
      "aria-valuemax",
      String(
        clampTabsPanelHeight(
          TABS_PANEL_MAX_HEIGHT,
          this.#viewportHeight(),
        ),
      ),
    );
    handle.setAttribute(
      "aria-valuenow",
      String(this.#bottomHeight),
    );
  }
}
