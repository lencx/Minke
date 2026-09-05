import {
  Info,
  X,
} from "@lucide/icons";
import type {
  AppUpdateCheckResult,
} from "@minke/harness-overlay/app-update-contract.ts";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  createPortal,
} from "react-dom";
import type {
  DesktopAboutInfo,
} from "../desktop/index.ts";
import {
  LucideIcon,
} from "../tabs/components/LucideIcon.ts";
import type {
  AboutTranslate,
} from "./locales.ts";
import {
  aboutMetadata,
  aboutTagline,
  DEEPSEEK_HARNESS_URL,
  MINKE_PROJECT_URL,
} from "./model.ts";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  '[href]:not([aria-disabled="true"])',
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const UPDATE_STATUS_KEYS = [
  "updateStatusUpToDate",
  "updateStatusAvailable",
  "updateStatusBusy",
  "updateStatusUnavailable",
  "updateStatusFailed",
] as const;

export interface AboutPanelProps {
  checkForUpdates?: () => Promise<AppUpdateCheckResult>;
  iconUrl: string;
  info: DesktopAboutInfo;
  onClose: () => void;
  openExternal: (url: string) => void;
  t: AboutTranslate;
}

export interface AboutDialogProps
  extends Omit<AboutPanelProps, "onClose"> {
  wide: boolean;
}

function GitHubMark(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="minke-about__github-mark"
      viewBox="0 0 24 24"
      width="15"
      height="15"
    >
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.3c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"
      />
    </svg>
  );
}

/** Render the focused About surface independently for testing and review. */
export function AboutPanel({
  checkForUpdates,
  iconUrl,
  info,
  onClose,
  openExternal,
  t,
}: AboutPanelProps): ReactNode {
  const taglineId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [taglineBefore, taglineAfter] = aboutTagline(t);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    AppUpdateCheckResult | "failed" | undefined
  >();

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      ) ?? []),
    ];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  const handleExternalLink = (
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): void => {
    event.preventDefault();
    openExternal(event.currentTarget.href);
  };
  const handleUpdateCheck = useCallback(async () => {
    if (checkForUpdates === undefined || checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateStatus(undefined);
    try {
      setUpdateStatus(await checkForUpdates());
    } catch {
      setUpdateStatus("failed");
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkForUpdates, checkingUpdate]);
  const updateStatusKey =
    updateStatus === undefined
      ? undefined
      : ({
          "up-to-date": "updateStatusUpToDate",
          "update-available": "updateStatusAvailable",
          busy: "updateStatusBusy",
          unavailable: "updateStatusUnavailable",
          failed: "updateStatusFailed",
        } as const)[updateStatus];
  const updateCheckLabelKey = checkingUpdate
    ? "checkingUpdate"
    : "checkUpdate";

  return (
    <div
      className="minke-about__overlay"
      data-minke-about-overlay
      role="presentation"
    >
      <div
        className="minke-about__mask"
        aria-hidden="true"
        onClick={onClose}
      />
      <section
        ref={panelRef}
        className="minke-about__panel"
        data-minke-about-dialog
        role="dialog"
        aria-modal="true"
        aria-label={info.productName}
        aria-describedby={taglineId}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeRef}
          type="button"
          className="minke-about__close"
          aria-label={t("close")}
          title={t("close")}
          onClick={onClose}
        >
          <LucideIcon icon={X} size={16} />
        </button>

        <header className="minke-about__identity">
          <img
            className="minke-about__icon"
            src={iconUrl}
            alt={t("iconAlt")}
            width="76"
            height="76"
          />
          <p id={taglineId} className="minke-about__tagline">
            {taglineBefore}
            <a
              className="minke-about__inline-link"
              href={DEEPSEEK_HARNESS_URL}
              onClick={handleExternalLink}
            >
              {t("harness")}
            </a>
            {taglineAfter}
          </p>
          <p className="minke-about__metadata">
            {aboutMetadata(info, t)}
          </p>
        </header>

        <div className="minke-about__copy">
          <footer className="minke-about__actions">
            {checkForUpdates !== undefined && (
              <button
                type="button"
                className="minke-about__action"
                data-minke-about-update-check
                disabled={checkingUpdate}
                aria-label={t(updateCheckLabelKey)}
                title={t(updateCheckLabelKey)}
                onClick={() => {
                  void handleUpdateCheck();
                }}
              >
                <span
                  className="minke-about__update-check-label"
                  aria-hidden="true"
                >
                  <span data-active={!checkingUpdate}>
                    {t("checkUpdate")}
                  </span>
                  <span data-active={checkingUpdate}>
                    {t("checkingUpdate")}
                  </span>
                </span>
              </button>
            )}
            <a
              className="minke-about__action minke-about__action--primary"
              href={MINKE_PROJECT_URL}
              onClick={handleExternalLink}
            >
              <GitHubMark />
              <span>{t("project")}</span>
            </a>
          </footer>
          {checkForUpdates !== undefined && (
            <p
              className="minke-about__update-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="minke-about__update-status-label">
                {UPDATE_STATUS_KEYS.map((key) => (
                  <span
                    key={key}
                    data-active={updateStatusKey === key}
                  >
                    {t(key)}
                  </span>
                ))}
              </span>
            </p>
          )}
          <p className="minke-about__community">{t("community")}</p>
        </div>
      </section>
    </div>
  );
}

/** Sidebar info action and its modal About surface. */
export function AboutDialog({
  wide,
  checkForUpdates,
  iconUrl,
  info,
  openExternal,
  t,
}: AboutDialogProps): ReactNode {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  return (
    <div
      className="minke-about"
      data-minke-about
      data-wide={wide ? "true" : "false"}
    >
      <button
        ref={triggerRef}
        type="button"
        className="minke-about__trigger"
        data-minke-about-trigger
        aria-label={t("trigger")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("trigger")}
        onClick={() => setOpen(true)}
      >
        <LucideIcon icon={Info} size={wide ? 17 : 18} />
      </button>
      {open &&
        createPortal(
          <AboutPanel
            checkForUpdates={checkForUpdates}
            iconUrl={iconUrl}
            info={info}
            onClose={close}
            openExternal={openExternal}
            t={t}
          />,
          document.body,
        )}
    </div>
  );
}
