import type {
  PluginCatalogSnapshot,
} from "@lencx/minke-plugin-catalog/contract";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface PluginCatalogTabPayload {
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly cancelling: boolean;
  readonly installingPluginId?: string;
  readonly credentialSaving?: boolean;
  readonly snapshot?: PluginCatalogSnapshot;
  readonly error?: string;
}

export type PluginCatalogTab =
  ManagedTab<PluginCatalogTabPayload>;

export function isPluginCatalogTab(
  tab: ManagedTab,
): tab is PluginCatalogTab {
  return tab.kind === "plugin-catalog";
}
