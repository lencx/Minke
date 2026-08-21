import type {
  TabsRuntime,
} from "../runtime.ts";
import {
  DSH_DETAILS_STATE_EVENT,
  readDshDetailsState,
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

interface DetailsStateEventHost extends EventTarget {
  readonly [DSH_DETAILS_STATE_KEY: string]: unknown;
}

interface DetailsLayoutOpenHost {
  openDetails(): void;
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
    const current =
      this.#tabId === undefined
        ? undefined
        : this.#runtime.tab(this.#tabId);
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

export function installDetailsTabsBridge(
  controller: DetailsTabsController,
  host: DetailsStateEventHost = window as unknown as DetailsStateEventHost,
): () => void {
  const reconcile = (): void => {
    const state = readDshDetailsState(host);
    if (state !== undefined) controller.accept(state);
  };
  host.addEventListener(DSH_DETAILS_STATE_EVENT, reconcile);
  reconcile();
  return () => {
    host.removeEventListener(DSH_DETAILS_STATE_EVENT, reconcile);
    controller.dispose();
  };
}

/**
 * Route the public layout.openDetails() compatibility seam through the
 * managed Details tab. A producer without a selected call cannot create a
 * useful Details surface, so its empty host-track open is intentionally
 * suppressed. An unpatched/older DSH runtime has no state snapshot and keeps
 * the original behavior.
 */
export function installDetailsLayoutOpenBridge(
  layout: DetailsLayoutOpenHost,
  controller: DetailsTabsController,
  host: DetailsStateEventHost = window as unknown as DetailsStateEventHost,
): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(
    layout,
    "openDetails",
  );
  const original = layout.openDetails;
  const intercepted = (): void => {
    const state = readDshDetailsState(host);
    if (state === undefined) {
      Reflect.apply(original, layout, []);
      return;
    }
    controller.accept(state);
  };
  Object.defineProperty(layout, "openDetails", {
    configurable: true,
    enumerable: ownDescriptor?.enumerable ?? false,
    value: intercepted,
    writable: true,
  });
  return () => {
    if (layout.openDetails !== intercepted) return;
    if (ownDescriptor === undefined) {
      delete (layout as Partial<DetailsLayoutOpenHost>).openDetails;
      return;
    }
    Object.defineProperty(layout, "openDetails", ownDescriptor);
  };
}
