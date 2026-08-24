import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopRemoteSettingsStore,
} from "../desktop/index.ts";
import {
  remoteEn,
  remoteZh,
  type RemoteLocaleKey,
  type RemoteTranslate,
} from "./locales.ts";
import {
  RemoteSettingsRuntime,
} from "./runtime.ts";
import {
  RemoteSettingsSection,
} from "./RemoteSettingsSection.tsx";
import {
  installRemoteStyles,
} from "./styles.ts";
import type {
  MinkeSettingsRuntime,
} from "../minke-settings/index.ts";

const REMOTE_NAMESPACE = "minke.remote";

export interface InstalledRemoteFeature {
  readonly runtime: RemoteSettingsRuntime;
  readonly t: RemoteTranslate;
}

/** Register desktop-managed private remote access settings. */
export function installRemote(
  ctx: HarnessClientContext,
  settings: MinkeSettingsRuntime,
): InstalledRemoteFeature {
  const store = desktopRemoteSettingsStore();

  ctx.effect(
    () =>
      ctx.locale.register(REMOTE_NAMESPACE, {
        zh: remoteZh,
        en: remoteEn,
      }),
    "minke-overlay: remote dictionaries",
  );
  const remoteT = ctx.locale.bind<RemoteLocaleKey>(
    REMOTE_NAMESPACE,
  ) as RemoteTranslate;
  const runtime = new RemoteSettingsRuntime(store);
  ctx.effect(
    () => {
      void runtime.initialize();
      return () => {
        runtime.dispose();
      };
    },
    "minke-overlay: remote settings runtime",
  );
  ctx.effect(
    () => installRemoteStyles(),
    "minke-overlay: remote settings styles",
  );
  if (store.available) {
    ctx.effect(
      () =>
        settings.register({
          id: "remote",
          order: 40,
          label: () => remoteT("nav"),
          icon: "remote",
          render: () => (
            <RemoteSettingsSection runtime={runtime} t={remoteT} />
          ),
        }),
      "minke-overlay: remote Minke Settings page",
    );
  }
  return Object.freeze({
    runtime,
    t: remoteT,
  });
}
