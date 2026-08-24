import type {
  ComponentType,
} from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  MinkeSettingsSection,
} from "./MinkeSettingsSection.tsx";
import {
  minkeSettingsEn,
  minkeSettingsZh,
  type MinkeSettingsLocaleKey,
  type MinkeSettingsTranslate,
} from "./locales.ts";
import type {
  MinkeSettingsRuntime,
} from "./runtime.ts";
import {
  installMinkeSettingsNavigationLogo,
  installMinkeSettingsStyles,
} from "./styles.ts";

const MINKE_SETTINGS_NAMESPACE = "minke.settings";

/** Install one unified Minke section inside the existing DSH Settings shell. */
export function installMinkeSettings(
  ctx: HarnessClientContext,
  runtime: MinkeSettingsRuntime,
): void {
  ctx.effect(
    () =>
      ctx.locale.register(MINKE_SETTINGS_NAMESPACE, {
        zh: minkeSettingsZh,
        en: minkeSettingsEn,
      }),
    "minke-overlay: Minke Settings dictionaries",
  );
  const t = ctx.locale.bind<MinkeSettingsLocaleKey>(
    MINKE_SETTINGS_NAMESPACE,
  ) as MinkeSettingsTranslate;
  ctx.effect(
    () => installMinkeSettingsStyles(),
    "minke-overlay: Minke Settings styles",
  );
  ctx.effect(
    () => installMinkeSettingsNavigationLogo(() => t("nav")),
    "minke-overlay: Minke Settings navigation logo",
  );
  ctx.effect(
    () => () => runtime.dispose(),
    "minke-overlay: Minke Settings runtime",
  );

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "minke-settings",
        order: 4,
        label: () => t("nav"),
        locale: MINKE_SETTINGS_NAMESPACE,
        inject: () => ({ runtime }),
      },
      MinkeSettingsSection as ComponentType<never>,
    ),
  );
}
