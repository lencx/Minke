import {
  Bot,
  ChevronRight,
  CircleAlert,
  Globe,
  History,
  ListFilter,
  LoaderCircle,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
  User,
  X,
} from "@lucide/icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import type {
  AgentBrowserHistorySnapshot,
  AgentBrowserHistoryVisit,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import type {
  AgentBrowserOwner,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import {
  webHistoryDisplayAddress,
  webHistoryPrimaryLabel,
} from "@minke/harness-overlay/client/tabs/web/history-suggestions.ts";
import type {
  BrowserHistoryCursor,
  BrowserHistoryTabsController,
} from "./controller.ts";
import type {
  BrowserHistoryTranslate,
} from "./locales.ts";
import type {
  BrowserHistoryTab,
} from "./types.ts";

type HistoryActorFilter = "all" | AgentBrowserOwner;
type HistoryLoadStatus = "loading" | "ready" | "error";
type HistoryAppendStatus = "idle" | "loading" | "error";

const HISTORY_QUERY_DEBOUNCE_MS = 180;
const HISTORY_ROW_HEIGHT = 56;
const HISTORY_OVERSCAN = 8;
const HISTORY_LOAD_MORE_THRESHOLD = 20;
const HISTORY_FALLBACK_VIEWPORT_HEIGHT = 560;

const actorFilters = [
  {
    icon: ListFilter,
    label: "browserHistory.filter.all",
    value: "all",
  },
  {
    icon: User,
    label: "browserHistory.filter.human",
    value: "human",
  },
  {
    icon: Bot,
    label: "browserHistory.filter.agent",
    value: "agent",
  },
] as const;

export interface BrowserHistoryVirtualRangeInput {
  readonly count: number;
  readonly overscan?: number;
  readonly rowHeight: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

export interface BrowserHistoryVirtualRange {
  readonly end: number;
  readonly start: number;
}

/** Return the half-open item range that should exist in the DOM. */
export function computeBrowserHistoryVirtualRange({
  count,
  overscan = HISTORY_OVERSCAN,
  rowHeight,
  scrollTop,
  viewportHeight,
}: BrowserHistoryVirtualRangeInput): BrowserHistoryVirtualRange {
  if (
    count <= 0 ||
    rowHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return { end: 0, start: 0 };
  }
  const safeScrollTop = Math.max(0, scrollTop);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const start = Math.max(
    0,
    Math.floor(safeScrollTop / rowHeight) - safeOverscan,
  );
  const end = Math.min(
    count,
    Math.ceil(
      (safeScrollTop + viewportHeight) / rowHeight,
    ) + safeOverscan,
  );
  return { end, start };
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-"),
    [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ].join(":"),
  ].join(" ");
}

function visitCountLabel(
  count: number,
  t: BrowserHistoryTranslate,
): string {
  return t(
    count === 1
      ? "browserHistory.visit.count.one"
      : "browserHistory.visit.count.many",
    { count },
  );
}

function sameCursor(
  left: BrowserHistoryCursor | undefined,
  right: BrowserHistoryCursor | undefined,
): boolean {
  return (
    left?.visitedAt === right?.visitedAt &&
    left?.visitId === right?.visitId
  );
}

function HistoryFavicon({
  failed,
  faviconUrl,
  onFailure,
}: {
  readonly failed: boolean;
  readonly faviconUrl?: string;
  readonly onFailure: (faviconUrl: string) => void;
}): ReactNode {
  if (faviconUrl === undefined || failed) {
    return <LucideIcon icon={Globe} size={14} />;
  }
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden="true"
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => onFailure(faviconUrl)}
    />
  );
}

interface IndexedHistoryVisit {
  readonly index: number;
  readonly visit: AgentBrowserHistoryVisit;
}

function visitsInRange(
  pages: readonly (readonly AgentBrowserHistoryVisit[])[],
  start: number,
  end: number,
): readonly IndexedHistoryVisit[] {
  const result: IndexedHistoryVisit[] = [];
  let pageStart = 0;
  for (const page of pages) {
    const pageEnd = pageStart + page.length;
    if (pageEnd <= start) {
      pageStart = pageEnd;
      continue;
    }
    if (pageStart >= end) break;
    const localStart = Math.max(0, start - pageStart);
    const localEnd = Math.min(page.length, end - pageStart);
    for (
      let localIndex = localStart;
      localIndex < localEnd;
      localIndex += 1
    ) {
      const visit = page[localIndex];
      if (visit !== undefined) {
        result.push({
          index: pageStart + localIndex,
          visit,
        });
      }
    }
    pageStart = pageEnd;
  }
  return result;
}

