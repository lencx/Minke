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
import {
  isPluginTab,
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
  readonly #revisions = new Map<string, number>();
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    installer: PluginInstallerPort,
    desktop: DesktopTabsPort,
  ) {
    this.#tabs = tabs;
    this.#installer = installer;
    this.#desktop = desktop;
  }

  create(title: string): string | undefined {
    if (this.#disposed || !this.#installer.available) {
      return undefined;
    }
    return this.#tabs.open<PluginTabPayload>({
      kind: "plugin-catalog",
      key: "plugins",
      title,
      payload: { installing: false },
    });
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
    });
    try {
      await this.#installer.install(command);
      if (!this.#isCurrent(tabId, revision)) return;
      this.#update(tabId, {
        installing: false,
        attemptedCommand: command,
        installedCommand: command,
      });
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revisions.clear();
  }

  #isCurrent(tabId: string, revision: number): boolean {
    return (
      !this.#disposed &&
      this.#revisions.get(tabId) === revision &&
      this.#tabs.tab(tabId) !== undefined
    );
  }

  #update(tabId: string, payload: PluginTabPayload): void {
    if (this.#disposed) return;
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isPluginTab(tab)) return;
    this.#tabs.update(tabId, { payload });
  }
}
