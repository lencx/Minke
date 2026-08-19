import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopFilesPort,
  desktopSessionLogsPort,
  desktopTabsPort,
  desktopTerminalPort,
  desktopTerminalSettingsStore,
} from "../desktop/index.ts";
import {
  createFilesTabRenderer,
  filesTabsEn,
  filesTabsZh,
  FilesTabsController,
  installConversationFileRouter,
  installFilesTabStyles,
  type FilesTabsLocaleKey,
  type FilesTabsTranslate,
} from "./files/index.ts";
import {
  installSessionHeaderActionStyles,
  installTabsStyles,
  NewSessionTabsHeaderAction,
  SessionLogHeaderAction,
  TabRendererRegistry,
  tabsEn,
  TabsHeaderAction,
  TabsLayoutStateRuntime,
  TabsPanel,
  TabsRuntime,
  tabsZh,
} from "./index.ts";
import {
  createTerminalTabRenderer,
  installTerminalSettingsNavigationIcon,
  installTerminalSettingsStyles,
  installTerminalTabStyles,
  terminalTabsEn,
  terminalTabsZh,
  TerminalSettingsRuntime,
  TerminalSettingsSection,
  TerminalTabsController,
  type TerminalTabsLocaleKey,
  type TerminalTabsTranslate,
} from "./terminal/index.ts";
import {
  createWebTabRenderer,
  installWebLinkTabs,
  installWebTabStyles,
  webTabsEn,
  webTabsZh,
  WebTabsController,
  type WebTabsLocaleKey,
  type WebTabsTranslate,
} from "./web/index.ts";

const TABS_NAMESPACE = "minke.tabs";
const FILES_TABS_NAMESPACE = "minke.tabs.files";
const WEB_TABS_NAMESPACE = "minke.tabs.web";
const TERMINAL_TABS_NAMESPACE = "minke.tabs.terminal";

export type TabsRuntimes = Readonly<{
  bottom: TabsRuntime;
  right: TabsRuntime;
}>;

/**
 * Install the independent right and bottom tab workspaces plus their native
 * Files, Terminal, Web, and session-log adapters.
 */
