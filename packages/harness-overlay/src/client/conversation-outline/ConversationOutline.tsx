import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CONVERSATION_OUTLINE_MARKER_HEIGHT,
  conversationOutlineRailLayout,
  conversationOutlineTooltipTop,
} from "./geometry.ts";
import type {
  ConversationOutlineTranslate,
} from "./locales.ts";
import {
  conversationOutlineItems,
  type ConversationOutlineItem,
  type ConversationOutlineNodeLookup,
} from "./model.ts";

const MIN_ITEM_COUNT = 2;
const MIN_SCROLLPORT_WIDTH = 900;
const MIN_RAIL_GUTTER = 76;
const MIN_RAIL_HEIGHT = 192;
const RAIL_LEFT_CLEARANCE = 15;
const RAIL_TOP_CLEARANCE = 18;
const RAIL_BOTTOM_CLEARANCE = 18;
const TRACK_HIT_SLOP = 12;
const HOVER_DELAY_MS = 110;
const HOVER_EXIT_DELAY_MS = 100;

interface ConversationOutlineSnapshot {
  readonly chat: {
    readonly order: readonly string[];
    readonly nodes: ConversationOutlineNodeLookup;
  };
  readonly hasMore: boolean;
}

export interface ConversationOutlineProps {
  readonly sessionId: string;
  readonly useSession: <Value>(
    selector: (snapshot: ConversationOutlineSnapshot) => Value,
  ) => Value;
  readonly t: ConversationOutlineTranslate;
}

interface OutlineGeometry {
  readonly visible: boolean;
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly availableTop: number;
  readonly availableBottom: number;
}

interface MessagePosition {
  readonly key: string;
  readonly top: number;
}

interface MessageIndex {
  readonly focusOffset: number;
  readonly positions: readonly MessagePosition[];
}

const INITIAL_GEOMETRY: OutlineGeometry = {
  visible: false,
  left: 0,
  top: 0,
  height: 0,
  availableTop: 0,
  availableBottom: 0,
};

const INITIAL_MESSAGE_INDEX: MessageIndex = {
  focusOffset: 0,
  positions: [],
};

type MarkerStyle = CSSProperties & {
  "--minke-outline-marker-scale": string;
};

const STAIRCASE_SCALES = [0.94, 0.72, 0.54, 0.4] as const;

function markerIndexAtClientY(
  track: HTMLElement,
  clientY: number,
  itemCount: number,
  hitSlop = 0,
): number | null {
  if (itemCount === 0) return null;
  const rect = track.getBoundingClientRect();
  const localY = clientY - rect.top;
  if (
    localY < -hitSlop ||
    localY > rect.height + hitSlop
  ) {
    return null;
  }
  const boundedY = Math.min(
    Math.max(0, localY),
    Math.max(0, rect.height - 0.01),
  );
  return Math.min(
    itemCount - 1,
    Math.max(
      0,
      Math.floor(
        (boundedY + track.scrollTop) /
          CONVERSATION_OUTLINE_MARKER_HEIGHT,
      ),
    ),
  );
}

function findChatScrollport(): HTMLElement | null {
  for (
    const flow of document.querySelectorAll<HTMLElement>(
      "[data-chat-flow]",
    )
  ) {
    const scrollport = flow.closest<HTMLElement>(
      "[data-conversation-scroll]",
    );
    if (scrollport !== null) return scrollport;
  }
  return document.querySelector<HTMLElement>(
    "[data-conversation-scroll]",
  );
}

function containsChatSurface(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return (
    node.matches(
      "[data-chat-flow], [data-conversation-scroll]",
    ) ||
    node.querySelector(
      "[data-chat-flow], [data-conversation-scroll]",
    ) !== null
  );
}

function findMessageRow(
  scrollport: HTMLElement,
  key: string,
): HTMLElement | null {
  for (
    const row of scrollport.querySelectorAll<HTMLElement>(
      "[data-chat-anchor-key]",
    )
  ) {
    if (row.dataset.chatAnchorKey === key) return row;
  }
  return null;
}

