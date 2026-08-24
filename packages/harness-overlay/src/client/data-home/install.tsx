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
  installDataHomeStyles,
  type DataHomeLocaleKey,
  type DataHomeTranslate,
} from "./index.ts";
import type {
  MinkeSettingsRuntime,
} from "../minke-settings/index.ts";

const DATA_HOME_NAMESPACE = "minke.data-home";

/** Register the desktop data-directory migration settings workflow. */
export function installDataHome(
  ctx: HarnessClientContext,
  settings: MinkeSettingsRuntime,
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
    () =>
      settings.register({
        id: "data-home",
        order: 30,
        label: () => dataHomeT("nav"),
        icon: "data-home",
        render: () => (
          <DataHomeSettingsSection
            runtime={dataHomeSettings}
            t={dataHomeT}
          />
        ),
      }),
    "minke-overlay: data-home Minke Settings page",
  );
}
