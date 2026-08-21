import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopFilesPort,
  desktopPluginInstallerPort,
  desktopSessionLogsPort,
  desktopTabsPort,
  desktopTerminalPort,
  desktopTerminalSettingsStore,
} from "../desktop/index.ts";
import {
  PreferencesSection,
  preferencesEn,
  preferencesZh,
  installPreferencesNavigationIcon,
  installPreferencesSettingsStyles,
  type PreferencesLocaleKey,
  type PreferencesTranslate,
} from "../preferences/index.ts";
import {
  createDetailsTabRenderer,
  DetailsTabsController,
  installDetailsLayoutOpenBridge,
  installDetailsTabsBridge,
  installDetailsTabStyles,
} from "./details/index.ts";
import {
  CodeThemeSettingsRuntime,
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
  createPluginTabRenderer,
  installPluginStyles,
  pluginsEn,
  pluginsZh,
  PluginTabsController,
  type PluginsLocaleKey,
  type PluginsTranslate,
} from "./plugins/index.ts";
import {
  installSessionHeaderActionStyles,
  installTabsStyles,
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
  installTerminalTabStyles,
  terminalTabsEn,
  terminalTabsZh,
  TerminalSettingsRuntime,
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
const PLUGINS_NAMESPACE = "minke.tabs.plugins";
const TERMINAL_TABS_NAMESPACE = "minke.tabs.terminal";
const PREFERENCES_NAMESPACE = "minke.preferences";

export type TabsRuntimes = Readonly<{
  bottom: TabsRuntime;
  right: TabsRuntime;
}>;

/**
 * Install the independent right and bottom tab workspaces plus their native
 * Files, Terminal, Web, Plugins, and session-log adapters.
 */
export function installTabs(
  ctx: HarnessClientContext,
): TabsRuntimes | undefined {
  const tabsPort = desktopTabsPort();
  const filesPort = desktopFilesPort();
  const pluginInstallerPort = desktopPluginInstallerPort();
  const terminalPort = desktopTerminalPort();
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const sessionLogsPort = desktopSessionLogsPort();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );
  const codeThemes = new CodeThemeSettingsRuntime(
    filesPort,
    ctx.theme.getTheme().active.colorScheme,
  );
  ctx.on("theme/change", (snapshot) =>
    codeThemes.setColorScheme(snapshot.active.colorScheme)
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
      codeThemes.dispose();
      terminalSettings.dispose();
    },
    "minke-overlay: Personal preferences runtimes",
  );
  void codeThemes.initialize();
  void terminalSettings.initialize();
  const terminalT = ctx.locale.bind<TerminalTabsLocaleKey>(
    TERMINAL_TABS_NAMESPACE,
  ) as TerminalTabsTranslate;
  if (terminalPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(TERMINAL_TABS_NAMESPACE, {
          zh: terminalTabsZh,
          en: terminalTabsEn,
        }),
      "minke-overlay: Terminal dictionaries",
    );
  }
  const preferencesT = ctx.locale.bind<PreferencesLocaleKey>(
    PREFERENCES_NAMESPACE,
  ) as PreferencesTranslate;
  if (terminalSettingsStore.available || filesPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(PREFERENCES_NAMESPACE, {
          zh: preferencesZh,
          en: preferencesEn,
        }),
      "minke-overlay: Personal preferences dictionaries",
    );
    ctx.effect(
      () => installPreferencesSettingsStyles(),
      "minke-overlay: Personal preferences styles",
    );
    ctx.effect(
      () =>
        installPreferencesNavigationIcon(() =>
          preferencesT("preferences.nav")
        ),
      "minke-overlay: Personal preferences navigation icon",
    );
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "minke-preferences",
          order: 6,
          label: () => preferencesT("preferences.nav"),
          locale: PREFERENCES_NAMESPACE,
          inject: () => ({
            ...(terminalSettingsStore.available
              ? { terminalSettings }
              : {}),
            ...(filesPort.available ? { codeThemes } : {}),
          }),
        },
        PreferencesSection as ComponentType<never>,
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
  if (pluginInstallerPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(PLUGINS_NAMESPACE, {
          zh: pluginsZh,
          en: pluginsEn,
        }),
      "minke-overlay: Plugins dictionaries",
    );
    ctx.effect(
      () => installPluginStyles(),
      "minke-overlay: Plugins styles",
    );
  }
  ctx.effect(
    () => installTabsStyles(),
    "minke-overlay: tabs styles",
  );
  ctx.effect(
    () => installWebTabStyles(),
    "minke-overlay: Web tab styles",
  );
  ctx.effect(
    () => installDetailsTabStyles(),
    "minke-overlay: Details tab styles",
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

  const openRightHost = ctx.layout.openDetails.bind(ctx.layout);
  const closeRightHost = ctx.layout.closeDetails.bind(ctx.layout);
  const rightTabs = new TabsRuntime({
    showPanel: openRightHost,
    hidePanel: closeRightHost,
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
  const pluginsT = ctx.locale.bind<PluginsLocaleKey>(
    PLUGINS_NAMESPACE,
  ) as PluginsTranslate;

  const createTabsWorkspace = (
    tabs: TabsRuntime,
    placement: "bottom" | "right",
  ) => {
    const renderers = new TabRendererRegistry();
    const webTabs = new WebTabsController(tabs, tabsPort);
    const pluginTabs = pluginInstallerPort.available
      ? new PluginTabsController(
          tabs,
          pluginInstallerPort,
          tabsPort,
          webTabs,
        )
      : undefined;
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
        pluginTabs?.dispose();
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
            createFilesTabRenderer(
              filesTabs,
              codeThemes,
              filesT,
            ),
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
              codeThemes,
              terminalT,
            ),
          ),
        `minke-overlay: ${placement} Terminal tab renderer`,
      );
    }
    if (pluginTabs !== undefined) {
      ctx.effect(
        () =>
          renderers.register(
            createPluginTabRenderer(pluginTabs, pluginsT),
          ),
        `minke-overlay: ${placement} Plugins renderer`,
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
      pluginTabs,
      renderers,
      webTabs,
    });
  };

  const rightWorkspace = createTabsWorkspace(
    rightTabs,
    "right",
  );
  ctx.effect(
    () =>
      rightWorkspace.renderers.register(
        createDetailsTabRenderer(),
      ),
    "minke-overlay: right Details renderer",
  );
  const detailsTabs = new DetailsTabsController(rightTabs, {
    releaseHost: closeRightHost,
  });
  ctx.effect(
    () =>
      installDetailsLayoutOpenBridge(
        ctx.layout,
        detailsTabs,
      ),
    "minke-overlay: Details layout.openDetails bridge",
  );
  ctx.effect(
    () => installDetailsTabsBridge(detailsTabs),
    "minke-overlay: Details tab lifecycle bridge",
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
        id: "minke-tabs-toggle",
        order: 10,
        locale: TABS_NAMESPACE,
        inject: () => ({ runtimes }),
      },
      TabsHeaderAction as ComponentType<never>,
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
  return runtimes;
}
