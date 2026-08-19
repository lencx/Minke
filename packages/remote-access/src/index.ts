/** Public interface of the Minke remote-access module. */
export {
  DEFAULT_REMOTE_SETTINGS,
  NO_REMOTE_AVAILABILITY,
  parseRemoteAvailability,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  parseRemoteSettingsSnapshot,
  REMOTE_METHODS,
  REMOTE_SETTINGS_READ_CHANNEL,
  REMOTE_SETTINGS_WRITE_CHANNEL,
  type RemoteAvailability,
  type RemoteMethodId,
  type RemoteRuntimeError,
  type RemoteRuntimeSnapshot,
  type RemoteRuntimeState,
  type RemoteSettings,
  type RemoteSettingsSnapshot,
} from "./contract.ts";
export {
  discoverRemoteCommands,
  type RemoteCommandDiscoveryOptions,
  type RemoteCommands,
} from "./discovery.ts";
export {
  parseLoopbackHarnessUrl,
  parseTailscaleStatusHostname,
  RemoteAccessError,
  RemoteAccessService,
  type RemoteAccessServiceOptions,
  type RemoteCommandExecutionOptions,
  type RemoteCommandExecutionResult,
  type RemoteCommandExecutor,
  type RemoteLaunchPlan,
  type RemoteProcessSpawner,
} from "./tailscale.ts";