function collectMessageRows(
  scrollport: HTMLElement,
): ReadonlyMap<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (
    const row of scrollport.querySelectorAll<HTMLElement>(
      "[data-chat-anchor-key]",
    )
  ) {
    const key = row.dataset.chatAnchorKey;
    if (key !== undefined) rows.set(key, row);
  }
  return rows;
}

function messageFocusOffset(scrollport: HTMLElement): number {
  const scrollRect = scrollport.getBoundingClientRect();
  const composer = scrollport.querySelector<HTMLElement>(
    "[data-composer-seat]",
  );
  const visibleBottom = Math.min(
    scrollRect.bottom,
    composer?.getBoundingClientRect().top ?? scrollRect.bottom,
  );
  return Math.min(
    160,
    Math.max(0, visibleBottom - scrollRect.top) * 0.32,
  );
}

function buildMessageIndex(
  scrollport: HTMLElement,
  items: readonly ConversationOutlineItem[],
  rows: ReadonlyMap<string, HTMLElement>,
): MessageIndex {
  const scrollRect = scrollport.getBoundingClientRect();
  const positions = items.flatMap((item) => {
    const row = rows.get(item.key);
    if (row === undefined) return [];
    return [{
      key: item.key,
      top: row.getBoundingClientRect().top -
        scrollRect.top +
        scrollport.scrollTop,
    }];
  });
  positions.sort((left, right) => left.top - right.top);
  return {
    focusOffset: messageFocusOffset(scrollport),
    positions,
  };
}

function geometryEqual(
  left: OutlineGeometry,
  right: OutlineGeometry,
): boolean {
  return (
    left.visible === right.visible &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5 &&
    Math.abs(
      left.availableTop - right.availableTop,
    ) < 0.5 &&
    Math.abs(
      left.availableBottom - right.availableBottom,
    ) < 0.5
  );
}

function outlineGeometry(
  scrollport: HTMLElement,
  items: readonly ConversationOutlineItem[],
): OutlineGeometry {
  const flow = scrollport.querySelector<HTMLElement>(
    "[data-chat-flow]",
  );
  if (flow === null) return INITIAL_GEOMETRY;
  const scrollRect = scrollport.getBoundingClientRect();
  const flowRect = flow.getBoundingClientRect();
  const composer = scrollport.querySelector<HTMLElement>(
    "[data-composer-seat]",
  );
  const composerTop = composer?.getBoundingClientRect().top ??
    scrollRect.bottom;
  const availableTop = scrollRect.top + RAIL_TOP_CLEARANCE;
  const availableBottom = Math.min(
    scrollRect.bottom - RAIL_BOTTOM_CLEARANCE,
    composerTop - RAIL_BOTTOM_CLEARANCE,
  );
  const availableHeight = Math.max(
    0,
    availableBottom - availableTop,
  );
  const rail = conversationOutlineRailLayout(
    availableTop,
    availableHeight,
    items.length,
  );
  const gutter = flowRect.left - scrollRect.left;
  const visible = (
    items.length >= MIN_ITEM_COUNT &&
    scrollRect.width >= MIN_SCROLLPORT_WIDTH &&
    gutter >= MIN_RAIL_GUTTER &&
    availableHeight >= MIN_RAIL_HEIGHT
  );
  const left = scrollRect.left + RAIL_LEFT_CLEARANCE;
  return {
    visible,
    left,
    top: rail.top,
    height: rail.height,
    availableTop,
    availableBottom,
  };
}

function activeMessageKey(
  scrollTop: number,
  index: MessageIndex,
): string | null {
  if (index.positions.length === 0) return null;
  const target = scrollTop + index.focusOffset;
  let low = 0;
  let high = index.positions.length - 1;
  let activeIndex = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const position = index.positions[middle];
    if (position === undefined) break;
    if (position.top <= target) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return index.positions[activeIndex]?.key ?? null;
}

