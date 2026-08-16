import { contextBridge, ipcRenderer } from "electron";
import {
  isProductShortcutActionId,
  parseShortcutBindings,
  SHORTCUT_INVOKE_CHANNEL,
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "../../packages/harness-overlay/src/shortcut-contract.ts";
import {
  parseTerminalSettings,
  TERMINAL_SETTINGS_READ_CHANNEL,
  TERMINAL_SETTINGS_WRITE_CHANNEL,
  type TerminalSettings,
} from "../../packages/harness-overlay/src/terminal-settings-contract.ts";
import {
  parseSessionLogExportId,
  SESSION_LOG_EXPORT_CHANNEL,
} from "../../packages/harness-overlay/src/session-export-contract.ts";
import {
  normalizeWebTabUrl,
  TABS_OPEN_EXTERNAL_CHANNEL,
} from "../../packages/harness-overlay/src/tabs/contract.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalCreateResult,
  parseTerminalEvent,
  parseTerminalResizeRequest,
  parseTerminalSessionId,
  parseTerminalWriteRequest,
  TABS_TERMINAL_CLOSE_CHANNEL,
  TABS_TERMINAL_CREATE_CHANNEL,
  TABS_TERMINAL_EVENT_CHANNEL,
  TABS_TERMINAL_RESIZE_CHANNEL,
  TABS_TERMINAL_WRITE_CHANNEL,
  type TerminalCreateRequest,
  type TerminalEvent,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from "../../packages/harness-overlay/src/tabs/terminal-contract.ts";
import {
  isDesktopLocale,
  WINDOW_LOCALE_CHANNEL,
  type DesktopLocale,
} from "../locale-contract.ts";
import {
  isWindowThemeMessage,
  WINDOW_THEME_CHANNEL,
  type WindowColorScheme,
  type WindowThemePreference,
  type WindowThemeMessage,
} from "../window-theme-contract.ts";

let observer: MutationObserver | undefined;
let lastMessage: WindowThemeMessage | undefined;
let hasAuthoritativeTheme = false;
const shortcutUnsubscribers = new Set<() => void>();
const terminalUnsubscribers = new Set<() => void>();

function currentColorScheme(): WindowColorScheme | undefined {
  const colorScheme = document.documentElement.style.colorScheme;
  return colorScheme === "light" || colorScheme === "dark"
    ? colorScheme
    : undefined;
}

function sameWindowThemeMessage(
  left: WindowThemeMessage | undefined,
  right: WindowThemeMessage,
): boolean {
  const leftPreference =
    left !== undefined && "preference" in left
      ? left.preference
      : undefined;
  return (
    left?.colorScheme === right.colorScheme &&
    leftPreference ===
      ("preference" in right ? right.preference : undefined)
  );
}

function sendWindowTheme(message: WindowThemeMessage): void {
  if (sameWindowThemeMessage(lastMessage, message)) return;
  lastMessage = message;
  ipcRenderer.send(WINDOW_THEME_CHANNEL, message);
}

function publishResolvedWindowTheme(): void {
  if (hasAuthoritativeTheme) return;
  const colorScheme = currentColorScheme();
  if (colorScheme === undefined) return;
  sendWindowTheme({ colorScheme });
}

function observeWindowTheme(): void {
  if (document.documentElement === null) {
    observer?.observe(document, {
      childList: true,
      subtree: true,
    });
    return;
  }

  observer?.disconnect();
  publishResolvedWindowTheme();
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
}

const shortcuts = Object.freeze({
  async read(): Promise<unknown> {
    return await ipcRenderer.invoke(SHORTCUT_SETTINGS_READ_CHANNEL);
  },
  async write(bindings: ShortcutBindings): Promise<void> {
    await ipcRenderer.invoke(
      SHORTCUT_SETTINGS_WRITE_CHANNEL,
      parseShortcutBindings(bindings),
    );
  },
  subscribe(
    listener: (id: ProductShortcutActionId) => void,
  ): () => void {
    const wrapped = (_event: unknown, id: unknown): void => {
      if (isProductShortcutActionId(id)) listener(id);
    };
    ipcRenderer.on(SHORTCUT_INVOKE_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      shortcutUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(SHORTCUT_INVOKE_CHANNEL, wrapped);
    };
    shortcutUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const locale = Object.freeze({
  publish(active: DesktopLocale): void {
    if (!isDesktopLocale(active)) {
      throw new TypeError("invalid Harness locale snapshot");
    }
    ipcRenderer.send(WINDOW_LOCALE_CHANNEL, active);
  },
});

const sessionLogs = Object.freeze({
  async export(sessionId: string): Promise<void> {
    await ipcRenderer.invoke(
      SESSION_LOG_EXPORT_CHANNEL,
      parseSessionLogExportId(sessionId),
    );
  },
});

const tabs = Object.freeze({
  openExternal(candidate: string): void {
    const url = normalizeWebTabUrl(candidate);
    if (url === undefined) {
      throw new TypeError("invalid Minke Web tab URL");
    }
    ipcRenderer.send(TABS_OPEN_EXTERNAL_CHANNEL, url);
  },
});

const terminal = Object.freeze({
  async readSettings(): Promise<unknown> {
    return await ipcRenderer.invoke(TERMINAL_SETTINGS_READ_CHANNEL);
  },
  async writeSettings(settings: TerminalSettings): Promise<void> {
    await ipcRenderer.invoke(
      TERMINAL_SETTINGS_WRITE_CHANNEL,
      parseTerminalSettings(settings),
    );
  },
  async create(request: TerminalCreateRequest): Promise<unknown> {
    return parseTerminalCreateResult(
      await ipcRenderer.invoke(
        TABS_TERMINAL_CREATE_CHANNEL,
        parseTerminalCreateRequest(request),
      ),
    );
  },
  write(request: TerminalWriteRequest): void {
    ipcRenderer.send(
      TABS_TERMINAL_WRITE_CHANNEL,
      parseTerminalWriteRequest(request),
    );
  },
  resize(request: TerminalResizeRequest): void {
    ipcRenderer.send(
      TABS_TERMINAL_RESIZE_CHANNEL,
      parseTerminalResizeRequest(request),
    );
  },
  close(sessionId: string): void {
    ipcRenderer.send(
      TABS_TERMINAL_CLOSE_CHANNEL,
      parseTerminalSessionId(sessionId),
    );
  },
  subscribe(listener: (event: TerminalEvent) => void): () => void {
    const wrapped = (_event: unknown, value: unknown): void => {
      try {
        listener(parseTerminalEvent(value));
      } catch {
        // Only main-process events matching the shared contract are delivered.
      }
    };
    ipcRenderer.on(TABS_TERMINAL_EVENT_CHANNEL, wrapped);
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      terminalUnsubscribers.delete(unsubscribe);
      ipcRenderer.off(TABS_TERMINAL_EVENT_CHANNEL, wrapped);
    };
    terminalUnsubscribers.add(unsubscribe);
    return unsubscribe;
  },
});

const surface = Object.freeze({
  kind: process.platform === "darwin" ? "macos" : "standard",
});

const windowTheme = Object.freeze({
  publish(
    preference: WindowThemePreference,
    colorScheme: WindowColorScheme,
  ): void {
    const message = { preference, colorScheme };
    if (!isWindowThemeMessage(message) || !("preference" in message)) {
      throw new TypeError("invalid Harness window theme snapshot");
    }
    hasAuthoritativeTheme = true;
    sendWindowTheme(message);
  },
});

contextBridge.exposeInMainWorld(
  "minkeDesktop",
  Object.freeze({
    locale,
    sessionLogs,
    tabs,
    terminal,
    shortcuts,
    surface,
    windowTheme,
  }),
);

observer = new MutationObserver(observeWindowTheme);
observeWindowTheme();

window.addEventListener(
  "unload",
  () => {
    for (const unsubscribe of [...shortcutUnsubscribers]) {
      unsubscribe();
    }
    for (const unsubscribe of [...terminalUnsubscribers]) {
      unsubscribe();
    }
    observer?.disconnect();
    observer = undefined;
  },
  { once: true },
);
