import {
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  PluginCatalogEntry,
  PluginInstallVerification,
} from "@lencx/minke-plugin-catalog/contract";
import {
  PluginCatalogIcon,
  PluginEmptyIcon,
  PluginExternalIcon,
  PluginRefreshIcon,
  PluginSearchIcon,
  PluginStarIcon,
  PluginStopIcon,
  PluginWarningIcon,
} from "./icons.tsx";
import type {
  PluginCatalogTabsController,
} from "./controller.ts";
import type {
  PluginCatalogTranslate,
} from "./locales.ts";
import type {
  PluginCatalogTab,
} from "./types.ts";

export interface PluginCatalogViewProps {
  readonly tab: PluginCatalogTab;
  readonly active: boolean;
  readonly controller: PluginCatalogTabsController;
  readonly t: PluginCatalogTranslate;
}

function formattedNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formattedTime(value: string | null): string | undefined {
  if (value === null) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function verificationLabel(
  verification: PluginInstallVerification,
  t: PluginCatalogTranslate,
): string {
  if (verification === "verified") {
    return t("plugins.verification.verified");
  }
  if (verification === "build-required") {
    return t("plugins.verification.buildRequired");
  }
  return t("plugins.verification.unverified");
}

function matchesQuery(
  plugin: PluginCatalogEntry,
  query: string,
): boolean {
  if (query === "") return true;
  return [
    plugin.packageName,
    plugin.repository,
    plugin.description,
    plugin.packagePath,
    ...plugin.topics,
  ].some((candidate) =>
    candidate.toLocaleLowerCase().includes(query)
  );
}

function PluginCard(props: {
  readonly plugin: PluginCatalogEntry;
  readonly controller: PluginCatalogTabsController;
  readonly t: PluginCatalogTranslate;
}): ReactNode {
  const { plugin, controller, t } = props;
  const topics = plugin.topics
    .filter((topic) => topic !== "dsh-plugin")
    .slice(0, 2);
  return (
    <li className="minke-plugins-card">
      <article>
        <div className="minke-plugins-card__heading">
          <span
            className="minke-plugins-card__icon"
            aria-hidden="true"
          >
            <PluginCatalogIcon size={16} />
          </span>
          <div className="minke-plugins-card__identity">
            <h3 title={plugin.packageName}>
              {plugin.packageName}
            </h3>
            <span title={plugin.repository}>
              {plugin.repository}
            </span>
          </div>
          <button
            type="button"
            className="minke-plugins-card__open"
            aria-label={t("plugins.card.open", {
              name: plugin.packageName,
            })}
            title={t("plugins.card.open", {
              name: plugin.packageName,
            })}
            onClick={() =>
              controller.openRepository(
                plugin.repositoryUrl,
                plugin.repository,
              )}
          >
            <PluginExternalIcon />
          </button>
        </div>

        <p className="minke-plugins-card__description">
          {plugin.description ||
            t("plugins.card.noDescription")}
        </p>

        <div className="minke-plugins-card__facts">
          <span
            className="minke-plugins-card__verification"
            data-verification={plugin.installVerification}
          >
            {verificationLabel(plugin.installVerification, t)}
          </span>
          {plugin.language !== null && (
            <span>{plugin.language}</span>
          )}
          {plugin.version !== null && (
            <span>v{plugin.version}</span>
          )}
          <span
            className="minke-plugins-card__stars"
            title={t("plugins.card.stars", {
              count: formattedNumber(plugin.stars),
            })}
          >
            <PluginStarIcon />
            {formattedNumber(plugin.stars)}
          </span>
        </div>

        {(plugin.packagePath !== "" || topics.length > 0) && (
          <div className="minke-plugins-card__details">
            {plugin.packagePath !== "" && (
              <code title={plugin.packagePath}>
                {plugin.packagePath}
              </code>
            )}
            {topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        )}
      </article>
    </li>
  );
}

export function PluginCatalogView({
  tab,
  active,
  controller,
  t,
}: PluginCatalogViewProps): ReactNode {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const snapshot = tab.payload.snapshot;
  const plugins = snapshot?.plugins ?? [];
  const normalizedQuery = deferredQuery
    .trim()
    .toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      plugins.filter((plugin) =>
        matchesQuery(plugin, normalizedQuery)
      ),
    [normalizedQuery, plugins],
  );
  const lastSync = formattedTime(
    snapshot?.lastRefreshAt ?? null,
  );
  const error =
    tab.payload.error ?? snapshot?.error;
  const hasError = error !== undefined;
  const pending = snapshot?.counts.pendingRepositories ?? 0;
  const busy =
    tab.payload.loading ||
    tab.payload.refreshing ||
    tab.payload.cancelling;
  const canCancel =
    tab.payload.refreshing || tab.payload.cancelling;

  return (
    <div
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view minke-plugins-page"
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      aria-busy={busy}
      hidden={!active}
    >
      <div className="minke-plugins-page__top">
        <header className="minke-plugins-page__header">
          <div className="minke-plugins-page__intro">
            <h2>{t("plugins.page.title")}</h2>
            <p>{t("plugins.page.body")}</p>
          </div>
          <div className="minke-plugins-page__actions">
            <button
              type="button"
              className="minke-plugins-action"
              data-primary={canCancel ? undefined : ""}
              data-stop={canCancel || undefined}
              disabled={
                tab.payload.loading || tab.payload.cancelling
              }
              onClick={() =>
                void (
                  canCancel
                    ? controller.cancel(tab.id)
                    : controller.refresh(tab.id)
                )}
            >
              <span
                className="minke-plugins-action__icon"
                data-spinning={
                  tab.payload.cancelling || undefined
                }
                aria-hidden="true"
              >
                {tab.payload.refreshing &&
                    !tab.payload.cancelling
                  ? <PluginStopIcon />
                  : <PluginRefreshIcon />}
              </span>
              {t(
                tab.payload.cancelling
                  ? "plugins.action.stopping"
                  : tab.payload.refreshing
                    ? "plugins.action.stop"
                    : "plugins.action.sync",
              )}
            </button>
            <button
              type="button"
              className="minke-plugins-action"
              onClick={() => controller.openDiscoveryResource()}
            >
              <PluginExternalIcon />
              {t("plugins.action.github")}
            </button>
          </div>
        </header>

        <div className="minke-plugins-page__controls">
          <label className="minke-plugins-search">
            <span aria-hidden="true">
              <PluginSearchIcon />
            </span>
            <span className="minke-plugins-search__label">
              {t("plugins.search.label")}
            </span>
            <input
              type="search"
              value={query}
              placeholder={t("plugins.search.placeholder")}
              aria-label={t("plugins.search.label")}
              onChange={(event) =>
                setQuery(event.currentTarget.value)}
            />
          </label>
          <div
            className="minke-plugins-page__summary"
            aria-live="polite"
          >
            <span>
              {t("plugins.summary", {
                plugins: formattedNumber(plugins.length),
                repositories: formattedNumber(
                  snapshot?.counts.repositories ?? 0,
                ),
              })}
            </span>
            <span>
              {lastSync === undefined
                ? t("plugins.status.never")
                : t("plugins.status.lastSync", {
                    time: lastSync,
                  })}
            </span>
          </div>
        </div>

        {(hasError || pending > 0) && snapshot !== undefined && (
          <div
            className="minke-plugins-notice"
            data-error={hasError || undefined}
            role={hasError ? "status" : undefined}
          >
            <PluginWarningIcon />
            <span>
              {hasError
                ? t("plugins.status.error", {
                    message: error,
                  })
                : t("plugins.status.pending", {
                    count: formattedNumber(pending),
                  })}
            </span>
          </div>
        )}
      </div>

      <div className="minke-plugins-page__content">
        {tab.payload.loading && snapshot === undefined ? (
          <div className="minke-plugins-state" role="status">
            <span
              className="minke-plugins-state__icon"
              data-spinning=""
              aria-hidden="true"
            >
              <PluginRefreshIcon />
            </span>
            <p>{t("plugins.loading")}</p>
          </div>
        ) : plugins.length === 0 ? (
          <div
            className="minke-plugins-state"
            role={hasError ? "alert" : "status"}
          >
            <span
              className="minke-plugins-state__icon"
              aria-hidden="true"
            >
              <PluginEmptyIcon />
            </span>
            <h3>{t("plugins.empty.title")}</h3>
            <p>
              {pending > 0
                ? t("plugins.empty.pending", {
                    count: formattedNumber(pending),
                  })
                : t("plugins.empty.body")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void controller.refresh(tab.id)}
            >
              {t("plugins.empty.action")}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="minke-plugins-state" role="status">
            <span
              className="minke-plugins-state__icon"
              aria-hidden="true"
            >
              <PluginSearchIcon />
            </span>
            <h3>{t("plugins.results.empty.title")}</h3>
            <p>{t("plugins.results.empty.body")}</p>
          </div>
        ) : (
          <ul className="minke-plugins-list">
            {filtered.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                controller={controller}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
