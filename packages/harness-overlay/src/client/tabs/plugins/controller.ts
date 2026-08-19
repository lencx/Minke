import type {
  PluginCatalogSnapshot,
} from "@lencx/minke-plugin-catalog/contract";
import type {
  PluginCatalogPort,
} from "@minke/harness-overlay/client/desktop/index.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  PLUGIN_DISCOVERY_TOPIC_URL,
} from "./resources.ts";
import {
  isPluginCatalogTab,
  type PluginCatalogTabPayload,
} from "./types.ts";

const REFRESH_POLL_MS = 1_500;

export interface PluginCatalogWebTabs {
  open(candidate: string, title?: string): string | undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeRepositoryUrl(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Local catalog state and actions layered over the generic Tabs runtime. */
export class PluginCatalogTabsController {
  readonly #tabs: TabsRuntime;
  readonly #catalog: PluginCatalogPort;
  readonly #webTabs: PluginCatalogWebTabs;
  readonly #revisions = new Map<string, number>();
  readonly #pollTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    catalog: PluginCatalogPort,
    webTabs: PluginCatalogWebTabs,
  ) {
    this.#tabs = tabs;
    this.#catalog = catalog;
    this.#webTabs = webTabs;
  }

  create(title: string): string | undefined {
    if (this.#disposed || !this.#catalog.available) return undefined;
    const tabId = this.#tabs.open<PluginCatalogTabPayload>({
      kind: "plugin-catalog",
      key: "plugin-catalog",
      title,
      payload: {
        loading: true,
        refreshing: false,
        cancelling: false,
      },
    });
    if (tabId !== undefined) void this.read(tabId);
    return tabId;
  }

  async read(tabId: string): Promise<void> {
    await this.#run(tabId, "read");
  }

  async refresh(tabId: string): Promise<void> {
    await this.#run(tabId, "refresh");
  }

  async cancel(tabId: string): Promise<void> {
    await this.#run(tabId, "cancel");
  }

  async install(
    tabId: string,
    pluginId: string,
  ): Promise<void> {
    await this.#runMutation(
      tabId,
      { installingPluginId: pluginId },
      () => this.#catalog.install(pluginId),
    );
  }

  async saveToken(
    tabId: string,
    token: string,
  ): Promise<void> {
    const saved = await this.#runMutation(
      tabId,
      { credentialSaving: true },
      () => this.#catalog.setToken(token),
    );
    if (saved) void this.refresh(tabId);
  }

  async clearToken(tabId: string): Promise<void> {
    await this.#runMutation(
      tabId,
      { credentialSaving: true },
      () => this.#catalog.clearToken(),
    );
  }

  openDiscoveryResource(): void {
    if (this.#disposed) return;
    this.#webTabs.open(
      PLUGIN_DISCOVERY_TOPIC_URL,
      "GitHub plugin topic",
    );
  }

  openRepository(
    repositoryUrl: string,
    title?: string,
  ): void {
    if (this.#disposed) return;
    const url = safeRepositoryUrl(repositoryUrl);
    if (url !== undefined) this.#webTabs.open(url, title);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const timer of this.#pollTimers.values()) {
      clearTimeout(timer);
    }
    this.#pollTimers.clear();
    this.#revisions.clear();
  }

  async #run(
    tabId: string,
    operation: "cancel" | "read" | "refresh",
  ): Promise<void> {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginCatalogTab(tab)) return;
    const revision = (this.#revisions.get(tabId) ?? 0) + 1;
    this.#revisions.set(tabId, revision);
    this.#clearPoll(tabId);
    this.#update(tabId, {
      loading: tab.payload.snapshot === undefined,
      refreshing:
        operation !== "cancel" &&
        (operation === "refresh" || tab.payload.refreshing),
      cancelling: operation === "cancel",
      snapshot: tab.payload.snapshot,
    });
    try {
      const snapshot = operation === "refresh"
        ? await this.#catalog.refresh()
        : operation === "cancel"
          ? await this.#catalog.cancel()
          : await this.#catalog.read();
      if (!this.#isCurrent(tabId, revision)) return;
      this.#applySnapshot(tabId, snapshot);
    } catch (error) {
      if (!this.#isCurrent(tabId, revision)) return;
      this.#update(tabId, {
        loading: false,
        refreshing: false,
        cancelling: false,
        snapshot: tab.payload.snapshot,
        error: errorMessage(error),
      });
    }
  }

  async #runMutation(
    tabId: string,
    state:
      | { installingPluginId: string }
      | { credentialSaving: true },
    operation: () => Promise<PluginCatalogSnapshot>,
  ): Promise<boolean> {
    if (this.#disposed) return false;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginCatalogTab(tab)) {
      return false;
    }
    const revision = (this.#revisions.get(tabId) ?? 0) + 1;
    this.#revisions.set(tabId, revision);
    this.#clearPoll(tabId);
    this.#update(tabId, {
      loading: false,
      refreshing: tab.payload.refreshing,
      cancelling: false,
      snapshot: tab.payload.snapshot,
      ...state,
    });
    try {
      const snapshot = await operation();
      if (!this.#isCurrent(tabId, revision)) return false;
      this.#applySnapshot(tabId, snapshot);
      return true;
    } catch (error) {
      if (!this.#isCurrent(tabId, revision)) return false;
      this.#update(tabId, {
        loading: false,
        refreshing: false,
        cancelling: false,
        snapshot: tab.payload.snapshot,
        error: errorMessage(error),
      });
      return false;
    }
  }

  #applySnapshot(
    tabId: string,
    snapshot: PluginCatalogSnapshot,
  ): void {
    this.#update(tabId, {
      loading: false,
      refreshing: snapshot.refreshing,
      cancelling: false,
      snapshot,
      ...(snapshot.error === undefined
        ? {}
        : { error: snapshot.error }),
    });
    if (snapshot.refreshing) this.#schedulePoll(tabId);
  }

  #schedulePoll(tabId: string): void {
    this.#clearPoll(tabId);
    const timer = setTimeout(() => {
      this.#pollTimers.delete(tabId);
      if (
        this.#tabs.tab(tabId) !== undefined &&
        !this.#disposed
      ) {
        void this.read(tabId);
      }
    }, REFRESH_POLL_MS);
    this.#pollTimers.set(tabId, timer);
  }

  #clearPoll(tabId: string): void {
    const timer = this.#pollTimers.get(tabId);
    if (timer !== undefined) clearTimeout(timer);
    this.#pollTimers.delete(tabId);
  }

  #isCurrent(tabId: string, revision: number): boolean {
    return (
      !this.#disposed &&
      this.#revisions.get(tabId) === revision &&
      this.#tabs.tab(tabId) !== undefined
    );
  }

  #update(
    tabId: string,
    payload: PluginCatalogTabPayload,
  ): void {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginCatalogTab(tab)) return;
    this.#tabs.update(tabId, { payload });
  }
}