export function installTabs(
  ctx: HarnessClientContext,
): TabsRuntimes | undefined {
  const tabsPort = desktopTabsPort();
  const filesPort = desktopFilesPort();
  const terminalPort = desktopTerminalPort();
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const sessionLogsPort = desktopSessionLogsPort();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );

  const filesT = ctx.locale.bind<FilesTabsLocaleKey>(
    FILES_TABS_NAMESPACE,
  ) as FilesTabsTranslate;
  if (filesPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(FILES_TABS_NAMESPACE, {
          zh: filesTabsZh,
          en: filesTabsEn,
        }),
      "minke-overlay: Files tab dictionaries",
    );
  }

  ctx.effect(
    () => () => {
      terminalSettings.dispose();
    },
    "minke-overlay: Terminal settings runtime",
  );
  void terminalSettings.initialize();
  const terminalT = ctx.locale.bind<TerminalTabsLocaleKey>(
    TERMINAL_TABS_NAMESPACE,
  ) as TerminalTabsTranslate;
  if (terminalPort.available || terminalSettingsStore.available) {
    ctx.effect(
      () =>
        ctx.locale.register(TERMINAL_TABS_NAMESPACE, {
          zh: terminalTabsZh,
          en: terminalTabsEn,
        }),
      "minke-overlay: Terminal dictionaries",
    );
  }
  if (terminalSettingsStore.available) {
    ctx.effect(
      () => installTerminalSettingsStyles(),
      "minke-overlay: Terminal settings styles",
    );
    ctx.effect(
      () =>
        installTerminalSettingsNavigationIcon(() =>
          terminalT("terminal.settings.nav")
        ),
      "minke-overlay: Terminal settings navigation icon",
    );
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "minke-terminal",
          order: 6,
          label: () => terminalT("terminal.settings.nav"),
          locale: TERMINAL_TABS_NAMESPACE,
          inject: () => ({
            runtime: terminalSettings,
          }),
        },
        TerminalSettingsSection as ComponentType<never>,
      ),
    );
  }

  if (tabsPort.available || sessionLogsPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(TABS_NAMESPACE, {
          zh: tabsZh,
          en: tabsEn,
        }),
      "minke-overlay: tabs dictionaries",
    );
    ctx.effect(
      () => installSessionHeaderActionStyles(),
      "minke-overlay: session header action styles",
    );
  }
  if (sessionLogsPort.available) {
    ctx.slots.inject(
      "conversation.session.header.utilities",
      () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "session-log-download",
            order: 0,
            priority: -100,
            locale: TABS_NAMESPACE,
            inject: () => ({
              exportSession: (sessionId: string) =>
                sessionLogsPort.export(sessionId),
            }),
          },
          SessionLogHeaderAction as ComponentType<never>,
        ),
    );
  }
  if (!tabsPort.available) return undefined;

  const tabsLayoutState = new TabsLayoutStateRuntime(tabsPort);
  const setRightTrackWidth = (width: number): void => {
    ctx.layout.setDetails(width);
  };
  ctx.effect(
    () => () => {
      tabsLayoutState.dispose();
    },
    "minke-overlay: Tabs layout state",
  );
  ctx.effect(
    () =>
      ctx.locale.register(WEB_TABS_NAMESPACE, {
        zh: webTabsZh,
        en: webTabsEn,
      }),
    "minke-overlay: Web tab dictionaries",
  );
  ctx.effect(
    () => installTabsStyles(),
    "minke-overlay: tabs styles",
  );
  ctx.effect(
    () => installWebTabStyles(),
    "minke-overlay: Web tab styles",
  );
  if (filesPort.available) {
    ctx.effect(
      () => installFilesTabStyles(),
      "minke-overlay: Files tab styles",
    );
  }
  if (terminalPort.available) {
    ctx.effect(
      () => installTerminalTabStyles(),
      "minke-overlay: Terminal tab styles",
    );
  }

  const rightTabs = new TabsRuntime({
    showPanel: () => ctx.layout.openDetails(),
    hidePanel: () => ctx.layout.closeDetails(),
  });
  const bottomTabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  }, {
    idPrefix: "bottom-",
  });
  const runtimes = Object.freeze({
    bottom: bottomTabs,
    right: rightTabs,
  });
  const webT = ctx.locale.bind<WebTabsLocaleKey>(
    WEB_TABS_NAMESPACE,
  ) as WebTabsTranslate;

  const createTabsWorkspace = (
    tabs: TabsRuntime,
    placement: "bottom" | "right",
  ) => {
    const renderers = new TabRendererRegistry();
    const webTabs = new WebTabsController(tabs, tabsPort);
    const filesTabs = filesPort.available
      ? new FilesTabsController(tabs, filesPort, {
          placement,
        })
      : undefined;
    const terminalTabs = terminalPort.available
      ? new TerminalTabsController(tabs, terminalPort)
      : undefined;
    ctx.effect(
      () => () => {
        terminalTabs?.dispose();
        filesTabs?.dispose();
        webTabs.dispose();
        renderers.clear();
        tabs.dispose();
      },
      `minke-overlay: ${placement} tabs runtime`,
    );
    if (filesTabs !== undefined) {
      ctx.effect(
        () =>
          renderers.register(
            createFilesTabRenderer(filesTabs, filesT),
          ),
        `minke-overlay: ${placement} Files tab renderer`,
      );
    }
    if (terminalTabs !== undefined) {
      ctx.effect(
        () =>
          renderers.register(
            createTerminalTabRenderer(
              terminalTabs,
              terminalSettings,
              terminalT,
            ),
          ),
        `minke-overlay: ${placement} Terminal tab renderer`,
      );
    }
    ctx.effect(
      () =>
        renderers.register(
          createWebTabRenderer(webTabs, webT),
        ),
      `minke-overlay: ${placement} Web tab renderer`,
    );
    return Object.freeze({
      filesTabs,
      renderers,
      webTabs,
    });
  };

  const rightWorkspace = createTabsWorkspace(
    rightTabs,
    "right",
  );
  const bottomWorkspace = createTabsWorkspace(
    bottomTabs,
    "bottom",
  );
  const rightFilesTabs = rightWorkspace.filesTabs;
  if (rightFilesTabs !== undefined) {
    ctx.effect(
      () =>
        installConversationFileRouter(
          ctx.workspaces,
          rightFilesTabs,
          () => filesT("files.tab.new"),
        ),
      "minke-overlay: conversation Files reader",
    );
  }
  ctx.effect(
    () => installWebLinkTabs(rightWorkspace.webTabs),
    "minke-overlay: Web link tabs",
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-tabs-new-session-toggle",
        order: 10,
        locale: TABS_NAMESPACE,
        inject: () => ({ runtimes }),
      },
      NewSessionTabsHeaderAction as ComponentType<never>,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-tabs-right",
        order: 20,
        locale: TABS_NAMESPACE,
        inject: () => ({
          placement: "right" as const,
          runtime: rightTabs,
          renderers: rightWorkspace.renderers,
          layoutState: tabsLayoutState,
          setRightTrackWidth,
        }),
      },
      TabsPanel as ComponentType<never>,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-tabs-bottom",
        order: 21,
        locale: TABS_NAMESPACE,
        inject: () => ({
          placement: "bottom" as const,
          runtime: bottomTabs,
          renderers: bottomWorkspace.renderers,
          layoutState: tabsLayoutState,
        }),
      },
      TabsPanel as ComponentType<never>,
    ),
  );
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () =>
      ctx.slots.register(
        {
          name: "conversation.session.header.utilities",
          id: "minke-tabs-toggle",
          order: 10,
          locale: TABS_NAMESPACE,
          inject: () => ({ runtimes }),
        },
        TabsHeaderAction as ComponentType<never>,
      ),
  );

  return runtimes;
}
