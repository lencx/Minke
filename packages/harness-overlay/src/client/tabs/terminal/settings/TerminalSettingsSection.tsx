import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  DEFAULT_TERMINAL_SETTINGS,
  parseTerminalSettings,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_MIN,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import type {
  TerminalTabsTranslate,
} from "@minke/harness-overlay/client/tabs/terminal/locales.ts";
import type {
  TerminalSettingsRuntime,
} from "./runtime.ts";
import {
  stageDraftChange,
  type SettingField,
  type TerminalSettingDrafts,
} from "./drafts.ts";

export interface TerminalSettingsSectionProps {
  runtime?: TerminalSettingsRuntime;
  t?: TerminalTabsTranslate;
}

/** Settings section for the small set of xterm rendering preferences. */
export function TerminalSettingsSection({
  runtime,
  t,
}: TerminalSettingsSectionProps): ReactNode {
  if (runtime === undefined || t === undefined) return null;
  return <LoadedTerminalSettings runtime={runtime} t={t} />;
}

function LoadedTerminalSettings({
  runtime,
  t,
}: Required<TerminalSettingsSectionProps>): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [drafts, setDrafts] = useState<TerminalSettingDrafts>(() =>
    settingsToDrafts(snapshot.settings)
  );
  const [invalid, setInvalid] = useState<
    Partial<Record<SettingField, true>>
  >({});

  useEffect(() => {
    setDrafts(settingsToDrafts(snapshot.settings));
  }, [
    snapshot.settings.fontFamily,
    snapshot.settings.fontSize,
    snapshot.settings.lineHeight,
  ]);

  const commit = (field: SettingField): void => {
    if (!snapshot.editable) return;
    try {
      const value = settingFromDraft(
        field,
        drafts[field],
        snapshot.settings,
      );
      runtime.update({ [field]: value });
      setDrafts((current) => ({
        ...current,
        [field]: settingToDraft(field, value),
      }));
      setInvalid((current) => {
        const next = { ...current };
        Reflect.deleteProperty(next, field);
        return next;
      });
    } catch {
      setInvalid((current) => ({ ...current, [field]: true }));
    }
  };

  const cancelDraft = (field: SettingField): void => {
    setDrafts((current) => ({
      ...current,
      [field]: settingToDraft(field, snapshot.settings[field]),
    }));
    setInvalid((current) => {
      const next = { ...current };
      Reflect.deleteProperty(next, field);
      return next;
    });
  };

  const onFieldKeyDown = (
    field: SettingField,
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelDraft(field);
      event.currentTarget.blur();
    }
  };

  const preview = previewSettings(snapshot.settings, drafts);
  const usesDefaults = sameSettings(
    snapshot.settings,
    DEFAULT_TERMINAL_SETTINGS,
  );

  return (
    <section
      className="minke-terminal-settings"
      aria-labelledby="minke-terminal-settings-title"
      data-minke-terminal-settings
    >
      <div className="minke-terminal-settings__intro">
        <h2
          id="minke-terminal-settings-title"
          className="minke-terminal-settings__title"
        >
          {t("terminal.settings.title")}
        </h2>
        <p className="minke-terminal-settings__description">
          {t("terminal.settings.description")}
        </p>
        {snapshot.error !== undefined && (
          <p
            className="minke-terminal-settings__error"
            role="alert"
          >
            {t(`terminal.settings.error.${snapshot.error}`)}
          </p>
        )}
      </div>

      <div className="minke-terminal-settings__fields">
        <label className="minke-terminal-settings__row">
          <span className="minke-terminal-settings__copy">
            <span className="minke-terminal-settings__label">
              {t("terminal.settings.fontFamily.label")}
            </span>
            <span
              id="minke-terminal-settings-font-family-help"
              className="minke-terminal-settings__help"
            >
              {t("terminal.settings.fontFamily.help")}
            </span>
          </span>
          <span className="minke-terminal-settings__control">
            <input
              className="minke-terminal-settings__input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={drafts.fontFamily}
              placeholder={t(
                "terminal.settings.fontFamily.placeholder",
              )}
              disabled={!snapshot.editable}
              aria-describedby={[
                "minke-terminal-settings-font-family-help",
                invalid.fontFamily
                  ? "minke-terminal-settings-font-family-error"
                  : "",
              ].filter(Boolean).join(" ")}
              aria-invalid={invalid.fontFamily === true}
              onChange={(event) => {
                stageDraftChange(setDrafts, "fontFamily", event);
              }}
              onBlur={() => {
                commit("fontFamily");
              }}
              onKeyDown={(event) => {
                onFieldKeyDown("fontFamily", event);
              }}
            />
            {invalid.fontFamily && (
              <span
                id="minke-terminal-settings-font-family-error"
                className="minke-terminal-settings__validation"
                role="alert"
              >
                {t("terminal.settings.validation.fontFamily")}
              </span>
            )}
          </span>
        </label>

        <label className="minke-terminal-settings__row">
          <span className="minke-terminal-settings__copy">
            <span className="minke-terminal-settings__label">
              {t("terminal.settings.fontSize.label")}
            </span>
            <span
              id="minke-terminal-settings-font-size-help"
              className="minke-terminal-settings__help"
            >
              {t("terminal.settings.fontSize.help", {
                min: TERMINAL_FONT_SIZE_MIN,
                max: TERMINAL_FONT_SIZE_MAX,
              })}
            </span>
          </span>
          <span className="minke-terminal-settings__control">
            <input
              className="minke-terminal-settings__input minke-terminal-settings__input--number"
              type="number"
              inputMode="numeric"
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              step={1}
              value={drafts.fontSize}
              disabled={!snapshot.editable}
              aria-describedby={[
                "minke-terminal-settings-font-size-help",
                invalid.fontSize
                  ? "minke-terminal-settings-font-size-error"
                  : "",
              ].filter(Boolean).join(" ")}
              aria-invalid={invalid.fontSize === true}
              onChange={(event) => {
                stageDraftChange(setDrafts, "fontSize", event);
              }}
              onBlur={() => {
                commit("fontSize");
              }}
              onKeyDown={(event) => {
                onFieldKeyDown("fontSize", event);
              }}
            />
            {invalid.fontSize && (
              <span
                id="minke-terminal-settings-font-size-error"
                className="minke-terminal-settings__validation"
                role="alert"
              >
                {t("terminal.settings.validation.fontSize", {
                  min: TERMINAL_FONT_SIZE_MIN,
                  max: TERMINAL_FONT_SIZE_MAX,
                })}
              </span>
            )}
          </span>
        </label>

        <label className="minke-terminal-settings__row">
          <span className="minke-terminal-settings__copy">
            <span className="minke-terminal-settings__label">
              {t("terminal.settings.lineHeight.label")}
            </span>
            <span
              id="minke-terminal-settings-line-height-help"
              className="minke-terminal-settings__help"
            >
              {t("terminal.settings.lineHeight.help", {
                min: TERMINAL_LINE_HEIGHT_MIN.toFixed(2),
                max: TERMINAL_LINE_HEIGHT_MAX.toFixed(2),
              })}
            </span>
          </span>
          <span className="minke-terminal-settings__control">
            <input
              className="minke-terminal-settings__input minke-terminal-settings__input--number"
              type="number"
              inputMode="decimal"
              min={TERMINAL_LINE_HEIGHT_MIN}
              max={TERMINAL_LINE_HEIGHT_MAX}
              step={0.05}
              value={drafts.lineHeight}
              disabled={!snapshot.editable}
              aria-describedby={[
                "minke-terminal-settings-line-height-help",
                invalid.lineHeight
                  ? "minke-terminal-settings-line-height-error"
                  : "",
              ].filter(Boolean).join(" ")}
              aria-invalid={invalid.lineHeight === true}
              onChange={(event) => {
                stageDraftChange(setDrafts, "lineHeight", event);
              }}
              onBlur={() => {
                commit("lineHeight");
              }}
              onKeyDown={(event) => {
                onFieldKeyDown("lineHeight", event);
              }}
            />
            {invalid.lineHeight && (
              <span
                id="minke-terminal-settings-line-height-error"
                className="minke-terminal-settings__validation"
                role="alert"
              >
                {t("terminal.settings.validation.lineHeight", {
                  min: TERMINAL_LINE_HEIGHT_MIN.toFixed(2),
                  max: TERMINAL_LINE_HEIGHT_MAX.toFixed(2),
                })}
              </span>
            )}
          </span>
        </label>
      </div>

      <div className="minke-terminal-settings__preview">
        <span className="minke-terminal-settings__preview-label">
          {t("terminal.settings.preview")}
        </span>
        <code
          className="minke-terminal-settings__preview-code"
          style={{
            fontFamily:
              preview.fontFamily === ""
                ? "var(--ds-font-family-code)"
                : preview.fontFamily,
            fontSize: `${String(preview.fontSize)}px`,
            lineHeight: preview.lineHeight,
          }}
        >
          <span>$ echo "Hello, Minke"</span>
          <span>Hello, Minke</span>
        </code>
      </div>

      <div className="minke-terminal-settings__footer">
        <button
          type="button"
          className="minke-terminal-settings__reset"
          disabled={!snapshot.editable || usesDefaults}
          onClick={() => {
            setInvalid({});
            runtime.reset();
          }}
        >
          {t("terminal.settings.reset")}
        </button>
      </div>
    </section>
  );
}