/** Responsive, keyboard-reachable navigator for loaded user messages. */
export function ConversationOutline({
  sessionId,
  useSession,
  t,
}: ConversationOutlineProps): ReactNode {
  const order = useSession((snapshot) => snapshot.chat.order);
  const nodes = useSession((snapshot) => snapshot.chat.nodes);
  const hasMore = useSession((snapshot) => snapshot.hasMore);
  const items = useMemo(
    () => conversationOutlineItems(order, nodes, {
      image: t("image"),
      nonText: t("nonText"),
    }),
    [nodes, order, t],
  );
  const [scrollport, setScrollport] =
    useState<HTMLElement | null>(null);
  const [chatFlow, setChatFlow] =
    useState<HTMLElement | null>(null);
  const [geometry, setGeometry] =
    useState<OutlineGeometry>(INITIAL_GEOMETRY);
  const [activeKey, setActiveKey] = useState<string | null>(
    null,
  );
  const [previewKey, setPreviewKey] = useState<string | null>(
    null,
  );
  const [highlightKey, setHighlightKey] = useState<
    string | null
  >(null);
  const [tabKey, setTabKey] = useState<string | null>(null);
  const [trackScrollTop, setTrackScrollTop] = useState(0);
  const [tooltipMeasurement, setTooltipMeasurement] = useState<{
    readonly key: string;
    readonly height: number;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLElement | null>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowMapRef = useRef<ReadonlyMap<string, HTMLElement>>(
    new Map(),
  );
  const messageIndexRef = useRef<MessageIndex>(
    INITIAL_MESSAGE_INDEX,
  );
  const visibleRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const activeFrameRef = useRef<number | null>(null);
  const suppressNextPointerClickRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const interactionRef = useRef<{
    hover: string | null;
    focus: string | null;
  }>({ hover: null, focus: null });

  useLayoutEffect(() => {
    const syncScrollport = (): void => {
      const next = findChatScrollport();
      const nextFlow = next?.querySelector<HTMLElement>(
        "[data-chat-flow]",
      ) ?? null;
      setScrollport((current) =>
        current === next ? current : next
      );
      setChatFlow((current) =>
        current === nextFlow ? current : nextFlow
      );
    };
    syncScrollport();
    const surfaceObserver = new MutationObserver((records) => {
      const changed = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          containsChatSurface,
        )
      );
      if (changed) syncScrollport();
    });
    surfaceObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => {
      surfaceObserver.disconnect();
    };
  }, [sessionId]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  useLayoutEffect(() => {
    if (scrollport === null) {
      visibleRef.current = false;
      rowMapRef.current = new Map();
      messageIndexRef.current = INITIAL_MESSAGE_INDEX;
      setGeometry(INITIAL_GEOMETRY);
      setActiveKey(null);
      return;
    }
    const measure = (): void => {
      const next = outlineGeometry(scrollport, items);
      const rows = next.visible
        ? collectMessageRows(scrollport)
        : new Map<string, HTMLElement>();
      const messageIndex = next.visible
        ? buildMessageIndex(scrollport, items, rows)
        : INITIAL_MESSAGE_INDEX;
      visibleRef.current = next.visible;
      rowMapRef.current = rows;
      messageIndexRef.current = messageIndex;
      setGeometry((current) =>
        geometryEqual(current, next) ? current : next
      );
      setActiveKey(
        next.visible
          ? activeMessageKey(
            scrollport.scrollTop,
            messageIndex,
          )
          : null,
      );
    };
    const scheduleMeasure = (): void => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        measure();
      });
    };
    const scheduleActiveUpdate = (): void => {
      if (!visibleRef.current) return;
      if (activeFrameRef.current !== null) return;
      activeFrameRef.current = requestAnimationFrame(() => {
        activeFrameRef.current = null;
        setActiveKey(
          activeMessageKey(
            scrollport.scrollTop,
            messageIndexRef.current,
          ),
        );
      });
    };
    measure();
    scrollport.addEventListener("scroll", scheduleActiveUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleMeasure);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(scrollport);
    if (chatFlow !== null) resizeObserver?.observe(chatFlow);
    const composer = scrollport.querySelector<HTMLElement>(
      "[data-composer-seat]",
    );
    if (composer !== null) resizeObserver?.observe(composer);
    const mutationObserver = new MutationObserver((records) => {
      const conversationChanged = records.some((record) => {
        const target = record.target;
        return (
          !(target instanceof Element) ||
          target.closest(
            "[data-minke-conversation-outline]",
          ) === null
        );
      });
      if (conversationChanged) scheduleMeasure();
    });
    mutationObserver.observe(scrollport, {
      childList: true,
      subtree: true,
    });
    return () => {
      visibleRef.current = false;
      rowMapRef.current = new Map();
      messageIndexRef.current = INITIAL_MESSAGE_INDEX;
      scrollport.removeEventListener(
        "scroll",
        scheduleActiveUpdate,
      );
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (activeFrameRef.current !== null) {
        cancelAnimationFrame(activeFrameRef.current);
        activeFrameRef.current = null;
      }
    };
  }, [chatFlow, items, scrollport]);

  const overflowing =
    items.length * CONVERSATION_OUTLINE_MARKER_HEIGHT >
      geometry.height;

  useEffect(() => {
    setTabKey((current) => {
      if (
        current !== null &&
        items.some((item) => item.key === current)
      ) {
        return current;
      }
      return null;
    });
  }, [items]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    if (!overflowing) {
      if (track.scrollTop !== 0) track.scrollTop = 0;
      setTrackScrollTop((current) =>
        current === 0 ? current : 0
      );
      return;
    }
    if (!geometry.visible) return;
    if (activeKey === null) return;
    const activeIndex = items.findIndex(
      (item) => item.key === activeKey,
    );
    if (activeIndex < 0) return;
    const top =
      activeIndex * CONVERSATION_OUTLINE_MARKER_HEIGHT;
    const bottom = top + CONVERSATION_OUTLINE_MARKER_HEIGHT;
    if (top < track.scrollTop) {
      track.scrollTop = top;
      setTrackScrollTop(top);
    } else if (bottom > track.scrollTop + track.clientHeight) {
      const next = bottom - track.clientHeight;
      track.scrollTop = next;
      setTrackScrollTop(next);
    }
  }, [
    activeKey,
    geometry.height,
    geometry.visible,
    items,
    overflowing,
  ]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (previewKey === null || tooltip === null) return;
    const height = tooltip.getBoundingClientRect().height;
    setTooltipMeasurement((current) =>
      current?.key === previewKey &&
        Math.abs(current.height - height) < 0.5
        ? current
        : { key: previewKey, height }
    );
  }, [
    geometry.availableBottom,
    geometry.availableTop,
    geometry.left,
    previewKey,
  ]);

  const syncPreview = useCallback(() => {
    setPreviewKey(
      interactionRef.current.focus ??
        interactionRef.current.hover,
    );
  }, []);

  const syncHighlight = useCallback(() => {
    setHighlightKey(
      interactionRef.current.focus ??
        interactionRef.current.hover,
    );
  }, []);

  const beginHover = useCallback(
    (key: string) => {
      if (interactionRef.current.hover === key) return;
      clearHoverTimer();
      interactionRef.current.hover = key;
      syncHighlight();
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        if (interactionRef.current.hover === key) {
          syncPreview();
        }
      }, HOVER_DELAY_MS);
    },
    [clearHoverTimer, syncHighlight, syncPreview],
  );

  const endHover = useCallback(
    (key: string) => {
      clearHoverTimer();
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        if (interactionRef.current.hover === key) {
          interactionRef.current.hover = null;
        }
        syncHighlight();
        syncPreview();
      }, HOVER_EXIT_DELAY_MS);
    },
    [clearHoverTimer, syncHighlight, syncPreview],
  );

  const focusPreview = useCallback(
    (key: string) => {
      clearHoverTimer();
      interactionRef.current.focus = key;
      syncHighlight();
      syncPreview();
    },
    [clearHoverTimer, syncHighlight, syncPreview],
  );

  const blurPreview = useCallback(
    (key: string) => {
      if (interactionRef.current.focus === key) {
        interactionRef.current.focus = null;
      }
      syncHighlight();
      syncPreview();
    },
    [syncHighlight, syncPreview],
  );

  const dismissPreview = useCallback(() => {
    clearHoverTimer();
    interactionRef.current.hover = null;
    interactionRef.current.focus = null;
    setHighlightKey(null);
    setPreviewKey(null);
  }, [clearHoverTimer]);

  const jumpTo = useCallback(
    (key: string) => {
      if (scrollport === null) return;
      const cachedRow = rowMapRef.current.get(key);
      const row = cachedRow?.isConnected
        ? cachedRow
        : findMessageRow(scrollport, key);
      if (row === null) return;
      row.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
      setActiveKey(key);
    },
    [scrollport],
  );

  const focusMarker = useCallback(
    (index: number) => {
      const item = items[index];
      if (item === undefined) return;
      setTabKey(item.key);
      markerRefs.current.get(item.key)?.focus();
    },
    [items],
  );

  const handleMarkerKey = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      index: number,
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissPreview();
        return;
      }
      let target: number | null = null;
      if (event.key === "ArrowDown") {
        target = Math.min(items.length - 1, index + 1);
      } else if (event.key === "ArrowUp") {
        target = Math.max(0, index - 1);
      } else if (event.key === "Home") {
        target = 0;
      } else if (event.key === "End") {
        target = items.length - 1;
      }
      if (target === null) return;
      event.preventDefault();
      focusMarker(target);
    },
    [dismissPreview, focusMarker, items.length],
  );

  if (scrollport === null) return null;

  const activeTabKey =
    tabKey ?? activeKey ?? items[0]?.key ?? null;
  const previewIndex = items.findIndex(
    (item) => item.key === previewKey,
  );
  const highlightIndex = items.findIndex(
    (item) => item.key === highlightKey,
  );
  const previewItem = previewIndex < 0
    ? undefined
    : items[previewIndex];
  const previewTop = previewItem === undefined
    ? 0
    : previewIndex * CONVERSATION_OUTLINE_MARKER_HEIGHT +
      CONVERSATION_OUTLINE_MARKER_HEIGHT / 2 -
      trackScrollTop;
  const tooltipVisible = (
    previewItem !== undefined &&
    previewTop >= 0 &&
    previewTop <= geometry.height
  );
  const tooltipHeight =
    tooltipMeasurement?.key === previewKey
      ? tooltipMeasurement.height
      : 0;
  const tooltipTop = tooltipHeight === 0
    ? previewTop
    : conversationOutlineTooltipTop(
      geometry.top + previewTop,
      tooltipHeight,
      geometry.availableTop,
      geometry.availableBottom,
    ) - geometry.top;

  return createPortal(
    <nav
      data-minke-conversation-outline=""
      data-visible={geometry.visible ? "true" : "false"}
      data-overflow={overflowing ? "true" : "false"}
      aria-label={t("label")}
      aria-description={
        hasMore ? t("historyIncomplete") : undefined
      }
      style={{
        left: geometry.left,
        top: geometry.top,
        height: geometry.height,
      }}
    >
      {hasMore && (
        <span
          data-minke-conversation-outline-history=""
          title={t("historyIncomplete")}
          role="note"
          aria-label={t("historyIncomplete")}
          tabIndex={0}
        />
      )}
      <div
        data-minke-conversation-outline-hitbox=""
        onPointerMove={(event) => {
          const track = trackRef.current;
          if (track === null) return;
          const index = markerIndexAtClientY(
            track,
            event.clientY,
            items.length,
            TRACK_HIT_SLOP,
          );
          const item = index === null ? undefined : items[index];
          if (item !== undefined) beginHover(item.key);
        }}
        onPointerLeave={() => {
          const key = interactionRef.current.hover;
          if (key !== null) endHover(key);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const track = trackRef.current;
          if (track === null) return;
          const index = markerIndexAtClientY(
            track,
            event.clientY,
            items.length,
            TRACK_HIT_SLOP,
          );
          const item = index === null ? undefined : items[index];
          if (item !== undefined) {
            suppressNextPointerClickRef.current = true;
            jumpTo(item.key);
          }
        }}
        onClick={(event) => {
          if (event.detail === 0) return;
          if (suppressNextPointerClickRef.current) {
            suppressNextPointerClickRef.current = false;
            return;
          }
          const track = trackRef.current;
          if (track === null) return;
          const index = markerIndexAtClientY(
            track,
            event.clientY,
            items.length,
            TRACK_HIT_SLOP,
          );
          const item = index === null ? undefined : items[index];
          if (item !== undefined) jumpTo(item.key);
        }}
      >
        <div
          ref={trackRef}
          data-minke-conversation-outline-track=""
          onScroll={(event) => {
            setTrackScrollTop(event.currentTarget.scrollTop);
          }}
        >
          {items.map((item, index) => {
            const current = item.key === activeKey;
            const staircaseDistance = highlightIndex < 0
              ? null
              : Math.abs(index - highlightIndex);
            const staircaseScale = staircaseDistance === null
              ? undefined
              : STAIRCASE_SCALES[staircaseDistance];
            const tooltipId =
              `minke-conversation-outline-tooltip-${index}`;
            const markerStyle: MarkerStyle = {
              "--minke-outline-marker-scale":
                `${
                  staircaseScale ??
                    item.markerWidth / 28
                }`,
            };
            return (
              <button
                key={item.key}
                ref={(element) => {
                  if (element === null) {
                    markerRefs.current.delete(item.key);
                  } else {
                    markerRefs.current.set(item.key, element);
                  }
                }}
                type="button"
                data-minke-conversation-outline-marker=""
                data-minke-conversation-outline-target={item.key}
                data-preview={
                  previewKey === item.key ? "true" : undefined
                }
                data-staircase-center={
                  staircaseDistance === 0
                    ? "true"
                    : undefined
                }
                aria-label={t("messageAction", {
                  index: index + 1,
                  total: items.length,
                })}
                aria-current={
                  current ? "location" : undefined
                }
                aria-describedby={
                  previewKey === item.key
                    ? tooltipId
                    : undefined
                }
                tabIndex={item.key === activeTabKey ? 0 : -1}
                style={markerStyle}
                onFocus={() => {
                  setTabKey(item.key);
                  focusPreview(item.key);
                }}
                onBlur={() => {
                  blurPreview(item.key);
                }}
                onKeyDown={(event) => {
                  handleMarkerKey(event, index);
                }}
                onClick={(event) => {
                  if (event.detail === 0) jumpTo(item.key);
                }}
              />
            );
          })}
        </div>
      </div>
      {tooltipVisible && previewItem !== undefined && (
        <aside
          ref={tooltipRef}
          id={`minke-conversation-outline-tooltip-${previewIndex}`}
          data-minke-conversation-outline-tooltip=""
          role="tooltip"
          style={{
            top: tooltipTop,
            visibility: tooltipHeight === 0
              ? "hidden"
              : undefined,
          }}
          onMouseEnter={clearHoverTimer}
          onMouseLeave={() => {
            endHover(previewItem.key);
          }}
        >
          <strong
            data-minke-conversation-outline-tooltip-title=""
          >
            {t("messagePosition", {
              index: previewIndex + 1,
              total: items.length,
            })}
          </strong>
          <span data-minke-conversation-outline-tooltip-body="">
            {previewItem.preview}
          </span>
        </aside>
      )}
    </nav>,
    scrollport,
  );
}
