/** Browser-style back/forward history for Harness session selection. */

export type OpenSession = (sessionId: string) => void;

export class SessionNavigationHistory {
  readonly #open: OpenSession;
  readonly #entries: string[] = [];
  #index = -1;
  #current: string | undefined;
  #expected: string | undefined;

  constructor(open: OpenSession) {
    this.#open = open;
  }

  /** Reconcile a Session selection made by any UI surface. */
  observe(sessionId: string | undefined): void {
    if (sessionId === this.#current) return;
    this.#current = sessionId;

    if (sessionId === undefined) {
      this.#expected = undefined;
      return;
    }
    if (sessionId === this.#expected) {
      this.#expected = undefined;
      return;
    }

    this.#expected = undefined;
    if (this.#entries[this.#index] === sessionId) return;
    this.#entries.splice(this.#index + 1);
    this.#entries.push(sessionId);
    this.#index = this.#entries.length - 1;
  }

  /** Return to the previous selected Session. */
  back(): boolean {
    return this.#moveTo(
      this.#current === undefined ? this.#index : this.#index - 1,
    );
  }

  /** Revisit the next Session after navigating backward. */
  forward(): boolean {
    return this.#moveTo(this.#index + 1);
  }

  #moveTo(index: number): boolean {
    const target = this.#entries[index];
    if (target === undefined) return false;

    const previousIndex = this.#index;
    const previousCurrent = this.#current;
    this.#index = index;
    this.#expected = target;
    try {
      this.#open(target);
      if (this.#expected === target) {
        this.#current = target;
        this.#expected = undefined;
      }
      return true;
    } catch {
      this.#index = previousIndex;
      this.#current = previousCurrent;
      this.#expected = undefined;
      return false;
    }
  }
}
