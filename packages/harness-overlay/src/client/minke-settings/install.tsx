import type {
  ComponentType,
} from "react";
import { MinkeBrandMark } from "../brand/MinkeBrand.tsx";
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
import { installMinkeSettingsStyles } from "./styles.ts";

const MINKE_SETTINGS_NAMESPACE = "minke.settings";
const MINKE_SETTINGS_SECTION_ID = "minke-settings";

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
    () => () => runtime.dispose(),
    "minke-overlay: Minke Settings runtime",
  );

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: MINKE_SETTINGS_SECTION_ID,
        order: 4,
        label: () => t("nav"),
        locale: MINKE_SETTINGS_NAMESPACE,
        inject: () => ({ runtime }),
      },
      MinkeSettingsSection as ComponentType<never>,
    ),
  );
  ctx.slots.inject("settings.section.icon", () =>
    ctx.slots.register(
      {
        name: "settings.section.icon",
        id: MINKE_SETTINGS_SECTION_ID,
        label: () => t("nav"),
      },
      ({ size }: { size: number }) => <MinkeBrandMark size={size} monochrome />,
    ),
  );
}
