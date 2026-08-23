import { TABS_WEB_PARTITION } from "@minke/harness-overlay/tabs/contract.ts";

export const PLUGIN_DISCOVERY_WEB_PREFERENCES = Object.freeze([
  "contextIsolation=yes",
  "nodeIntegration=no",
  "sandbox=yes",
  "webSecurity=yes",
]);

interface PluginDiscoveryWebviewTarget {
  className: string;
  setAttribute(name: string, value: string): void;
}

/** Apply the security and identity contract to a new discovery guest. */
export function configurePluginDiscoveryWebview(
  view: PluginDiscoveryWebviewTarget,
  options: {
    readonly url: string;
    readonly label: string;
  },
): void {
  view.className = "minke-plugins-browser__guest";
  view.setAttribute("src", options.url);
  view.setAttribute("partition", TABS_WEB_PARTITION);
  view.setAttribute(
    "webpreferences",
    PLUGIN_DISCOVERY_WEB_PREFERENCES.join(","),
  );
  view.setAttribute("aria-label", options.label);
}
