import type {
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  PluginTabsController,
} from "./controller.ts";
import {
  PluginIcon,
} from "./icons.tsx";
import type {
  PluginsTranslate,
} from "./locales.ts";
import { createWebTabRenderer } from "../web/renderer.tsx";
import type { WebTabsTranslate } from "../web/locales.ts";

/** GitHub preset reuses the browser UI while preserving saved discovery identities. */
export function createPluginTabRenderer(
  controller: PluginTabsController,
  t: PluginsTranslate,
  webT: WebTabsTranslate,
): TabRenderer {
  const browser = createWebTabRenderer(controller.web, webT, { allowPopups: false, annotations: false });
  return {
    ...browser,
    kind: "plugin-catalog",
    persistence: { save: tab => browser.persistence!.save(tab), restore: tab => controller.restore(tab) },
    createOptions: () => [
      {
        id: "plugins",
        label: t("plugins.create.label"),
        order: 30,
        icon: <PluginIcon size={20} />,
        create: () => {
          controller.create(t("plugins.tab.title"));
        },
      },
    ],
    renderIcon: () => <PluginIcon size={13} />,
  };
}
