import { useEffect, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import {
  formatShortcutBindingParts,
  shortcutBindingFromEvent,
  type ShortcutPlatform,
} from "./binding.ts";
import type { ShortcutTranslate } from "./locales.ts";
import type { ShortcutSectionState } from "./projection.ts";
import type {
  ShortcutMutationResult,
} from "./runtime.ts";
import {
  installShortcutRecordingEscapeGuard,
} from "./shortcut-recording.ts";

export interface ShortcutSectionProps {
  useShortcuts: <T>(
    selector: (state: ShortcutSectionState) => T,
  ) => T;
  platform: ShortcutPlatform;
  setBinding: (
    id: string,
    binding: string | null,
  ) => ShortcutMutationResult;
  resetBinding: (id: string) => ShortcutMutationResult;
  t: ShortcutTranslate;
}

/** Settings page contributed through Harness's public settings.section slot. */
export function ShortcutSection({
  useShortcuts,
  platform,
  setBinding,
  resetBinding,
  t,
}: ShortcutSectionProps): ReactNode {
  const state = useShortcuts((value) => value);
  const [recording, setRecording] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    id: string;
    other: string;
  } | null>(null);
  const labels = new Map(
    state.actions.map((action) => [action.id, action.label]),
  );

  useEffect(() => {
    if (recording === null) return;
    return installShortcutRecordingEscapeGuard(window, () => {
      setRecording(null);
      setConflict(null);
    });
  }, [recording]);

  const settle = (
    id: string,
    result: ShortcutMutationResult,
  ): void => {
    if (result.ok) {
      setConflict(null);
      setRecording(null);
    } else {
      setConflict({ id, other: result.conflictActionId });
    }
  };

  const record = (
    id: string,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setRecording(null);
      setConflict(null);
      return;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      settle(id, setBinding(id, null));
      return;
    }
    const binding = shortcutBindingFromEvent(event.nativeEvent, platform);
    if (binding !== null) {
      event.preventDefault();
      settle(id, setBinding(id, binding));
    }
  };

  return (
    <section
      className="minke-shortcuts"
      aria-labelledby="minke-shortcuts-title"
      data-minke-shortcuts
    >
      <div className="minke-shortcuts__intro">
        <h2
          id="minke-shortcuts-title"
          className="minke-shortcuts__title"
        >
          {t("title")}
        </h2>
        <p className="minke-shortcuts__description">{t("description")}</p>
        {state.error !== undefined && (
          <p className="minke-shortcuts__error" role="alert">
            {t(`error.${state.error}`)}
          </p>
        )}
      </div>
      <div className="minke-shortcuts__rows">
        {state.actions.map((action) => {
          const active = recording === action.id;
          const displayParts =
            action.binding === null
              ? undefined
              : formatShortcutBindingParts(action.binding, platform);
          const runtimeConflict = action.conflicts[0];
          const conflictId =
            conflict?.id === action.id
              ? conflict.other
              : runtimeConflict;
          const conflictText =
            conflictId === undefined
              ? undefined
              : t("conflict", {
                  action: labels.get(conflictId) ?? conflictId,
                });
          return (
            <div
              key={action.id}
              className="minke-shortcuts__row"
              data-shortcut-action={action.id}
            >
              <div className="minke-shortcuts__action">
                <span className="minke-shortcuts__action-label">
                  {action.label}
                </span>
                {conflictText !== undefined && (
                  <span
                    className="minke-shortcuts__conflict"
                    role="alert"
                  >
                    {conflictText}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={[
                  "minke-shortcuts__binding",
                  active
                    ? "minke-shortcuts__binding--recording"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={`${t("record")}: ${action.label}`}
                aria-pressed={active}
                disabled={!action.editable}
                onClick={() => {
                  setConflict(null);
                  setRecording(active ? null : action.id);
                }}
                onKeyDown={
                  active
                    ? (event) => {
                        record(action.id, event);
                      }
                    : undefined
                }
              >
                {active ? (
                  t("recording")
                ) : displayParts === undefined ? (
                  t("unassigned")
                ) : (
                  <span className="minke-shortcuts__keycaps">
                    {displayParts.map((key, index) => (
                      <kbd
                        key={`${key}-${String(index)}`}
                        className="minke-shortcuts__key"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="minke-shortcuts__reset"
                disabled={!action.editable || !action.overridden}
                onClick={() => {
                  settle(action.id, resetBinding(action.id));
                }}
              >
                {t("reset")}
              </button>
              {active && (
                <span className="minke-shortcuts__hint">
                  {t("disableHint")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
