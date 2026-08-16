import {
  isProductShortcutActionId,
  parseShortcutBindings,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  parseTerminalSettings,
  type TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";
import {
  parseSessionLogExportId,
} from "@minke/harness-overlay/session-export-contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalEvent,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalEvent,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";

export interface ShortcutStore {
  readonly available: boolean;
  read(): Promise<ShortcutBindings>;
  write(bindings: ShortcutBindings): Promise<void>;
}

export interface TerminalSettingsStore {
  readonly available: boolean;
  read(): Promise<TerminalSettings>;
  write(settings: TerminalSettings): Promise<void>;
}

export interface DesktopShortcutPort extends ShortcutStore {
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
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
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void;
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

interface DesktopTabsBridge {
  openExternal(url: string): void;
}

interface DesktopTerminalBridge {
  create(request: TerminalCreateRequest): Promise<unknown>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  close(sessionId: string): void;
  subscribe(listener: (event: unknown) => void): () => void;
  readSettings(): Promise<unknown>;
  writeSettings(settings: TerminalSettings): Promise<void>;
}

interface DesktopSessionLogsBridge {
  export(sessionId: string): Promise<void>;
}

interface DesktopSurfaceBridge {
  readonly kind: "macos" | "standard";
}

interface DesktopBridgeWindow {
  minkeDesktop?: {
    locale?: DesktopWindowLocaleBridge;
    sessionLogs?: DesktopSessionLogsBridge;
    tabs?: DesktopTabsBridge;
    terminal?: DesktopTerminalBridge;
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
): DesktopShortcutPort {
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
      subscribe() {
        return () => {};
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
    subscribe(listener) {
      return bridge.subscribe((id) => {
        if (isProductShortcutActionId(id)) listener(id);
      });
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

export interface DesktopTabsPort {
  readonly available: boolean;
  openExternal(url: string): void;
}

export interface DesktopTerminalPort {
  readonly available: boolean;
  create(
    request: TerminalCreateRequest,
  ): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  close(sessionId: string): void;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
}

export interface DesktopSessionLogsPort {
  readonly available: boolean;
  export(sessionId: string): Promise<void>;
}

/** Adapt the native save/reveal workflow exposed by the isolated preload. */
export function desktopSessionLogsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopSessionLogsPort {
  const bridge = source.minkeDesktop?.sessionLogs;
  if (bridge === undefined) {
    return {
      available: false,
      async export() {
        throw new Error(
          "Minke desktop Session export bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async export(sessionId) {
      await bridge.export(parseSessionLogExportId(sessionId));
    },
  };
}

/** Adapt the isolated preload bridge used by host-backed tab actions. */
export function desktopTabsPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTabsPort {
  const bridge = source.minkeDesktop?.tabs;
  if (bridge === undefined) {
    return {
      available: false,
      openExternal() {},
    };
  }
  return {
    available: true,
    openExternal(url) {
      bridge.openExternal(url);
    },
  };
}

/** Adapt the isolated preload bridge used by interactive Terminal tabs. */
export function desktopTerminalPort(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopTerminalPort {
  const bridge = source.minkeDesktop?.terminal;
  if (bridge === undefined) {
    return {
      available: false,
      async create() {
        throw new Error(
          "Minke desktop Terminal bridge is unavailable",
        );
      },
      write() {},
      resize() {},
      close() {},
      subscribe() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async create(request) {
      return parseTerminalCreateResult(
        await bridge.create(parseTerminalCreateRequest(request)),
      );
    },
    write(request) {
      bridge.write(parseTerminalWriteRequest(request));
    },
    resize(request) {
      bridge.resize(parseTerminalResizeRequest(request));
    },
    close(sessionId) {
      bridge.close(parseTerminalSessionId(sessionId));
    },
    subscribe(listener) {
      return bridge.subscribe((event) => {
        listener(parseTerminalEvent(event));
      });
    },
  };
}

/** Adapt the Terminal bridge's durable rendering-settings verbs. */
export function desktopTerminalSettingsStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): TerminalSettingsStore {
  const bridge = source.minkeDesktop?.terminal;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        throw new Error(
          "Minke desktop Terminal settings bridge is unavailable",
        );
      },
      async write() {
        throw new Error(
          "Minke desktop Terminal settings bridge is unavailable",
        );
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseTerminalSettings(await bridge.readSettings());
    },
    async write(settings) {
      await bridge.writeSettings(parseTerminalSettings(settings));
    },
  };
}
