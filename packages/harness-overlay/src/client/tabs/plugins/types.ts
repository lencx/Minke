import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  PluginLifecyclePlugin,
} from "./lifecycle.ts";

export type PluginView = "installed" | "discover";

export type PluginOperation =
  | { readonly kind: "idle" }
  | { readonly kind: "install"; readonly command: string }
  | { readonly kind: "uninstall"; readonly plugin: string }
  | {
      readonly kind: "set-enabled";
      readonly plugin: string;
      readonly enabled: boolean;
    }
  | { readonly kind: "restart" }
  | {
      readonly kind: "set-safe-mode";
      readonly enabled: boolean;
    };

export type PluginFeedback =
  | { readonly kind: "none" }
  | {
      readonly kind: "install-success";
      readonly command: string;
    }
  | {
      readonly kind: "install-error";
      readonly command: string;
      readonly message: string;
    }
  | {
      readonly kind: "uninstall-success";
      readonly plugin: string;
    }
  | {
      readonly kind: "uninstall-error";
      readonly plugin: string;
      readonly message: string;
    }
  | {
      readonly kind: "restart-error";
      readonly message: string;
    }
  | {
      readonly kind: "set-enabled-error";
      readonly plugin: string;
      readonly enabled: boolean;
      readonly message: string;
    }
  | {
      readonly kind: "safe-mode-error";
      readonly enabled: boolean;
      readonly message: string;
    };

interface PluginCatalogBase {
  readonly plugins: readonly PluginLifecyclePlugin[];
  readonly safeMode: boolean;
}

export type PluginCatalogState =
  | (PluginCatalogBase & { readonly status: "loading" })
  | (PluginCatalogBase & { readonly status: "ready" })
  | (
      PluginCatalogBase & {
        readonly status: "runtime-unavailable";
        readonly message: string;
      }
    )
  | (
      PluginCatalogBase & {
        readonly status: "failed";
        readonly message: string;
      }
    );

export interface PluginTabPayload {
  readonly view: PluginView;
  readonly operation: PluginOperation;
  readonly feedback: PluginFeedback;
  readonly catalog: PluginCatalogState;
}

export type PluginTab = ManagedTab<PluginTabPayload>;

export function isPluginTab(
  tab: ManagedTab,
): tab is PluginTab {
  return tab.kind === "plugin-catalog";
}
