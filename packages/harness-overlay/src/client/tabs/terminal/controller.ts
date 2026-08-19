import type {
  DesktopTerminalPort,
} from "@minke/harness-overlay/client/desktop/index.ts";
import type {
  TerminalEvent,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  isTerminalTab,
  type TerminalTabPayload,
} from "./types.ts";

const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;
const MAX_BUFFERED_OUTPUT = 256 * 1024;

export interface TerminalTabListener {
  data?(value: string): void;
  exit?(exitCode: number | undefined): void;
  error?(message: string): void;
}

function appendBounded(current: string, value: string): string {
  return `${current}${value}`.slice(-MAX_BUFFERED_OUTPUT);
}

/** Terminal-specific lifecycle layered over the content-agnostic Tabs core. */
export class TerminalTabsController {
  readonly #tabs: TabsRuntime;
  readonly #desktop: DesktopTerminalPort;
  readonly #sessionByTab = new Map<string, string>();
  readonly #tabBySession = new Map<string, string>();
  readonly #listeners = new Map<
    string,
    Set<TerminalTabListener>
  >();
  readonly #bufferByTab = new Map<string, string>();
  readonly #pendingBySession = new Map<
    string,
    TerminalEvent[]
  >();
  readonly #pendingWrites = new Map<string, string>();
  readonly #pendingResize = new Map<
    string,
    { cols: number; rows: number }
  >();
  readonly #unsubscribeTerminal: () => void;
  readonly #unsubscribeTabs: () => void;
  #nextId = 0;
  #disposed = false;

