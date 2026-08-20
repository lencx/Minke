import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  WebviewTag,
} from "electron";
import { TABS_WEB_PARTITION } from "@minke/harness-overlay/tabs/contract.ts";
import {
  parsePluginInstallCommand,
  type InstalledPlugin,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import githubCompactCss from "./github-compact.css";
import githubSearchCss from "./github-search.css";
import githubTopicCss from "./github-topic.css";
import {
  PluginBackIcon,
  PluginBrowserIcon,
  PluginClearIcon,
  PluginExternalIcon,
  PluginForwardIcon,
  PluginHomeIcon,
  PluginIcon,
  PluginInstallIcon,
  PluginRefreshIcon,
  PluginStopIcon,
  PluginSuccessIcon,
  PluginWarningIcon,
} from "./icons.tsx";
import type { PluginTabsController } from "./controller.ts";
import type { PluginsTranslate } from "./locales.ts";
import {
  PLUGIN_DISCOVERY_TOPIC_URL,
  createPluginSearchUrl,
  readPluginSearchQuery,
} from "./resources.ts";
import type { PluginTab } from "./types.ts";

export interface PluginsViewProps {
  readonly tab: PluginTab;
  readonly active: boolean;
  readonly controller: PluginTabsController;
  readonly t: PluginsTranslate;
}

interface BrowserState {
  readonly url: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly error?: string;
}

function externalUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : PLUGIN_DISCOVERY_TOPIC_URL;
  } catch {
    return PLUGIN_DISCOVERY_TOPIC_URL;
  }
}

function isPluginTopicUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.replace(/\/+$/u, "") === "/topics/dsh-plugin"
    );
  } catch {
    return false;
  }
}

function isGitHubTopicUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      /^\/topics\/[^/]+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isGitHubUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

