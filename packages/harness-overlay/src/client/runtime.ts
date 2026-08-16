import {
  isShortcutBinding,
  type ShortcutBindings,
} from "../shortcut-contract.ts";
import {
  detectShortcutPlatform,
  shortcutBindingFromEvent,
  type ShortcutPlatform,
} from "./binding.ts";
import type { ShortcutStore } from "./bridge.ts";

export type ShortcutErrorKind = "unavailable" | "read" | "write";

export interface ShortcutAction {
  id: string;
  label: () => string;
  defaultBinding: string | null;
  order?: number;
  run: () => void;
}

export interface ShortcutActionView {
  id: string;
  label: string;
  defaultBinding: string | null;
  binding: string | null;
  overridden: boolean;
  editable: boolean;
  order: number;
  conflicts: readonly string[];
}

export interface ShortcutRuntimeSnapshot {
  revision: number;
}

export type ShortcutMutationResult =
  | { ok: true }
  | { ok: false; conflictActionId: string };

interface KeyboardTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
}

const ACTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

/**
 * Owns shortcut registration, collision handling, one keydown listener, and
 * the async desktop persistence port. Harness features remain upstream-clean;
 * Minke product actions register against this local runtime.
 */
export class ShortcutRuntime {
  readonly store: ShortcutStore;
  readonly target: KeyboardTarget | undefined;
  readonly platform: ShortcutPlatform;
  #actions = new Map<string, ShortcutAction>();
  #overrides: ShortcutBindings = {};
  #editable = false;
  #error: ShortcutErrorKind | undefined;
  #snapshot: ShortcutRuntimeSnapshot = Object.freeze({ revision: 0 });
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #initializePromise: Promise<void> | undefined;
  #disposed = false;
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    this.#dispatch(event);
  };

  constructor(
    store: ShortcutStore,
    target: KeyboardTarget | undefined =
      typeof document === "undefined" ? undefined : document,
    platform: ShortcutPlatform = detectShortcutPlatform(),
  ) {
    this.store = store;
    this.target = target;
    this.platform = platform;
    target?.addEventListener("keydown", this.#onKeyDown);
  }

  get editable(): boolean {
    return this.#editable;
  }

  get error(): ShortcutErrorKind | undefined {
    return this.#error;
  }

  getSnapshot(): ShortcutRuntimeSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Hydrate durable overrides exactly once. */
  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  register(action: ShortcutAction): () => void {
    if (!ACTION_ID_PATTERN.test(action.id)) {
      throw new Error(`invalid shortcut action id ${JSON.stringify(action.id)}`);
    }
    if (
      action.defaultBinding !== null &&
      !isShortcutBinding(action.defaultBinding)
    ) {
      throw new Error(
        `invalid default shortcut ${JSON.stringify(action.defaultBinding)}`,
      );
    }
    if (this.#actions.has(action.id)) {
      throw new Error(`duplicate shortcut action ${JSON.stringify(action.id)}`);
    }
    this.#actions.set(action.id, action);
    this.#publish();
    return () => {
      if (this.#actions.delete(action.id)) this.#publish();
    };
  }

  /** Run one registered action through the same path used by key events. */
  invoke(id: string): boolean {
    const action = this.#actions.get(id);
    if (action === undefined) return false;
    action.run();
    return true;
  }

  listActions(): readonly ShortcutActionView[] {
    const actions = [...this.#actions.values()];
    return actions
      .map((action): ShortcutActionView => {
        const binding = this.#effectiveBinding(action);
        const conflicts =
          binding === null
            ? []
            : actions
                .filter(
                  (candidate) =>
                    candidate.id !== action.id &&
                    this.#effectiveBinding(candidate) === binding,
                )
                .map((candidate) => candidate.id);
        return Object.freeze({
          id: action.id,
          label: action.label(),
          defaultBinding: action.defaultBinding,
          binding,
          overridden: Object.hasOwn(this.#overrides, action.id),
          editable: this.#editable,
          order: action.order ?? 0,
          conflicts: Object.freeze(conflicts),
        });
      })
      .sort(
        (left, right) =>
          left.order - right.order || left.label.localeCompare(right.label),
      );
  }

  setBinding(
    id: string,
    binding: string | null,
  ): ShortcutMutationResult {
    this.#assertEditable();
    const action = this.#requireAction(id);
    if (binding !== null && !isShortcutBinding(binding)) {
      throw new Error(`invalid shortcut binding ${JSON.stringify(binding)}`);
    }
    const conflict =
      binding === null
        ? undefined
        : [...this.#actions.values()].find(
            (candidate) =>
              candidate.id !== id &&
              this.#effectiveBinding(candidate) === binding,
          );
    if (conflict !== undefined) {
      return { ok: false, conflictActionId: conflict.id };
    }

    const next = { ...this.#overrides };
    if (binding === action.defaultBinding) {
      Reflect.deleteProperty(next, id);
    } else {
      next[id] = binding ?? "";
    }
    this.#commit(next);
    return { ok: true };
  }

  resetBinding(id: string): ShortcutMutationResult {
    this.#assertEditable();
    const action = this.#requireAction(id);
    const conflict =
      action.defaultBinding === null
        ? undefined
        : [...this.#actions.values()].find(
            (candidate) =>
              candidate.id !== id &&
              this.#effectiveBinding(candidate) === action.defaultBinding,
          );
    if (conflict !== undefined) {
      return { ok: false, conflictActionId: conflict.id };
    }
    if (!Object.hasOwn(this.#overrides, id)) return { ok: true };
    const next = { ...this.#overrides };
    Reflect.deleteProperty(next, id);
    this.#commit(next);
    return { ok: true };
  }

  /** Await queued persistence, primarily for deterministic shutdown/tests. */
  async flush(): Promise<void> {
    await this.#saveTail;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.target?.removeEventListener("keydown", this.#onKeyDown);
    this.#listeners.clear();
    this.#actions.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.store.available) {
      this.#error = "unavailable";
      this.#publish();
      return;
    }
    try {
      const bindings = await this.store.read();
      if (this.#disposed) return;
      this.#overrides = { ...bindings };
      this.#editable = true;
      this.#error = undefined;
      this.#publish();
    } catch {
      if (this.#disposed) return;
      this.#editable = false;
      this.#error = "read";
      this.#publish();
    }
  }

  #assertEditable(): void {
    if (!this.#editable) {
      throw new Error("shortcut settings are not editable");
    }
  }

  #requireAction(id: string): ShortcutAction {
    const action = this.#actions.get(id);
    if (action === undefined) {
      throw new Error(`unknown shortcut action ${JSON.stringify(id)}`);
    }
    return action;
  }

  #effectiveBinding(action: ShortcutAction): string | null {
    const override = this.#overrides[action.id];
    if (override === "") return null;
    if (override !== undefined && isShortcutBinding(override)) return override;
    return action.defaultBinding;
  }

  #commit(next: ShortcutBindings): void {
    if (shallowRecordEqual(next, this.#overrides)) return;
    this.#overrides = next;
    this.#error = undefined;
    this.#publish();

    const generation = ++this.#saveGeneration;
    const payload = { ...next };
    const operation = this.#saveTail.then(async () => {
      await this.store.write(payload);
    });
    this.#saveTail = operation.then(
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) return;
        if (this.#error === "write") {
          this.#error = undefined;
          this.#publish();
        }
      },
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) return;
        this.#error = "write";
        this.#publish();
      },
    );
  }

  #dispatch(event: KeyboardEvent): void {
    const binding = shortcutBindingFromEvent(event, this.platform);
    if (binding === null) return;
    const matches = [...this.#actions.values()].filter(
      (action) => this.#effectiveBinding(action) === binding,
    );
    const match = matches[0];
    if (matches.length !== 1 || match === undefined) return;
    event.preventDefault();
    this.invoke(match.id);
  }

  #publish(): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}

function shallowRecordEqual(
  left: ShortcutBindings,
  right: ShortcutBindings,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}
