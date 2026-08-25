import type {
  ReactNode,
} from "react";

export type MinkeSettingsPageIcon =
  | "preferences"
  | "browser"
  | "shortcuts"
  | "data-home";

export interface MinkeSettingsPage {
  readonly id: string;
  readonly order: number;
  readonly label: () => string;
  readonly icon: MinkeSettingsPageIcon;
  /**
   * Keep the page mounted after it has been visited.
   * Disable this for transient interaction modes that own global listeners.
   */
  readonly keepAlive?: boolean;
  readonly render: () => ReactNode;
}

export interface MinkeSettingsSnapshot {
  readonly activeId: string | undefined;
  readonly pages: readonly MinkeSettingsPage[];
  readonly revision: number;
}

function comparePages(
  left: MinkeSettingsPage,
  right: MinkeSettingsPage,
): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

/**
 * Owns the unified Minke Settings directory and active secondary tab.
 *
 * Feature installers retain their settings runtimes and contribute only a
 * render seam, while the existing DSH Settings shell owns modal behavior.
 */
export class MinkeSettingsRuntime {
  #pages = new Map<string, MinkeSettingsPage>();
  #selectedId: string | undefined;
  #snapshot: MinkeSettingsSnapshot = Object.freeze({
    activeId: undefined,
    pages: Object.freeze([]),
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #disposed = false;

  getSnapshot = (): MinkeSettingsSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  register(page: MinkeSettingsPage): () => void {
    if (this.#disposed) return () => {};
    const id = page.id.trim();
    if (id === "") {
      throw new Error("Minke Settings page ids must not be empty");
    }
    if (this.#pages.has(id)) {
      throw new Error(`Minke Settings page "${id}" is already registered`);
    }
    const registered = Object.freeze({
      ...page,
      id,
    });
    this.#pages.set(id, registered);
    this.#publishDirectory();

    let active = true;
    return () => {
      if (!active || this.#disposed) return;
      active = false;
      this.#pages.delete(id);
      this.#publishDirectory();
    };
  }

  select = (id: string): void => {
    if (
      this.#disposed ||
      id === this.#snapshot.activeId ||
      !this.#snapshot.pages.some((page) => page.id === id)
    ) {
      return;
    }
    this.#selectedId = id;
    this.#publish({ activeId: id });
  };

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pages.clear();
    this.#listeners.clear();
  }

  #publishDirectory(): void {
    const pages = Object.freeze(
      [...this.#pages.values()].sort(comparePages),
    );
    if (
      this.#selectedId !== undefined &&
      !pages.some(({ id }) => id === this.#selectedId)
    ) {
      this.#selectedId = undefined;
    }
    const activeId = pages.some(
        ({ id }) => id === this.#selectedId,
      )
      ? this.#selectedId
      : pages[0]?.id;
    this.#publish({
      pages,
      activeId,
    });
  }

  #publish(
    patch: Partial<Omit<MinkeSettingsSnapshot, "revision">>,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
