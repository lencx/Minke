import type { ComponentType } from "react";
import {
  DEFAULT_SHORTCUT_BINDINGS,
} from "@minke/harness-overlay/shortcut-contract.ts";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopSessionLogsPort,
  desktopShortcutStore,
} from "../desktop/index.ts";
import {
  CommandPalette,
  createCommandPaletteRuntime,
  installCommandPaletteStyles,
  paletteEn,
  paletteZh,
  type PaletteLocaleKey,
  type PaletteTranslate,
} from "../palette/index.ts";
import type {
  TabsRuntimes,
} from "../tabs/install.tsx";
import type {
  MinkeSettingsRuntime,
} from "../minke-settings/index.ts";
import {
  hasOpenModalSurface,
  openHarnessSettings,
} from "./actions.ts";
import {
  en,
  zh,
  type ShortcutLocaleKey,
  type ShortcutTranslate,
} from "./locales.ts";
import {
  createShortcutSectionSource,
  type Observable,
  type ShortcutSectionState,
} from "./projection.ts";
import { ShortcutRuntime } from "./runtime.ts";
import { SessionNavigationHistory } from "./session-navigation.ts";
import {
  ShortcutSettingsPage,
} from "./ShortcutSection.tsx";
import {
  installShortcutStyles,
} from "./styles.ts";

const SHORTCUTS_NAMESPACE = "minke.shortcuts";
const PALETTE_NAMESPACE = "minke.palette";

/** Install native and browser shortcut actions plus their Settings surface. */
export function installShortcuts(
  ctx: HarnessClientContext,
  tabsRuntimes: TabsRuntimes | undefined,
  settings: MinkeSettingsRuntime,
): void {
  ctx.effect(
    () =>
      ctx.locale.register(SHORTCUTS_NAMESPACE, {
        zh,
        en,
      }),
    "minke-overlay: shortcut dictionaries",
  );
  ctx.effect(
    () => installShortcutStyles(),
    "minke-overlay: shortcut styles",
  );
  const t = ctx.locale.bind<ShortcutLocaleKey>(
    SHORTCUTS_NAMESPACE,
  ) as ShortcutTranslate;
  const shortcutStore = desktopShortcutStore();
  const sessionLogsPort = desktopSessionLogsPort();
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
  const commandPalette = createCommandPaletteRuntime(
    runtime,
    () => !hasOpenModalSurface(),
  );
  ctx.effect(
    () => () => commandPalette.dispose(),
    "minke-overlay: command palette runtime",
  );
  ctx.effect(
    () =>
      runtime.onBeforeInvoke((id) => {
        if (id !== "palette.open") commandPalette.close();
      }),
    "minke-overlay: command palette action arbitration",
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
      const offRuntime = runtime.subscribe(() =>
        commandPalette.refresh()
      );
      const offLocale = ctx.locale.subscribe(() =>
        commandPalette.refresh()
      );
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
  ctx.effect(
    () => () => {
      runtime.dispose();
    },
    "minke-overlay: shortcut runtime",
  );
  ctx.effect(
    () =>
      shortcutStore.subscribe((id) => {
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
          disabledReason: () =>
            sessionNavigation.canBack
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
          disabledReason: () =>
            sessionNavigation.canForward
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
    workspace: TabsRuntimes["workspaces"]["right"],
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
  if (tabsRuntimes !== undefined) {
    const registerTabAction = (
      id: string,
      label: PaletteLocaleKey,
      keyword: PaletteLocaleKey,
      workspace: TabsRuntimes["workspaces"]["right"],
      creatorId: string,
      order: number,
    ): void => {
      if (
        !workspace.renderers.creators().some(
          (candidate) => candidate.id === creatorId,
        )
      ) {
        return;
      }
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
    registerTabAction(
      "files.open",
      "action.openFiles",
      "keywords.files",
      tabsRuntimes.workspaces.right,
      "files",
      100,
    );
    registerTabAction(
      "terminal.open",
      "action.openTerminal",
      "keywords.terminal",
      tabsRuntimes.workspaces.bottom,
      "terminal",
      110,
    );
    registerTabAction(
      "browser.open",
      "action.openBrowser",
      "keywords.browser",
      tabsRuntimes.workspaces.right,
      "browser",
      120,
    );
    registerTabAction(
      "plugins.browse",
      "action.browsePlugins",
      "keywords.plugins",
      tabsRuntimes.workspaces.right,
      "plugins",
      130,
    );
  }
  void runtime.initialize();

  const source: Observable<ShortcutSectionState> =
    createShortcutSectionSource(runtime, ctx.locale);
  ctx.effect(
    () =>
      settings.register({
        id: "shortcuts",
        order: 20,
        label: () => t("nav"),
        icon: "shortcuts",
        keepAlive: false,
        render: () => (
          <ShortcutSettingsPage
            source={source}
            platform={runtime.platform}
            setBinding={runtime.setBinding.bind(runtime)}
            resetBinding={runtime.resetBinding.bind(runtime)}
            t={t}
          />
        ),
      }),
    "minke-overlay: shortcuts Minke Settings page",
  );
}
