import type {
  TabCreateOption,
  TabRenderer,
} from "./types.ts";

/** Renderer seam that lets web, terminal, and future content share one shell. */
export class TabRendererRegistry {
  readonly #renderers = new Map<string, TabRenderer>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  readonly getSnapshot = (): number => this.#revision;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  register(renderer: TabRenderer): () => void {
    if (this.#renderers.has(renderer.kind)) {
      throw new Error(`Tabs renderer already registered: ${renderer.kind}`);
    }
    this.#renderers.set(renderer.kind, renderer);
    this.#emit();
    return () => {
      if (this.#renderers.get(renderer.kind) === renderer) {
        this.#renderers.delete(renderer.kind);
        this.#emit();
      }
    };
  }

  get(kind: string): TabRenderer | undefined {
    return this.#renderers.get(kind);
  }

  creators(): readonly TabCreateOption[] {
    return [...this.#renderers.values()]
      .flatMap((renderer) => renderer.createOptions?.() ?? [])
      .sort((left, right) => {
        return (
          (left.order ?? 0) -
          (right.order ?? 0)
        );
      });
  }

  clear(): void {
    if (this.#renderers.size === 0) return;
    this.#renderers.clear();
    this.#emit();
  }

  #emit(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}
