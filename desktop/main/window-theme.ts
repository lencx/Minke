import {
  isWindowThemeMessage,
  WINDOW_THEME_CHANNEL,
  type WindowColorScheme,
} from "../window-theme-contract.ts";

/** Lifecycle handle for a window-scoped native theme listener. */
export type WindowThemeBinding = Readonly<{
  dispose(): void;
}>;

type WindowThemeHost = Readonly<{
  webContents: {
    ipc: {
      off(channel: string, listener: WindowThemeListener): void;
      on(channel: string, listener: WindowThemeListener): void;
    };
  };
}>;

type NativeThemeHost = {
  themeSource: "system" | WindowColorScheme;
};

type WindowThemeListener = (event: unknown, message: unknown) => void;

/**
 * Apply validated theme messages from one BrowserWindow to Electron's native
 * appearance and remove the listener when that window closes.
 */
export function bindWindowTheme(
  window: WindowThemeHost,
  nativeTheme: NativeThemeHost,
): WindowThemeBinding {
  let disposed = false;
  const ipc = window.webContents.ipc;
  const listener: WindowThemeListener = (_event, message) => {
    if (!isWindowThemeMessage(message)) return;
    const source =
      "preference" in message
        ? message.preference
        : message.colorScheme;
    if (nativeTheme.themeSource !== source) {
      nativeTheme.themeSource = source;
    }
  };
  ipc.on(WINDOW_THEME_CHANNEL, listener);

  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ipc.off(WINDOW_THEME_CHANNEL, listener);
    },
  });
}
