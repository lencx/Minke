import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopDataHomeSettingsPort,
  shouldExposeDesktopDataHomeSettings,
} from "../desktop/index.ts";
import {
  dataHomeEn,
  dataHomeZh,
  DataHomeSettingsRuntime,
  DataHomeSettingsSection,
  installDataHomeNavigationIcon,
  installDataHomeStyles,
  type DataHomeLocaleKey,
  type DataHomeTranslate,
} from "./index.ts";

const DATA_HOME_NAMESPACE = "minke.data-home";

/** Register the desktop data-directory migration settings workflow. */
export function installDataHome(
  ctx: HarnessClientContext,
): void {
  const dataHomePort = desktopDataHomeSettingsPort();
  if (!shouldExposeDesktopDataHomeSettings()) return;

  ctx.effect(
    () =>
      ctx.locale.register(DATA_HOME_NAMESPACE, {
        zh: dataHomeZh,
        en: dataHomeEn,
      }),
    "minke-overlay: data-home dictionaries",
  );
  const dataHomeT = ctx.locale.bind<DataHomeLocaleKey>(
    DATA_HOME_NAMESPACE,
  ) as DataHomeTranslate;
  const dataHomeSettings = new DataHomeSettingsRuntime(
    dataHomePort,
  );
  ctx.effect(
    () => {
      void dataHomeSettings.initialize();
      return () => {
        dataHomeSettings.dispose();
      };
    },
    "minke-overlay: data-home runtime",
  );
  ctx.effect(
    () => installDataHomeStyles(),
    "minke-overlay: data-home styles",
  );
  ctx.effect(
    () => installDataHomeNavigationIcon(() => dataHomeT("nav")),
    "minke-overlay: data-home navigation icon",
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "minke-data-home",
        order: 4,
        label: () => dataHomeT("nav"),
        locale: DATA_HOME_NAMESPACE,
        inject: () => ({
          runtime: dataHomeSettings,
        }),
      },
      DataHomeSettingsSection as ComponentType<never>,
    ),
  );
}
