import type {
  TabsLayoutPlacement,
  TabsLayoutState,
  TabsLayoutStateUpdate,
} from "@minke/harness-overlay/tabs/contract.ts";

export interface TabsLayoutStatePort {
  readLayoutState(): Promise<TabsLayoutState>;
  writeLayoutState(update: TabsLayoutStateUpdate): Promise<void>;
}

/** Shares one hydrated geometry snapshot between the independent panels. */
export class TabsLayoutStateRuntime {
  readonly #port: TabsLayoutStatePort;
  readonly #ready: Promise<void>;
  readonly #revisions = {
    bottom: 0,
    right: 0,
  };
  #state: TabsLayoutState = {};
  #disposed = false;

  constructor(port: TabsLayoutStatePort) {
    this.#port = port;
    const bottomRevision = this.#revisions.bottom;
    const rightRevision = this.#revisions.right;
    this.#ready = port
      .readLayoutState()
      .then((state) => {
        if (this.#disposed) return;
        this.#state = {
          ...(this.#revisions.right === rightRevision &&
          state.rightWidth !== undefined
            ? { rightWidth: state.rightWidth }
            : this.#state.rightWidth === undefined
              ? {}
              : { rightWidth: this.#state.rightWidth }),
          ...(this.#revisions.bottom === bottomRevision &&
          state.bottomHeight !== undefined
            ? { bottomHeight: state.bottomHeight }
            : this.#state.bottomHeight === undefined
              ? {}
              : { bottomHeight: this.#state.bottomHeight }),
        };
      })
      .catch(() => {
        // Tabs remains usable when best-effort layout hydration fails.
      });
  }

  async size(
    placement: TabsLayoutPlacement,
  ): Promise<number | undefined> {
    await this.#ready;
    return placement === "right"
      ? this.#state.rightWidth
      : this.#state.bottomHeight;
  }

  setSize(placement: TabsLayoutPlacement, size: number): void {
    if (this.#disposed) return;
    this.#revisions[placement] += 1;
    this.#state =
      placement === "right"
        ? { ...this.#state, rightWidth: size }
        : { ...this.#state, bottomHeight: size };
    void this.#port
      .writeLayoutState({ placement, size })
      .catch(() => {
        // A persistence failure never interrupts the active resize gesture.
      });
  }

  dispose(): void {
    this.#disposed = true;
  }
}
