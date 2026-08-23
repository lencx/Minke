import type {
  TabsRuntime,
} from "../runtime.ts";
import {
  type DshDetailsState,
} from "./contract.ts";

export const DETAILS_TAB_KIND = "details";
export const DETAILS_TAB_KEY = "dsh-details";

export interface DetailsTabPayload {
  readonly sessionId: string;
  readonly callId: string;
  readonly label: string;
  readonly title: string;
}

export interface DetailsTabsControllerOptions {
  readonly releaseHost: () => void;
  readonly schedule?: (task: () => void) => void;
}

function tabTitle(state: DshDetailsState): string {
  return state.title === state.label
    ? state.label
    : `${state.label} · ${state.title}`;
}

/**
 * One stateful adapter owns the native Details tab identity. DSH continues to
 * own selection, session snapshots, and plugin slots; this class owns only the
 * tab lifecycle and coalesces React cleanup/setup event pairs.
 */
export class DetailsTabsController {
  readonly #runtime: TabsRuntime;
  readonly #releaseHost: () => void;
  readonly #schedule: (task: () => void) => void;
  #pending: DshDetailsState | undefined;
  #scheduled = false;
  #tabId: string | undefined;
  #disposed = false;

  constructor(
    runtime: TabsRuntime,
    options: DetailsTabsControllerOptions,
  ) {
    this.#runtime = runtime;
    this.#releaseHost = options.releaseHost;
    const schedule = options.schedule ?? queueMicrotask;
    this.#schedule = (task) => schedule(task);
  }

  accept(state: DshDetailsState): void {
    if (this.#disposed) return;
    this.#pending = state;
    if (this.#scheduled) return;
    this.#scheduled = true;
    this.#schedule(() => {
      this.#scheduled = false;
      const pending = this.#pending;
      this.#pending = undefined;
      if (this.#disposed || pending === undefined) return;
      this.#reconcile(pending);
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = undefined;
  }

  #reconcile(state: DshDetailsState): void {
    const tracked =
      this.#tabId === undefined
        ? undefined
        : this.#runtime.tab(this.#tabId);
    const current =
      tracked?.kind === DETAILS_TAB_KIND &&
        tracked.key === DETAILS_TAB_KEY
        ? tracked
        : this.#runtime
          .getSnapshot()
          .tabs
          .find(
            (tab) =>
              tab.kind === DETAILS_TAB_KIND &&
              tab.key === DETAILS_TAB_KEY,
          );
    this.#tabId = current?.id;
    if (!state.open || state.callId === undefined) {
      if (current !== undefined) {
        this.#runtime.close(current.id);
      } else if (!this.#runtime.getSnapshot().visible) {
        this.#releaseHost();
      }
      this.#tabId = undefined;
      return;
    }

    const payload: DetailsTabPayload = Object.freeze({
      sessionId: state.sessionId,
      callId: state.callId,
      label: state.label,
      title: state.title,
    });
    if (current !== undefined) {
      this.#runtime.update(current.id, {
        title: tabTitle(state),
        payload,
      });
      this.#runtime.activate(current.id);
      return;
    }

    this.#tabId = this.#runtime.open({
      kind: DETAILS_TAB_KIND,
      key: DETAILS_TAB_KEY,
      title: tabTitle(state),
      payload,
    });
  }
}
