import {
  isDesktopLocale,
  WINDOW_LOCALE_CHANNEL,
  type DesktopLocale,
} from "../locale-contract.ts";

/** Lifecycle handle for a window-scoped Harness locale listener. */
export type WindowLocaleBinding = Readonly<{
  dispose(): void;
}>;

type WindowLocaleListener = (event: unknown, locale: unknown) => void;

type WindowLocaleHost = Readonly<{
  webContents: {
    ipc: {
      off(channel: string, listener: WindowLocaleListener): void;
      on(channel: string, listener: WindowLocaleListener): void;
    };
  };
}>;

type DesktopLocaleTarget = Readonly<{
  setLocale(locale: DesktopLocale): void;
}>;

/**
 * Project validated, authorized Harness locale messages into desktop state.
 * The listener is window-scoped so closing a BrowserWindow releases it.
 */
export function bindWindowLocale(
  window: WindowLocaleHost,
  target: DesktopLocaleTarget,
  authorize: (event: unknown) => boolean,
): WindowLocaleBinding {
  let disposed = false;
  const ipc = window.webContents.ipc;
  const listener: WindowLocaleListener = (event, locale) => {
    if (!authorize(event) || !isDesktopLocale(locale)) return;
    target.setLocale(locale);
  };
  ipc.on(WINDOW_LOCALE_CHANNEL, listener);

  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ipc.off(WINDOW_LOCALE_CHANNEL, listener);
    },
  });
}
