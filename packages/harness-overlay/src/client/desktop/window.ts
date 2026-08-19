import type {
  HarnessColorScheme,
  HarnessLocale,
  HarnessThemePreference,
} from "../core/context.ts";
import type {
  DesktopAboutInfo,
  DesktopBridgeWindow,
  DesktopWindowLocalePort,
  DesktopWindowThemePort,
} from "./contracts.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Read immutable product metadata projected by the isolated preload. */
export function desktopAboutInfo(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopAboutInfo {
  const about = source.minkeDesktop?.about;
  if (
    about === undefined ||
    !isNonEmptyString(about.productName) ||
    !isNonEmptyString(about.version) ||
    !isNonEmptyString(about.platform) ||
    !isNonEmptyString(about.arch)
  ) {
    return {
      available: false,
      productName: "Minke",
      version: "",
      platform: "",
      arch: "",
    };
  }
  return {
    available: true,
    productName: about.productName,
    version: about.version,
    platform: about.platform,
    arch: about.arch,
  };
}

/** True only inside the native macOS window that supplies the early surface. */
export function hasMacOSDesktopSurface(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): boolean {
  return source.minkeDesktop?.surface?.kind === "macos";
}

/** Keep Electron native chrome synchronized with the Harness theme. */
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
    publish(
      preference: HarnessThemePreference,
      colorScheme: HarnessColorScheme,
    ) {
      bridge.publish(preference, colorScheme);
    },
  };
}

/** Project Harness's active locale to the native Electron window. */
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
    publish(locale: HarnessLocale) {
      bridge.publish(locale);
    },
  };
}
