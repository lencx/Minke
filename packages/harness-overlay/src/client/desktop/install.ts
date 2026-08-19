import type {
  HarnessClientContext,
  HarnessLocaleSnapshot,
  HarnessThemeSnapshot,
} from "../core/context.ts";
import { installDesktopSurface } from "./surface.ts";
import {
  desktopWindowLocalePort,
  desktopWindowThemePort,
  hasMacOSDesktopSurface,
} from "./window.ts";

/** Install native-surface behavior and synchronize Harness window state. */
export function installDesktopClient(
  ctx: HarnessClientContext,
): void {
  if (hasMacOSDesktopSurface()) {
    ctx.effect(
      () => installDesktopSurface(),
      "minke-overlay: macOS desktop surface",
    );
  }

  const windowLocale = desktopWindowLocalePort();
  const syncWindowLocale = (
    snapshot: HarnessLocaleSnapshot,
  ): void => {
    windowLocale.publish(snapshot.active);
  };
  syncWindowLocale(ctx.locale.getSnapshot());
  ctx.on("locale/change", syncWindowLocale);

  const windowTheme = desktopWindowThemePort();
  const syncWindowTheme = (
    snapshot: HarnessThemeSnapshot,
  ): void => {
    windowTheme.publish(
      snapshot.preference,
      snapshot.active.colorScheme,
    );
  };
  syncWindowTheme(ctx.theme.getTheme());
  ctx.on("theme/change", syncWindowTheme);
}
