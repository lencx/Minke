import {
  DatabaseBackup,
  Globe,
  Keyboard,
  Palette,
  type LucideIconData,
} from "@lucide/icons";
import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  LucideIcon,
} from "../tabs/components/LucideIcon.ts";
import type {
  MinkeSettingsTranslate,
} from "./locales.ts";
import type {
  MinkeSettingsPage,
  MinkeSettingsPageIcon,
  MinkeSettingsRuntime,
} from "./runtime.ts";

const PAGE_ICONS: Readonly<
  Record<MinkeSettingsPageIcon, LucideIconData>
> = {
  preferences: Palette,
  browser: Globe,
  shortcuts: Keyboard,
  "data-home": DatabaseBackup,
};

type TabNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

/** Resolve horizontal tab keyboard navigation without coupling it to DOM. */
export function nextMinkeSettingsTabIndex(
  current: number,
  length: number,
  key: string,
): number | undefined {
  if (length <= 0) return undefined;
  switch (key as TabNavigationKey) {
    case "ArrowLeft":
      return (current - 1 + length) % length;
    case "ArrowRight":
      return (current + 1) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return undefined;
  }
}

/** Decide whether a page's live content should remain mounted while hidden. */
export function shouldMountMinkeSettingsPage(
  page: MinkeSettingsPage,
  activeId: string | undefined,
  visitedIds: ReadonlySet<string>,
): boolean {
  return page.id === activeId ||
    (
      page.keepAlive !== false &&
      visitedIds.has(page.id)
    );
}

interface MinkeSettingsPageContentProps {
  page: MinkeSettingsPage;
}

function MinkeSettingsPageContent({
  page,
}: MinkeSettingsPageContentProps): ReactNode {
  return page.render();
}

interface MinkeSettingsPageBoundaryProps {
  children: ReactNode;
  label: string;
  t: MinkeSettingsTranslate;
}

interface MinkeSettingsPageBoundaryState {
  failed: boolean;
}

/** Keep one failing contribution from taking down every Minke settings page. */
class MinkeSettingsPageBoundary extends Component<
  MinkeSettingsPageBoundaryProps,
  MinkeSettingsPageBoundaryState
> {
  state: MinkeSettingsPageBoundaryState = {
    failed: false,
  };

  static getDerivedStateFromError(): MinkeSettingsPageBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `Minke Settings page "${this.props.label}" failed`,
      error,
      info.componentStack,
    );
  }

  #retry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="minke-settings__page-error" role="alert">
        <p>{this.props.t("pageError")}</p>
        <button type="button" onClick={this.#retry}>
          {this.props.t("retry")}
        </button>
      </div>
    );
  }
}

export interface MinkeSettingsSectionProps {
  runtime: MinkeSettingsRuntime;
  t: MinkeSettingsTranslate;
}

/**
 * Keep all Minke-owned configuration in one DSH Settings section.
 *
 * The icon tabs are deliberately compact, while their accessible names,
 * native tooltips, stable positions, and page headings retain discoverability.
 */
export function MinkeSettingsSection({
  runtime,
  t,
}: MinkeSettingsSectionProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const idPrefix = useId();
  const rootRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(
    () => new Set(
      snapshot.activeId === undefined ? [] : [snapshot.activeId],
    ),
  );

  useEffect(() => {
    const activeId = snapshot.activeId;
    if (activeId === undefined) return;
    setVisitedIds((previous) => {
      if (previous.has(activeId)) return previous;
      return new Set([...previous, activeId]);
    });
  }, [snapshot.activeId]);

  const selectPage = (id: string, index?: number): void => {
    runtime.select(id);
    rootRef.current?.scrollIntoView({
      block: "start",
      behavior: "instant",
    });
    if (index !== undefined) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    const next = nextMinkeSettingsTabIndex(
      index,
      snapshot.pages.length,
      event.key,
    );
    if (next === undefined) return;
    const page = snapshot.pages[next];
    if (page === undefined) return;
    event.preventDefault();
    selectPage(page.id, next);
  };

  return (
    <section
      ref={rootRef}
      className="minke-settings"
      data-minke-settings
    >
      {snapshot.pages.length === 0
        ? (
          <p className="minke-settings__empty" role="status">
            {t("empty")}
          </p>
        )
        : (
          <>
            <div className="minke-settings__tabs-shell">
              <div
                className="minke-settings__tabs"
                role="tablist"
                aria-label={t("title")}
              >
                {snapshot.pages.map((page, index) => {
                  const active = page.id === snapshot.activeId;
                  const label = page.label();
                  const tabId = `${idPrefix}-tab-${page.id}`;
                  const panelId = `${idPrefix}-panel-${page.id}`;
                  return (
                    <button
                      ref={(element) => {
                        tabRefs.current[index] = element;
                      }}
                      key={page.id}
                      id={tabId}
                      type="button"
                      className="minke-settings__tab"
                      role="tab"
                      aria-label={label}
                      aria-selected={active}
                      aria-controls={panelId}
                      tabIndex={active ? 0 : -1}
                      title={label}
                      onClick={() => selectPage(page.id)}
                      onKeyDown={(event) =>
                        handleTabKeyDown(event, index)}
                    >
                      <LucideIcon
                        icon={PAGE_ICONS[page.icon]}
                        size={17}
                      />
                      <span className="minke-settings__hidden-label">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="minke-settings__pages">
              {snapshot.pages.map((page) => {
                const tabId = `${idPrefix}-tab-${page.id}`;
                const panelId = `${idPrefix}-panel-${page.id}`;
                const mounted = shouldMountMinkeSettingsPage(
                  page,
                  snapshot.activeId,
                  visitedIds,
                );
                return (
                  <div
                    key={page.id}
                    id={panelId}
                    className="minke-settings__page"
                    role="tabpanel"
                    aria-labelledby={tabId}
                    hidden={page.id !== snapshot.activeId}
                  >
                    {mounted
                      ? (
                        <MinkeSettingsPageBoundary
                          label={page.label()}
                          t={t}
                        >
                          <MinkeSettingsPageContent page={page} />
                        </MinkeSettingsPageBoundary>
                      )
                      : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
    </section>
  );
}
