import {
  parseShortcutBindings,
  type ShortcutBindings,
} from "../shortcut-contract.ts";

export interface ShortcutStore {
  readonly available: boolean;
  read(): Promise<ShortcutBindings>;
  write(bindings: ShortcutBindings): Promise<void>;
}

export type HarnessThemePreference = "light" | "dark" | "system";
export type HarnessColorScheme = "light" | "dark";
export type HarnessLocale = "zh" | "en";

export interface DesktopWindowThemePort {
  readonly available: boolean;
  publish(
    preference: HarnessThemePreference,
    colorScheme: HarnessColorScheme,
  ): void;
}

export interface DesktopWindowLocalePort {
  readonly available: boolean;
  publish(locale: HarnessLocale): void;
}

interface DesktopShortcutBridge {
  read(): Promise<unknown>;
  write(bindings: ShortcutBindings): Promise<void>;
}

interface DesktopWindowThemeBridge {
  publish(
    preference: HarnessThemePreference,
    colorScheme: HarnessColorScheme,
  ): void;
}

interface DesktopWindowLocaleBridge {
  publish(locale: HarnessLocale): void;
}

interface DesktopSurfaceBridge {
  readonly kind: "macos" | "standard";
}

interface DesktopBridgeWindow {
  minkeDesktop?: {
    locale?: DesktopWindowLocaleBridge;
    shortcuts?: DesktopShortcutBridge;
    surface?: DesktopSurfaceBridge;
    windowTheme?: DesktopWindowThemeBridge;
  };
}

/** True only inside the native macOS window that supplies the early surface. */
export function hasMacOSDesktopSurface(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): boolean {
  return source.minkeDesktop?.surface?.kind === "macos";
}

/** Adapt the isolated preload API to the shortcut runtime's small store port. */
export function desktopShortcutStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): ShortcutStore {
  const bridge = source.minkeDesktop?.shortcuts;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return {};
      },
      async write() {
        throw new Error("Minke desktop shortcut bridge is unavailable");
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseShortcutBindings(await bridge.read());
    },
    async write(bindings) {
      await bridge.write(parseShortcutBindings(bindings));
    },
  };
}

/** Adapt the preload bridge used to keep Electron native chrome on ctx.theme. */
export function desktopWindowThemePort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopWindowThemePort {
  const bridge = source.minkeDesktop?.windowTheme;
  if (bridge === undefined) {
    return {
      available: false,
      publish() {},
    };
  }
  return {
    available: true,
    publish(preference, colorScheme) {
      bridge.publish(preference, colorScheme);
    },
  };
}

/** Adapt the preload bridge that projects Harness's active locale to Electron. */
export function desktopWindowLocalePort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopWindowLocalePort {
  const bridge = source.minkeDesktop?.locale;
  if (bridge === undefined) {
    return {
      available: false,
      publish() {},
    };
  }
  return {
    available: true,
    publish(locale) {
      bridge.publish(locale);
    },
  };
}
