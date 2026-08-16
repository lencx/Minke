import type { ComponentType } from "react";
import { openHarnessSettings } from "./actions.ts";
import {
  desktopShortcutStore,
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
  installShortcutNavigationIcon,
  installShortcutStyles,
} from "./styles.ts";
import { WelcomeNoticeBypass } from "./WelcomeNoticeBypass.tsx";

export {
  IconKeyboardOutline16,
  KEYBOARD_ICON_SVG,
} from "./icons/index.tsx";

interface LocaleService extends LocaleRevisionSource {
  register(
    namespace: string,
    dictionaries: {
      zh: Record<ShortcutLocaleKey, string>;
      en: Record<ShortcutLocaleKey, string>;
    },
  ): () => void;
  bind(namespace: string): ShortcutTranslate;
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
}

interface HarnessClientContext {
  effect(
    callback: () => void | (() => void),
    label: string,
  ): unknown;
  locale: LocaleService;
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

/** Cordis services required by this out-of-tree browser plugin. */
export const inject = ["slots", "locale", "theme", "workspaces"];

/** Compose Minke shortcuts through Harness's public client services and slots. */
export function apply(ctx: HarnessClientContext): void {
  ctx.effect(
    () => ctx.locale.register(NAMESPACE, { zh, en }),
    "minke-overlay: shortcut dictionaries",
  );
  ctx.effect(
    () => installShortcutStyles(),
    "minke-overlay: shortcut styles",
  );
  const t = ctx.locale.bind(NAMESPACE);
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

  const runtime = new ShortcutRuntime(desktopShortcutStore());
  ctx.effect(
    () => () => {
      runtime.dispose();
    },
    "minke-overlay: shortcut runtime",
  );
  ctx.effect(
    () =>
      runtime.register({
        id: "settings.open",
        label: () => t("action.settings"),
        defaultBinding: "Mod+Comma",
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
        defaultBinding: "Mod+N",
        order: 10,
        run: () => {
          ctx.workspaces.startSession();
        },
      }),
    "minke-overlay: New Session shortcut",
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
