import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  DataHomeCandidateOrigin,
  DataHomeMigrationMode,
} from "@minke/harness-overlay/data-home-contract.ts";
import type {
  DataHomeLocaleKey,
  DataHomeTranslate,
} from "./locales.ts";
import type {
  DataHomeSettingsErrorKind,
  DataHomeSettingsRuntime,
} from "./runtime.ts";

type TargetChoice = "current" | "recommended" | "custom";

export interface DataHomeSettingsSectionProps {
  runtime?: DataHomeSettingsRuntime;
  t?: DataHomeTranslate;
}

/** Settings section for choosing and safely converging the DSH data root. */
export function DataHomeSettingsSection({
  runtime,
  t,
}: DataHomeSettingsSectionProps): ReactNode {
  if (runtime === undefined || t === undefined) return null;
  return <LoadedDataHomeSettings runtime={runtime} t={t} />;
}

function LoadedDataHomeSettings({
  runtime,
  t,
}: Required<DataHomeSettingsSectionProps>): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [choice, setChoice] = useState<TargetChoice>("current");
  const [mode, setMode] = useState<DataHomeMigrationMode>("merge");
  const [customPath, setCustomPath] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const data = snapshot.data;
  const targetPath =
    choice === "recommended"
      ? data?.recommendedPath ?? ""
      : choice === "current"
        ? data?.activePath ?? ""
        : customPath;
  const planMatches =
    snapshot.plan !== undefined &&
    snapshot.plan.targetPath === targetPath &&
    snapshot.plan.mode === mode;

  useEffect(() => {
    setAcknowledged(false);
  }, [
    mode,
    targetPath,
    snapshot.plan?.mode,
    snapshot.plan?.targetPath,
  ]);

  const chooseCustomDirectory = async (): Promise<void> => {
    const selected = await runtime.chooseDirectory();
    if (selected === undefined) return;
    setChoice("custom");
    setCustomPath(selected);
  };

  const previewMigration = async (): Promise<void> => {
    await runtime.preview(targetPath, mode);
    const normalizedTarget = runtime.getSnapshot().plan?.targetPath;
    if (choice === "custom" && normalizedTarget !== undefined) {
      setCustomPath(normalizedTarget);
    }
  };

  const lastMigration = data?.lastMigration;

  return (
    <section
      className="minke-data-home"
      aria-labelledby="minke-data-home-title"
      data-minke-data-home
    >
      <div className="minke-data-home__intro">
        <h2
          id="minke-data-home-title"
          className="minke-data-home__title"
        >
          {t("title")}
        </h2>
        <p className="minke-data-home__description">
          {t("description")}
        </p>
        {snapshot.error !== undefined && (
          <p className="minke-data-home__error" role="alert">
            {t(errorLocaleKey(snapshot.error))}
          </p>
        )}
        {lastMigration?.status === "completed" && (
          <>
            <p className="minke-data-home__status" role="status">
              {lastMigration.mode === "fresh"
                ? t("lastFreshCompleted")
                : t("lastCompleted", {
                    files: lastMigration.copiedFiles,
                    conflicts: lastMigration.conflictFiles,
                  })}
            </p>
            <ConflictDetails
              total={lastMigration.conflictFiles}
              paths={lastMigration.conflicts}
              t={t}
            />
          </>
        )}
        {lastMigration?.status === "failed" && (
          <p className="minke-data-home__error" role="alert">
            {t("lastFailed", {
              error: lastMigration.error ?? "Unknown error",
            })}
          </p>
        )}
      </div>

      {data !== undefined && (
        <>
          <div className="minke-data-home__current">
            <span className="minke-data-home__field-label">
              {t("currentLabel")}
            </span>
            <code className="minke-data-home__path">
              {data.activePath}
            </code>
            <span className="minke-data-home__help">
              {t("currentHelp")}
            </span>
            <span className="minke-data-home__help">
              {t("externalHelp")}
            </span>
          </div>

          <fieldset className="minke-data-home__targets">
            <legend className="minke-data-home__field-label">
              {t("targetLabel")}
            </legend>
            <TargetOption
              checked={choice === "current"}
              label={t("optionCurrent")}
              path={data.activePath}
              onSelect={() => {
                setChoice("current");
              }}
            />
            <TargetOption
              checked={choice === "recommended"}
              label={t("optionRecommended")}
              help={t("optionRecommendedHelp")}
              path={data.recommendedPath}
              recommended
              onSelect={() => {
                setChoice("recommended");
              }}
            />
            <label className="minke-data-home__target">
              <input
                type="radio"
                name="minke-data-home-target"
                checked={choice === "custom"}
                onChange={() => {
                  setChoice("custom");
                }}
              />
              <span className="minke-data-home__target-copy">
                <span className="minke-data-home__target-heading">
                  {t("optionCustom")}
                </span>
                <span className="minke-data-home__custom-control">
                  <input
                    className="minke-data-home__input"
                    type="text"
                    value={customPath}
                    placeholder={t("customPlaceholder")}
                    spellCheck={false}
                    disabled={snapshot.busy}
                    onFocus={() => {
                      setChoice("custom");
                    }}
                    onChange={(event) => {
                      setChoice("custom");
                      setCustomPath(event.currentTarget.value);
                    }}
                  />
                  <button
                    type="button"
                    className="minke-data-home__button"
                    disabled={snapshot.busy}
                    onClick={() => {
                      void chooseCustomDirectory();
                    }}
                  >
                    {t("browse")}
                  </button>
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="minke-data-home__strategies">
            <legend className="minke-data-home__field-label">
              {t("modeLabel")}
            </legend>
            <ModeOption
              checked={mode === "merge"}
              label={t("modeMerge")}
              badge={t("modeRecommended")}
              help={t("modeMergeHelp")}
              onSelect={() => {
                setMode("merge");
              }}
            />
            <ModeOption
              checked={mode === "fresh"}
              label={t("modeFresh")}
              help={t("modeFreshHelp")}
              onSelect={() => {
                setMode("fresh");
              }}
            />
          </fieldset>

          <div className="minke-data-home__detected">
            <h3 className="minke-data-home__subtitle">
              {t("detectedTitle")}
            </h3>
            {data.candidates.length === 0 ? (
              <p className="minke-data-home__help">
                {t("detectedEmpty")}
              </p>
            ) : (
              <ul className="minke-data-home__candidate-list">
                {data.candidates.map((candidate) => (
                  <li
                    key={candidate.path}
                    className="minke-data-home__candidate"
                  >
                    <span className="minke-data-home__candidate-main">
                      <code>{candidate.path}</code>
                      <span className="minke-data-home__origins">
                        {candidate.origins
                          .map((origin) =>
                            t(originLocaleKey(origin))
                          )
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="minke-data-home__candidate-size">
                      {t("candidateSummary", {
                        files: candidate.fileCount,
                        size: formatBytes(candidate.byteCount),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="minke-data-home__actions">
            <button
              type="button"
              className="minke-data-home__button minke-data-home__button--primary"
              disabled={
                snapshot.busy || targetPath.trim().length === 0
              }
              onClick={() => {
                void previewMigration();
              }}
            >
              {snapshot.busy
                ? t("previewing")
                : mode === "fresh"
                  ? t("reviewFresh")
                  : t("previewMerge")}
            </button>
          </div>

          {planMatches && snapshot.plan !== undefined && (
            <div className="minke-data-home__plan">
              <h3 className="minke-data-home__subtitle">
                {snapshot.plan.mode === "fresh"
                  ? t("freshPlanTitle")
                  : t("planTitle")}
              </h3>
              {snapshot.plan.mode === "fresh" ? (
                <p className="minke-data-home__help">
                  {t("freshPlanBody", {
                    path: snapshot.plan.targetPath,
                  })}
                </p>
              ) : (
                <>
                  <ul className="minke-data-home__plan-list">
                    <li>
                      {t("planCopy", {
                        files: snapshot.plan.copyFiles,
                        size: formatBytes(snapshot.plan.copyBytes),
                      })}
                    </li>
                    <li>
                      {t("planIdentical", {
                        files: snapshot.plan.identicalFiles,
                      })}
                    </li>
                    <li>
                      {t("planConflicts", {
                        files: snapshot.plan.conflictFiles,
                      })}
                    </li>
                  </ul>
                  <ConflictDetails
                    total={snapshot.plan.conflictFiles}
                    paths={snapshot.plan.conflicts}
                    t={t}
                  />
                </>
              )}
              <div
                className={
                  snapshot.plan.mode === "fresh"
                    ? "minke-data-home__risk minke-data-home__risk--fresh"
                    : "minke-data-home__risk"
                }
              >
                <strong>
                  {snapshot.plan.mode === "fresh"
                    ? t("freshRiskTitle")
                    : t("riskTitle")}
                </strong>
                <p>
                  {snapshot.plan.mode === "fresh"
                    ? t("freshRiskBody")
                    : t("riskBody")}
                </p>
              </div>
              <label className="minke-data-home__acknowledge">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={snapshot.busy || snapshot.scheduled}
                  onChange={(event) => {
                    setAcknowledged(event.currentTarget.checked);
                  }}
                />
                <span>
                  {snapshot.plan.mode === "fresh"
                    ? t("freshRiskAccept")
                    : t("riskAccept")}
                </span>
              </label>
              <button
                type="button"
                className={
                  snapshot.plan.mode === "fresh"
                    ? "minke-data-home__button minke-data-home__button--primary"
                    : "minke-data-home__button minke-data-home__button--danger"
                }
                disabled={
                  !acknowledged ||
                  snapshot.busy ||
                  snapshot.scheduled
                }
                onClick={() => {
                  void runtime.schedule(
                    snapshot.plan?.targetPath ?? targetPath,
                    snapshot.plan?.mode ?? mode,
                  );
                }}
              >
                {snapshot.busy
                  ? t("scheduling")
                  : snapshot.plan.mode === "fresh"
                    ? t("activateFresh")
                    : t("migrate")}
              </button>
            </div>
          )}

          {snapshot.scheduled && (
            <p className="minke-data-home__status" role="status">
              {snapshot.plan?.mode === "fresh"
                ? t("freshScheduled")
                : t("scheduled")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ConflictDetails({
  total,
  paths,
  t,
}: {
  total: number;
  paths: readonly string[];
  t: DataHomeTranslate;
}): ReactNode {
  if (total === 0 || paths.length === 0) return null;
  const remaining = Math.max(0, total - paths.length);
  return (
    <details className="minke-data-home__conflicts">
      <summary>{t("conflictPaths")}</summary>
      <ul>
        {paths.map((path, index) => (
          <li key={`${path}:${String(index)}`}>
            <code>{path}</code>
          </li>
        ))}
        {remaining > 0 && (
          <li>{t("conflictMore", { files: remaining })}</li>
        )}
      </ul>
    </details>
  );
}

function TargetOption({
  checked,
  label,
  help,
  path,
  recommended = false,
  onSelect,
}: {
  checked: boolean;
  label: string;
  help?: string;
  path: string;
  recommended?: boolean;
  onSelect(): void;
}): ReactNode {
  return (
    <label className="minke-data-home__target">
      <input
        type="radio"
        name="minke-data-home-target"
        checked={checked}
        onChange={onSelect}
      />
      <span className="minke-data-home__target-copy">
        <span className="minke-data-home__target-heading">
          {label}
          {recommended && (
            <span className="minke-data-home__badge">Minke</span>
          )}
        </span>
        <code className="minke-data-home__target-path">{path}</code>
        {help !== undefined && (
          <span className="minke-data-home__help">{help}</span>
        )}
      </span>
    </label>
  );
}

function ModeOption({
  checked,
  label,
  help,
  badge,
  onSelect,
}: {
  checked: boolean;
  label: string;
  help: string;
  badge?: string;
  onSelect(): void;
}): ReactNode {
  return (
    <label className="minke-data-home__strategy">
      <input
        type="radio"
        name="minke-data-home-mode"
        checked={checked}
        onChange={onSelect}
      />
      <span className="minke-data-home__strategy-copy">
        <span className="minke-data-home__target-heading">
          {label}
          {badge !== undefined && (
            <span className="minke-data-home__badge">{badge}</span>
          )}
        </span>
        <span className="minke-data-home__help">{help}</span>
      </span>
    </label>
  );
}

function originLocaleKey(
  origin: DataHomeCandidateOrigin,
): DataHomeLocaleKey {
  switch (origin) {
    case "active":
      return "originActive";
    case "configured":
      return "originConfigured";
    case "minke":
      return "originMinke";
    case "environment":
      return "originEnvironment";
    case "default":
      return "originDefault";
  }
}

function errorLocaleKey(
  error: DataHomeSettingsErrorKind,
): DataHomeLocaleKey {
  switch (error) {
    case "unavailable":
      return "errorUnavailable";
    case "read":
      return "errorRead";
    case "choose":
      return "errorChoose";
    case "plan":
      return "errorPlan";
    case "fresh":
      return "errorFresh";
    case "schedule":
      return "errorSchedule";
  }
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${String(value)} B`;
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(1)} KiB`;
  }
  if (value < 1_024 * 1_024 * 1_024) {
    return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`;
  }
  return `${(value / (1_024 * 1_024 * 1_024)).toFixed(1)} GiB`;
}
