/**
 * Linux credential storage backend selection.
 *
 * Chromium picks its OSCrypt backend from the desktop environment. Desktop
 * environments Chromium does not recognize (Hyprland, sway, i3, Awesome, …)
 * fall back to `basic_text`, which Electron refuses to use for encryption.
 * Minke then reports "OS credential protection is unavailable" even though a
 * Secret Service (GNOME Keyring, KeePassXC, KWallet, …) is available on the
 * machine.
 *
 * The Secret Service backend works on every Linux desktop that ships a
 * keyring, so Minke requests it unless Chromium already selects KWallet,
 * which happens on KDE sessions.
 */

/** Explicit backend override, e.g. `MINKE_PASSWORD_STORE=kwallet5`. */
export const MINKE_PASSWORD_STORE_ENV = "MINKE_PASSWORD_STORE";

export type LinuxPasswordStore =
  | "basic"
  | "gnome-libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6";

export interface LinuxPasswordStoreEnvironment {
  readonly platform: NodeJS.Platform;
  readonly desktopEnvironment?: string | undefined;
  readonly desktopSession?: string | undefined;
  readonly kdeFullSession?: string | undefined;
  readonly kdeSessionVersion?: string | undefined;
  readonly explicitStore?: string | undefined;
  readonly hasPasswordStoreSwitch?: boolean | undefined;
}

export interface LinuxPasswordStoreDecision {
  readonly store: LinuxPasswordStore | undefined;
  readonly reason:
    | "explicit-override"
    | "invalid-override"
    | "not-linux"
    | "command-line-override"
    | "kde-default"
    | "secret-service-fallback";
}

const SUPPORTED_STORES: ReadonlySet<string> = new Set([
  "basic",
  "gnome-libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

/**
 * The desktop tokens of `XDG_CURRENT_DESKTOP`.
 *
 * Chromium compares the colon separated entries of that variable literally,
 * so the tokens are kept in their original spelling.
 */
export function desktopEnvironmentTokens(
  desktopEnvironment: string | undefined,
): string[] {
  if (desktopEnvironment === undefined) return [];
  return desktopEnvironment
    .split(":")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Decides which `--password-store` backend Minke should request.
 *
 * Chromium's existing switch takes precedence over the environment override.
 * KDE sessions use Chromium's KWallet default.
 */
export function resolveLinuxPasswordStore(
  environment: LinuxPasswordStoreEnvironment,
): LinuxPasswordStoreDecision {
  if (environment.platform !== "linux") {
    return { store: undefined, reason: "not-linux" };
  }
  if (environment.hasPasswordStoreSwitch) {
    return { store: undefined, reason: "command-line-override" };
  }
  const explicit = (environment.explicitStore ?? "").trim().toLowerCase();
  if (explicit.length > 0) {
    if (!SUPPORTED_STORES.has(explicit)) {
      return { store: undefined, reason: "invalid-override" };
    }
    return {
      store: explicit as LinuxPasswordStore,
      reason: "explicit-override",
    };
  }
  const tokens = desktopEnvironmentTokens(environment.desktopEnvironment);
  const desktopSession = environment.desktopSession;
  const legacyKde = desktopSession === "kde4" || desktopSession === "kde-plasma"
    || (environment.kdeSessionVersion !== undefined
      && (desktopSession === "kde" || environment.kdeFullSession !== undefined));
  if (tokens.includes("KDE") || legacyKde) {
    return { store: undefined, reason: "kde-default" };
  }
  return {
    store: "gnome-libsecret",
    reason: "secret-service-fallback",
  };
}

export interface PasswordStoreCommandLine {
  readonly commandLine: {
    hasSwitch(name: string): boolean;
    appendSwitch(name: string, value: string): void;
  };
}

/**
 * Requests the resolved backend from Chromium.
 *
 * Chromium reads the switch while it initializes OSCrypt, so the caller must
 * apply it before the first `safeStorage` use.
 */
export function applyLinuxPasswordStore(
  app: PasswordStoreCommandLine,
  environment: LinuxPasswordStoreEnvironment = {
    platform: process.platform,
    desktopEnvironment: process.env.XDG_CURRENT_DESKTOP,
    desktopSession: process.env.DESKTOP_SESSION,
    kdeFullSession: process.env.KDE_FULL_SESSION,
    kdeSessionVersion: process.env.KDE_SESSION_VERSION,
    explicitStore: process.env[MINKE_PASSWORD_STORE_ENV],
  },
): LinuxPasswordStoreDecision {
  const decision = resolveLinuxPasswordStore({
    ...environment,
    hasPasswordStoreSwitch: app.commandLine.hasSwitch("password-store"),
  });
  if (decision.store !== undefined) {
    app.commandLine.appendSwitch("password-store", decision.store);
  }
  return decision;
}