  constructor(tabs: TabsRuntime, desktop: DesktopTerminalPort) {
    this.#tabs = tabs;
    this.#desktop = desktop;
    this.#unsubscribeTerminal = desktop.subscribe(
      (event) => this.#receive(event),
    );
    this.#unsubscribeTabs = tabs.subscribe(
      () => this.#releaseClosedTabs(),
    );
  }

  create(cwd: string | undefined, title: string): string | undefined {
    if (this.#disposed || !this.#desktop.available) return undefined;
    const tabId = this.#tabs.open<TerminalTabPayload>({
      kind: "terminal",
      key: `terminal:${++this.#nextId}`,
      title,
      payload: {
        ...(cwd === undefined ? {} : { cwd }),
        status: "starting",
      },
    });
    if (tabId === undefined) return undefined;

    void this.#desktop
      .create({
        ...(cwd === undefined ? {} : { cwd }),
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      })
      .then(({ sessionId }) => {
        if (this.#disposed || this.#tabs.tab(tabId) === undefined) {
          this.#pendingBySession.delete(sessionId);
          this.#releaseTabState(tabId);
          this.#desktop.close(sessionId);
          return;
        }
        this.#sessionByTab.set(tabId, sessionId);
        this.#tabBySession.set(sessionId, tabId);
        this.#update(tabId, {
          sessionId,
          status: "running",
        });

        const pending = this.#pendingBySession.get(sessionId) ?? [];
        this.#pendingBySession.delete(sessionId);
        for (const event of pending) this.#receive(event);

        const input = this.#pendingWrites.get(tabId);
        this.#pendingWrites.delete(tabId);
        if (input !== undefined) {
          this.#desktop.write({ sessionId, data: input });
        }
        const resize = this.#pendingResize.get(tabId);
        this.#pendingResize.delete(tabId);
        if (resize !== undefined) {
          this.#desktop.resize({ sessionId, ...resize });
        }
      })
      .catch((error: unknown) => {
        if (this.#tabs.tab(tabId) === undefined) {
          this.#releaseTabState(tabId);
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        this.#update(tabId, {
          status: "error",
          error: message,
        });
        this.#notify(tabId, { type: "error", message });
      });
    return tabId;
  }

  subscribe(
    tabId: string,
    listener: TerminalTabListener,
  ): () => void {
    let listeners = this.#listeners.get(tabId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(tabId, listeners);
    }
    listeners.add(listener);
    const buffered = this.#bufferByTab.get(tabId);
    if (buffered !== undefined) {
      this.#bufferByTab.delete(tabId);
      listener.data?.(buffered);
    }
    return () => {
      const current = this.#listeners.get(tabId);
      current?.delete(listener);
      if (current?.size === 0) this.#listeners.delete(tabId);
    };
  }

  write(tabId: string, data: string): void {
    const sessionId = this.#sessionByTab.get(tabId);
    if (sessionId === undefined) {
      this.#pendingWrites.set(
        tabId,
        appendBounded(
          this.#pendingWrites.get(tabId) ?? "",
          data,
        ),
      );
      return;
    }
    this.#desktop.write({ sessionId, data });
  }

  resize(tabId: string, cols: number, rows: number): void {
    const sessionId = this.#sessionByTab.get(tabId);
    if (sessionId === undefined) {
      this.#pendingResize.set(tabId, { cols, rows });
      return;
    }
    this.#desktop.resize({ sessionId, cols, rows });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeTerminal();
    this.#unsubscribeTabs();
    for (const sessionId of this.#sessionByTab.values()) {
      this.#desktop.close(sessionId);
    }
    this.#sessionByTab.clear();
    this.#tabBySession.clear();
    this.#listeners.clear();
    this.#bufferByTab.clear();
    this.#pendingBySession.clear();
    this.#pendingWrites.clear();
    this.#pendingResize.clear();
  }

  #receive(event: TerminalEvent): void {
    const tabId = this.#tabBySession.get(event.sessionId);
    if (tabId === undefined) {
      const pending = this.#pendingBySession.get(event.sessionId) ?? [];
      pending.push(event);
      this.#pendingBySession.set(event.sessionId, pending.slice(-64));
      return;
    }
    if (event.type === "data") {
      this.#notify(tabId, event);
      return;
    }
    if (event.type === "error") {
      this.#update(tabId, {
        status: "error",
        error: event.message,
      });
      this.#notify(tabId, event);
      return;
    }
    this.#update(tabId, {
      status: "exited",
      exitCode: event.exitCode,
    });
    this.#notify(tabId, event);
    this.#sessionByTab.delete(tabId);
    this.#tabBySession.delete(event.sessionId);
  }

  #notify(
    tabId: string,
    event:
      | { type: "data"; data: string }
      | { type: "exit"; exitCode?: number }
      | { type: "error"; message: string },
  ): void {
    const listeners = this.#listeners.get(tabId);
    if (event.type === "data" && (listeners?.size ?? 0) === 0) {
      this.#bufferByTab.set(
        tabId,
        appendBounded(
          this.#bufferByTab.get(tabId) ?? "",
          event.data,
        ),
      );
      return;
    }
    for (const listener of listeners ?? []) {
      if (event.type === "data") listener.data?.(event.data);
      else if (event.type === "exit") {
        listener.exit?.(event.exitCode);
      } else {
        listener.error?.(event.message);
      }
    }
  }

  #update(
    tabId: string,
    patch: Partial<TerminalTabPayload>,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isTerminalTab(tab)) return;
    this.#tabs.update<TerminalTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        ...patch,
      },
    });
  }

  #releaseClosedTabs(): void {
    const trackedTabs = new Set([
      ...this.#sessionByTab.keys(),
      ...this.#listeners.keys(),
      ...this.#bufferByTab.keys(),
      ...this.#pendingWrites.keys(),
      ...this.#pendingResize.keys(),
    ]);
    for (const tabId of trackedTabs) {
      if (this.#tabs.tab(tabId) !== undefined) continue;
      const sessionId = this.#sessionByTab.get(tabId);
      if (sessionId !== undefined) {
        this.#desktop.close(sessionId);
        this.#sessionByTab.delete(tabId);
        this.#tabBySession.delete(sessionId);
        this.#pendingBySession.delete(sessionId);
      }
      this.#releaseTabState(tabId);
    }
  }

  #releaseTabState(tabId: string): void {
    this.#listeners.delete(tabId);
    this.#bufferByTab.delete(tabId);
    this.#pendingWrites.delete(tabId);
    this.#pendingResize.delete(tabId);
  }
}
