import {
  useDeferredValue,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  parsePluginCatalogGitHubToken,
  type PluginCatalogCandidate,
  type PluginCatalogEntry,
  type PluginInstallVerification,
} from "@lencx/minke-plugin-catalog/contract";
import {
  PluginCatalogIcon,
  PluginCredentialIcon,
  PluginEmptyIcon,
  PluginExternalIcon,
  PluginInstalledIcon,
  PluginInstallIcon,
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

type CatalogFilter =
  | "all"
  | "verified"
  | "pending"
  | "installed";

type CatalogItem =
  | {
    readonly kind: "plugin";
    readonly plugin: PluginCatalogEntry;
  }
  | {
    readonly kind: "candidate";
    readonly candidate: PluginCatalogCandidate;
  };

const FILTERS: readonly CatalogFilter[] = [
  "all",
  "verified",
  "pending",
  "installed",
];

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
  plugin: PluginCatalogEntry,
  t: PluginCatalogTranslate,
): string {
  const verification: PluginInstallVerification =
    plugin.installVerification;
  if (
    verification === "verified" &&
    plugin.requiresBuildAllowance
  ) {
    return t("plugins.verification.buildAllowance");
  }
  if (verification === "verified") {
    return t("plugins.verification.verified");
  }
  if (verification === "build-required") {
    return t("plugins.verification.buildRequired");
  }
  return t("plugins.verification.unverified");
}

function isOneClickInstallable(
  plugin: PluginCatalogEntry,
): boolean {
  return (
    plugin.installVerification === "verified" &&
    !plugin.requiresBuildAllowance
  );
}

function matchesQuery(
  item: CatalogItem,
  query: string,
): boolean {
  if (query === "") return true;
  const values = item.kind === "plugin"
    ? [
      item.plugin.packageName,
      item.plugin.repository,
      item.plugin.description,
      item.plugin.packagePath,
      ...item.plugin.topics,
    ]
    : [
      item.candidate.repository,
      item.candidate.description,
      item.candidate.language ?? "",
      ...item.candidate.topics,
    ];
  return values.some((candidate) =>
    candidate.toLocaleLowerCase().includes(query)
  );
}

function matchesFilter(
  item: CatalogItem,
  filter: CatalogFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "installed") {
    return item.kind === "plugin" && item.plugin.installed;
  }
  if (filter === "verified") {
    return (
      item.kind === "plugin" &&
      item.plugin.installVerification === "verified"
    );
  }
  return (
    item.kind === "candidate" ||
    item.plugin.installVerification !== "verified"
  );
}

function cardTopics(topics: readonly string[]): string[] {
  return topics
    .filter((topic) => topic !== "dsh-plugin")
    .slice(0, 2);
}

function Stars(props: {
  readonly stars: number;
  readonly t: PluginCatalogTranslate;
}): ReactNode {
  return (
    <span
      className="minke-plugins-card__stars"
      title={props.t("plugins.card.stars", {
        count: formattedNumber(props.stars),
      })}
    >
      <PluginStarIcon />
      {formattedNumber(props.stars)}
    </span>
  );
}

