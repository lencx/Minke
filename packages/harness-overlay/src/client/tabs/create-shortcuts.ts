import {
  TAB_CREATE_SHORTCUT_DESCRIPTORS,
  type TabCreateShortcutCreatorId,
} from "@minke/harness-overlay/shortcut-contract.ts";
import type {
  ShortcutPlatform,
} from "../shortcuts/binding.ts";
import type {
  TabsPanelPlacement,
} from "./constants.ts";

export interface TabCreateShortcutAction {
  readonly binding: string | null;
  readonly conflicts?: readonly string[];
  readonly id: string;
}

export interface TabCreateShortcutSource {
  readonly platform: ShortcutPlatform;
  listActions(): readonly TabCreateShortcutAction[];
  subscribe(listener: () => void): () => void;
}

const descriptorByKey = new Map(
  TAB_CREATE_SHORTCUT_DESCRIPTORS.map((descriptor) => [
    `${descriptor.placement}:${descriptor.creatorId}`,
    descriptor,
  ]),
);
const shortcutActionIds = new Set<string>(
  TAB_CREATE_SHORTCUT_DESCRIPTORS.map(
    (descriptor) => descriptor.actionId,
  ),
);

function bindingMapsEqual(
  left: ReadonlyMap<string, string | null>,
  right: ReadonlyMap<string, string | null>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(
      ([id, binding]) => right.get(id) === binding,
    )
  );
}

/**
 * Projects configurable shortcut actions into placement-specific tab
 * creation hints without coupling the Tabs surface to ShortcutRuntime.
 */
export class TabCreateShortcutBindings {
  #bindings = new Map<string, string | null>();
  #connection: object | undefined;
  #disposed = false;
  #listeners = new Set<() => void>();
  #platform: ShortcutPlatform = "other";
  #revision = 0;
  #sourceUnsubscribe: (() => void) | undefined;

  readonly getSnapshot = (): number => this.#revision;

  get platform(): ShortcutPlatform {
    return this.#platform;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  binding(
    placement: TabsPanelPlacement,
    creatorId: string,
  ): string | null | undefined {
    const descriptor = descriptorByKey.get(
      `${placement}:${creatorId}`,
    );
    return descriptor === undefined
      ? undefined
      : this.#bindings.get(descriptor.actionId);
  }

  connect(source: TabCreateShortcutSource): () => void {
    if (this.#disposed) return () => {};
    this.#detachSource();
    const connection = {};
    this.#connection = connection;
    this.#refresh(source);
    const unsubscribe = source.subscribe(() => {
      if (
        this.#disposed ||
        this.#connection !== connection
      ) return;
      this.#refresh(source);
    });
    if (
      this.#disposed ||
      this.#connection !== connection
    ) {
      unsubscribe();
    } else {
      this.#sourceUnsubscribe = unsubscribe;
    }
    return () => {
      if (this.#connection !== connection) return;
      this.disconnect();
    };
  }

  disconnect(): void {
    if (this.#disposed) return;
    this.#detachSource();
    if (this.#bindings.size === 0) return;
    this.#bindings = new Map();
    this.#publish();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#detachSource();
    this.#bindings.clear();
    this.#listeners.clear();
  }

  #detachSource(): void {
    this.#connection = undefined;
    const unsubscribe = this.#sourceUnsubscribe;
    this.#sourceUnsubscribe = undefined;
    unsubscribe?.();
  }

  #refresh(source: TabCreateShortcutSource): void {
    const nextBindings = new Map<string, string | null>();
    for (const action of source.listActions()) {
      if (shortcutActionIds.has(action.id)) {
        nextBindings.set(
          action.id,
          (action.conflicts?.length ?? 0) === 0
            ? action.binding
            : null,
        );
      }
    }
    const platformChanged = this.#platform !== source.platform;
    if (
      !platformChanged &&
      bindingMapsEqual(this.#bindings, nextBindings)
    ) {
      return;
    }
    this.#platform = source.platform;
    this.#bindings = nextBindings;
    this.#publish();
  }

  #publish(): void {
    this.#revision += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}

export type {
  TabCreateShortcutCreatorId,
};