function BrowserAction(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly external?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      className="minke-plugins-browser__action"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      data-external={props.external || undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function InstalledPluginCard(props: {
  readonly plugin: InstalledPlugin;
  readonly controller: PluginTabsController;
  readonly t: PluginsTranslate;
}): ReactNode {
  const { plugin, controller, t } = props;
  const missing = plugin.state === "missing";
  const repositoryUrl = plugin.repositoryUrl;
  return (
    <article
      className="minke-plugins-installed__card"
      data-state={plugin.state}
    >
      <header>
        <span className="minke-plugins-installed__icon" aria-hidden="true">
          <PluginIcon size={17} />
        </span>
        <span className="minke-plugins-installed__heading">
          <strong title={plugin.name}>{plugin.name}</strong>
          <span>
            <span data-state={plugin.state}>
              {t(
                missing
                  ? "plugins.installed.missing"
                  : "plugins.installed.ready",
              )}
            </span>
            {plugin.version !== undefined && <small>v{plugin.version}</small>}
          </span>
        </span>
        {repositoryUrl !== undefined && (
          <button
            type="button"
            className="minke-plugins-installed__repository"
            title={t("plugins.installed.repository")}
            aria-label={t("plugins.installed.repository")}
            onClick={() => controller.openExternal(repositoryUrl)}
          >
            <PluginExternalIcon />
          </button>
        )}
      </header>
      <p>
        {missing
          ? t("plugins.installed.missingBody")
          : (plugin.description ?? t("plugins.installed.noDescription"))}
      </p>
      <footer>
        <span>{t("plugins.installed.requested")}</span>
        <code title={plugin.requested}>{plugin.requested}</code>
      </footer>
    </article>
  );
}

export function PluginsView({
  tab,
  active,
  controller,
  t,
}: PluginsViewProps): ReactNode {
  const [draft, setDraft] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<WebviewTag | null>(null);
  const browserUrlRef = useRef(PLUGIN_DISCOVERY_TOPIC_URL);
  const [browser, setBrowser] = useState<BrowserState>({
    url: PLUGIN_DISCOVERY_TOPIC_URL,
    loading: true,
    canGoBack: false,
    canGoForward: false,
  });
  const parsedCommand = useMemo(() => {
    try {
      return parsePluginInstallCommand(draft);
    } catch {
      return undefined;
    }
  }, [draft]);
  const hasDraft = draft.trim().length > 0;
  const invalid = hasDraft && parsedCommand === undefined;
  const attemptedCommand = parsedCommand?.command ?? draft;
  const feedbackMatches = tab.payload.attemptedCommand === attemptedCommand;
  const installed =
    feedbackMatches && tab.payload.installedCommand === attemptedCommand;
  const installError = feedbackMatches ? tab.payload.error : undefined;

  useEffect(() => {
    if (tab.payload.view !== "discover") return;
    const host = hostRef.current;
    if (host === null) return;

    const initialUrl = browserUrlRef.current;
    const view = host.ownerDocument.createElement("webview") as WebviewTag;
    view.className = "minke-plugins-browser__guest";
    view.setAttribute("src", initialUrl);
    view.setAttribute("partition", TABS_WEB_PARTITION);
    view.setAttribute(
      "webpreferences",
      [
        "contextIsolation=yes",
        "nodeIntegration=no",
        "sandbox=yes",
        "webSecurity=yes",
      ].join(","),
    );
    view.setAttribute("aria-label", t("plugins.browser.title"));
    viewRef.current = view;
    setBrowser((current) => ({
      ...current,
      url: initialUrl,
      loading: true,
      canGoBack: false,
      canGoForward: false,
      error: undefined,
    }));

    let disposed = false;
    let cssRevision = 0;
    let insertedCssKeys: string[] = [];

    const removeInsertedCss = (keys: readonly string[]): void => {
      for (const key of keys) {
        void view.removeInsertedCSS(key).catch(() => {});
      }
    };

    const injectGitHubLayout = async (): Promise<void> => {
      const revision = ++cssRevision;
      const previousKeys = insertedCssKeys;
      insertedCssKeys = [];
      removeInsertedCss(previousKeys);

      let url = PLUGIN_DISCOVERY_TOPIC_URL;
      try {
        url = view.getURL() || url;
      } catch {}
      if (!isGitHubUrl(url)) return;

      const sources = isGitHubTopicUrl(url)
        ? [githubCompactCss, githubTopicCss]
        : readPluginSearchQuery(url) !== undefined
          ? [githubCompactCss, githubSearchCss]
          : [githubCompactCss];
      const nextKeys: string[] = [];
      try {
        for (const source of sources) {
          nextKeys.push(await view.insertCSS(source));
        }
      } catch {
        removeInsertedCss(nextKeys);
        return;
      }
      if (disposed || revision !== cssRevision) {
        removeInsertedCss(nextKeys);
        return;
      }
      insertedCssKeys = nextKeys;
    };

    const syncNavigation = (patch: Partial<BrowserState> = {}): void => {
      if (disposed) return;
      let url = PLUGIN_DISCOVERY_TOPIC_URL;
      let canGoBack = false;
      let canGoForward = false;
      try {
        url = view.getURL() || url;
        canGoBack = view.canGoBack();
        canGoForward = view.canGoForward();
      } catch {}
      browserUrlRef.current = url;
      setBrowser((current) => ({
        ...current,
        url,
        canGoBack,
        canGoForward,
        ...patch,
      }));
    };

    const handleStart = (): void => {
      syncNavigation({ loading: true, error: undefined });
    };
    const handleStop = (): void => {
      syncNavigation({ loading: false });
    };
    const handleReady = (): void => {
      syncNavigation();
      void injectGitHubLayout();
    };
    const handleNavigate = (event: DidNavigateEvent): void => {
      const searchQuery = readPluginSearchQuery(event.url);
      if (searchQuery !== undefined) {
        setSearchDraft(searchQuery);
      } else if (isPluginTopicUrl(event.url)) {
        setSearchDraft("");
      }
      syncNavigation({
        url: event.url,
        error: undefined,
      });
    };
    const handleNavigateInPage = (event: DidNavigateInPageEvent): void => {
      if (!event.isMainFrame) return;
      const searchQuery = readPluginSearchQuery(event.url);
      if (searchQuery !== undefined) {
        setSearchDraft(searchQuery);
      } else if (isPluginTopicUrl(event.url)) {
        setSearchDraft("");
      }
      syncNavigation({ url: event.url });
    };
    const handleFailure = (event: DidFailLoadEvent): void => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      syncNavigation({
        loading: false,
        url: event.validatedURL || PLUGIN_DISCOVERY_TOPIC_URL,
        error: event.errorDescription,
      });
    };

    view.addEventListener("did-start-loading", handleStart);
    view.addEventListener("did-stop-loading", handleStop);
    view.addEventListener("dom-ready", handleReady);
    view.addEventListener("did-navigate", handleNavigate);
    view.addEventListener("did-navigate-in-page", handleNavigateInPage);
    view.addEventListener("did-fail-load", handleFailure);
    host.append(view);

    return () => {
      disposed = true;
      cssRevision += 1;
      removeInsertedCss(insertedCssKeys);
      view.removeEventListener("did-start-loading", handleStart);
      view.removeEventListener("did-stop-loading", handleStop);
      view.removeEventListener("dom-ready", handleReady);
      view.removeEventListener("did-navigate", handleNavigate);
      view.removeEventListener("did-navigate-in-page", handleNavigateInPage);
      view.removeEventListener("did-fail-load", handleFailure);
      view.remove();
      viewRef.current = null;
    };
  }, [tab.id, tab.payload.view, t]);

  const submitInstall = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (parsedCommand === undefined || tab.payload.installing) {
      return;
    }
    void controller.install(tab.id, parsedCommand.command);
  };

  const loadTopic = (): void => {
    const view = viewRef.current;
    if (view === null) return;
    setSearchDraft("");
    void view.loadURL(PLUGIN_DISCOVERY_TOPIC_URL);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const view = viewRef.current;
    if (view === null) return;
    void view.loadURL(createPluginSearchUrl(searchDraft));
  };

  const retry = (): void => {
    const view = viewRef.current;
    if (view === null) return;
    void view.loadURL(externalUrl(browser.url));
  };

  return (
    <div
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view minke-plugins-page"
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      aria-busy={
        tab.payload.installing ||
        (tab.payload.view === "installed" && tab.payload.loadingInstalled)
      }
      hidden={!active}
    >
      <section className="minke-plugins-install">
        <div className="minke-plugins-install__copy">
          <h2>{t("plugins.install.title")}</h2>
          <p>{t("plugins.install.body")}</p>
        </div>
        <form className="minke-plugins-install__form" onSubmit={submitInstall}>
          <label
            className="minke-plugins-visually-hidden"
            htmlFor={`minke-plugin-command-${tab.id}`}
          >
            {t("plugins.install.label")}
          </label>
          <span className="minke-plugins-install__prompt" aria-hidden="true">
            $
          </span>
          <input
            id={`minke-plugin-command-${tab.id}`}
            value={draft}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={tab.payload.installing}
            aria-invalid={invalid || undefined}
            aria-describedby={`minke-plugin-command-detail-${tab.id}`}
            placeholder={t("plugins.install.placeholder")}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <button
            type="submit"
            disabled={parsedCommand === undefined || tab.payload.installing}
          >
            <span
              data-spinning={tab.payload.installing || undefined}
              aria-hidden="true"
            >
              {tab.payload.installing ? (
                <PluginRefreshIcon />
              ) : (
                <PluginInstallIcon />
              )}
            </span>
            {t(
              tab.payload.installing
                ? "plugins.install.installing"
                : "plugins.install.action",
            )}
          </button>
        </form>
        <div
          id={`minke-plugin-command-detail-${tab.id}`}
          className="minke-plugins-install__detail"
        >
          <span
            className="minke-plugins-install__trust"
            data-invalid={invalid || undefined}
          >
            {invalid
              ? t("plugins.install.invalid")
              : t("plugins.install.trust")}
          </span>
          <span className="minke-plugins-install__feedback" aria-live="polite">
            {installed ? (
              <>
                <PluginSuccessIcon />
                {t("plugins.install.success")}
              </>
            ) : installError !== undefined ? (
              <span role="alert">
                <PluginWarningIcon />
                {t("plugins.install.failed", {
                  message: installError,
                })}
              </span>
            ) : null}
          </span>
        </div>
      </section>

      <nav
        className="minke-plugins-switcher"
        aria-label={t("plugins.view.label")}
      >
        <div role="tablist">
          <button
            id={`minke-plugin-view-installed-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.payload.view === "installed"}
            aria-controls={`minke-plugin-installed-${tab.id}`}
            data-active={tab.payload.view === "installed" || undefined}
            onClick={() => controller.setView(tab.id, "installed")}
          >
            <PluginIcon size={14} />
            <span>{t("plugins.view.installed")}</span>
            <small>{tab.payload.installedPlugins.length}</small>
          </button>
          <button
            id={`minke-plugin-view-discover-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.payload.view === "discover"}
            aria-controls={`minke-plugin-discover-${tab.id}`}
            data-active={tab.payload.view === "discover" || undefined}
            onClick={() => controller.setView(tab.id, "discover")}
          >
            <PluginBrowserIcon />
            <span>{t("plugins.view.discover")}</span>
          </button>
        </div>
        {tab.payload.view === "installed" && (
          <button
            type="button"
            className="minke-plugins-switcher__refresh"
            title={t("plugins.installed.refresh")}
            aria-label={t("plugins.installed.refresh")}
            disabled={tab.payload.loadingInstalled}
            data-spinning={tab.payload.loadingInstalled || undefined}
            onClick={() => void controller.refreshInstalled(tab.id)}
          >
            <PluginRefreshIcon />
          </button>
        )}
      </nav>

      {tab.payload.view === "installed" ? (
        <section
          id={`minke-plugin-installed-${tab.id}`}
          className="minke-plugins-installed"
          role="tabpanel"
          aria-labelledby={`minke-plugin-view-installed-${tab.id}`}
          aria-busy={tab.payload.loadingInstalled}
        >
          {tab.payload.installedError !== undefined &&
            tab.payload.installedPlugins.length > 0 && (
              <div className="minke-plugins-installed__notice" role="alert">
                <PluginWarningIcon />
                <span>{t("plugins.installed.errorTitle")}</span>
                <button
                  type="button"
                  onClick={() => void controller.refreshInstalled(tab.id)}
                >
                  {t("plugins.installed.retry")}
                </button>
              </div>
            )}
          {tab.payload.loadingInstalled &&
          tab.payload.installedPlugins.length === 0 ? (
            <div
              className="minke-plugins-installed__state"
              data-state="loading"
              aria-live="polite"
            >
              <span aria-hidden="true">
                <PluginRefreshIcon />
              </span>
              <h3>{t("plugins.installed.loading")}</h3>
            </div>
          ) : tab.payload.installedError !== undefined &&
            tab.payload.installedPlugins.length === 0 ? (
            <div
              className="minke-plugins-installed__state"
              data-state="error"
              role="alert"
            >
              <span aria-hidden="true">
                <PluginWarningIcon />
              </span>
              <h3>{t("plugins.installed.errorTitle")}</h3>
              <p>{t("plugins.installed.errorBody")}</p>
              <button
                type="button"
                onClick={() => void controller.refreshInstalled(tab.id)}
              >
                {t("plugins.installed.retry")}
              </button>
            </div>
          ) : tab.payload.installedPlugins.length === 0 ? (
            <div className="minke-plugins-installed__state">
              <span aria-hidden="true">
                <PluginIcon size={18} />
              </span>
              <h3>{t("plugins.installed.emptyTitle")}</h3>
              <p>{t("plugins.installed.emptyBody")}</p>
              <button
                type="button"
                onClick={() => controller.setView(tab.id, "discover")}
              >
                <PluginBrowserIcon />
                {t("plugins.installed.emptyAction")}
              </button>
            </div>
          ) : (
            <div className="minke-plugins-installed__grid">
              {tab.payload.installedPlugins.map((plugin) => (
                <InstalledPluginCard
                  key={plugin.name}
                  plugin={plugin}
                  controller={controller}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section
          id={`minke-plugin-discover-${tab.id}`}
          className="minke-plugins-browser"
          role="tabpanel"
          aria-labelledby={`minke-plugin-view-discover-${tab.id}`}
        >
          <div className="minke-plugins-browser__bar">
            <div className="minke-plugins-browser__identity">
              <span>
                <strong>{t("plugins.browser.title")}</strong>
                <small title={browser.url}>
                  {isPluginTopicUrl(browser.url)
                    ? t("plugins.browser.topic")
                    : new URL(externalUrl(browser.url)).pathname.replace(
                        /^\/+/u,
                        "",
                      ) || t("plugins.browser.topic")}
                </small>
              </span>
            </div>
            <form
              className="minke-plugins-browser__search"
              role="search"
              onSubmit={submitSearch}
            >
              <label
                className="minke-plugins-visually-hidden"
                htmlFor={`minke-plugin-search-${tab.id}`}
              >
                {t("plugins.browser.searchLabel")}
              </label>
              <span
                className="minke-plugins-browser__site-icon"
                data-loading={browser.loading || undefined}
                aria-hidden="true"
              >
                <PluginBrowserIcon />
              </span>
              <input
                ref={searchInputRef}
                id={`minke-plugin-search-${tab.id}`}
                value={searchDraft}
                type="search"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("plugins.browser.searchPlaceholder")}
                onChange={(event) => setSearchDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || searchDraft === "") {
                    return;
                  }
                  event.preventDefault();
                  setSearchDraft("");
                }}
              />
              {searchDraft !== "" && (
                <button
                  type="button"
                  title={t("plugins.browser.searchClear")}
                  aria-label={t("plugins.browser.searchClear")}
                  onClick={() => {
                    setSearchDraft("");
                    searchInputRef.current?.focus();
                  }}
                >
                  <PluginClearIcon />
                </button>
              )}
            </form>
            <div className="minke-plugins-browser__actions">
              <div className="minke-plugins-browser__nav">
                <BrowserAction
                  label={t("plugins.browser.back")}
                  disabled={!browser.canGoBack}
                  onClick={() => viewRef.current?.goBack()}
                >
                  <PluginBackIcon />
                </BrowserAction>
                <BrowserAction
                  label={t("plugins.browser.forward")}
                  disabled={!browser.canGoForward}
                  onClick={() => viewRef.current?.goForward()}
                >
                  <PluginForwardIcon />
                </BrowserAction>
                <BrowserAction
                  label={t("plugins.browser.home")}
                  onClick={loadTopic}
                >
                  <PluginHomeIcon />
                </BrowserAction>
                <BrowserAction
                  label={t(
                    browser.loading
                      ? "plugins.browser.stop"
                      : "plugins.browser.reload",
                  )}
                  onClick={() => {
                    if (browser.loading) {
                      viewRef.current?.stop();
                    } else {
                      viewRef.current?.reload();
                    }
                  }}
                >
                  {browser.loading ? <PluginStopIcon /> : <PluginRefreshIcon />}
                </BrowserAction>
              </div>
              <BrowserAction
                external
                label={t("plugins.browser.external")}
                onClick={() =>
                  controller.openExternal(externalUrl(browser.url))
                }
              >
                <PluginExternalIcon />
              </BrowserAction>
            </div>
          </div>
          <div
            ref={hostRef}
            className="minke-plugins-browser__host"
            data-error={browser.error !== undefined || undefined}
          >
            {browser.error !== undefined && (
              <div className="minke-plugins-browser__error" role="alert">
                <PluginWarningIcon />
                <h3>{t("plugins.browser.errorTitle")}</h3>
                <p>{t("plugins.browser.errorBody")}</p>
                <code>{browser.error}</code>
                <div>
                  <button type="button" onClick={retry}>
                    {t("plugins.browser.retry")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      controller.openExternal(externalUrl(browser.url))
                    }
                  >
                    <PluginExternalIcon />
                    {t("plugins.browser.external")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
