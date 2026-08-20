import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface PluginTabPayload {
  readonly installing: boolean;
  readonly attemptedCommand?: string;
  readonly installedCommand?: string;
  readonly error?: string;
}

export type PluginTab = ManagedTab<PluginTabPayload>;

export function isPluginTab(
  tab: ManagedTab,
): tab is PluginTab {
  return tab.kind === "plugin-catalog";
}
