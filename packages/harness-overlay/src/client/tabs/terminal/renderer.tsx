import type {
  ReactNode,
} from "react";
import type {
  ManagedTab,
  TabRenderer,
} from "../types.ts";
import type {
  TerminalTabsController,
} from "./controller.ts";
import {
  TerminalIcon,
} from "./icons.tsx";
import type {
  TerminalTabsTranslate,
} from "./locales.ts";
import {
  TerminalView,
} from "./TerminalView.tsx";
import {
  isTerminalTab,
} from "./types.ts";
import type {
  TerminalSettingsRuntime,
} from "./settings/runtime.ts";

export function createTerminalTabRenderer(
  controller: TerminalTabsController,
  settings: TerminalSettingsRuntime,
  t: TerminalTabsTranslate,
): TabRenderer {
  const createTerminal = (context: {
    readonly cwd?: string;
  }): void => {
    controller.create(context.cwd, t("terminal.tab.new"));
  };
  return {
    kind: "terminal",
    createOptions: () => [
      {
        id: "terminal",
        label: t("terminal.create.label"),
        order: 10,
        icon: <TerminalIcon size={20} />,
        create: createTerminal,
      },
    ],
    renderIcon: () => <TerminalIcon size={13} />,
    renderView: (
      tab: ManagedTab,
      active: boolean,
    ): ReactNode =>
      isTerminalTab(tab)
        ? (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={active}
            controller={controller}
            settings={settings}
            t={t}
          />
        )
        : null,
  };
}
