export interface MacOSSigningEnvironment {
  readonly CSC_KEYCHAIN?: string;
  readonly CSC_NAME?: string;
  readonly MINKE_MACOS_SIGN_IDENTITY?: string;
  readonly MINKE_MACOS_SIGN_KEYCHAIN?: string;
}

export interface MacOSSigningConfig {
  readonly identity: string;
  readonly identityValidation: boolean;
  readonly keychain: string | undefined;
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}

/**
 * Prefer an explicitly configured, stable signing identity for Keychain ACLs.
 * Local machines without a certificate retain the existing ad-hoc fallback.
 */
export function resolveMacOSSigningConfig(
  environment: MacOSSigningEnvironment,
): MacOSSigningConfig {
  const identity =
    optionalValue(environment.MINKE_MACOS_SIGN_IDENTITY) ??
    optionalValue(environment.CSC_NAME) ??
    "-";
  const keychain =
    optionalValue(environment.MINKE_MACOS_SIGN_KEYCHAIN) ??
    optionalValue(environment.CSC_KEYCHAIN);
  return Object.freeze({
    identity,
    identityValidation: identity !== "-",
    keychain,
  });
}
