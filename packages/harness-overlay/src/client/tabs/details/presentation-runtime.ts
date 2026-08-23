/**
 * In-memory handoff between the Harness presentation slot and the managed
 * Details tab. It deliberately owns no DOM lookup or global event protocol.
 */
export class DetailsPresentationRuntime {
  #target: HTMLElement | null = null;
  readonly #listeners = new Set<() => void>();

  readonly getSnapshot = (): HTMLElement | null => this.#target;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setTarget(target: HTMLElement | null): void {
    if (this.#target === target) return;
    this.#target = target;
    for (const listener of this.#listeners) listener();
  }
}
