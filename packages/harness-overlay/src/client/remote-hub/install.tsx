import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopRemoteHubPort,
} from "../desktop/index.ts";
import type {
  InstalledRemoteFeature,
} from "../remote/install.tsx";
import {
  remoteHubEn,
  remoteHubZh,
  type RemoteHubLocaleKey,
  type RemoteHubTranslate,
} from "./locales.ts";
import {
  RemoteHubRuntime,
} from "./runtime.ts";
import {
  installRemoteHubStyles,
} from "./styles.ts";
import {
  NewSessionRemoteHubAction,
  RemoteHubAction,
  RemoteHubDialogHost,
} from "./view.tsx";

const REMOTE_HUB_NAMESPACE = "minke.remote-hub";

/** Install one top entry and one root dialog over the existing Remote runtime. */
export function installRemoteHub(
  ctx: HarnessClientContext,
  remote: InstalledRemoteFeature,
): RemoteHubRuntime | undefined {
  const port = desktopRemoteHubPort();
  if (!port.available && !remote.runtime.store.available) {
    return undefined;
  }
  const runtime = new RemoteHubRuntime(
    remote.runtime,
    port,
  );
  ctx.effect(
    () =>
      ctx.locale.register(REMOTE_HUB_NAMESPACE, {
        zh: remoteHubZh,
        en: remoteHubEn,
      }),
    "minke-overlay: Remote Hub dictionaries",
  );
  const t = ctx.locale.bind<RemoteHubLocaleKey>(
    REMOTE_HUB_NAMESPACE,
  ) as RemoteHubTranslate;
  ctx.effect(
    () => installRemoteHubStyles(),
    "minke-overlay: Remote Hub styles",
  );
  ctx.effect(
    () => {
      void runtime.initialize();
      return () => {
        void runtime.dispose();
      };
    },
    "minke-overlay: Remote Hub runtime",
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-remote-hub-new-session-action",
        order: 9,
        label: () => t("trigger"),
        locale: REMOTE_HUB_NAMESPACE,
        inject: () => ({ runtime }),
      },
      NewSessionRemoteHubAction as ComponentType<never>,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "minke-remote-hub-dialog",
        order: 90,
        label: () => t("title"),
        locale: REMOTE_HUB_NAMESPACE,
        inject: () => ({
          runtime,
          remoteT: remote.t,
        }),
      },
      RemoteHubDialogHost as ComponentType<never>,
    ),
  );
  ctx.slots.inject(
    "conversation.session.header.utilities",
    () =>
      ctx.slots.register(
        {
          name: "conversation.session.header.utilities",
          id: "minke-remote-hub-action",
          order: 5,
          label: () => t("trigger"),
          locale: REMOTE_HUB_NAMESPACE,
          inject: () => ({ runtime }),
        },
        RemoteHubAction as ComponentType<never>,
      ),
  );
  return runtime;
}
