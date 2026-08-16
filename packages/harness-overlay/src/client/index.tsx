import type { ComponentType } from "react";
import {
  DEFAULT_SHORTCUT_BINDINGS,
} from "@minke/harness-overlay/shortcut-contract.ts";
import { openHarnessSettings } from "./actions.ts";
import {
  desktopSessionLogsPort,
  desktopShortcutStore,
  desktopTabsPort,
  desktopTerminalPort,
  desktopTerminalSettingsStore,
  desktopWindowLocalePort,
  desktopWindowThemePort,
  hasMacOSDesktopSurface,
  type HarnessColorScheme,
  type HarnessLocale,
  type HarnessThemePreference,
} from "./bridge.ts";
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
import { ShortcutRuntime } from "./runtime.ts";
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

interface SlotService {
  inject(name: string, callback: () => unknown): void;
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
      id: "minke-tabs-new-session-toggle";
      order: number;
      locale: string;
      inject: () => {
        runtime: TabsRuntime;
      };
    },
    component: ComponentType<never>,
  ): unknown;
  register(
    options: {
      name: "shell.overlay";
      id: "minke-tabs";
      order: number;
      locale: string;
      inject: () => {
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
        runtime: TabsRuntime;
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
}

const NAMESPACE = "minke.shortcuts";
const TABS_NAMESPACE = "minke.tabs";
const WEB_TABS_NAMESPACE = "minke.tabs.web";
const TERMINAL_TABS_NAMESPACE = "minke.tabs.terminal";

/** Cordis services required by this out-of-tree browser plugin. */
export const inject = [
  "slots",
  "locale",
  "theme",
  "workspaces",
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
  const terminalPort = desktopTerminalPort();
  const terminalSettingsStore = desktopTerminalSettingsStore();
  const terminalSettings = new TerminalSettingsRuntime(
    terminalSettingsStore,
  );
  const sessionLogsPort = desktopSessionLogsPort();
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
    if (terminalPort.available) {
      ctx.effect(
        () => installTerminalTabStyles(),
        "minke-overlay: Terminal tab styles",
      );
    }
    const tabs = new TabsRuntime({
      showPanel: () => ctx.layout.openDetails(),
      hidePanel: () => ctx.layout.closeDetails(),
    });
    const renderers = new TabRendererRegistry();
    const webTabs = new WebTabsController(tabs, tabsPort);
    const terminalTabs = terminalPort.available
      ? new TerminalTabsController(tabs, terminalPort)
      : undefined;
    const webT = ctx.locale.bind<WebTabsLocaleKey>(
      WEB_TABS_NAMESPACE,
    ) as WebTabsTranslate;
    ctx.effect(
      () => () => {
        terminalTabs?.dispose();
        webTabs.dispose();
        renderers.clear();
        tabs.dispose();
      },
      "minke-overlay: tabs runtime",
    );
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
        "minke-overlay: Terminal tab renderer",
      );
    }
    ctx.effect(
      () =>
        renderers.register(
          createWebTabRenderer(webTabs, webT),
        ),
      "minke-overlay: Web tab renderer",
    );
    ctx.effect(
      () => installWebLinkTabs(webTabs),
      "minke-overlay: Web link tabs",
    );
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "minke-tabs-new-session-toggle",
          order: 10,
          locale: TABS_NAMESPACE,
          inject: () => ({ runtime: tabs }),
        },
        NewSessionTabsHeaderAction as ComponentType<never>,
      ),
    );
    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "minke-tabs",
          order: 20,
          locale: TABS_NAMESPACE,
          inject: () => ({ runtime: tabs, renderers }),
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
            inject: () => ({ runtime: tabs }),
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
        id: "settings.open",
        label: () => t("action.settings"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["settings.open"],
        order: 0,
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
        run: () => {
          ctx.workspaces.startSession();
        },
      }),
    "minke-overlay: New Session shortcut",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "sidebar.toggle",
        label: () => t("action.toggleSidebar"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["sidebar.toggle"],
        order: 20,
        run: () => {
          ctx.layout.toggleSidebar();
        },
      }),
    "minke-overlay: Toggle Sidebar shortcut",
  );
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
