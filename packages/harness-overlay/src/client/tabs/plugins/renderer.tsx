import type {
  ReactNode,
} from "react";
import type {
  ManagedTab,
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  PluginCatalogTabsController,
} from "./controller.ts";
import {
  PluginCatalogIcon,
} from "./icons.tsx";
import type {
  PluginCatalogTranslate,
} from "./locales.ts";
import {
  PluginCatalogView,
} from "./PluginCatalogView.tsx";
import {
  isPluginCatalogTab,
} from "./types.ts";

/** Local plugin catalog renderer registered beside other Tabs content. */
export function createPluginCatalogTabRenderer(
  controller: PluginCatalogTabsController,
  t: PluginCatalogTranslate,
): TabRenderer {
  return {
    kind: "plugin-catalog",
    createOptions: () => [
      {
        id: "plugins",
        label: t("plugins.create.label"),
        order: 30,
        icon: <PluginCatalogIcon size={20} />,
        create: () => {
          controller.create(t("plugins.tab.title"));
        },
      },
    ],
    renderIcon: () => <PluginCatalogIcon size={13} />,
    loading: (tab) =>
      isPluginCatalogTab(tab) &&
      (
        tab.payload.loading ||
        tab.payload.refreshing ||
        tab.payload.cancelling
      ),
    loadingLabel: () => t("plugins.loading"),
    renderView: (
      tab: ManagedTab,
      active: boolean,
    ): ReactNode =>
      isPluginCatalogTab(tab)
        ? (
          <PluginCatalogView
            key={tab.id}
            tab={tab}
            active={active}
            controller={controller}
            t={t}
          />
        )
        : null,
  };
}