function withoutVisit(
  pages: readonly (readonly AgentBrowserHistoryVisit[])[],
  removed: AgentBrowserHistoryVisit,
): readonly (readonly AgentBrowserHistoryVisit[])[] {
  return pages
    .map((page) =>
      page.flatMap((visit) => {
        if (visit.visitId === removed.visitId) return [];
        if (visit.pathKey !== removed.pathKey) return [visit];
        return [{
          ...visit,
          pathAgentVisits: Math.max(
            0,
            visit.pathAgentVisits -
              (removed.actor === "agent" ? 1 : 0),
          ),
          pathHumanVisits: Math.max(
            0,
            visit.pathHumanVisits -
              (removed.actor === "human" ? 1 : 0),
          ),
          pathVisitCount: Math.max(
            1,
            visit.pathVisitCount - 1,
          ),
        }];
      }))
    .filter((page) => page.length > 0);
}

export function BrowserHistoryView({
  active,
  controller,
  tab,
  t,
}: {
  readonly active: boolean;
  readonly controller: BrowserHistoryTabsController;
  readonly tab: BrowserHistoryTab;
  readonly t: BrowserHistoryTranslate;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [actor, setActor] =
    useState<HistoryActorFilter>("all");
  const [snapshot, setSnapshot] =
    useState<AgentBrowserHistorySnapshot>();
  const [visitPages, setVisitPages] = useState<
    readonly (readonly AgentBrowserHistoryVisit[])[]
  >([]);
  const [nextCursor, setNextCursor] =
    useState<BrowserHistoryCursor>();
  const [status, setStatus] =
    useState<HistoryLoadStatus>("loading");
  const [appendStatus, setAppendStatus] =
    useState<HistoryAppendStatus>("idle");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState(false);
  const [deletingVisitId, setDeletingVisitId] =
    useState<number>();
  const [deleteErrorVisitId, setDeleteErrorVisitId] =
    useState<number>();
  const [focusAfterDeleteIndex, setFocusAfterDeleteIndex] =
    useState<number>();
  const [scrollTop, setScrollTop] = useState(0);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [focusedVisitIndex, setFocusedVisitIndex] =
    useState<number>();
  const [viewportHeight, setViewportHeight] = useState(
    HISTORY_FALLBACK_VIEWPORT_HEIGHT,
  );
  const [rowHeight, setRowHeight] = useState(HISTORY_ROW_HEIGHT);
  const [failedFaviconUrls, setFailedFaviconUrls] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const latestFilterRef = useRef({ actor, debouncedQuery });
  latestFilterRef.current = { actor, debouncedQuery };
  const generationRef = useRef(0);
  const clearRequestId = useRef(0);
  const deleteRequestId = useRef(0);
  const clearingRef = useRef(false);
  const deletingVisitRef = useRef<number | undefined>(undefined);
  const appendPendingRef = useRef(false);
  const seenVisitIdsRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const pendingScrollTopRef = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearCancelRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusAfterConfirmationRef = useRef<
    "search" | "trigger" | undefined
  >(undefined);
  const clearConfirmMessageId =
    `minke-browser-history-clear-${tab.id}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, HISTORY_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const resetAndLoad = useCallback(async (
    filter: HistoryActorFilter,
    searchQuery: string,
  ): Promise<void> => {
    if (clearingRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    appendPendingRef.current = false;
    seenVisitIdsRef.current = new Set();
    setSnapshot(undefined);
    setVisitPages([]);
    setNextCursor(undefined);
    setStatus("loading");
    setAppendStatus("idle");
    setDeleteErrorVisitId(undefined);
    setScrollTop(0);
    setKeyboardIndex(0);
    setFocusedVisitIndex(undefined);
    pendingScrollTopRef.current = 0;
    if (scrollFrameRef.current !== undefined) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = undefined;
    }
    if (resultsRef.current !== null) {
      resultsRef.current.scrollTop = 0;
    }
    try {
      const next = await controller.readPage({
        ...(filter === "all" ? {} : { actor: filter }),
        ...(searchQuery === "" ? {} : { query: searchQuery }),
      });
      if (
        !mountedRef.current ||
        generationRef.current !== generation
      ) return;
      setSnapshot(next);
      seenVisitIdsRef.current = new Set(
        next.visits.map((visit) => visit.visitId),
      );
      setVisitPages(
        next.visits.length === 0 ? [] : [next.visits],
      );
      setNextCursor(next.nextCursor);
      setStatus("ready");
    } catch (loadError) {
      if (
        !mountedRef.current ||
        generationRef.current !== generation
      ) return;
      console.warn(
        "Minke Browser History could not load visits.",
        loadError,
      );
      setStatus("error");
    }
  }, [controller]);

  const loadMore = useCallback(async (): Promise<void> => {
    const before = nextCursor;
    if (
      before === undefined ||
      appendPendingRef.current ||
      clearingRef.current ||
      status !== "ready"
    ) return;
    const generation = generationRef.current;
    appendPendingRef.current = true;
    setAppendStatus("loading");
    try {
      const next = await controller.readPage({
        ...(actor === "all" ? {} : { actor }),
        before,
        ...(debouncedQuery === ""
          ? {}
          : { query: debouncedQuery }),
      });
      if (
        !mountedRef.current ||
        generationRef.current !== generation
      ) return;
      const uniqueVisits = next.visits.filter((visit) => {
        if (seenVisitIdsRef.current.has(visit.visitId)) {
          return false;
        }
        seenVisitIdsRef.current.add(visit.visitId);
        return true;
      });
      if (uniqueVisits.length > 0) {
        setVisitPages((current) => [...current, uniqueVisits]);
      }
      setNextCursor(
        sameCursor(before, next.nextCursor)
          ? undefined
          : next.nextCursor,
      );
      setAppendStatus("idle");
    } catch (loadError) {
      if (
        !mountedRef.current ||
        generationRef.current !== generation
      ) return;
      console.warn(
        "Minke Browser History could not load more visits.",
        loadError,
      );
      setAppendStatus("error");
    } finally {
      if (
        mountedRef.current &&
        generationRef.current === generation
      ) {
        appendPendingRef.current = false;
      }
    }
  }, [
    actor,
    controller,
    debouncedQuery,
    nextCursor,
    status,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      clearRequestId.current += 1;
      deleteRequestId.current += 1;
      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!active) {
      generationRef.current += 1;
      appendPendingRef.current = false;
      pendingScrollTopRef.current = 0;
      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
      return;
    }
    void resetAndLoad(actor, debouncedQuery);
    return () => {
      generationRef.current += 1;
      appendPendingRef.current = false;
    };
  }, [active, actor, debouncedQuery, resetAndLoad]);

  useEffect(() => {
    const results = resultsRef.current;
    if (results === null) return;
    const measure = (): void => {
      setViewportHeight(
        results.clientHeight ||
        HISTORY_FALLBACK_VIEWPORT_HEIGHT,
      );
      const view = results.ownerDocument.defaultView;
      const measuredRowHeight = Number.parseFloat(
        view?.getComputedStyle(results).getPropertyValue(
          "--minke-browser-history-row-height",
        ) ?? "",
      );
      if (
        Number.isFinite(measuredRowHeight) &&
        measuredRowHeight > 0
      ) {
        setRowHeight(measuredRowHeight);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(results);
    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    if (confirmingClear) {
      if (active) {
        clearCancelRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const focusTarget = focusAfterConfirmationRef.current;
    focusAfterConfirmationRef.current = undefined;
    if (!active) return;
    if (focusTarget === "trigger") {
      clearButtonRef.current?.focus({ preventScroll: true });
    } else if (focusTarget === "search") {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [active, clearing, confirmingClear]);

  const visitCount = useMemo(
    () => visitPages.reduce(
      (count, page) => count + page.length,
      0,
    ),
    [visitPages],
  );
  const virtualRange = useMemo(
    () => computeBrowserHistoryVirtualRange({
      count: visitCount,
      rowHeight,
      scrollTop,
      viewportHeight,
    }),
    [rowHeight, scrollTop, viewportHeight, visitCount],
  );
  const virtualVisits = useMemo(() => {
    const visibleVisits = visitsInRange(
      visitPages,
      virtualRange.start,
      virtualRange.end,
    );
    if (
      focusedVisitIndex === undefined ||
      (
        focusedVisitIndex >= virtualRange.start &&
        focusedVisitIndex < virtualRange.end
      )
    ) {
      return visibleVisits;
    }
    const focusedVisit = visitsInRange(
      visitPages,
      focusedVisitIndex,
      focusedVisitIndex + 1,
    )[0];
    if (focusedVisit === undefined) return visibleVisits;
    return focusedVisitIndex < virtualRange.start
      ? [focusedVisit, ...visibleVisits]
      : [...visibleVisits, focusedVisit];
  }, [
    focusedVisitIndex,
    virtualRange.end,
    virtualRange.start,
    visitPages,
  ]);

  useEffect(() => {
    if (
      nextCursor === undefined ||
      appendStatus !== "idle" ||
      visitCount === 0 ||
      virtualRange.end <
        visitCount - HISTORY_LOAD_MORE_THRESHOLD
    ) return;
    void loadMore();
  }, [
    appendStatus,
    loadMore,
    nextCursor,
    virtualRange.end,
    visitCount,
  ]);

  const closeClearConfirmation = (): void => {
    if (clearingRef.current) return;
    focusAfterConfirmationRef.current = "trigger";
    setClearError(false);
    setConfirmingClear(false);
  };

  const clearHistory = async (): Promise<void> => {
    if (
      clearingRef.current ||
      deletingVisitRef.current !== undefined
    ) return;
    clearingRef.current = true;
    const currentRequest = clearRequestId.current + 1;
    clearRequestId.current = currentRequest;
    generationRef.current += 1;
    appendPendingRef.current = false;
    setClearError(false);
    setClearing(true);
    try {
      const next = await controller.clear();
      if (
        !mountedRef.current ||
        clearRequestId.current !== currentRequest
      ) return;
      generationRef.current += 1;
      setSnapshot(next);
      seenVisitIdsRef.current = new Set();
      setVisitPages([]);
      setNextCursor(undefined);
      setStatus("ready");
      setAppendStatus("idle");
      setDeletingVisitId(undefined);
      setDeleteErrorVisitId(undefined);
      setScrollTop(0);
      setKeyboardIndex(0);
      setFocusedVisitIndex(undefined);
      pendingScrollTopRef.current = 0;
      if (scrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
      if (resultsRef.current !== null) {
        resultsRef.current.scrollTop = 0;
      }
      focusAfterConfirmationRef.current = "search";
      setConfirmingClear(false);
      setQuery("");
      setDebouncedQuery("");
      setActor("all");
    } catch (clearError) {
      if (
        !mountedRef.current ||
        clearRequestId.current !== currentRequest
      ) return;
      console.warn(
        "Minke Browser History could not clear visits.",
        clearError,
      );
      setClearError(true);
    } finally {
      if (
        mountedRef.current &&
        clearRequestId.current === currentRequest
      ) {
        clearingRef.current = false;
        setClearing(false);
      }
    }
  };

  const deleteVisit = async (
    visit: AgentBrowserHistoryVisit,
    index: number,
  ): Promise<void> => {
    if (
      clearingRef.current ||
      deletingVisitRef.current !== undefined
    ) return;
    deletingVisitRef.current = visit.visitId;
    const requestId = deleteRequestId.current + 1;
    const requestGeneration = generationRef.current;
    deleteRequestId.current = requestId;
    setDeleteErrorVisitId(undefined);
    setDeletingVisitId(visit.visitId);
    try {
      await controller.deleteVisit(visit.visitId);
      if (
        !mountedRef.current ||
        deleteRequestId.current !== requestId
      ) return;
      if (generationRef.current !== requestGeneration) {
        const latestFilter = latestFilterRef.current;
        await resetAndLoad(
          latestFilter.actor,
          latestFilter.debouncedQuery,
        );
        return;
      }
      seenVisitIdsRef.current.delete(visit.visitId);
      setVisitPages((current) => withoutVisit(current, visit));
      setSnapshot((current) => current === undefined
        ? current
        : {
          ...current,
          agentVisits: Math.max(
            0,
            current.agentVisits -
              (visit.actor === "agent" ? 1 : 0),
          ),
          humanVisits: Math.max(
            0,
            current.humanVisits -
              (visit.actor === "human" ? 1 : 0),
          ),
          retainedVisits: Math.max(
            0,
            current.retainedVisits - 1,
          ),
          totalVisits: Math.max(0, current.totalVisits - 1),
          uniquePaths: Math.max(
            0,
            current.uniquePaths -
              (visit.pathVisitCount === 1 ? 1 : 0),
          ),
        });
      setFocusedVisitIndex(index);
      setFocusAfterDeleteIndex(index);
    } catch (deleteError) {
      if (
        !mountedRef.current ||
        deleteRequestId.current !== requestId
      ) return;
      console.warn(
        "Minke Browser History could not delete a visit.",
        deleteError,
      );
      setDeleteErrorVisitId(visit.visitId);
    } finally {
      if (
        mountedRef.current &&
        deleteRequestId.current === requestId
      ) {
        deletingVisitRef.current = undefined;
        setDeletingVisitId(undefined);
      }
    }
  };

  const handleScroll = (
    event: UIEvent<HTMLDivElement>,
  ): void => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      setScrollTop(pendingScrollTopRef.current);
    });
  };

  const markFaviconFailed = useCallback(
    (faviconUrl: string): void => {
      setFailedFaviconUrls((current) => {
        if (current.has(faviconUrl)) return current;
        const next = new Set(current);
        if (next.size >= 512) {
          const oldest = next.values().next().value;
          if (typeof oldest === "string") next.delete(oldest);
        }
        next.add(faviconUrl);
        return next;
      });
    },
    [],
  );

  const moveVisitFocus = useCallback((
    requestedIndex: number,
  ): void => {
    if (visitCount === 0) return;
    const index = Math.max(
      0,
      Math.min(visitCount - 1, requestedIndex),
    );
    const results = resultsRef.current;
    if (results !== null) {
      const visibleHeight =
        results.clientHeight || viewportHeight;
      const resultsRect = results.getBoundingClientRect();
      const viewportTop = resultsRect.top + results.clientTop;
      const renderedRow = results
        .querySelector<HTMLButtonElement>(
          `[data-history-index="${String(index)}"]`,
        )
        ?.closest("li");
      const renderedRowRect = renderedRow?.getBoundingClientRect();
      const hasRenderedGeometry =
        renderedRowRect !== undefined &&
        renderedRowRect.bottom > renderedRowRect.top;
      const visitsList = results.querySelector<HTMLOListElement>(
        ".minke-browser-history__visits",
      );
      const listRect = visitsList?.getBoundingClientRect();
      const listTop =
        listRect === undefined
          ? 0
          : (
            listRect.top -
            viewportTop +
            results.scrollTop +
            (visitsList?.clientTop ?? 0)
          );
      const rowTop = hasRenderedGeometry
        ? (
          renderedRowRect.top -
          viewportTop +
          results.scrollTop
        )
        : listTop + index * rowHeight;
      const rowBottom = hasRenderedGeometry
        ? (
          renderedRowRect.bottom -
          viewportTop +
          results.scrollTop
        )
        : rowTop + rowHeight;
      let nextScrollTop = results.scrollTop;
      if (rowTop < results.scrollTop) {
        nextScrollTop = Math.max(0, rowTop);
      } else if (
        rowBottom > results.scrollTop + visibleHeight
      ) {
        nextScrollTop = rowBottom - visibleHeight;
      }
      if (nextScrollTop !== results.scrollTop) {
        results.scrollTop = nextScrollTop;
        pendingScrollTopRef.current = nextScrollTop;
        setScrollTop(nextScrollTop);
      }
    }
    setKeyboardIndex(index);
    window.requestAnimationFrame(() => {
      resultsRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-history-index="${String(index)}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  }, [rowHeight, viewportHeight, visitCount]);

  const handleVisitKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = index + 1;
        break;
      case "ArrowUp":
        nextIndex = index - 1;
        break;
      case "PageDown":
        nextIndex =
          index + Math.max(1, Math.floor(viewportHeight / rowHeight));
        break;
      case "PageUp":
        nextIndex =
          index - Math.max(1, Math.floor(viewportHeight / rowHeight));
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = visitCount - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    moveVisitFocus(nextIndex);
    if (
      nextIndex >= visitCount - 1 &&
      nextCursor !== undefined
    ) {
      void loadMore();
    }
  };

  useLayoutEffect(() => {
    if (focusAfterDeleteIndex === undefined || !active) return;
    setFocusAfterDeleteIndex(undefined);
    if (visitCount === 0) {
      setFocusedVisitIndex(undefined);
      setKeyboardIndex(0);
      searchRef.current?.focus({ preventScroll: true });
      if (nextCursor !== undefined) void loadMore();
      return;
    }
    const nextIndex = Math.min(
      focusAfterDeleteIndex,
      visitCount - 1,
    );
    moveVisitFocus(nextIndex);
    resultsRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-history-index="${String(nextIndex)}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [
    active,
    focusAfterDeleteIndex,
    loadMore,
    moveVisitFocus,
    nextCursor,
    visitCount,
  ]);

  const filtered = actor !== "all" || debouncedQuery !== "";
  const loadingInitial =
    status === "loading" && snapshot === undefined;
  const tabStopIndex =
    (
      keyboardIndex >= virtualRange.start &&
      keyboardIndex < virtualRange.end
    ) ||
    focusedVisitIndex === keyboardIndex
      ? keyboardIndex
      : virtualRange.start;
  const resultCountKey = nextCursor === undefined
    ? "browserHistory.results.loaded"
    : "browserHistory.results.loadedMore";

  return (
    <section
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view minke-browser-history"
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      hidden={!active}
    >
      <div className="minke-browser-history__page">
        <div className="minke-browser-history__controls">
          <label className="minke-browser-history__search-control">
            <span className="minke-browser-history__search-icon">
              <LucideIcon icon={Search} size={14} />
            </span>
            <input
              ref={searchRef}
              className="minke-browser-history__search"
              type="search"
              value={query}
              disabled={
                clearing || deletingVisitId !== undefined
              }
              aria-label={t("browserHistory.search.label")}
              placeholder={t("browserHistory.search.placeholder")}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
            {query !== "" && (
              <button
                type="button"
                className="minke-browser-history__search-clear"
                disabled={
                  clearing || deletingVisitId !== undefined
                }
                aria-label={t("browserHistory.search.clear")}
                title={t("browserHistory.search.clear")}
                onClick={() => {
                  setQuery("");
                  setDebouncedQuery("");
                  searchRef.current?.focus({
                    preventScroll: true,
                  });
                }}
              >
                <LucideIcon icon={X} size={13} />
              </button>
            )}
          </label>
          <button
            ref={clearButtonRef}
            type="button"
            className="minke-browser-history__clear"
            aria-label={t("browserHistory.clear.label")}
            title={t("browserHistory.clear.label")}
            disabled={
              confirmingClear ||
              clearing ||
              deletingVisitId !== undefined ||
              snapshot === undefined ||
              snapshot.totalVisits === 0
            }
            onClick={() => {
              setClearError(false);
              setConfirmingClear(true);
            }}
          >
            <LucideIcon icon={Trash2} size={13} />
          </button>
          <div className="minke-browser-history__filter-bar">
            <div
              className="minke-browser-history__filters"
              role="group"
              aria-label={t("browserHistory.filter.label")}
            >
              {actorFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  data-actor={filter.value}
                  aria-pressed={actor === filter.value}
                  aria-label={t(filter.label)}
                  title={t(filter.label)}
                  disabled={
                    clearing || deletingVisitId !== undefined
                  }
                  onClick={() => {
                    setDebouncedQuery(query.trim());
                    setActor(filter.value);
                  }}
                >
                  <LucideIcon icon={filter.icon} size={13} />
                </button>
              ))}
            </div>
            <div
              className="minke-browser-history__result-count"
              aria-live="polite"
            >
              {status !== "error" && visitCount > 0
                ? t(resultCountKey, { count: visitCount })
                : null}
            </div>
          </div>
        </div>
        {confirmingClear && (
          <div
            className="minke-browser-history__clear-confirm"
            role="alert"
            aria-labelledby={clearConfirmMessageId}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || clearing) return;
              event.preventDefault();
              event.stopPropagation();
              closeClearConfirmation();
            }}
          >
            <span
              className={
                "minke-browser-history__clear-confirm-icon"
              }
            >
              <LucideIcon icon={TriangleAlert} size={15} />
            </span>
            <span
              id={clearConfirmMessageId}
              className={
                "minke-browser-history__clear-confirm-copy"
              }
            >
              <span>{t("browserHistory.clear.confirm")}</span>
              {clearError && (
                <span
                  className="minke-browser-history__clear-error"
                  role="alert"
                >
                  {t("browserHistory.clear.error")}
                </span>
              )}
            </span>
            <div className="minke-browser-history__clear-actions">
              <button
                ref={clearCancelRef}
                type="button"
                disabled={clearing}
                onClick={closeClearConfirmation}
              >
                {t("browserHistory.clear.cancel")}
              </button>
              <button
                type="button"
                data-variant="danger"
                disabled={clearing}
                onClick={() => void clearHistory()}
              >
                {t(
                  clearing
                    ? "browserHistory.clear.clearing"
                    : "browserHistory.clear.confirmAction",
                )}
              </button>
            </div>
          </div>
        )}
        <div
          ref={resultsRef}
          className="minke-browser-history__results"
          aria-busy={
            loadingInitial || appendStatus === "loading"
          }
          onScroll={handleScroll}
        >
          {loadingInitial && (
            <div
              className={
                "minke-browser-history__status "
                + "minke-browser-history__status--loading"
              }
              role="status"
            >
              <span
                className={
                  "minke-browser-history__visually-hidden"
                }
              >
                {t("browserHistory.loading")}
              </span>
              <div
                className="minke-browser-history__skeleton"
                aria-hidden="true"
              >
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={
                      "minke-browser-history__skeleton-row"
                    }
                  >
                    <span />
                    <span />
                  </span>
                ))}
              </div>
            </div>
          )}
          {status === "error" && (
            <div
              className="minke-browser-history__status"
              data-state="error"
              role="alert"
            >
              <span className="minke-browser-history__status-icon">
                <LucideIcon icon={CircleAlert} size={18} />
              </span>
              <strong>{t("browserHistory.error")}</strong>
              <span>{t("browserHistory.error.detail")}</span>
              <button
                type="button"
                onClick={() =>
                  void resetAndLoad(actor, debouncedQuery)}
              >
                {t("browserHistory.retry")}
              </button>
            </div>
          )}
          {status === "ready" &&
            visitCount === 0 &&
            !filtered && (
              <div
                className="minke-browser-history__status"
                data-state="empty"
                role="status"
              >
                <span
                  className="minke-browser-history__status-icon"
                >
                  <LucideIcon icon={History} size={19} />
                </span>
                <strong>{t("browserHistory.empty")}</strong>
                <span>{t("browserHistory.empty.detail")}</span>
              </div>
            )}
          {status === "ready" &&
            visitCount === 0 &&
            filtered && (
              <div
                className="minke-browser-history__status"
                data-state="no-match"
                role="status"
              >
                <span
                  className="minke-browser-history__status-icon"
                >
                  <LucideIcon icon={SearchX} size={19} />
                </span>
                <strong>{t("browserHistory.noMatch")}</strong>
                <span>{t("browserHistory.noMatch.detail")}</span>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setDebouncedQuery("");
                    setActor("all");
                    searchRef.current?.focus({
                      preventScroll: true,
                    });
                  }}
                >
                  {t("browserHistory.noMatch.reset")}
                </button>
              </div>
            )}
          {visitCount > 0 && (
            <>
              <ol
                className="minke-browser-history__visits"
                aria-label={t("browserHistory.list.label")}
                style={{
                  height: visitCount * rowHeight,
                }}
              >
                {virtualVisits.map(({ index, visit }) => {
                  const primary = webHistoryPrimaryLabel(visit);
                  const address =
                    webHistoryDisplayAddress(visit.url);
                  const visitedAt =
                    formatLocalDateTime(visit.visitedAt);
                  const deleting =
                    deletingVisitId === visit.visitId;
                  const deleteFailed =
                    deleteErrorVisitId === visit.visitId;
                  const deleteLabel = t(
                    deleteFailed
                      ? "browserHistory.delete.error"
                      : deleting
                        ? "browserHistory.delete.deleting"
                        : "browserHistory.delete.label",
                    { title: primary },
                  );
                  return (
                    <li
                      key={visit.visitId}
                      data-delete-state={
                        deleteFailed
                          ? "error"
                          : deleting
                            ? "loading"
                            : undefined
                      }
                      aria-busy={deleting || undefined}
                      aria-posinset={index + 1}
                      aria-setsize={
                        nextCursor === undefined
                          ? visitCount
                          : -1
                      }
                      style={{
                        height: rowHeight,
                        transform: `translateY(${
                          String(index * rowHeight)
                        }px)`,
                      }}
                      onFocusCapture={() => {
                        setKeyboardIndex(index);
                        setFocusedVisitIndex(index);
                      }}
                      onBlurCapture={(event) => {
                        if (
                          event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) return;
                        setFocusedVisitIndex((current) =>
                          current === index ? undefined : current);
                      }}
                    >
                      <button
                        type="button"
                        className="minke-browser-history__visit"
                        data-history-index={index}
                        tabIndex={index === tabStopIndex ? 0 : -1}
                        title={visit.url}
                        disabled={clearing || deleting}
                        onKeyDown={(event) =>
                          handleVisitKeyDown(event, index)}
                        onClick={() => {
                          controller.openVisit(visit.url, primary);
                        }}
                      >
                        <span
                          className={
                            "minke-browser-history__visit-kind"
                          }
                        >
                          <HistoryFavicon
                            failed={
                              visit.faviconUrl !== undefined &&
                              failedFaviconUrls.has(visit.faviconUrl)
                            }
                            faviconUrl={visit.faviconUrl}
                            onFailure={markFaviconFailed}
                          />
                        </span>
                        <span
                          className={
                            "minke-browser-history__visit-body"
                          }
                        >
                          <strong
                            className={
                              "minke-browser-history__visit-primary"
                            }
                          >
                            {primary}
                          </strong>
                          <span
                            className={
                              "minke-browser-history__visit-details"
                            }
                          >
                            <span
                              className={
                                "minke-browser-history__actor"
                              }
                              data-actor={visit.actor}
                              aria-label={t(
                                visit.actor === "agent"
                                  ? "browserHistory.actor.agent"
                                  : "browserHistory.actor.human",
                              )}
                              title={t(
                                visit.actor === "agent"
                                  ? "browserHistory.actor.agent"
                                  : "browserHistory.actor.human",
                              )}
                            >
                              <LucideIcon
                                icon={
                                  visit.actor === "agent"
                                    ? Bot
                                    : User
                                }
                                size={12}
                              />
                            </span>
                            <span
                              className={
                                "minke-browser-history__visit-url"
                              }
                              dir="ltr"
                            >
                              {address}
                            </span>
                            <span
                              className={
                                "minke-browser-history__separator "
                                + "minke-browser-history__separator--time"
                              }
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <time
                              dateTime={
                                new Date(
                                  visit.visitedAt,
                                ).toISOString()
                              }
                            >
                              {visitedAt}
                            </time>
                            <span
                              className={
                                "minke-browser-history__separator"
                                + " minke-browser-history__separator--count"
                              }
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span
                              className={
                                "minke-browser-history__visit-count"
                              }
                            >
                              {visitCountLabel(
                                visit.pathVisitCount,
                                t,
                              )}
                            </span>
                          </span>
                        </span>
                        <span
                          className={
                            "minke-browser-history__visit-open"
                          }
                        >
                          <LucideIcon
                            icon={ChevronRight}
                            size={14}
                          />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={
                          "minke-browser-history__visit-delete"
                        }
                        data-state={
                          deleteFailed
                            ? "error"
                            : deleting
                              ? "loading"
                              : undefined
                        }
                        tabIndex={index === tabStopIndex ? 0 : -1}
                        aria-label={deleteLabel}
                        title={deleteLabel}
                        disabled={
                          clearing ||
                          confirmingClear ||
                          (
                            deletingVisitId !== undefined &&
                            !deleting
                          ) ||
                          deleting
                        }
                        onKeyDown={(event) =>
                          handleVisitKeyDown(event, index)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteVisit(visit, index);
                        }}
                      >
                        <LucideIcon
                          icon={deleting ? LoaderCircle : Trash2}
                          size={13}
                        />
                      </button>
                      {deleteFailed && (
                        <span
                          className={
                            "minke-browser-history__visually-hidden"
                          }
                          role="alert"
                        >
                          {deleteLabel}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div
                className="minke-browser-history__load-more"
                data-state={appendStatus}
                role={
                  appendStatus === "error"
                    ? "alert"
                    : appendStatus === "loading"
                      ? "status"
                      : undefined
                }
                aria-hidden={
                  appendStatus === "idle" &&
                  nextCursor === undefined
                    ? true
                    : undefined
                }
              >
                {appendStatus === "loading"
                  ? t("browserHistory.loadMore.loading")
                  : appendStatus === "error"
                    ? (
                      <>
                        <span>
                          {t("browserHistory.loadMore.error")}
                        </span>
                        <button
                          type="button"
                          onClick={() => void loadMore()}
                        >
                          {t("browserHistory.loadMore.retry")}
                        </button>
                      </>
                    )
                    : nextCursor === undefined
                      ? null
                      : (
                        <button
                          type="button"
                          onClick={() => void loadMore()}
                        >
                          {t("browserHistory.loadMore.action")}
                        </button>
                      )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
