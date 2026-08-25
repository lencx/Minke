import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopRemoteSettingsStore,
  desktopTabsPort,
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
  installRemoteStyles,
} from "./styles.ts";

const REMOTE_NAMESPACE = "minke.remote";

export interface InstalledRemoteFeature {
  readonly runtime: RemoteSettingsRuntime;
  readonly t: RemoteTranslate;
  readonly openExternal: (url: string) => void;
}

/** Install the desktop-managed private remote access runtime. */
export function installRemote(
  ctx: HarnessClientContext,
): InstalledRemoteFeature {
  const store = desktopRemoteSettingsStore();
  const tabsPort = desktopTabsPort();

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
  return Object.freeze({
    runtime,
    t: remoteT,
    openExternal(url: string): void {
      tabsPort.openExternal(url);
    },
  });
}
