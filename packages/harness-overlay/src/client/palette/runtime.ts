import type {
  PaletteActionView,
  ShortcutRuntime,
} from "../shortcuts/runtime.ts";
import { searchPaletteActions } from "./search.ts";

export interface CommandPaletteSnapshot {
  readonly open: boolean;
  readonly query: string;
  readonly results: readonly PaletteActionView[];
  readonly activeId: string | undefined;
}

type ActionSource = () => readonly PaletteActionView[];
type ActionInvoker = (id: string) => boolean;
type OpenGuard = () => boolean;

const EMPTY_SNAPSHOT: CommandPaletteSnapshot = Object.freeze({
  open: false,
  query: "",
  results: Object.freeze([]),
  activeId: undefined,
});

/** Owns the keyboard-oriented state machine for the global action palette. */
export class CommandPaletteRuntime {
  readonly #actions: ActionSource;
  readonly #invoke: ActionInvoker;
  readonly #canOpen: OpenGuard;
  readonly #listeners = new Set<() => void>();
  readonly #beforeCloseListeners = new Set<() => void>();
  #snapshot: CommandPaletteSnapshot = EMPTY_SNAPSHOT;

  constructor(
    actions: ActionSource,
    invoke: ActionInvoker,
    canOpen: OpenGuard = () => true,
  ) {
    this.#actions = actions;
    this.#invoke = invoke;
    this.#canOpen = canOpen;
  }

  getSnapshot = (): CommandPaletteSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  onBeforeClose(listener: () => void): () => void {
    this.#beforeCloseListeners.add(listener);
    return () => {
      this.#beforeCloseListeners.delete(listener);
    };
  }

  open(): void {
    if (!this.#canOpen()) return;
    const results = searchPaletteActions(this.#actions(), "");
    this.#publish({
      open: true,
      query: "",
      results,
      activeId: firstEnabledId(results),
    });
  }

  close(): void {
    if (!this.#snapshot.open) return;
    for (const listener of [...this.#beforeCloseListeners]) listener();
    this.#publish(EMPTY_SNAPSHOT);
  }

  toggle(): void {
    if (this.#snapshot.open) this.close();
    else this.open();
  }

  setQuery(query: string): void {
    if (!this.#snapshot.open || query === this.#snapshot.query) return;
    const results = searchPaletteActions(this.#actions(), query);
    this.#publish({
      open: true,
      query,
      results,
      activeId: firstEnabledId(results),
    });
  }

  refresh(): void {
    if (!this.#snapshot.open) return;
    const results = searchPaletteActions(
      this.#actions(),
      this.#snapshot.query,
    );
    const activeStillEnabled = results.some(
      (action) =>
        action.id === this.#snapshot.activeId &&
        action.disabledReason === undefined,
    );
    this.#publish({
      ...this.#snapshot,
      results,
      activeId: activeStillEnabled
        ? this.#snapshot.activeId
        : firstEnabledId(results),
    });
  }

  moveSelection(delta: -1 | 1): void {
    const enabled = this.#snapshot.results.filter(
      (action) => action.disabledReason === undefined,
    );
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex(
      (action) => action.id === this.#snapshot.activeId,
    );
    const nextIndex = currentIndex < 0
      ? (delta > 0 ? 0 : enabled.length - 1)
      : (currentIndex + delta + enabled.length) % enabled.length;
    this.#publish({
      ...this.#snapshot,
      activeId: enabled[nextIndex]?.id,
    });
  }

  select(id: string): void {
    const action = this.#snapshot.results.find(
      (candidate) => candidate.id === id,
    );
    if (action?.disabledReason !== undefined) return;
    if (action === undefined || id === this.#snapshot.activeId) return;
    this.#publish({ ...this.#snapshot, activeId: id });
  }

  execute(id = this.#snapshot.activeId): boolean {
    if (id === undefined) return false;
    const action = this.#snapshot.results.find(
      (candidate) => candidate.id === id,
    );
    if (action === undefined || action.disabledReason !== undefined) {
      return false;
    }
    this.close();
    return this.#invoke(id);
  }

  dispose(): void {
    this.#listeners.clear();
    this.#beforeCloseListeners.clear();
    this.#snapshot = EMPTY_SNAPSHOT;
  }

  #publish(snapshot: CommandPaletteSnapshot): void {
    this.#snapshot = Object.freeze({
      ...snapshot,
      results: Object.freeze([...snapshot.results]),
    });
    for (const listener of this.#listeners) listener();
  }
}

function firstEnabledId(
  actions: readonly PaletteActionView[],
): string | undefined {
  return actions.find(
    (action) => action.disabledReason === undefined,
  )?.id;
}

export function createCommandPaletteRuntime(
  actions: Pick<ShortcutRuntime, "listPaletteActions" | "invoke">,
  canOpen?: OpenGuard,
): CommandPaletteRuntime {
  return new CommandPaletteRuntime(
    () => actions.listPaletteActions(),
    (id) => actions.invoke(id),
    canOpen,
  );
}
