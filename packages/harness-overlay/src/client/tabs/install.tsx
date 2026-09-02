import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopAgentBrowserPort,
  desktopAppUpdateSettingsStore,
  desktopPluginInstallerPort,
  desktopSessionLogsPort,
  desktopTerminalSettingsStore,
  desktopWebSearchSettingsStore,
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
  WebSearchSettingsRuntime,
  preferencesEn,
  preferencesZh,
  installPreferencesSettingsStyles,
  type PreferencesLocaleKey,
  type PreferencesTranslate,
} from "../preferences/index.ts";
import type {
  MinkeSettingsRuntime,
} from "../minke-settings/index.ts";
import {
  agentBrowserTabsEn,
  agentBrowserTabsZh,
  AgentBrowserTabsController,
  createAgentBrowserComposerBridge,
  createAgentBrowserChatPort,
  createAgentBrowserTabRenderer,
  installAgentBrowserTabStyles,
  type AgentBrowserComposerBridge,
  type AgentBrowserTabsLocaleKey,
  type AgentBrowserTabsTranslate,
} from "./agent-browser/index.ts";
import {
  CodeThemeSettingsRuntime,
  createFilesTabRenderer,
  filesTabsEn,
  filesTabsZh,
  FilesTabsController,
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
const AGENT_BROWSER_TABS_NAMESPACE =
  "minke.tabs.agent-browser";
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
  settings: MinkeSettingsRuntime,
): TabsRuntimes | undefined {
  const workspacePorts = minkeWorkspacePorts(ctx.connection);
  const tabsPort = workspacePorts.tabs;
  const agentBrowserPort = desktopAgentBrowserPort();
  const filesPort = workspacePorts.files;
  const terminalPort = workspacePorts.terminal;
  const pluginInstallerPort = desktopPluginInstallerPort();
  const pluginLifecyclePort = createPluginLifecyclePort(
    pluginInstallerPort,
    createHarnessPluginInventoryPort(
      ctx.remote.pluginInventory,
    ),
  );
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const appUpdateSettingsStore =
    desktopAppUpdateSettingsStore();
  const webSearchSettingsStore =
    desktopWebSearchSettingsStore();
  const sessionLogsPort = desktopSessionLogsPort();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );
  const appUpdateSettings = new AppUpdateSettingsRuntime(
    appUpdateSettingsStore,
  );
  const webSearchSettings = new WebSearchSettingsRuntime(
    webSearchSettingsStore,
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
      webSearchSettings.dispose();
    },
    "minke-overlay: Personal preferences runtimes",
  );
  void codeThemes.initialize();
  void terminalSettings.initialize();
  void appUpdateSettings.initialize();
  void webSearchSettings.initialize();
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
    appUpdateSettingsStore.available ||
    webSearchSettingsStore.available
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
        settings.register({
          id: "preferences",
          order: 0,
          label: () => preferencesT("preferences.nav"),
          icon: "preferences",
          render: () => (
            <PreferencesSection
              t={preferencesT}
              {...(
                terminalSettingsStore.available
                  ? { terminalSettings }
                  : {}
              )}
              {...(filesPort.available ? { codeThemes } : {})}
              {...(
                appUpdateSettingsStore.available
                  ? { appUpdateSettings }
                  : {}
              )}
              {...(
                webSearchSettingsStore.available
                  ? { webSearchSettings }
                  : {}
              )}
            />
          ),
        }),
      "minke-overlay: Personal preferences Minke Settings page",
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
  if (
    agentBrowserPort.available ||
    tabsPort.embeddedWebAvailable
  ) {
    ctx.effect(
      () => installAgentBrowserTabStyles(),
      "minke-overlay: Browser annotation and Agent Browser styles",
    );
  }
  if (agentBrowserPort.available) {
    ctx.effect(
      () =>
        ctx.locale.register(AGENT_BROWSER_TABS_NAMESPACE, {
          zh: agentBrowserTabsZh,
          en: agentBrowserTabsEn,
        }),
      "minke-overlay: Agent Browser tab dictionaries",
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
  // alpha.2 owns native Details in its top-level slot. Minke only uses the
  // public layout transitions to reserve that track for its right Tabs.
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
  const browserCommentsComposerCapability:
    AgentBrowserComposerBridge =
      createAgentBrowserComposerBridge(ctx.sessions);
  if (
    (
      agentBrowserPort.available ||
      tabsPort.embeddedWebAvailable
    ) &&
    ctx.inject !== undefined
  ) {
    ctx.inject(
      ["conversation", "inputTriggers"],
      (scope) => {
        const conversation = scope.get("conversation");
        const inputTriggers = scope.get("inputTriggers");
        scope.effect(
          () => (
            browserCommentsComposerCapability.connect(
              conversation,
              inputTriggers,
            )
          ),
          "minke-overlay: Browser comments Chat composer bridge",
        );
      },
    );
  }
  const browserCommentsChat = createAgentBrowserChatPort(
    ctx.sessions,
    browserCommentsComposerCapability,
  );

  const createTabsWorkspace = (
    tabs: TabsRuntime,
    placement: "bottom" | "right",
  ) => {
    const renderers = new TabRendererRegistry();
    const filesTabs = filesPort.available
      ? new FilesTabsController(tabs, filesPort, {
          placement,
        })
      : undefined;
    const webTabs = tabsPort.embeddedWebAvailable
      ? new WebTabsController(tabs, tabsPort, {
          chat: browserCommentsChat,
          history: agentBrowserPort.available
            ? agentBrowserPort
            : undefined,
          openLocalPath: ({ path, title }) =>
            filesTabs?.openLocalPath(
              path,
              title ?? filesT("files.tab.new"),
            ) ?? false,
        })
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
  const agentBrowserT =
    ctx.locale.bind<AgentBrowserTabsLocaleKey>(
      AGENT_BROWSER_TABS_NAMESPACE,
    ) as AgentBrowserTabsTranslate;
  const agentBrowserTabs = agentBrowserPort.available
    ? new AgentBrowserTabsController(
        rightTabs,
        agentBrowserPort,
        {
          chat: browserCommentsChat,
        },
      )
    : undefined;
  if (agentBrowserTabs !== undefined) {
    ctx.effect(
      () =>
        rightWorkspace.renderers.register(
          createAgentBrowserTabRenderer(
            agentBrowserTabs,
            agentBrowserT,
          ),
        ),
      "minke-overlay: right Agent Browser renderer",
    );
    ctx.effect(
      () => () => agentBrowserTabs.dispose(),
      "minke-overlay: right Agent Browser controller",
    );
    void agentBrowserTabs.initialize();
  }
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
        inject: () => ({
          runtimes,
          presentation: rightHost,
        }),
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
          inject: () => ({
            runtimes,
            presentation: rightHost,
          }),
        },
        TabsHeaderAction as ComponentType<never>,
      ),
  );
  return runtimes;
}
