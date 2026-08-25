import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  BROWSER_USER_AGENT_MAX_LENGTH,
} from "@minke/harness-overlay/browser-settings-contract.ts";
import type {
  BrowserSettingsTranslate,
} from "./locales.ts";
import type {
  BrowserSettingsRuntime,
} from "./runtime.ts";
import {
  stageBrowserUserAgentChange,
  browserUserAgentDisplayValue,
  stageBrowserUserAgentDraft,
  type BrowserUserAgentField,
} from "./drafts.ts";

/** A standalone settings page for ordinary and Agent browser identities. */
export function BrowserSettingsSection({
  runtime,
  t,
}: {
  readonly runtime: BrowserSettingsRuntime;
  readonly t: BrowserSettingsTranslate;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [drafts, setDrafts] = useState(() => ({
    webUserAgent: browserUserAgentDisplayValue(
      snapshot.settings.webUserAgent,
      snapshot.automaticUserAgent,
    ),
    agentUserAgent: browserUserAgentDisplayValue(
      snapshot.settings.agentUserAgent,
      snapshot.automaticUserAgent,
    ),
  }));
  const [invalid, setInvalid] = useState<
    Partial<Record<BrowserUserAgentField, true>>
  >({});

  useEffect(() => {
    setDrafts({
      webUserAgent: browserUserAgentDisplayValue(
        snapshot.settings.webUserAgent,
        snapshot.automaticUserAgent,
      ),
      agentUserAgent: browserUserAgentDisplayValue(
        snapshot.settings.agentUserAgent,
        snapshot.automaticUserAgent,
      ),
    });
    setInvalid({});
  }, [
    snapshot.settings.webUserAgent,
    snapshot.settings.agentUserAgent,
    snapshot.automaticUserAgent,
  ]);

  const commit = (field: BrowserUserAgentField): void => {
    if (!snapshot.editable) return;
    const staged = stageBrowserUserAgentDraft(
      drafts[field],
      snapshot.automaticUserAgent,
    );
    try {
      runtime.setUserAgent(field, staged.configuredValue);
      setDrafts((current) => ({
        ...current,
        [field]: staged.displayValue,
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
  const reset = (field: BrowserUserAgentField): void => {
    if (!snapshot.editable) return;
    const staged = stageBrowserUserAgentDraft(
      "",
      snapshot.automaticUserAgent,
    );
    setDrafts((current) => ({
      ...current,
      [field]: staged.displayValue,
    }));
    setInvalid((current) => {
      const next = { ...current };
      Reflect.deleteProperty(next, field);
      return next;
    });
    runtime.setUserAgent(field, staged.configuredValue);
  };
  const cancel = (field: BrowserUserAgentField): void => {
    setDrafts((current) => ({
      ...current,
      [field]: browserUserAgentDisplayValue(
        snapshot.settings[field],
        snapshot.automaticUserAgent,
      ),
    }));
    setInvalid((current) => {
      const next = { ...current };
      Reflect.deleteProperty(next, field);
      return next;
    });
  };
  const handleKeyDown = (
    field: BrowserUserAgentField,
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel(field);
      event.currentTarget.blur();
    } else if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return (
    <section
      className="minke-browser-settings"
      aria-labelledby="minke-browser-settings-title"
      data-minke-browser-settings
    >
      <header className="minke-browser-settings__intro">
        <h2 id="minke-browser-settings-title">
          {t("browser.title")}
        </h2>
        <p>{t("browser.description")}</p>
        {snapshot.error !== undefined && (
          <p
            className="minke-browser-settings__error"
            role="alert"
          >
            {t(`browser.error.${snapshot.error}`)}
          </p>
        )}
      </header>

      <div className="minke-browser-settings__fields">
        {(
          [
            ["webUserAgent", "web"],
            ["agentUserAgent", "agent"],
          ] as const
        ).map(([field, target]) => {
          const helpId = `minke-browser-${target}-ua-help`;
          const editHintId =
            `minke-browser-${target}-ua-edit-hint`;
          const validationId =
            `minke-browser-${target}-ua-validation`;
          const isInvalid = invalid[field] === true;
          return (
            <label
              key={field}
              className="minke-browser-settings__field"
            >
              <span className="minke-browser-settings__copy">
                <span className="minke-browser-settings__label">
                  {t(`browser.${target}.label`)}
                </span>
                <span
                  id={helpId}
                  className="minke-browser-settings__help"
                >
                  {t(`browser.${target}.help`)}
                </span>
              </span>
              <span className="minke-browser-settings__control">
                <textarea
                  className="minke-browser-settings__input"
                  value={drafts[field]}
                  disabled={!snapshot.editable}
                  maxLength={BROWSER_USER_AGENT_MAX_LENGTH}
                  rows={3}
                  wrap="soft"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={isInvalid}
                  aria-describedby={
                    isInvalid
                      ? `${helpId} ${editHintId} ${validationId}`
                      : `${helpId} ${editHintId}`
                  }
                  onChange={(event) =>
                    stageBrowserUserAgentChange(
                      setDrafts,
                      field,
                      event,
                    )}
                  onBlur={() => commit(field)}
                  onKeyDown={(event) =>
                    handleKeyDown(field, event)}
                />
                <button
                  className="minke-browser-settings__reset"
                  type="button"
                  disabled={
                    !snapshot.editable ||
                    (
                      snapshot.settings[field] === "" &&
                      drafts[field] === snapshot.automaticUserAgent
                    )
                  }
                  onClick={() => reset(field)}
                >
                  {t("browser.reset")}
                </button>
              </span>
              <span
                id={editHintId}
                className="minke-browser-settings__edit-hint"
              >
                {t("browser.editHint")}
              </span>
              {isInvalid && (
                <span
                  id={validationId}
                  className="minke-browser-settings__error"
                  role="alert"
                >
                  {t("browser.validation")}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
