import { contextBridge, ipcRenderer } from "electron";
import {
  parseShortcutBindings,
  SHORTCUT_SETTINGS_READ_CHANNEL,
  SHORTCUT_SETTINGS_WRITE_CHANNEL,
  type ShortcutBindings,
} from "../../packages/harness-overlay/src/shortcut-contract.ts";
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
});

const locale = Object.freeze({
  publish(active: DesktopLocale): void {
    if (!isDesktopLocale(active)) {
      throw new TypeError("invalid Harness locale snapshot");
    }
    ipcRenderer.send(WINDOW_LOCALE_CHANNEL, active);
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
  Object.freeze({ locale, shortcuts, surface, windowTheme }),
);

observer = new MutationObserver(observeWindowTheme);
observeWindowTheme();

window.addEventListener(
  "unload",
  () => {
    observer?.disconnect();
    observer = undefined;
  },
  { once: true },
);
