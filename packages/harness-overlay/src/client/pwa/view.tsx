import {
  Download,
  Share,
  X,
} from "@lucide/icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  LucideIcon,
} from "../tabs/components/LucideIcon.ts";
import type {
  PwaTranslate,
} from "./locales.ts";
import type {
  PwaInstallRuntime,
} from "./runtime.ts";

export interface PwaInstallActionProps {
  readonly runtime: PwaInstallRuntime;
  readonly t: PwaTranslate;
  readonly wide: boolean;
}

/** Optional install action; it never interrupts the active workspace. */
export function PwaInstallAction({
  runtime,
  t,
  wide,
}: PwaInstallActionProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [guideOpen, setGuideOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = snapshot.mode === "installing";
  const hidden =
    snapshot.mode === "hidden" ||
    snapshot.mode === "installed";

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    runtime.clearError();
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, [runtime]);

  useEffect(() => {
    if (!guideOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeGuide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeGuide, guideOpen]);

  useEffect(() => {
    if (hidden) setGuideOpen(false);
  }, [hidden]);

  const install = async (): Promise<void> => {
    if (
      snapshot.mode === "manual" ||
      snapshot.mode === "error"
    ) {
      setGuideOpen(true);
      return;
    }
    const result = await runtime.install();
    if (result === "manual" || result === "error") {
      setGuideOpen(true);
    }
  };

  if (hidden) return null;

  const guide =
    snapshot.mode === "error"
      ? t("errorGuide")
      : snapshot.mode === "manual" &&
          snapshot.guide === "ios"
        ? t("iosGuide")
        : t("browserGuide");

  return (
    <div
      className="minke-pwa-install"
      data-minke-pwa-install
      data-wide={wide ? "true" : "false"}
    >
      <button
        ref={triggerRef}
        type="button"
        className="minke-pwa-install__trigger"
        aria-label={busy ? t("installing") : t("trigger")}
        aria-expanded={guideOpen}
        aria-haspopup="dialog"
        aria-busy={busy}
        title={busy ? t("installing") : t("trigger")}
        disabled={busy}
        onClick={() => {
          void install();
        }}
      >
        <LucideIcon icon={Download} size={wide ? 17 : 18} />
      </button>
      {guideOpen && (
        <section
          className="minke-pwa-install__guide"
          role="dialog"
          aria-label={t("guideTitle")}
        >
          <button
            ref={closeRef}
            type="button"
            className="minke-pwa-install__close"
            aria-label={t("close")}
            title={t("close")}
            onClick={closeGuide}
          >
            <LucideIcon icon={X} size={15} />
          </button>
          <span
            className="minke-pwa-install__guide-icon"
            aria-hidden="true"
          >
            <LucideIcon icon={Share} size={17} />
          </span>
          <h2>{t("guideTitle")}</h2>
          <p>{guide}</p>
        </section>
      )}
    </div>
  );
}
