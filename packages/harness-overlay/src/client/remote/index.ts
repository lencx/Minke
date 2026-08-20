export {
  remoteEn,
  remoteZh,
  type RemoteLocaleKey,
  type RemoteTranslate,
} from "./locales.ts";
export {
  copyRemoteAddress,
  type RemoteClipboard,
} from "./clipboard.ts";
export {
  maskRemoteAddress,
  presentRemoteStatus,
  type RemoteStatusPresentation,
} from "./presentation.ts";
export {
  RemoteSettingsRuntime,
  type RemotePendingChange,
  type RemoteSettingsErrorKind,
  type RemoteSettingsSnapshot,
} from "./runtime.ts";
export {
  RemoteSettingsSection,
  type RemoteSettingsSectionProps,
} from "./RemoteSettingsSection.tsx";
export {
  installRemoteNavigationIcon,
  installRemoteStyles,
} from "./styles.ts";
