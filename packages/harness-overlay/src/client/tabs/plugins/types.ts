import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  PluginLifecyclePlugin,
} from "./lifecycle.ts";

export type PluginView = "installed" | "discover";

export interface PluginTabPayload {
  readonly view: PluginView;
  readonly installing: boolean;
  readonly restarting: boolean;
  readonly uninstallingPlugin?: string;
  readonly loadingInstalled: boolean;
  readonly installedPlugins: readonly PluginLifecyclePlugin[];
  readonly attemptedCommand?: string;
  readonly installedCommand?: string;
  readonly error?: string;
  readonly installedError?: string;
  readonly runtimeError?: string;
  readonly restartError?: string;
  readonly uninstalledPlugin?: string;
  readonly uninstallError?: string;
}

export type PluginTab = ManagedTab<PluginTabPayload>;

export function isPluginTab(
  tab: ManagedTab,
): tab is PluginTab {
  return tab.kind === "plugin-catalog";
}
