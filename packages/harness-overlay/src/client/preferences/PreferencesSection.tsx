import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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
  TerminalSettingsRuntime,
} from "../tabs/terminal/settings/runtime.ts";
import {
  stageDraftChange,
  type SettingField,
  type TerminalSettingDrafts,
} from "../tabs/terminal/settings/drafts.ts";
import {
  CODE_THEME_GROUPS,
  CODE_THEMES,
  codeThemeCssVariables,
  codeThemePalette,
} from "../tabs/files/code-themes.ts";
import type {
  CodeThemeSettingsRuntime,
} from "../tabs/files/code-theme-runtime.ts";
import type {
  FileManagerCodeTheme,
  FileManagerCodeThemeMode,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  PreferencesTranslate,
} from "./locales.ts";
import type {
  AppUpdateSettingsRuntime,
} from "./app-update-runtime.ts";
import type {
  WebSearchSettingsRuntime,
} from "./web-search-runtime.ts";

export interface PreferencesSectionProps {
  appUpdateSettings?: AppUpdateSettingsRuntime;
  webSearchSettings?: WebSearchSettingsRuntime;
  terminalSettings?: TerminalSettingsRuntime;
  codeThemes?: CodeThemeSettingsRuntime;
  t?: PreferencesTranslate;
}

/** One settings section for personal editor and Terminal preferences. */
export function PreferencesSection({
  appUpdateSettings,
  webSearchSettings,
  terminalSettings,
  codeThemes,
  t,
}: PreferencesSectionProps): ReactNode {
  if (
    t === undefined ||
    (
      appUpdateSettings === undefined &&
      webSearchSettings === undefined &&
      terminalSettings === undefined &&
      codeThemes === undefined
    )
  ) {
    return null;
  }
  return (
    <section
      className="minke-preferences"
      aria-labelledby="minke-preferences-title"
      data-minke-preferences
    >
      <div className="minke-preferences__intro">
        <h2
          id="minke-preferences-title"
          className="minke-preferences__title"
        >
          {t("preferences.title")}
        </h2>
        <p className="minke-preferences__description">
          {t("preferences.description")}
        </p>
      </div>
      {codeThemes !== undefined && (
        <CodeThemePreferences runtime={codeThemes} t={t} />
      )}
      {terminalSettings !== undefined && codeThemes !== undefined && (
        <ThemedTerminalPreferences
          runtime={terminalSettings}
          codeThemes={codeThemes}
          t={t}
        />
      )}
      {terminalSettings !== undefined && codeThemes === undefined && (
        <TerminalPreferences
          runtime={terminalSettings}
          codeTheme="github-light-default"
          t={t}
        />
      )}
      {webSearchSettings !== undefined && (
        <WebSearchPreferences
          runtime={webSearchSettings}
          t={t}
        />
      )}
      {appUpdateSettings !== undefined && (
        <AppUpdatePreferences
          runtime={appUpdateSettings}
          t={t}
        />
      )}
    </section>
  );
}

