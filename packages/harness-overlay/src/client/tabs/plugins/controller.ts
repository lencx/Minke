import type { DesktopTabsPort } from "../../desktop/contracts.ts";
import type { TabsRuntime } from "../runtime.ts";
import type { ManagedTab } from "../types.ts";
import type { WebTabsController } from "../web/controller.ts";
import { PLUGIN_DISCOVERY_TOPIC_URL } from "./resources.ts";

/** GitHub browser preset; DSH owns plugin management and indexed discovery. */
export class PluginTabsController {
  readonly web: WebTabsController;
  readonly #tabs: TabsRuntime;
  readonly #desktop: DesktopTabsPort;
  #disposed = false;

  constructor(tabs: TabsRuntime, desktop: DesktopTabsPort, web: WebTabsController) {
    this.#tabs = tabs;
    this.#desktop = desktop;
    this.web = web;
  }

  create(title: string): string | undefined {
    if (this.#disposed || !this.#desktop.embeddedWebAvailable) return undefined;
    return this.#tabs.open({ kind: "plugin-catalog", key: "plugins", title, payload: {
      url: PLUGIN_DISCOVERY_TOPIC_URL, loading: true, canGoBack: false, canGoForward: false,
    } });
  }

  restore(tab: ManagedTab): void {
    if (this.#disposed || typeof tab.payload !== "object" || tab.payload === null) return;
    const url = "url" in tab.payload ? tab.payload.url : PLUGIN_DISCOVERY_TOPIC_URL;
    this.web.restore({ ...tab, payload: { url } });
  }

  dispose(): void { this.#disposed = true; }
}
