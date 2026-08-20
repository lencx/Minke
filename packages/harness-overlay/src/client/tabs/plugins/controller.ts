import {
  parsePluginInstallCommand,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  DesktopTabsPort,
  PluginInstallerPort,
} from "@minke/harness-overlay/client/desktop/index.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import type {
  WebTabsController,
} from "@minke/harness-overlay/client/tabs/web/controller.ts";
import {
  isPluginTab,
  type PluginView,
  type PluginTabPayload,
} from "./types.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Command installation state layered over the generic Tabs runtime. */
export class PluginTabsController {
  readonly #tabs: TabsRuntime;
  readonly #installer: PluginInstallerPort;
  readonly #desktop: DesktopTabsPort;
  readonly #webTabs: Pick<WebTabsController, "open">;
  readonly #revisions = new Map<string, number>();
  readonly #listRevisions = new Map<string, number>();
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    installer: PluginInstallerPort,
    desktop: DesktopTabsPort,
    webTabs: Pick<WebTabsController, "open">,
  ) {
    this.#tabs = tabs;
    this.#installer = installer;
    this.#desktop = desktop;
    this.#webTabs = webTabs;
  }

  create(title: string): string | undefined {
    if (this.#disposed || !this.#installer.available) {
      return undefined;
    }
    const tabId = this.#tabs.open<PluginTabPayload>({
      kind: "plugin-catalog",
      key: "plugins",
      title,
      payload: {
        view: "installed",
        installing: false,
        loadingInstalled: true,
        installedPlugins: [],
      },
    });
    if (tabId !== undefined) {
      void this.refreshInstalled(tabId);
    }
    return tabId;
  }

  setView(tabId: string, view: PluginView): void {
    this.#update(tabId, { view });
  }

  async refreshInstalled(tabId: string): Promise<void> {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginTab(tab)) return;
    const revision =
      (this.#listRevisions.get(tabId) ?? 0) + 1;
    this.#listRevisions.set(tabId, revision);
    this.#update(tabId, {
      loadingInstalled: true,
      installedError: undefined,
    });
    try {
      const snapshot = await this.#installer.readInstalled();
      if (!this.#isListCurrent(tabId, revision)) return;
      this.#update(tabId, {
        loadingInstalled: false,
        installedPlugins: snapshot.plugins,
        installedError: undefined,
      });
    } catch (error) {
      if (!this.#isListCurrent(tabId, revision)) return;
      this.#update(tabId, {
        loadingInstalled: false,
        installedError: errorMessage(error),
      });
    }
  }

  async install(tabId: string, candidate: string): Promise<void> {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isPluginTab(tab) ||
      tab.payload.installing
    ) {
      return;
    }
    let command: string;
    try {
      command = parsePluginInstallCommand(candidate).command;
    } catch (error) {
      this.#update(tabId, {
        installing: false,
        attemptedCommand: candidate,
        error: errorMessage(error),
      });
      return;
    }

    const revision = (this.#revisions.get(tabId) ?? 0) + 1;
    this.#revisions.set(tabId, revision);
    this.#update(tabId, {
      installing: true,
      attemptedCommand: command,
      error: undefined,
    });
    try {
      await this.#installer.install(command);
      if (!this.#isCurrent(tabId, revision)) return;
      this.#update(tabId, {
        view: "installed",
        installing: false,
        attemptedCommand: command,
        installedCommand: command,
        error: undefined,
      });
      await this.refreshInstalled(tabId);
    } catch (error) {
      if (!this.#isCurrent(tabId, revision)) return;
      this.#update(tabId, {
        installing: false,
        attemptedCommand: command,
        error: errorMessage(error),
      });
    }
  }

  openExternal(candidate: string): void {
    if (this.#disposed || !this.#desktop.available) return;
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) return;
    this.#desktop.openExternal(url);
  }

  openInTab(candidate: string): void {
    if (this.#disposed) return;
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) return;
    this.#webTabs.open(url);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revisions.clear();
    this.#listRevisions.clear();
  }

  #isCurrent(tabId: string, revision: number): boolean {
    return (
      !this.#disposed &&
      this.#revisions.get(tabId) === revision &&
      this.#tabs.tab(tabId) !== undefined
    );
  }

  #isListCurrent(tabId: string, revision: number): boolean {
    return (
      !this.#disposed &&
      this.#listRevisions.get(tabId) === revision &&
      this.#tabs.tab(tabId) !== undefined
    );
  }

  #update(
    tabId: string,
    patch: Partial<PluginTabPayload>,
  ): void {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginTab(tab)) return;
    this.#tabs.update(tabId, {
      payload: {
        ...tab.payload,
        ...patch,
      },
    });
  }
}
