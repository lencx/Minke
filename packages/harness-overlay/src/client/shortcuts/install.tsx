import type { ComponentType } from "react";
import {
  DEFAULT_SHORTCUT_BINDINGS,
} from "@minke/harness-overlay/shortcut-contract.ts";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopShortcutStore,
} from "../desktop/index.ts";
import type {
  TabsRuntimes,
} from "../tabs/install.tsx";
import { openHarnessSettings } from "./actions.ts";
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
import { ShortcutSection } from "./ShortcutSection.tsx";
import {
  installShortcutNavigationIcon,
  installShortcutStyles,
} from "./styles.ts";

const SHORTCUTS_NAMESPACE = "minke.shortcuts";

/** Install native and browser shortcut actions plus their Settings surface. */
export function installShortcuts(
  ctx: HarnessClientContext,
  tabsRuntimes: TabsRuntimes | undefined,
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
  ctx.effect(
    () => installShortcutNavigationIcon(() => t("nav")),
    "minke-overlay: shortcut navigation icon",
  );

  const shortcutStore = desktopShortcutStore();
  const runtime = new ShortcutRuntime(shortcutStore);
  const sessionNavigation = new SessionNavigationHistory((sessionId) => {
    ctx.sessions.open(sessionId);
  });
  const observeSessionSelection = (): void => {
    sessionNavigation.observe(
      ctx.sessions.list.getSnapshot().current,
    );
  };
  observeSessionSelection();
  ctx.effect(
    () => ctx.sessions.list.subscribe(observeSessionSelection),
    "minke-overlay: Session navigation history",
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
        id: "session.back",
        label: () => t("action.sessionBack"),
        defaultBinding: DEFAULT_SHORTCUT_BINDINGS["session.back"],
        order: 20,
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
          run: () => {
            tabsRuntimes.bottom.toggle();
          },
        }),
      "minke-overlay: Toggle Bottom Panel shortcut",
    );
  }
  void runtime.initialize();

  const source: Observable<ShortcutSectionState> =
    createShortcutSectionSource(runtime, ctx.locale);
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "minke-shortcuts",
        order: 5,
        label: () => t("nav"),
        locale: SHORTCUTS_NAMESPACE,
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