function WebSearchPreferences({
  runtime,
  t,
}: {
  readonly runtime: WebSearchSettingsRuntime;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const helpId = "minke-web-search-fallback-help";
  return (
    <section
      className="minke-preferences__group"
      aria-labelledby="minke-web-search-settings-title"
      data-minke-web-search-settings
    >
      <div className="minke-preferences__group-heading">
        <h3 id="minke-web-search-settings-title">
          {t("preferences.webSearch.title")}
        </h3>
        <p>{t("preferences.webSearch.description")}</p>
        {snapshot.error !== undefined && (
          <p className="minke-preferences__error" role="alert">
            {t(
              `preferences.webSearch.error.${snapshot.error}`,
            )}
          </p>
        )}
      </div>
      <div className="minke-preferences__fields">
        <label className="minke-preferences__row">
          <span className="minke-preferences__copy">
            <span className="minke-preferences__label">
              {t("preferences.webSearch.fallback.label")}
            </span>
            <span
              id={helpId}
              className="minke-preferences__help"
            >
              {t("preferences.webSearch.fallback.help")}
            </span>
          </span>
          <span className="minke-preferences__control">
            <span className="minke-preferences__switch">
              <input
                type="checkbox"
                checked={snapshot.settings.fallbackEnabled}
                disabled={!snapshot.editable}
                aria-label={t(
                  "preferences.webSearch.fallback.label",
                )}
                aria-describedby={helpId}
                onChange={(event) => {
                  runtime.setFallbackEnabled(
                    event.currentTarget.checked,
                  );
                }}
              />
              <span aria-hidden="true" />
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

function AppUpdatePreferences({
  runtime,
  t,
}: {
  readonly runtime: AppUpdateSettingsRuntime;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  return (
    <section
      className="minke-preferences__group"
      aria-labelledby="minke-app-update-settings-title"
      data-minke-app-update-settings
    >
      <div className="minke-preferences__group-heading">
        <h3 id="minke-app-update-settings-title">
          {t("preferences.update.title")}
        </h3>
        <p>{t("preferences.update.description")}</p>
        {snapshot.error !== undefined && (
          <p className="minke-preferences__error" role="alert">
            {t(`preferences.update.error.${snapshot.error}`)}
          </p>
        )}
      </div>
      <div className="minke-preferences__fields">
        <label className="minke-preferences__row">
          <span className="minke-preferences__copy">
            <span className="minke-preferences__label">
              {t("preferences.update.autoDownload.label")}
            </span>
            <span className="minke-preferences__help">
              {t("preferences.update.autoDownload.help")}
            </span>
          </span>
          <span className="minke-preferences__control">
            <span className="minke-preferences__switch">
              <input
                type="checkbox"
                checked={snapshot.settings.autoDownload}
                disabled={!snapshot.editable}
                aria-label={t(
                  "preferences.update.autoDownload.label",
                )}
                onChange={(event) => {
                  runtime.setAutoDownload(
                    event.currentTarget.checked,
                  );
                }}
              />
              <span aria-hidden="true" />
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

function CodeThemePreferences({
  runtime,
  t,
}: {
  readonly runtime: CodeThemeSettingsRuntime;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  return (
    <section
      className="minke-preferences__group"
      aria-labelledby="minke-preferences-code-title"
    >
      <div className="minke-preferences__group-heading">
        <h3 id="minke-preferences-code-title">
          {t("preferences.code.title")}
        </h3>
        <p>{t("preferences.code.description")}</p>
        {snapshot.error !== undefined && (
          <p className="minke-preferences__error" role="alert">
            {t(`preferences.code.error.${snapshot.error}`)}
          </p>
        )}
      </div>
      <div className="minke-preferences__fields">
        {CODE_THEME_MODES.map((colorScheme) => (
          <CodeThemePreferenceRow
            key={colorScheme}
            colorScheme={colorScheme}
            theme={snapshot.themes[colorScheme]}
            editable={snapshot.editable}
            runtime={runtime}
            t={t}
          />
        ))}
      </div>
      <div className="minke-preferences__code-previews">
        {CODE_THEME_MODES.map((colorScheme) => (
          <CodeThemePreview
            key={colorScheme}
            colorScheme={colorScheme}
            theme={snapshot.themes[colorScheme]}
            active={snapshot.colorScheme === colorScheme}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

const CODE_THEME_MODES = ["light", "dark"] as const;

function CodeThemePreferenceRow({
  colorScheme,
  theme,
  editable,
  runtime,
  t,
}: {
  readonly colorScheme: FileManagerCodeThemeMode;
  readonly theme: FileManagerCodeTheme;
  readonly editable: boolean;
  readonly runtime: CodeThemeSettingsRuntime;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const helpId = `minke-preferences-code-theme-${colorScheme}-help`;
  const labelKey =
    colorScheme === "light"
      ? "preferences.codeTheme.light.label"
      : "preferences.codeTheme.dark.label";
  const helpKey =
    colorScheme === "light"
      ? "preferences.codeTheme.light.help"
      : "preferences.codeTheme.dark.help";

  return (
    <label
      className="minke-preferences__row"
      data-code-theme-slot={colorScheme}
    >
      <span className="minke-preferences__copy">
        <span className="minke-preferences__label">
          {t(labelKey)}
        </span>
        <span
          id={helpId}
          className="minke-preferences__help"
        >
          {t(helpKey)}
        </span>
      </span>
      <span className="minke-preferences__control">
        <select
          className="minke-preferences__input minke-preferences__select"
          value={theme}
          disabled={!editable}
          aria-describedby={helpId}
          onChange={(event) => {
            const selectedTheme = CODE_THEMES.find(
              ({ id }) => id === event.currentTarget.value,
            )?.id;
            if (selectedTheme !== undefined) {
              runtime.update(colorScheme, selectedTheme);
            }
          }}
        >
          {CODE_THEME_GROUPS.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.themes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.variantName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </span>
    </label>
  );
}

function CodeThemePreview({
  colorScheme,
  theme,
  active,
  t,
}: {
  readonly colorScheme: FileManagerCodeThemeMode;
  readonly theme: FileManagerCodeTheme;
  readonly active: boolean;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const palette = codeThemePalette(theme);
  const selectedTheme =
    CODE_THEMES.find(({ id }) => id === theme) ?? CODE_THEMES[0];
  const mode =
    colorScheme === "light"
      ? t("preferences.codeTheme.light.label")
      : t("preferences.codeTheme.dark.label");
  const previewStyle = {
    ...codeThemeCssVariables(theme),
    colorScheme: palette.colorScheme,
  } as CSSProperties;

  return (
    <div
      className="minke-preferences__code-preview"
      data-appearance={colorScheme}
      data-code-theme={theme}
      data-color-scheme={palette.colorScheme}
      data-active={active}
      style={previewStyle}
    >
      <div className="minke-preferences__preview-heading">
        <span className="minke-preferences__preview-label">
          {t("preferences.codeTheme.preview", {
            mode,
            theme: selectedTheme.name,
          })}
        </span>
        {active && (
          <span className="minke-preferences__active-badge">
            {t("preferences.codeTheme.active")}
          </span>
        )}
      </div>
      <code>
        <span style={{ color: palette.keyword }}>const</span>
        {" theme = "}
        <span style={{ color: palette.string }}>
          &quot;{theme}&quot;
        </span>
        {"; "}
        <span style={{ color: palette.comment }}>// Minke</span>
      </code>
    </div>
  );
}

function TerminalPreferences({
  runtime,
  codeTheme,
  t,
}: {
  readonly runtime: TerminalSettingsRuntime;
  readonly codeTheme: FileManagerCodeTheme;
  readonly t: PreferencesTranslate;
}): ReactNode {
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
  const codePalette = codeThemePalette(codeTheme);

  return (
    <section
      className="minke-preferences__group minke-terminal-settings"
      aria-labelledby="minke-terminal-settings-title"
      data-minke-terminal-settings
    >
      <div className="minke-preferences__group-heading">
        <h3 id="minke-terminal-settings-title">
          {t("preferences.terminal.title")}
        </h3>
        <p>{t("preferences.terminal.description")}</p>
        {snapshot.error !== undefined && (
          <p
            className="minke-preferences__error"
            role="alert"
          >
            {t(`preferences.terminal.error.${snapshot.error}`)}
          </p>
        )}
      </div>

      <div className="minke-terminal-settings__fields">
        <label className="minke-terminal-settings__row">
          <span className="minke-terminal-settings__copy">
            <span className="minke-terminal-settings__label">
              {t("preferences.terminal.fontFamily.label")}
            </span>
            <span
              id="minke-terminal-settings-font-family-help"
              className="minke-terminal-settings__help"
            >
              {t("preferences.terminal.fontFamily.help")}
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
                "preferences.terminal.fontFamily.placeholder",
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
                {t("preferences.terminal.validation.fontFamily")}
              </span>
            )}
          </span>
        </label>

        <label className="minke-terminal-settings__row">
          <span className="minke-terminal-settings__copy">
            <span className="minke-terminal-settings__label">
              {t("preferences.terminal.fontSize.label")}
            </span>
            <span
              id="minke-terminal-settings-font-size-help"
              className="minke-terminal-settings__help"
            >
              {t("preferences.terminal.fontSize.help", {
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
                {t("preferences.terminal.validation.fontSize", {
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
              {t("preferences.terminal.lineHeight.label")}
            </span>
            <span
              id="minke-terminal-settings-line-height-help"
              className="minke-terminal-settings__help"
            >
              {t("preferences.terminal.lineHeight.help", {
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
                {t("preferences.terminal.validation.lineHeight", {
                  min: TERMINAL_LINE_HEIGHT_MIN.toFixed(2),
                  max: TERMINAL_LINE_HEIGHT_MAX.toFixed(2),
                })}
              </span>
            )}
          </span>
        </label>
      </div>

      <div
        className="minke-terminal-settings__preview"
        data-code-theme={codeTheme}
        data-color-scheme={codePalette.colorScheme}
        style={{
          ...codeThemeCssVariables(codeTheme),
          colorScheme: codePalette.colorScheme,
        } as CSSProperties}
      >
        <span className="minke-terminal-settings__preview-label">
          {t("preferences.terminal.preview")}
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
          <span>
            <span className="minke-terminal-settings__preview-prompt">
              $
            </span>
            {" echo "}
            <span className="minke-terminal-settings__preview-string">
              &quot;Hello, Minke&quot;
            </span>
          </span>
          <span className="minke-terminal-settings__preview-output">
            Hello, Minke
          </span>
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
          {t("preferences.terminal.reset")}
        </button>
      </div>
    </section>
  );
}

function ThemedTerminalPreferences({
  runtime,
  codeThemes,
  t,
}: {
  readonly runtime: TerminalSettingsRuntime;
  readonly codeThemes: CodeThemeSettingsRuntime;
  readonly t: PreferencesTranslate;
}): ReactNode {
  const codeThemeSnapshot = useSyncExternalStore(
    codeThemes.subscribe,
    codeThemes.getSnapshot,
    codeThemes.getSnapshot,
  );
  return (
    <TerminalPreferences
      runtime={runtime}
      codeTheme={codeThemeSnapshot.theme}
      t={t}
    />
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