function PluginCard(props: {
  readonly plugin: PluginCatalogEntry;
  readonly tabId: string;
  readonly busy: boolean;
  readonly installing: boolean;
  readonly controller: PluginCatalogTabsController;
  readonly t: PluginCatalogTranslate;
}): ReactNode {
  const {
    plugin,
    tabId,
    busy,
    installing,
    controller,
    t,
  } = props;
  const topics = cardTopics(plugin.topics);
  const installable = isOneClickInstallable(plugin);
  return (
    <li className="minke-plugins-card">
      <article data-plugin="">
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
            {verificationLabel(plugin, t)}
          </span>
          {plugin.language !== null && (
            <span>{plugin.language}</span>
          )}
          {plugin.version !== null && (
            <span>v{plugin.version}</span>
          )}
          <Stars stars={plugin.stars} t={t} />
          {plugin.installed ? (
            <span
              className="minke-plugins-card__installed"
              title={t("plugins.install.restart")}
            >
              <PluginInstalledIcon />
              {t("plugins.install.installed")}
            </span>
          ) : installable ? (
            <button
              type="button"
              className="minke-plugins-card__install"
              disabled={busy}
              onClick={() =>
                void controller.install(tabId, plugin.id)}
            >
              <span
                data-spinning={installing || undefined}
                aria-hidden="true"
              >
                {installing
                  ? <PluginRefreshIcon />
                  : <PluginInstallIcon />}
              </span>
              {t(
                installing
                  ? "plugins.install.installing"
                  : "plugins.install.action",
              )}
            </button>
          ) : null}
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

function CandidateCard(props: {
  readonly candidate: PluginCatalogCandidate;
  readonly controller: PluginCatalogTabsController;
  readonly t: PluginCatalogTranslate;
}): ReactNode {
  const { candidate, controller, t } = props;
  const topics = cardTopics(candidate.topics);
  const name =
    candidate.repository.split("/").at(-1) ??
    candidate.repository;
  return (
    <li className="minke-plugins-card">
      <article data-candidate="">
        <div className="minke-plugins-card__heading">
          <span
            className="minke-plugins-card__icon"
            aria-hidden="true"
          >
            <PluginCatalogIcon size={16} />
          </span>
          <div className="minke-plugins-card__identity">
            <h3 title={name}>{name}</h3>
            <span title={candidate.repository}>
              {candidate.repository}
            </span>
          </div>
          <button
            type="button"
            className="minke-plugins-card__open"
            aria-label={t("plugins.card.open", { name })}
            title={t("plugins.card.open", { name })}
            onClick={() =>
              controller.openRepository(
                candidate.repositoryUrl,
                candidate.repository,
              )}
          >
            <PluginExternalIcon />
          </button>
        </div>

        <p className="minke-plugins-card__description">
          {candidate.description ||
            t("plugins.candidate.noDescription")}
        </p>

        <div className="minke-plugins-card__facts">
          <span
            className="minke-plugins-card__verification"
            data-verification={`candidate-${candidate.status}`}
          >
            {t(
              candidate.status === "error"
                ? "plugins.candidate.error"
                : "plugins.candidate.pending",
            )}
          </span>
          {candidate.language !== null && (
            <span>{candidate.language}</span>
          )}
          <Stars stars={candidate.stars} t={t} />
        </div>

        {topics.length > 0 && (
          <div className="minke-plugins-card__details">
            {topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        )}
      </article>
    </li>
  );
}

function CredentialPanel(props: {
  readonly tab: PluginCatalogTab;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly close: () => void;
  readonly controller: PluginCatalogTabsController;
  readonly t: PluginCatalogTranslate;
}): ReactNode {
  const {
    tab,
    draft,
    setDraft,
    close,
    controller,
    t,
  } = props;
  const credential = tab.payload.snapshot?.credential;
  const saving = tab.payload.credentialSaving === true;
  const valid = (() => {
    try {
      parsePluginCatalogGitHubToken(draft);
      return true;
    } catch {
      return false;
    }
  })();
  const writable = credential?.writable === true;
  const configured = credential?.configured === true;
  const busy =
    tab.payload.loading ||
    tab.payload.refreshing ||
    tab.payload.cancelling ||
    tab.payload.installingPluginId !== undefined ||
    saving;
  const detail = credential?.source === "environment"
    ? t("plugins.credential.environment")
    : !writable
      ? t("plugins.credential.unavailable")
      : credential?.source === "secure-storage"
        ? t("plugins.credential.secure")
        : t("plugins.credential.body");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || !writable || busy) return;
    const token = draft;
    setDraft("");
    close();
    void controller.saveToken(tab.id, token);
  };

  return (
    <form
      id={`minke-plugin-credential-${tab.id}`}
      className="minke-plugins-credential"
      aria-label={t("plugins.credential.title")}
      onSubmit={submit}
    >
      <div className="minke-plugins-credential__header">
        <div>
          <strong>{t("plugins.credential.title")}</strong>
          <span
            data-configured={configured || undefined}
          >
            {t(
              configured
                ? "plugins.credential.configured"
                : "plugins.credential.unconfigured",
            )}
          </span>
        </div>
        <p>{detail}</p>
      </div>
      {writable && (
        <label className="minke-plugins-credential__field">
          <span>{t("plugins.credential.input")}</span>
          <input
            type="password"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            placeholder={t(
              "plugins.credential.placeholder",
            )}
            aria-invalid={
              draft.length > 0 && !valid
                ? true
                : undefined
            }
            onChange={(event) =>
              setDraft(event.currentTarget.value)}
          />
          {draft.length > 0 && !valid && (
            <small role="alert">
              {t("plugins.credential.invalid")}
            </small>
          )}
        </label>
      )}
      <div className="minke-plugins-credential__actions">
        {writable && (
          <button
            type="submit"
            data-primary=""
            disabled={!valid || busy}
          >
            {t(
              saving
                ? "plugins.credential.saving"
                : "plugins.credential.save",
            )}
          </button>
        )}
        {configured &&
          credential?.source === "secure-storage" && (
            <button
              type="button"
              data-danger=""
              disabled={busy}
              onClick={() => {
                setDraft("");
                close();
                void controller.clearToken(tab.id);
              }}
            >
              {t("plugins.credential.remove")}
            </button>
          )}
        <button
          type="button"
          disabled={saving}
          onClick={close}
        >
          {t("plugins.credential.close")}
        </button>
      </div>
    </form>
  );
}

export function PluginCatalogView({
  tab,
  active,
  controller,
  t,
}: PluginCatalogViewProps): ReactNode {
  const [query, setQuery] = useState("");
  const [filter, setFilter] =
    useState<CatalogFilter>("all");
  const [credentialOpen, setCredentialOpen] =
    useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const deferredQuery = useDeferredValue(query);
  const snapshot = tab.payload.snapshot;
  const plugins = snapshot?.plugins ?? [];
  const candidates = snapshot?.candidates ?? [];
  const items = useMemo<readonly CatalogItem[]>(
    () => [
      ...plugins.map(
        (plugin): CatalogItem => ({
          kind: "plugin",
          plugin,
        }),
      ),
      ...candidates.map(
        (candidate): CatalogItem => ({
          kind: "candidate",
          candidate,
        }),
      ),
    ],
    [candidates, plugins],
  );
  const normalizedQuery = deferredQuery
    .trim()
    .toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesFilter(item, filter) &&
          matchesQuery(item, normalizedQuery),
      ),
    [filter, items, normalizedQuery],
  );
  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((candidate) => [
          candidate,
          items.filter((item) =>
            matchesFilter(item, candidate)
          ).length,
        ]),
      ) as Record<CatalogFilter, number>,
    [items],
  );
  const lastSync = formattedTime(
    snapshot?.lastRefreshAt ?? null,
  );
  const error = tab.payload.error ?? snapshot?.error;
  const hasError = error !== undefined;
  const pending =
    snapshot?.counts.pendingRepositories ?? 0;
  const busy =
    tab.payload.loading ||
    tab.payload.refreshing ||
    tab.payload.cancelling ||
    tab.payload.installingPluginId !== undefined ||
    tab.payload.credentialSaving === true;
  const canCancel =
    tab.payload.refreshing || tab.payload.cancelling;
  const credentialConfigured =
    snapshot?.credential.configured === true;

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
              data-configured={
                credentialConfigured || undefined
              }
              aria-expanded={credentialOpen}
              aria-controls={
                `minke-plugin-credential-${tab.id}`
              }
              disabled={snapshot === undefined}
              onClick={() => {
                setTokenDraft("");
                setCredentialOpen((open) => !open);
              }}
            >
              <PluginCredentialIcon />
              {t(
                credentialConfigured
                  ? "plugins.action.tokenConfigured"
                  : "plugins.action.token",
              )}
            </button>
            <button
              type="button"
              className="minke-plugins-action"
              data-primary={canCancel ? undefined : ""}
              data-stop={canCancel || undefined}
              disabled={
                tab.payload.loading ||
                tab.payload.cancelling ||
                tab.payload.installingPluginId !== undefined ||
                tab.payload.credentialSaving === true
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

        {credentialOpen && snapshot !== undefined && (
          <CredentialPanel
            tab={tab}
            draft={tokenDraft}
            setDraft={setTokenDraft}
            close={() => {
              setTokenDraft("");
              setCredentialOpen(false);
            }}
            controller={controller}
            t={t}
          />
        )}

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
                candidates: formattedNumber(
                  candidates.length,
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

        <div
          className="minke-plugins-filters"
          role="group"
          aria-label={t("plugins.filter.label")}
        >
          {FILTERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={filter === candidate}
              onClick={() => setFilter(candidate)}
            >
              {t(`plugins.filter.${candidate}`)}
              <span>
                {formattedNumber(filterCounts[candidate])}
              </span>
            </button>
          ))}
        </div>

        {hasError && snapshot !== undefined && (
          <div
            className="minke-plugins-notice"
            data-error=""
            role="status"
          >
            <PluginWarningIcon />
            <span>
              {t("plugins.status.error", {
                message: error,
              })}
            </span>
          </div>
        )}
        {pending > 0 && snapshot !== undefined && (
          <div className="minke-plugins-notice" role="status">
            <PluginWarningIcon />
            <span>
              {t(
                candidates.length > 0
                  ? "plugins.status.pendingVisible"
                  : "plugins.status.pending",
                {
                  visible: formattedNumber(candidates.length),
                  count: formattedNumber(pending),
                },
              )}
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
        ) : items.length === 0 ? (
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
            {filtered.map((item) =>
              item.kind === "plugin"
                ? (
                  <PluginCard
                    key={`plugin:${item.plugin.id}`}
                    plugin={item.plugin}
                    tabId={tab.id}
                    busy={busy}
                    installing={
                      tab.payload.installingPluginId ===
                      item.plugin.id
                    }
                    controller={controller}
                    t={t}
                  />
                )
                : (
                  <CandidateCard
                    key={`candidate:${item.candidate.id}`}
                    candidate={item.candidate}
                    controller={controller}
                    t={t}
                  />
                )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
