import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopTabsPort,
} from "../desktop/index.ts";
import {
  en,
  type PwaLocaleKey,
  type PwaTranslate,
  zh,
} from "./locales.ts";
import {
  PwaInstallRuntime,
} from "./runtime.ts";
import {
  installPwaStyles,
} from "./styles.ts";
import {
  PwaInstallAction,
} from "./view.tsx";

const PWA_NAMESPACE = "minke.pwa";

/** Add install affordances only to the browser projection. */
export function installPwa(ctx: HarnessClientContext): void {
  if (desktopTabsPort().embeddedWebAvailable) return;

  const runtime = new PwaInstallRuntime();
  ctx.effect(
    () => runtime.mount(),
    "minke-overlay: PWA install runtime",
  );
  ctx.effect(
    () =>
      ctx.locale.register(PWA_NAMESPACE, {
        zh,
        en,
      }),
    "minke-overlay: PWA dictionaries",
  );
  const t = ctx.locale.bind<PwaLocaleKey>(
    PWA_NAMESPACE,
  ) as PwaTranslate;
  ctx.effect(
    () => installPwaStyles(),
    "minke-overlay: PWA styles",
  );
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "minke-pwa-install",
        order: 90,
        label: () => t("trigger"),
        locale: PWA_NAMESPACE,
        inject: () => ({ runtime, t }),
      },
      PwaInstallAction as ComponentType<never>,
    ),
  );
}
