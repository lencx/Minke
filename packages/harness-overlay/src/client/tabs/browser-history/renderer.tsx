import {
  History,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import type {
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import {
  BrowserHistoryView,
} from "./BrowserHistoryView.tsx";
import type {
  BrowserHistoryTabsController,
} from "./controller.ts";
import type {
  BrowserHistoryTranslate,
} from "./locales.ts";
import {
  BROWSER_HISTORY_TAB_KIND,
  isBrowserHistoryTab,
} from "./types.ts";

export function createBrowserHistoryTabRenderer(
  controller: BrowserHistoryTabsController,
  t: BrowserHistoryTranslate,
): TabRenderer {
  return {
    kind: BROWSER_HISTORY_TAB_KIND,
    createOptions: () => [{
      id: "browser-history",
      label: t("browserHistory.create.label"),
      order: 21,
      icon: <LucideIcon icon={History} size={20} />,
      create: () => {
        controller.create(t("browserHistory.tab.title"));
      },
    }],
    renderIcon: () => <LucideIcon icon={History} size={13} />,
    renderView: (tab, active, visible = true) =>
      isBrowserHistoryTab(tab)
        ? (
          <BrowserHistoryView
            key={tab.id}
            active={active && visible}
            controller={controller}
            tab={tab}
            t={t}
          />
        )
        : null,
  };
}
