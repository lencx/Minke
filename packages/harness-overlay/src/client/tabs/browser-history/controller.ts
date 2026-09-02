import type {
  DesktopAgentBrowserPort,
} from "@minke/harness-overlay/client/desktop/contracts.ts";
import type {
  AgentBrowserOwner,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AGENT_BROWSER_HISTORY_DEFAULT_LIMIT,
  parseAgentBrowserHistoryClearRequest,
  parseAgentBrowserHistoryDeleteRequest,
  parseAgentBrowserHistoryReadRequest,
  parseAgentBrowserHistorySnapshot,
  type AgentBrowserHistoryCursor,
  type AgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import type {
  WebTabsController,
} from "@minke/harness-overlay/client/tabs/web/controller.ts";
import {
  BROWSER_HISTORY_TAB_KIND,
  type BrowserHistoryTabPayload,
} from "./types.ts";

export type BrowserHistorySource = Pick<
  DesktopAgentBrowserPort,
  "clearHistory" | "deleteHistory" | "readHistory"
>;

export type BrowserHistoryWebTabs = Pick<
  WebTabsController,
  "open"
>;

export type BrowserHistoryCursor = AgentBrowserHistoryCursor;

export interface BrowserHistoryReadOptions {
  readonly actor?: AgentBrowserOwner;
  readonly before?: BrowserHistoryCursor;
  readonly query?: string;
}

/** Owns the singleton History tab and its cross-tab navigation commands. */
export class BrowserHistoryTabsController {
  readonly #tabs: TabsRuntime;
  readonly #history: BrowserHistorySource;
  readonly #webTabs: BrowserHistoryWebTabs;

  constructor(
    tabs: TabsRuntime,
    history: BrowserHistorySource,
    webTabs: BrowserHistoryWebTabs,
  ) {
    this.#tabs = tabs;
    this.#history = history;
    this.#webTabs = webTabs;
  }

  create(title: string): string | undefined {
    return this.#tabs.open<BrowserHistoryTabPayload>({
      kind: BROWSER_HISTORY_TAB_KIND,
      key: "global",
      title,
      payload: { scope: "global" },
    });
  }

  openVisit(
    url: string,
    title?: string,
  ): string | undefined {
    return this.#webTabs.open(url, title);
  }

  async readRecent(
    actor?: AgentBrowserOwner,
  ): Promise<AgentBrowserHistorySnapshot> {
    return await this.readPage(
      actor === undefined ? {} : { actor },
    );
  }

  async readPage(
    options: BrowserHistoryReadOptions = {},
  ): Promise<AgentBrowserHistorySnapshot> {
    const request = parseAgentBrowserHistoryReadRequest({
      limit: AGENT_BROWSER_HISTORY_DEFAULT_LIMIT,
      ...(options.actor === undefined
        ? {}
        : { actor: options.actor }),
      ...(options.before === undefined
        ? {}
        : { before: options.before }),
      ...(options.query === undefined ||
        options.query.trim() === ""
        ? {}
        : { query: options.query.trim() }),
    });
    return parseAgentBrowserHistorySnapshot(
      await this.#history.readHistory(request),
    );
  }

  async clear(): Promise<AgentBrowserHistorySnapshot> {
    const request = parseAgentBrowserHistoryClearRequest({
      confirm: true,
    });
    return parseAgentBrowserHistorySnapshot(
      await this.#history.clearHistory(request),
    );
  }

  async deleteVisit(visitId: number): Promise<void> {
    await this.#history.deleteHistory(
      parseAgentBrowserHistoryDeleteRequest({ visitId }),
    );
  }
}
