import {
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  createPortal,
} from "react-dom";
import type {
  AgentBrowserHistoryVisit,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  WebTabsController,
} from "./controller.ts";
import {
  WebIcon,
} from "./icons.tsx";
import {
  recentWebHistorySuggestions,
  webHistoryDisplayAddress,
} from "./history-suggestions.ts";
import type {
  WebTabsTranslate,
} from "./locales.ts";
import type {
  WebTabPayload,
} from "./types.ts";

export interface WebAddressBarProps {
  tab: ManagedTab<WebTabPayload>;
  controller: WebTabsController;
  t: WebTabsTranslate;
}

interface HistoryPopupGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

type HistoryStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

const historyDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Editable URL surface for the active Web tab toolbar. */
export function WebAddressBar({
  tab,
  controller,
  t,
}: WebAddressBarProps): ReactNode {
  const [draft, setDraft] = useState(tab.payload.url ?? "");
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyStatus, setHistoryStatus] =
    useState<HistoryStatus>("idle");
  const [historyVisits, setHistoryVisits] = useState<
    readonly AgentBrowserHistoryVisit[]
  >([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popupGeometry, setPopupGeometry] =
    useState<HistoryPopupGeometry>();
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyListId = useId();

  useEffect(() => {
    setDraft(tab.payload.url ?? "");
    setInvalid(false);
    setEdited(false);
    setActiveIndex(-1);
    if (tab.payload.url === undefined) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [tab.id, tab.payload.url]);

  useEffect(() => {
    if (!focused) return;
    let current = true;
    setHistoryStatus("loading");
    void controller.readRecentHistory().then(
      (visits) => {
        if (!current) return;
        setHistoryVisits(visits);
        setHistoryStatus("ready");
        setActiveIndex(-1);
      },
      () => {
        if (!current) return;
        setHistoryVisits([]);
        setHistoryStatus("unavailable");
        setActiveIndex(-1);
      },
    );
    return () => {
      current = false;
    };
  }, [controller, focused, tab.id]);

  useLayoutEffect(() => {
    if (!focused || !historyOpen) {
      setPopupGeometry(undefined);
      return;
    }
    const update = (): void => {
      const form = formRef.current;
      if (form === null) return;
      const rect = form.getBoundingClientRect();
      setPopupGeometry({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
        maxHeight: Math.max(
          96,
          window.innerHeight - rect.bottom - 12,
        ),
      });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (formRef.current !== null) {
      observer?.observe(formRef.current);
    }
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [focused, historyOpen]);

  const historySuggestions = useMemo(
    () =>
      recentWebHistorySuggestions(
        historyVisits,
        edited ? draft : "",
      ),
    [draft, edited, historyVisits],
  );
  const popupVisible =
    focused &&
    historyOpen &&
    historyStatus !== "unavailable" &&
    popupGeometry !== undefined;

  const navigateTo = (candidate: string): boolean => {
    const accepted = controller.navigate(tab.id, candidate);
    setInvalid(!accepted);
    if (accepted) {
      setDraft(candidate);
      setHistoryOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
    return accepted;
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    navigateTo(draft);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHistoryOpen(true);
      setActiveIndex((current) =>
        historySuggestions.length === 0
          ? -1
          : (current + 1) % historySuggestions.length
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHistoryOpen(true);
      setActiveIndex((current) =>
        historySuggestions.length === 0
          ? -1
          : current <= 0
            ? historySuggestions.length - 1
            : current - 1
      );
      return;
    }
    if (
      event.key === "Enter" &&
      historyOpen &&
      activeIndex >= 0
    ) {
      const selected = historySuggestions[activeIndex];
      if (selected !== undefined) {
        event.preventDefault();
        navigateTo(selected.url);
      }
      return;
    }
    if (event.key === "Escape" && historyOpen) {
      event.preventDefault();
      setHistoryOpen(false);
      setActiveIndex(-1);
    }
  };

  const historyPopup = popupVisible
    ? (
      <div
        id={historyListId}
        className="minke-tabs-location-history"
        role="listbox"
        aria-label={t("web.history.recent")}
        style={{
          left: popupGeometry.left,
          top: popupGeometry.top,
          width: popupGeometry.width,
          maxHeight: popupGeometry.maxHeight,
        }}
      >
        <div className="minke-tabs-location-history__heading">
          {t("web.history.recent")}
        </div>
        {historyStatus === "loading"
          ? (
            <div
              className="minke-tabs-location-history__status"
              role="status"
            >
              {t("web.history.loading")}
            </div>
          )
          : historySuggestions.length === 0
            ? (
              <div
                className="minke-tabs-location-history__status"
                role="status"
              >
                {edited && draft.trim() !== ""
                  ? t("web.history.noMatch")
                  : t("web.history.empty")}
              </div>
            )
            : historySuggestions.map((visit, index) => (
              <button
                key={visit.pathKey}
                id={`${historyListId}-option-${String(index)}`}
                type="button"
                className="minke-tabs-location-history__option"
                role="option"
                aria-selected={index === activeIndex}
                title={visit.url}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => navigateTo(visit.url)}
              >
                <span className="minke-tabs-location-history__address">
                  {webHistoryDisplayAddress(visit.url)}
                </span>
                <span className="minke-tabs-location-history__metadata">
                  <span>
                    {t(
                      visit.actor === "agent"
                        ? "web.history.actor.agent"
                        : "web.history.actor.human",
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={new Date(visit.visitedAt).toISOString()}>
                    {historyDateTime.format(visit.visitedAt)}
                  </time>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t("web.history.visits", {
                      count: visit.pathVisitCount,
                    })}
                  </span>
                </span>
              </button>
            ))}
      </div>
    )
    : null;

  return (
    <>
      <form
        ref={formRef}
        className="minke-tabs-location"
        onSubmit={submit}
        data-invalid={invalid || undefined}
      >
        <span className="minke-tabs-location__icon">
          <WebIcon size={15} />
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="go"
          value={draft}
          aria-label={t("web.address.label")}
          aria-invalid={invalid || undefined}
          aria-autocomplete="list"
          aria-controls={popupVisible ? historyListId : undefined}
          aria-expanded={popupVisible}
          aria-activedescendant={
            popupVisible && activeIndex >= 0
              ? `${historyListId}-option-${String(activeIndex)}`
              : undefined
          }
          role="combobox"
          title={tab.payload.url ?? t("web.address.placeholder")}
          placeholder={t("web.address.placeholder")}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setEdited(true);
            setHistoryOpen(true);
            setActiveIndex(-1);
            if (invalid) setInvalid(false);
          }}
          onFocus={(event) => {
            setFocused(true);
            setEdited(false);
            setHistoryOpen(true);
            setActiveIndex(-1);
            event.currentTarget.select();
          }}
          onBlur={() => {
            setFocused(false);
            setHistoryOpen(false);
            setActiveIndex(-1);
            setDraft(tab.payload.url ?? "");
            setInvalid(false);
          }}
          onKeyDown={handleKeyDown}
        />
      </form>
      {historyPopup !== null && typeof document !== "undefined"
        ? createPortal(historyPopup, document.body)
        : null}
    </>
  );
}
