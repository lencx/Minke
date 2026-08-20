import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  InstalledPlugin,
} from "@minke/harness-overlay/plugin-install-contract.ts";

export type PluginView = "installed" | "discover";

export interface PluginTabPayload {
  readonly view: PluginView;
  readonly installing: boolean;
  readonly uninstallingPlugin?: string;
  readonly loadingInstalled: boolean;
  readonly installedPlugins: readonly InstalledPlugin[];
  readonly attemptedCommand?: string;
  readonly installedCommand?: string;
  readonly error?: string;
  readonly installedError?: string;
  readonly uninstalledPlugin?: string;
  readonly uninstallError?: string;
}

export type PluginTab = ManagedTab<PluginTabPayload>;

export function isPluginTab(
  tab: ManagedTab,
): tab is PluginTab {
  return tab.kind === "plugin-catalog";
}
