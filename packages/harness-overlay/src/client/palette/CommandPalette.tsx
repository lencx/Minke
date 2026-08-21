import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ShortcutPlatform } from "../shortcuts/binding.ts";
import { CommandPaletteActionList } from "./ActionList.tsx";
import type { PaletteTranslate } from "./locales.ts";
import type { CommandPaletteRuntime } from "./runtime.ts";

const LISTBOX_ID = "minke-command-palette-results";

export interface CommandPaletteProps {
  runtime: CommandPaletteRuntime;
  platform: ShortcutPlatform;
  t: PaletteTranslate;
}

export function CommandPalette({
  runtime,
  platform,
  t,
}: CommandPaletteProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => runtime.onBeforeClose(() => {
    const target = returnFocusRef.current;
    if (target?.isConnected) target.focus();
    returnFocusRef.current = null;
  }), [runtime]);

  useEffect(() => {
    if (!snapshot.open) return;
    const activeElement = document.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : null;
    inputRef.current?.focus();
    return () => {
      returnFocusRef.current = null;
    };
  }, [snapshot.open]);

  useEffect(() => {
    const active = snapshot.activeId === undefined
      ? undefined
      : document.getElementById(`minke-command-${snapshot.activeId}`);
    active?.scrollIntoView({ block: "nearest" });
  }, [snapshot.activeId]);

  if (!snapshot.open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      runtime.moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      runtime.execute();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      runtime.close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="minke-command-palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) runtime.close();
      }}
    >
      <div
        className="minke-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("search.label")}
        onKeyDown={onKeyDown}
      >
        <div className="minke-command-palette__search">
          <input
            ref={inputRef}
            className="minke-command-palette__input"
            type="text"
            role="combobox"
            aria-label={t("search.label")}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={LISTBOX_ID}
            aria-activedescendant={snapshot.activeId === undefined
              ? undefined
              : `minke-command-${snapshot.activeId}`}
            placeholder={t("search.placeholder")}
            value={snapshot.query}
            onChange={(event) => runtime.setQuery(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div
          id={LISTBOX_ID}
          className="minke-command-palette__results"
          role="listbox"
          aria-label={t("search.label")}
        >
          {snapshot.results.length === 0
            ? (
              <div className="minke-command-palette__empty" role="status">
                {t("empty")}
              </div>
            )
            : (
              <CommandPaletteActionList
                actions={snapshot.results}
                activeId={snapshot.activeId}
                grouped={snapshot.query.trim() === ""}
                platform={platform}
                runtime={runtime}
                t={t}
              />
            )}
        </div>
        <div className="minke-command-palette__footer" aria-hidden="true">
          <span><kbd>↑↓</kbd> {t("hint.navigate")}</span>
          <span><kbd>↵</kbd> {t("hint.select")}</span>
          <span><kbd>Esc</kbd> {t("hint.close")}</span>
        </div>
      </div>
    </div>
  );
}
