import type { ComponentType } from "react";
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
  installRemoteNavigationIcon,
  installRemoteStyles,
} from "./styles.ts";

const REMOTE_NAMESPACE = "minke.remote";

export interface InstalledRemoteFeature {
  readonly runtime: RemoteSettingsRuntime;
  readonly t: RemoteTranslate;
}

/** Register desktop-managed private remote access settings. */
export function installRemote(
  ctx: HarnessClientContext,
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
      () => installRemoteNavigationIcon(() => remoteT("nav")),
      "minke-overlay: remote navigation icon",
    );
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "minke-remote",
          order: 5,
          label: () => remoteT("nav"),
          locale: REMOTE_NAMESPACE,
          inject: () => ({
            runtime,
            t: remoteT,
          }),
        },
        RemoteSettingsSection as ComponentType<never>,
      ),
    );
  }
  return Object.freeze({
    runtime,
    t: remoteT,
  });
}
