import type { ComponentType } from "react";
import {
  DEFAULT_SHORTCUT_BINDINGS,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  aboutEn,
  aboutZh,
  installAboutStyles,
  MinkeAboutDialog,
  type AboutLocaleKey,
  type AboutTranslate,
} from "./about/index.tsx";
import { openHarnessSettings } from "./actions.ts";
import {
  desktopAboutInfo,
  desktopFilesPort,
  desktopModelRuntimeSettingsStore,
  desktopSessionLogsPort,
  desktopShortcutStore,
  desktopTabsPort,
  desktopTerminalPort,
  desktopTerminalSettingsStore,
  desktopWindowLocalePort,
  desktopWindowThemePort,
  hasMacOSDesktopSurface,
  type DesktopAboutInfo,
  type HarnessColorScheme,
  type HarnessLocale,
  type HarnessThemePreference,
} from "./bridge.ts";
import {
  installLocalModelSettings,
  localModelEn,
  localModelZh,
  LocalModelSettingsRuntime,
  type LocalModelLocaleKey,
  type LocalModelTranslate,
} from "./local-model/index.ts";
import { installDesktopSurface } from "./desktop-surface.ts";
import { ShortcutSection } from "./ShortcutSection.tsx";
import {
  en,
  zh,
  type ShortcutLocaleKey,
  type ShortcutTranslate,
} from "./locales.ts";
import {
  createShortcutSectionSource,
  type LocaleRevisionSource,
  type Observable,
  type ShortcutSectionState,
} from "./projection.ts";
import {
  CommandPalette,
  createCommandPaletteRuntime,
  installCommandPaletteStyles,
  paletteEn,
  paletteZh,
  type PaletteLocaleKey,
  type PaletteTranslate,
} from "./palette/index.ts";
import { ShortcutRuntime } from "./runtime.ts";
import { SessionNavigationHistory } from "./session-navigation.ts";
import {
  installSessionHeaderActionStyles,
  installTabsStyles,
  NewSessionTabsHeaderAction,
  SessionLogHeaderAction,
  TabRendererRegistry,
  tabsEn,
  TabsHeaderAction,
  TabsPanel,
  TabsRuntime,
  tabsZh,
} from "./tabs/index.ts";
import {
  createFilesTabRenderer,
  filesTabsEn,
  filesTabsZh,
  FilesTabsController,
  installFilesTabStyles,
  type FilesTabsLocaleKey,
  type FilesTabsTranslate,
} from "./tabs/files/index.ts";
import {
  createWebTabRenderer,
  installWebLinkTabs,
  installWebTabStyles,
  webTabsEn,
  webTabsZh,
  WebTabsController,
  type WebTabsLocaleKey,
  type WebTabsTranslate,
} from "./tabs/web/index.ts";
import {
  createTerminalTabRenderer,
  installTerminalSettingsNavigationIcon,
  installTerminalSettingsStyles,
  installTerminalTabStyles,
  terminalTabsEn,
  terminalTabsZh,
  TerminalTabsController,
  TerminalSettingsRuntime,
  TerminalSettingsSection,
  type TerminalTabsLocaleKey,
  type TerminalTabsTranslate,
} from "./tabs/terminal/index.ts";
import {
  installShortcutNavigationIcon,
  installShortcutStyles,
} from "./styles.ts";
import { WelcomeNoticeBypass } from "./WelcomeNoticeBypass.tsx";

interface LocaleService extends LocaleRevisionSource {
  register<Key extends string>(
    namespace: string,
    dictionaries: {
      zh: Record<Key, string>;
      en: Record<Key, string>;
    },
  ): () => void;
  bind<Key extends string>(
    namespace: string,
  ): (
    key: Key,
    params?: Record<string, unknown>,
  ) => string;
  getSnapshot(): { active: HarnessLocale; revision: number };
  subscribe(listener: () => void): () => void;
}

type TabsRuntimes = Readonly<{
  bottom: TabsRuntime;
  right: TabsRuntime;
}>;

type TabsWorkspace = Readonly<{
  renderers: TabRendererRegistry;
}>;

type TabsWorkspaces = Readonly<{
  bottom: TabsWorkspace;
  right: TabsWorkspace;
}>;

