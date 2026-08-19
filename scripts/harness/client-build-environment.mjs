const HARNESS_CLIENT_ENVIRONMENT_PREFIX = "DSH_CLIENT_";
const HARNESS_CLIENT_PROFILE_SELECTOR = "DSH_BUILD_CLIENT_PROFILE";

/**
 * Build the environment inherited by the pinned Harness client build.
 *
 * Harness client values are compiled into browser artifacts. Remove any
 * inherited upstream profile or client values before selecting Minke's title
 * so a developer or release environment cannot rebrand the desktop window.
 */
export function minkeHarnessClientBuildEnvironment(
  inherited = process.env,
) {
  const environment = { ...inherited };
  for (const name of Object.keys(environment)) {
    if (
      name === HARNESS_CLIENT_PROFILE_SELECTOR ||
      name.startsWith(HARNESS_CLIENT_ENVIRONMENT_PREFIX)
    ) {
      delete environment[name];
    }
  }
  environment.DSH_CLIENT_TITLE = "Minke";
  return environment;
}
