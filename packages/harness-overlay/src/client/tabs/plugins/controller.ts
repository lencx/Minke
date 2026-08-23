import {
  parsePluginInstallCommand,
  parsePluginUninstallTarget,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  DesktopTabsPort,
} from "@minke/harness-overlay/client/desktop/index.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import type {
  WebTabsController,
} from "@minke/harness-overlay/client/tabs/web/controller.ts";
import {
  isPluginTab,
  type PluginFeedback,
  type PluginOperation,
  type PluginTab,
  type PluginTabPayload,
  type PluginView,
} from "./types.ts";
import type {
  PluginLifecyclePort,
} from "./lifecycle.ts";

const IDLE = Object.freeze({
  kind: "idle",
}) satisfies PluginOperation;
const NO_FEEDBACK = Object.freeze({
  kind: "none",
}) satisfies PluginFeedback;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plugin management state layered over the generic Tabs runtime. */
export class PluginTabsController {
  readonly #tabs: TabsRuntime;
  readonly #lifecycle: PluginLifecyclePort;
  readonly #desktop: DesktopTabsPort;
  readonly #webTabs: Pick<WebTabsController, "open">;
  readonly #operationRevisions = new Map<string, number>();
  readonly #listRevisions = new Map<string, number>();
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    lifecycle: PluginLifecyclePort,
    desktop: DesktopTabsPort,
    webTabs: Pick<WebTabsController, "open">,
  ) {
    this.#tabs = tabs;
    this.#lifecycle = lifecycle;
    this.#desktop = desktop;
    this.#webTabs = webTabs;
  }

  create(title: string): string | undefined {
    if (this.#disposed || !this.#lifecycle.available) {
      return undefined;
    }
    const tabId = this.#tabs.open<PluginTabPayload>({
      kind: "plugin-catalog",
      key: "plugins",
      title,
      payload: {
        view: "installed",
        operation: IDLE,
        feedback: NO_FEEDBACK,
        catalog: {
          status: "loading",
          plugins: [],
          safeMode: false,
        },
      },
    });
    if (tabId !== undefined) void this.refreshInstalled(tabId);
    return tabId;
  }

  setView(tabId: string, view: PluginView): void {
    this.#update(tabId, { view });
  }

  async refreshInstalled(tabId: string): Promise<void> {
    const tab = this.#pluginTab(tabId);
    if (tab === undefined) return;
    const revision = (this.#listRevisions.get(tabId) ?? 0) + 1;
    this.#listRevisions.set(tabId, revision);
    this.#update(tabId, {
      catalog: {
        status: "loading",
        plugins: tab.payload.catalog.plugins,
        safeMode: tab.payload.catalog.safeMode,
      },
    });
    try {
      const snapshot = await this.#lifecycle.read();
      if (!this.#isListCurrent(tabId, revision)) return;
      this.#update(tabId, {
        catalog: snapshot.runtimeError === undefined
          ? {
              status: "ready",
              plugins: snapshot.plugins,
              safeMode: snapshot.safeMode,
            }
          : {
              status: "runtime-unavailable",
              plugins: snapshot.plugins,
              safeMode: snapshot.safeMode,
              message: snapshot.runtimeError,
            },
      });
    } catch (error) {
      if (!this.#isListCurrent(tabId, revision)) return;
      const current = this.#pluginTab(tabId);
      if (current === undefined) return;
      this.#update(tabId, {
        catalog: {
          status: "failed",
          plugins: current.payload.catalog.plugins,
          safeMode: current.payload.catalog.safeMode,
          message: errorMessage(error),
        },
      });
    }
  }

  async install(tabId: string, candidate: string): Promise<void> {
    if (this.#idleTab(tabId) === undefined) return;
    let command: string;
    try {
      command = parsePluginInstallCommand(candidate).command;
    } catch (error) {
      this.#update(tabId, {
        feedback: {
          kind: "install-error",
          command: candidate,
          message: errorMessage(error),
        },
      });
      return;
    }
    const revision = this.#begin(tabId, {
      kind: "install",
      command,
    });
    try {
      await this.#lifecycle.install(command);
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        view: "installed",
        operation: IDLE,
        feedback: { kind: "install-success", command },
      });
      await this.refreshInstalled(tabId);
    } catch (error) {
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: {
          kind: "install-error",
          command,
          message: errorMessage(error),
        },
      });
    }
  }

  async uninstall(tabId: string, candidate: string): Promise<void> {
    if (this.#idleTab(tabId) === undefined) return;
    let plugin: string;
    try {
      plugin = parsePluginUninstallTarget(candidate);
    } catch (error) {
      this.#update(tabId, {
        feedback: {
          kind: "uninstall-error",
          plugin: candidate,
          message: errorMessage(error),
        },
      });
      return;
    }
    const revision = this.#begin(tabId, {
      kind: "uninstall",
      plugin,
    });
    try {
      await this.#lifecycle.uninstall(plugin);
      if (!this.#isOperationCurrent(tabId, revision)) return;
      const current = this.#pluginTab(tabId);
      if (current === undefined) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: { kind: "uninstall-success", plugin },
        catalog: {
          ...current.payload.catalog,
          plugins: current.payload.catalog.plugins.filter(
            (candidatePlugin) => candidatePlugin.name !== plugin,
          ),
        },
      });
      await this.refreshInstalled(tabId);
    } catch (error) {
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: {
          kind: "uninstall-error",
          plugin,
          message: errorMessage(error),
        },
      });
    }
  }

  async setEnabled(
    tabId: string,
    candidate: string,
    enabled: boolean,
  ): Promise<void> {
    if (this.#idleTab(tabId) === undefined) return;
    let plugin: string;
    try {
      plugin = parsePluginUninstallTarget(candidate);
    } catch (error) {
      this.#update(tabId, {
        feedback: {
          kind: "set-enabled-error",
          plugin: candidate,
          enabled,
          message: errorMessage(error),
        },
      });
      return;
    }
    const revision = this.#begin(tabId, {
      kind: "set-enabled",
      plugin,
      enabled,
    });
    try {
      await this.#lifecycle.setEnabled(plugin, enabled);
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: NO_FEEDBACK,
      });
      await this.refreshInstalled(tabId);
    } catch (error) {
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: {
          kind: "set-enabled-error",
          plugin,
          enabled,
          message: errorMessage(error),
        },
      });
    }
  }

  async setSafeMode(
    tabId: string,
    enabled: boolean,
  ): Promise<void> {
    if (this.#idleTab(tabId) === undefined) return;
    const revision = this.#begin(tabId, {
      kind: "set-safe-mode",
      enabled,
    });
    try {
      await this.#lifecycle.setSafeMode(enabled);
      if (!this.#isOperationCurrent(tabId, revision)) return;
      const current = this.#pluginTab(tabId);
      if (current === undefined) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: NO_FEEDBACK,
        catalog: {
          ...current.payload.catalog,
          safeMode: enabled,
        },
      });
    } catch (error) {
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: {
          kind: "safe-mode-error",
          enabled,
          message: errorMessage(error),
        },
      });
    }
  }

  async restart(tabId: string): Promise<void> {
    if (this.#idleTab(tabId) === undefined) return;
    const revision = this.#begin(tabId, { kind: "restart" });
    try {
      await this.#lifecycle.restart();
    } catch (error) {
      if (!this.#isOperationCurrent(tabId, revision)) return;
      this.#update(tabId, {
        operation: IDLE,
        feedback: {
          kind: "restart-error",
          message: errorMessage(error),
        },
      });
    }
  }

  openExternal(candidate: string): void {
    if (this.#disposed || !this.#desktop.available) return;
    const url = normalizeWebTabUrl(candidate);
    if (url !== undefined) this.#desktop.openExternal(url);
  }

  openInTab(candidate: string): void {
    if (this.#disposed) return;
    const url = normalizeWebTabUrl(candidate);
    if (url !== undefined) this.#webTabs.open(url);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#operationRevisions.clear();
    this.#listRevisions.clear();
  }

  #pluginTab(tabId: string): PluginTab | undefined {
    if (this.#disposed) return undefined;
    const tab = this.#tabs.tab(tabId);
    return tab !== undefined && isPluginTab(tab) ? tab : undefined;
  }

  #idleTab(tabId: string): PluginTab | undefined {
    const tab = this.#pluginTab(tabId);
    return tab?.payload.operation.kind === "idle" ? tab : undefined;
  }

  #begin(
    tabId: string,
    operation: Exclude<PluginOperation, { readonly kind: "idle" }>,
  ): number {
    const revision =
      (this.#operationRevisions.get(tabId) ?? 0) + 1;
    this.#operationRevisions.set(tabId, revision);
    this.#update(tabId, {
      operation,
      feedback: NO_FEEDBACK,
    });
    return revision;
  }

  #isOperationCurrent(tabId: string, revision: number): boolean {
    return (
      this.#operationRevisions.get(tabId) === revision &&
      this.#pluginTab(tabId) !== undefined
    );
  }

  #isListCurrent(tabId: string, revision: number): boolean {
    return (
      this.#listRevisions.get(tabId) === revision &&
      this.#pluginTab(tabId) !== undefined
    );
  }

  #update(
    tabId: string,
    patch: Partial<PluginTabPayload>,
  ): void {
    const tab = this.#pluginTab(tabId);
    if (tab === undefined) return;
    this.#tabs.update(tabId, {
      payload: {
        ...tab.payload,
        ...patch,
      },
    });
  }
}