interface SlotService {
  inject(name: string, callback: () => unknown): void;
  register(
    options: {
      name: "sidebar.footer.action";
      id: "minke-about";
      order: number;
      label: () => string;
      locale: string;
      inject: () => {
        info: DesktopAboutInfo;
        openExternal(url: string): void;
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "settings.onboarding";
      id: "welcome-notice";
      order: number;
      priority: number;
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "settings.section";
      id: string;
      order: number;
      label: () => string;
      locale: string;
      inject: () => {
        hooks: { shortcuts: Observable<ShortcutSectionState> };
        platform: ShortcutRuntime["platform"];
        setBinding: ShortcutRuntime["setBinding"];
        resetBinding: ShortcutRuntime["resetBinding"];
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "settings.section";
      id: string;
      order: number;
      label: () => string;
      locale: string;
      inject: () => {
        runtime: TerminalSettingsRuntime;
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "shell.overlay";
      id: "minke-command-palette";
      order: number;
      locale: string;
      inject: () => {
        runtime: ReturnType<typeof createCommandPaletteRuntime>;
        platform: ShortcutRuntime["platform"];
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "shell.overlay";
      id: "minke-tabs-new-session-toggle";
      order: number;
      locale: string;
      inject: () => {
        runtimes: TabsRuntimes;
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "shell.overlay";
      id: "minke-tabs-right" | "minke-tabs-bottom";
      order: number;
      locale: string;
      inject: () => {
        placement: "right" | "bottom";
        runtime: TabsRuntime;
        renderers: TabRendererRegistry;
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "conversation.session.header.utilities";
      id: string;
      order: number;
      priority?: number;
      locale: string;
      inject: () => {
        runtimes: TabsRuntimes;
      } | {
        exportSession(sessionId: string): Promise<void>;
      };
    },
    component: ComponentType<never>,
  ): unknown;
}

interface HarnessClientContext {
  effect(
    callback: () => void | (() => void),
    label: string,
  ): unknown;
  locale: LocaleService;
  layout: {
    openDetails(): void;
    closeDetails(): void;
    toggleSidebar(): void;
  };
  slots: SlotService;
  theme: {
    getTheme(): {
      preference: HarnessThemePreference;
      active: { colorScheme: HarnessColorScheme };
    };
  };
  on(
    event: "theme/change",
    listener: (snapshot: {
      preference: HarnessThemePreference;
      active: { colorScheme: HarnessColorScheme };
    }) => void,
  ): void;
  on(
    event: "locale/change",
    listener: (snapshot: {
      active: HarnessLocale;
      revision: number;
    }) => void,
  ): void;
  workspaces: {
    startSession(workspaceId?: unknown): void;
  };
  sessions: {
    list: {
      getSnapshot(): {
        current: string | undefined;
        byId: Readonly<
          Record<string, { readonly cwd?: string } | undefined>
        >;
      };
      subscribe(listener: () => void): () => void;
    };
    open(sessionId: string): void;
  };
}

const NAMESPACE = "minke.shortcuts";
const ABOUT_NAMESPACE = "minke.about";
const TABS_NAMESPACE = "minke.tabs";
const FILES_TABS_NAMESPACE = "minke.tabs.files";
const WEB_TABS_NAMESPACE = "minke.tabs.web";
const TERMINAL_TABS_NAMESPACE = "minke.tabs.terminal";
const LOCAL_MODEL_NAMESPACE = "minke.local-model";
const PALETTE_NAMESPACE = "minke.palette";

/** Cordis services required by this out-of-tree browser plugin. */
export const inject = [
  "slots",
  "locale",
  "theme",
  "workspaces",
  "sessions",
  "layout",
];

/** Compose Minke product surfaces through Harness's public services and slots. */
export function apply(ctx: HarnessClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NAMESPACE, { zh, en }),
    "minke-overlay: shortcut dictionaries",
  );
  ctx.effect(
    () => installShortcutStyles(),
    "minke-overlay: shortcut styles",
  );
  const t = ctx.locale.bind<ShortcutLocaleKey>(
    NAMESPACE,
  ) as ShortcutTranslate;
  ctx.effect(
    () => installShortcutNavigationIcon(() => t("nav")),
    "minke-overlay: shortcut navigation icon",
  );
  if (hasMacOSDesktopSurface()) {
    ctx.effect(
      () => installDesktopSurface(),
      "minke-overlay: macOS desktop surface",
    );
  }

  const tabsPort = desktopTabsPort();
  const aboutInfo = desktopAboutInfo();
  if (aboutInfo.available) {
    ctx.effect(
      () =>
        ctx.locale.register(ABOUT_NAMESPACE, {
          zh: aboutZh,
          en: aboutEn,
        }),
      "minke-overlay: About dictionaries",
    );
    const aboutT = ctx.locale.bind<AboutLocaleKey>(
      ABOUT_NAMESPACE,
    ) as AboutTranslate;
    ctx.effect(
      () => installAboutStyles(),
      "minke-overlay: About styles",
    );
    ctx.slots.inject("sidebar.footer.action", () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          id: "minke-about",
          order: 100,
          label: () => aboutT("trigger"),
          locale: ABOUT_NAMESPACE,
          inject: () => ({
            info: aboutInfo,
            openExternal: (url: string) => {
              tabsPort.openExternal(url);
            },
          }),
        },
        MinkeAboutDialog as ComponentType<never>,
      ),
    );
  }
  const filesPort = desktopFilesPort();
  const terminalPort = desktopTerminalPort();
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );
  let tabsRuntimes: TabsRuntimes | undefined;
  let tabsWorkspaces: TabsWorkspaces | undefined;
  const modelRuntimeSettingsStore =
    desktopModelRuntimeSettingsStore();
  if (modelRuntimeSettingsStore.available) {
    ctx.effect(
      () =>
        ctx.locale.register(LOCAL_MODEL_NAMESPACE, {
          zh: localModelZh,
          en: localModelEn,
        }),
      "minke-overlay: local model settings dictionaries",
    );
    const modelRuntimeSettings = new LocalModelSettingsRuntime(
      modelRuntimeSettingsStore,
    );
    const localModelT = ctx.locale.bind<LocalModelLocaleKey>(
      LOCAL_MODEL_NAMESPACE,
    ) as LocalModelTranslate;
    ctx.effect(
      () => {
        let active = true;
        let disposeView = (): void => {};
        void modelRuntimeSettings.initialize().then(() => {
          if (!active) return;
          disposeView = installLocalModelSettings(
            modelRuntimeSettings,
            localModelT,
          );
        });
        return () => {
          active = false;
          disposeView();
          modelRuntimeSettings.dispose();
        };
      },
      "minke-overlay: local model settings runtime",
    );
  }
  const sessionLogsPort = desktopSessionLogsPort();
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
  if (tabsPort.available) {
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
    tabsRuntimes = runtimes;
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
        ? new FilesTabsController(tabs, filesPort)
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
    tabsWorkspaces = Object.freeze({
      bottom: bottomWorkspace,
      right: rightWorkspace,
    });
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
  }

  const windowLocale = desktopWindowLocalePort();
  const syncWindowLocale = (
    snapshot: ReturnType<LocaleService["getSnapshot"]>,
  ): void => {
    windowLocale.publish(snapshot.active);
  };
  syncWindowLocale(ctx.locale.getSnapshot());
  ctx.on("locale/change", syncWindowLocale);

  const windowTheme = desktopWindowThemePort();
  const syncWindowTheme = (
    snapshot: ReturnType<HarnessClientContext["theme"]["getTheme"]>,
  ): void => {
    windowTheme.publish(
      snapshot.preference,
      snapshot.active.colorScheme,
    );
  };
  syncWindowTheme(ctx.theme.getTheme());
  ctx.on("theme/change", syncWindowTheme);

  const shortcutStore = desktopShortcutStore();
  const runtime = new ShortcutRuntime(shortcutStore);
  ctx.effect(
    () =>
      ctx.locale.register(PALETTE_NAMESPACE, {
        zh: paletteZh,
        en: paletteEn,
      }),
    "minke-overlay: command palette dictionaries",
  );
  const paletteT = ctx.locale.bind<PaletteLocaleKey>(
    PALETTE_NAMESPACE,
  ) as PaletteTranslate;
  ctx.effect(
    () => installCommandPaletteStyles(),
    "minke-overlay: command palette styles",
  );
  const commandPalette = createCommandPaletteRuntime(runtime);
  ctx.effect(
    () => () => commandPalette.dispose(),
    "minke-overlay: command palette runtime",
  );
  const sessionNavigation = new SessionNavigationHistory((sessionId) => {
    ctx.sessions.open(sessionId);
  });
  const observeSessionSelection = (): void => {
    sessionNavigation.observe(
      ctx.sessions.list.getSnapshot().current,
    );
    commandPalette.refresh();
  };
  observeSessionSelection();
  ctx.effect(
    () => {
      const offRuntime = runtime.subscribe(() => commandPalette.refresh());
      const offLocale = ctx.locale.subscribe(() => commandPalette.refresh());
      const offSessions = ctx.sessions.list.subscribe(
        observeSessionSelection,
      );
      return () => {
        offRuntime();
        offLocale();
        offSessions();
      };
    },
    "minke-overlay: command palette projection",
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-command-palette",
        order: 100,
        locale: PALETTE_NAMESPACE,
        inject: () => ({
          runtime: commandPalette,
          platform: runtime.platform,
        }),
      },
      CommandPalette as ComponentType<never>,
    ),
  );
  ctx.effect(
    () => () => {
      runtime.dispose();
    },
    "minke-overlay: shortcut runtime",
  );
  ctx.effect(
    () => shortcutStore.subscribe((id) => {
      runtime.invoke(id);
    }),
    "minke-overlay: native shortcut menu",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "palette.open",
        label: () => t("action.commandPalette"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["palette.open"],
        order: -10,
        run: () => commandPalette.toggle(),
      }),
    "minke-overlay: Command Palette shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "settings.open",
        label: () => t("action.settings"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["settings.open"],
        order: 0,
        palette: {
          group: "application",
          order: 300,
          keywords: () => [paletteT("keywords.settings")],
        },
        run: () => {
          if (!openHarnessSettings()) {
            console.warn("Minke could not find the Harness Settings trigger");
          }
        },
      }),
    "minke-overlay: Settings shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "session.new",
        label: () => t("action.newSession"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["session.new"],
        order: 10,
        palette: {
          group: "session",
          order: 10,
          keywords: () => [paletteT("keywords.newSession")],
        },
        run: () => {
          ctx.workspaces.startSession();
        },
      }),
    "minke-overlay: New Session shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "session.back",
        label: () => t("action.sessionBack"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["session.back"],
        order: 20,
        palette: {
          group: "session",
          order: 20,
          keywords: () => [paletteT("keywords.previousSession")],
          disabledReason: () => sessionNavigation.canBack
            ? undefined
            : paletteT("disabled.previousSession"),
        },
        run: () => {
          sessionNavigation.back();
        },
      }),
    "minke-overlay: Session Back shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "session.forward",
        label: () => t("action.sessionForward"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["session.forward"],
        order: 30,
        palette: {
          group: "session",
          order: 30,
          keywords: () => [paletteT("keywords.nextSession")],
          disabledReason: () => sessionNavigation.canForward
            ? undefined
            : paletteT("disabled.nextSession"),
        },
        run: () => {
          sessionNavigation.forward();
        },
      }),
    "minke-overlay: Session Forward shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "sidebar.toggle",
        label: () => t("action.toggleSidebar"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["sidebar.toggle"],
        order: 40,
        palette: {
          group: "view",
          order: 200,
          keywords: () => [paletteT("keywords.sidebar")],
        },
        run: () => {
          ctx.layout.toggleSidebar();
        },
      }),
    "minke-overlay: Toggle Sidebar shortcut",
  );
  if (tabsRuntimes !== undefined) {
    ctx.effect(
      () =>
        runtime.register({
          id: "tabs.toggle",
          label: () => t("action.toggleRightSidebar"),
          defaultBinding: DEFAULT_SHORTCUT_BINDINGS["tabs.toggle"],
          order: 50,
          palette: {
            group: "view",
            order: 210,
            keywords: () => [paletteT("keywords.rightPanel")],
          },
          run: () => {
            tabsRuntimes.right.toggle();
          },
        }),
      "minke-overlay: Toggle Right Sidebar shortcut",
    );
    ctx.effect(
      () =>
        runtime.register({
          id: "tabs.bottom.toggle",
          label: () => t("action.toggleBottomPanel"),
          defaultBinding:
            DEFAULT_SHORTCUT_BINDINGS["tabs.bottom.toggle"],
          order: 60,
          palette: {
            group: "view",
            order: 220,
            keywords: () => [paletteT("keywords.bottomPanel")],
          },
          run: () => {
            tabsRuntimes.bottom.toggle();
          },
        }),
      "minke-overlay: Toggle Bottom Panel shortcut",
    );
  }
  if (sessionLogsPort.available) {
    ctx.effect(
      () =>
        runtime.register({
          id: "session.export",
          label: () => paletteT("action.exportSession"),
          defaultBinding: null,
          shortcutConfigurable: false,
          palette: {
            group: "session",
            order: 40,
            keywords: () => [paletteT("keywords.exportSession")],
            disabledReason: () =>
              ctx.sessions.list.getSnapshot().current === undefined
                ? paletteT("disabled.activeSession")
                : undefined,
          },
          run: () => {
            const sessionId = ctx.sessions.list.getSnapshot().current;
            if (sessionId === undefined) return;
            void sessionLogsPort
              .export(sessionId)
              .catch((error: unknown) => {
                console.warn(
                  "Minke could not export the current Session",
                  error,
                );
              });
          },
        }),
      "minke-overlay: Export Session palette action",
    );
  }
  const openTab = (
    workspace: TabsWorkspace,
    creatorId: string,
  ): void => {
    const creator = workspace.renderers.creators().find(
      (candidate) => candidate.id === creatorId,
    );
    if (creator === undefined) {
      console.warn(`Minke could not find the ${creatorId} tab creator`);
      return;
    }
    const sessions = ctx.sessions.list.getSnapshot();
    const cwd = sessions.current === undefined
      ? undefined
      : sessions.byId[sessions.current]?.cwd;
    creator.create({ cwd });
  };
  if (tabsWorkspaces !== undefined) {
    const registerTabAction = (
      id: string,
      label: PaletteLocaleKey,
      keyword: PaletteLocaleKey,
      workspace: TabsWorkspace,
      creatorId: string,
      order: number,
    ): void => {
      ctx.effect(
        () =>
          runtime.register({
            id,
            label: () => paletteT(label),
            defaultBinding: null,
            shortcutConfigurable: false,
            palette: {
              group: "open",
              order,
              keywords: () => [paletteT(keyword)],
            },
            run: () => openTab(workspace, creatorId),
          }),
        `minke-overlay: ${id} palette action`,
      );
    };
    if (filesPort.available) {
      registerTabAction(
        "files.open",
        "action.openFiles",
        "keywords.files",
        tabsWorkspaces.right,
        "files",
        100,
      );
    }
    if (terminalPort.available) {
      registerTabAction(
        "terminal.open",
        "action.openTerminal",
        "keywords.terminal",
        tabsWorkspaces.bottom,
        "terminal",
        110,
      );
    }
    registerTabAction(
      "browser.open",
      "action.openBrowser",
      "keywords.browser",
      tabsWorkspaces.right,
      "browser",
      120,
    );
    registerTabAction(
      "plugins.browse",
      "action.browsePlugins",
      "keywords.plugins",
      tabsWorkspaces.right,
      "plugins",
      130,
    );
  }
  void runtime.initialize();

  const source: Observable<ShortcutSectionState> =
    createShortcutSectionSource(runtime, ctx.locale);

  ctx.slots.inject("settings.onboarding", () =>
    ctx.slots.register(
      {
        name: "settings.onboarding",
        id: "welcome-notice",
        order: -100,
        priority: -100,
      },
      WelcomeNoticeBypass as ComponentType<never>,
    ),
  );

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "minke-shortcuts",
        order: 5,
        label: () => t("nav"),
        locale: NAMESPACE,
        inject: () => ({
          hooks: { shortcuts: source },
          platform: runtime.platform,
          setBinding: runtime.setBinding.bind(runtime),
          resetBinding: runtime.resetBinding.bind(runtime),
        }),
      },
      ShortcutSection as ComponentType<never>,
    ),
  );
}