function settingsToDrafts(
  settings: Readonly<TerminalSettings>,
): TerminalSettingDrafts {
  return {
    fontFamily: settings.fontFamily,
    fontSize: String(settings.fontSize),
    lineHeight: settings.lineHeight.toFixed(2),
  };
}

function settingToDraft(
  field: SettingField,
  value: TerminalSettings[SettingField],
): string {
  return field === "lineHeight"
    ? (value as number).toFixed(2)
    : String(value);
}

function settingsFromDrafts(
  drafts: TerminalSettingDrafts,
): TerminalSettings {
  return parseTerminalSettings({
    fontFamily: drafts.fontFamily,
    fontSize:
      drafts.fontSize.trim() === ""
        ? Number.NaN
        : Number(drafts.fontSize),
    lineHeight:
      drafts.lineHeight.trim() === ""
        ? Number.NaN
        : Number(drafts.lineHeight),
  });
}

function settingFromDraft(
  field: SettingField,
  draft: string,
  current: Readonly<TerminalSettings>,
): TerminalSettings[SettingField] {
  const value =
    field === "fontFamily"
      ? draft
      : draft.trim() === ""
        ? Number.NaN
        : Number(draft);
  const parsed = parseTerminalSettings({
    ...current,
    [field]: value,
  });
  return parsed[field];
}

function previewSettings(
  fallback: Readonly<TerminalSettings>,
  drafts: TerminalSettingDrafts,
): Readonly<TerminalSettings> {
  try {
    return settingsFromDrafts(drafts);
  } catch {
    return fallback;
  }
}

function sameSettings(
  left: Readonly<TerminalSettings>,
  right: Readonly<TerminalSettings>,
): boolean {
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight
  );
}
