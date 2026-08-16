import type {
  ShortcutActionView,
  ShortcutErrorKind,
  ShortcutRuntime,
} from "./runtime.ts";

export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface LocaleRevisionSource {
  getSnapshot(): { revision: number };
  subscribe(listener: () => void): () => void;
}

export interface ShortcutSectionState {
  actions: readonly ShortcutActionView[];
  error: ShortcutErrorKind | undefined;
}

/**
 * Project runtime state and locale revision into one stable Settings source.
 * A language switch recomputes action labels even when no binding changed.
 */
export function createShortcutSectionSource(
  runtime: ShortcutRuntime,
  locale: LocaleRevisionSource,
): Observable<ShortcutSectionState> {
  let runtimeRevision = -1;
  let localeRevision = -1;
  let snapshot: ShortcutSectionState = Object.freeze({
    actions: [],
    error: undefined,
  });

  return {
    getSnapshot: () => {
      const nextRuntimeRevision = runtime.getSnapshot().revision;
      const nextLocaleRevision = locale.getSnapshot().revision;
      if (
        nextRuntimeRevision !== runtimeRevision ||
        nextLocaleRevision !== localeRevision
      ) {
        runtimeRevision = nextRuntimeRevision;
        localeRevision = nextLocaleRevision;
        snapshot = Object.freeze({
          actions: runtime.listActions(),
          error: runtime.error,
        });
      }
      return snapshot;
    },
    subscribe: (listener) => {
      const offRuntime = runtime.subscribe(listener);
      const offLocale = locale.subscribe(listener);
      return () => {
        offRuntime();
        offLocale();
      };
    },
  };
}
