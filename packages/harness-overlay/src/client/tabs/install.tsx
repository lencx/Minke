import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopAppUpdateSettingsStore,
  desktopPluginInstallerPort,
  desktopSessionLogsPort,
  desktopTerminalSettingsStore,
} from "../desktop/index.ts";
import {
  minkeWorkspacePorts,
} from "../host/workspace.ts";
import {
  installMobileWebViewport,
  installMobileWebViewportStyles,
} from "../host/mobile-web-viewport.ts";
import {
  AppUpdateSettingsRuntime,
  PreferencesSection,
  preferencesEn,
  preferencesZh,
  installPreferencesNavigationIcon,
  installPreferencesSettingsStyles,
  type PreferencesLocaleKey,
  type PreferencesTranslate,
} from "../preferences/index.ts";
import {
  installDetailsTabs,
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
  createHarnessPluginInventoryPort,
  createPluginLifecyclePort,
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
  ResponsiveRightTabsHost,
} from "./responsive-right-host.ts";
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
  workspaces: Readonly<{
    bottom: Readonly<{ renderers: TabRendererRegistry }>;
    right: Readonly<{ renderers: TabRendererRegistry }>;
  }>;
}>;

/**
 * Install the independent right and bottom tab workspaces plus their native
 * Files, Terminal, Web, Plugins, and session-log adapters.
 */
export function installTabs(
  ctx: HarnessClientContext,
): TabsRuntimes | undefined {
  const workspacePorts = minkeWorkspacePorts(ctx.connection);
  const tabsPort = workspacePorts.tabs;
  const filesPort = workspacePorts.files;
  const terminalPort = workspacePorts.terminal;
  const pluginInstallerPort = desktopPluginInstallerPort();
  const pluginLifecyclePort = createPluginLifecyclePort(
    pluginInstallerPort,
    createHarnessPluginInventoryPort(ctx.connection),
  );
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const appUpdateSettingsStore =
    desktopAppUpdateSettingsStore();
  const sessionLogsPort = desktopSessionLogsPort();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );
  const appUpdateSettings = new AppUpdateSettingsRuntime(
    appUpdateSettingsStore,
  );
  const codeThemes = new CodeThemeSettingsRuntime(
    filesPort,
    ctx.theme.getTheme().active.colorScheme,
  );
  if (!tabsPort.embeddedWebAvailable) {
    ctx.effect(
      () => installMobileWebViewportStyles(),
      "minke-overlay: mobile Web viewport styles",
    );
    ctx.effect(
      () => installMobileWebViewport(),
      "minke-overlay: mobile Web viewport",
    );
  }
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
      appUpdateSettings.dispose();
    },
    "minke-overlay: Personal preferences runtimes",
  );
  void codeThemes.initialize();
  void terminalSettings.initialize();
  void appUpdateSettings.initialize();
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
  if (
    terminalSettingsStore.available ||
    filesPort.available ||
    appUpdateSettingsStore.available
  ) {
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
            ...(appUpdateSettingsStore.available
              ? { appUpdateSettings }
              : {}),
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
  if (tabsPort.embeddedWebAvailable) {
    ctx.effect(
      () =>
        ctx.locale.register(WEB_TABS_NAMESPACE, {
          zh: webTabsZh,
          en: webTabsEn,
        }),
      "minke-overlay: Web tab dictionaries",
    );
  }
  if (pluginLifecyclePort.available) {
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
  if (tabsPort.embeddedWebAvailable) {
    ctx.effect(
      () => installWebTabStyles(),
      "minke-overlay: Web tab styles",
    );
  }
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
  const rightHost = new ResponsiveRightTabsHost({
    openDetails: openRightHost,
    closeDetails: closeRightHost,
  }, {
    // The preload bridge is the capability boundary. Do not infer the
    // runtime from user-agent or packaging metadata.
    drawerEnabled: !tabsPort.embeddedWebAvailable,
  });
  const rightTabs = new TabsRuntime(rightHost);
  const bottomTabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  }, {
    idPrefix: "bottom-",
  });
  ctx.effect(
    () => () => {
      rightHost.dispose();
    },
    "minke-overlay: responsive right Tabs host",
  );
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
    const webTabs = tabsPort.embeddedWebAvailable
      ? new WebTabsController(tabs, tabsPort)
      : undefined;
    const pluginTabs =
      pluginLifecyclePort.available && webTabs !== undefined
      ? new PluginTabsController(
          tabs,
          pluginLifecyclePort,
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
        webTabs?.dispose();
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
    if (webTabs !== undefined) {
      ctx.effect(
        () =>
          renderers.register(
            createWebTabRenderer(webTabs, webT),
          ),
        `minke-overlay: ${placement} Web tab renderer`,
      );
    }
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
      installDetailsTabs({
        runtime: rightTabs,
        renderers: rightWorkspace.renderers,
        layout: ctx.layout,
        slots: ctx.slots,
      }),
    "minke-overlay: Details tabs integration",
  );
  const bottomWorkspace = createTabsWorkspace(
    bottomTabs,
    "bottom",
  );
  const runtimes: TabsRuntimes = Object.freeze({
    bottom: bottomTabs,
    right: rightTabs,
    workspaces: Object.freeze({
      bottom: Object.freeze({
        renderers: bottomWorkspace.renderers,
      }),
      right: Object.freeze({
        renderers: rightWorkspace.renderers,
      }),
    }),
  });
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
  const rightWebTabs = rightWorkspace.webTabs;
  if (rightWebTabs !== undefined) {
    ctx.effect(
      () => installWebLinkTabs(rightWebTabs),
      "minke-overlay: Web link tabs",
    );
  }

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
          presentation: rightHost,
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
