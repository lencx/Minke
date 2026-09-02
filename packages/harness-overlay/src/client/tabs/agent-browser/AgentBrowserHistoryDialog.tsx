import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  History,
  Trash2,
  X,
} from "@lucide/icons";
import type {
  AgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import type {
  AgentBrowserOwner,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import {
  ToolbarButton,
} from "@minke/harness-overlay/client/tabs/components/ToolbarButton.tsx";
import type {
  AgentBrowserTabsController,
} from "./controller.ts";
import type {
  AgentBrowserTabsTranslate,
} from "./locales.ts";

type HistoryActorFilter = "all" | AgentBrowserOwner;

const HISTORY_PAGE_SIZE = 100;
const HISTORY_FILTERS = [
  {
    value: "all",
    label: "agentBrowser.history.filter.all",
  },
  {
    value: "human",
    label: "agentBrowser.history.filter.human",
  },
  {
    value: "agent",
    label: "agentBrowser.history.filter.agent",
  },
] as const;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatNumber(
  template: string,
  key: string,
  value: number,
): string {
  return template.replace(`{${key}}`, String(value));
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  close: () => void,
  panel: HTMLDivElement | null,
): void {
  if (event.nativeEvent.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== "Tab" || panel === null) return;
  const focusable = [...panel.querySelectorAll<HTMLElement>(
    "button:not(:disabled), [href], input:not(:disabled), "
      + "select:not(:disabled), textarea:not(:disabled), "
      + "[tabindex]:not([tabindex='-1'])",
  )].filter((candidate) => candidate.offsetParent !== null);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    document.activeElement === last
  ) {
    event.preventDefault();
    first.focus();
  }
}

export function AgentBrowserHistoryDialog({
  controller,
  t,
}: {
  readonly controller: AgentBrowserTabsController;
  readonly t: AgentBrowserTabsTranslate;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [actor, setActor] = useState<HistoryActorFilter>("all");
  const [snapshot, setSnapshot] =
    useState<AgentBrowserHistorySnapshot>();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    requestId.current += 1;
    setOpen(false);
    setConfirmingClear(false);
    const target = returnFocusRef.current;
    if (target?.isConnected) target.focus();
    returnFocusRef.current = null;
  }, []);

  const load = useCallback(async (
    filter: HistoryActorFilter,
  ): Promise<void> => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setError(undefined);
    try {
      const next = await controller.readHistory({
        limit: HISTORY_PAGE_SIZE,
        ...(filter === "all" ? {} : { actor: filter }),
      });
      if (requestId.current === currentRequest) {
        setSnapshot(next);
      }
    } catch (loadError) {
      if (requestId.current === currentRequest) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : String(loadError),
        );
      }
    } finally {
      if (requestId.current === currentRequest) {
        setLoading(false);
      }
    }
  }, [controller]);

  useEffect(() => {
    if (!open) return;
    void load(actor);
    return () => {
      requestId.current += 1;
    };
  }, [actor, load, open]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const openDialog = (): void => {
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement ? active : null;
    setOpen(true);
  };

  const clearHistory = async (): Promise<void> => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setClearing(true);
    setError(undefined);
    try {
      const next = await controller.clearHistory();
      if (requestId.current === currentRequest) {
        setSnapshot(next);
        setConfirmingClear(false);
      }
    } catch (clearError) {
      if (requestId.current === currentRequest) {
        setError(
          clearError instanceof Error
            ? clearError.message
            : String(clearError),
        );
      }
    } finally {
      if (requestId.current === currentRequest) {
        setClearing(false);
      }
    }
  };

  return (
    <>
      <ToolbarButton
        label={t("agentBrowser.history.action.open")}
        pressed={open}
        onClick={openDialog}
      >
        <LucideIcon icon={History} size={14} />
      </ToolbarButton>
      {open && (
        <div
          className="minke-agent-browser-history__backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={panelRef}
            className="minke-agent-browser-history"
            role="dialog"
            aria-modal="true"
            aria-label={t("agentBrowser.history.title")}
            onKeyDown={(event) =>
              handleDialogKeyDown(
                event,
                close,
                panelRef.current,
              )}
          >
            <header className="minke-agent-browser-history__header">
              <div>
                <h2 className="minke-agent-browser-history__title">
                  {t("agentBrowser.history.title")}
                </h2>
                <p className="minke-agent-browser-history__privacy">
                  {t("agentBrowser.history.privacy")}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="minke-agent-browser-history__icon-button"
                aria-label={t("agentBrowser.history.action.close")}
                title={t("agentBrowser.history.action.close")}
                onClick={close}
              >
                <LucideIcon icon={X} size={15} />
              </button>
            </header>

            {snapshot !== undefined && (
              <section
                className="minke-agent-browser-history__summary"
                aria-label={t("agentBrowser.history.summary.label")}
              >
                <span>
                  {formatNumber(
                    t("agentBrowser.history.summary.total"),
                    "count",
                    snapshot.totalVisits,
                  )}
                </span>
                <span>
                  {formatNumber(
                    t("agentBrowser.history.summary.paths"),
                    "count",
                    snapshot.uniquePaths,
                  )}
                </span>
                <span>
                  {t("agentBrowser.history.summary.actors")
                    .replace(
                      "{agent}",
                      String(snapshot.agentVisits),
                    )
                    .replace(
                      "{human}",
                      String(snapshot.humanVisits),
                    )}
                </span>
              </section>
            )}

            <div className="minke-agent-browser-history__filters">
              <div
                className={
                  "minke-agent-browser-history__filter-actions"
                }
              >
                {HISTORY_FILTERS.map(
                  (filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      className={
                        "minke-agent-browser-history__filter"
                      }
                      data-active={
                        actor === filter.value || undefined
                      }
                      aria-pressed={actor === filter.value}
                      onClick={() => setActor(filter.value)}
                    >
                      {t(filter.label)}
                    </button>
                  ),
                )}
              </div>
              {snapshot !== undefined && (
                <span
                  className={
                    "minke-agent-browser-history__timeline-count"
                  }
                >
                  {t("agentBrowser.history.timeline")
                    .replace(
                      "{shown}",
                      String(snapshot.visits.length),
                    )
                    .replace(
                      "{retained}",
                      String(snapshot.retainedVisits),
                    )}
                </span>
              )}
            </div>

            <div
              className="minke-agent-browser-history__content"
              aria-busy={loading || clearing || undefined}
            >
              {error !== undefined && (
                <div
                  className="minke-agent-browser-history__error"
                  role="alert"
                >
                  {t("agentBrowser.history.error")}: {error}
                </div>
              )}
              {loading && snapshot === undefined && (
                <div
                  className="minke-agent-browser-history__empty"
                  role="status"
                >
                  {t("agentBrowser.history.loading")}
                </div>
              )}
              {!loading &&
                snapshot !== undefined &&
                snapshot.visits.length === 0 && (
                  <div
                    className="minke-agent-browser-history__empty"
                    role="status"
                  >
                    {t("agentBrowser.history.empty")}
                  </div>
                )}
              {snapshot !== undefined &&
                snapshot.visits.length > 0 && (
                  <ol className="minke-agent-browser-history__visits">
                    {snapshot.visits.map((visit) => (
                      <li
                        key={visit.visitId}
                        className={
                          "minke-agent-browser-history__visit"
                        }
                      >
                        <div
                          className={
                            "minke-agent-browser-history__visit-main"
                          }
                        >
                          <span
                            className={
                              "minke-agent-browser-history__visit-path"
                            }
                            title={visit.url}
                          >
                            <strong>{new URL(visit.url).host}</strong>
                            <span>{visit.pathname}</span>
                          </span>
                          <span
                            className={
                              "minke-agent-browser-history__actor"
                            }
                            data-actor={visit.actor}
                          >
                            {t(
                              visit.actor === "agent"
                                ? "agentBrowser.history.actor.agent"
                                : "agentBrowser.history.actor.human",
                            )}
                          </span>
                        </div>
                        <div
                          className={
                            "minke-agent-browser-history__visit-meta"
                          }
                        >
                          <time
                            dateTime={
                              new Date(visit.visitedAt).toISOString()
                            }
                          >
                            {dateTimeFormatter.format(
                              new Date(visit.visitedAt),
                            )}
                          </time>
                          <span aria-hidden="true">·</span>
                          <span>
                            {formatNumber(
                              t(
                                "agentBrowser.history.visit.count",
                              ),
                              "count",
                              visit.pathVisitCount,
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
            </div>

            <footer className="minke-agent-browser-history__footer">
              {confirmingClear ? (
                <>
                  <span
                    className={
                      "minke-agent-browser-history__clear-warning"
                    }
                  >
                    {t("agentBrowser.history.clear.confirm")}
                  </span>
                  <button
                    type="button"
                    className="minke-agent-browser-history__button"
                    disabled={clearing}
                    onClick={() => setConfirmingClear(false)}
                  >
                    {t("agentBrowser.history.clear.cancel")}
                  </button>
                  <button
                    type="button"
                    className={
                      "minke-agent-browser-history__button "
                      + "minke-agent-browser-history__button--danger"
                    }
                    disabled={clearing}
                    onClick={() => void clearHistory()}
                  >
                    {clearing
                      ? t("agentBrowser.history.clear.clearing")
                      : t("agentBrowser.history.clear.confirmAction")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={
                    "minke-agent-browser-history__button "
                    + "minke-agent-browser-history__button--danger"
                  }
                  disabled={
                    loading ||
                    clearing ||
                    snapshot === undefined ||
                    snapshot.totalVisits === 0
                  }
                  onClick={() => setConfirmingClear(true)}
                >
                  <LucideIcon icon={Trash2} size={13} />
                  {t("agentBrowser.history.action.clear")}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
