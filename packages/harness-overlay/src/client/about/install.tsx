import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopAboutInfo,
  desktopTabsPort,
} from "../desktop/index.ts";
import {
  aboutEn,
  aboutZh,
  installAboutStyles,
  MinkeAboutDialog,
  type AboutLocaleKey,
  type AboutTranslate,
} from "./index.tsx";

const ABOUT_NAMESPACE = "minke.about";

/** Register the desktop-only About action and dialog. */
export function installAbout(ctx: HarnessClientContext): void {
  const aboutInfo = desktopAboutInfo();
  if (!aboutInfo.available) return;

  const tabsPort = desktopTabsPort();
  ctx.effect(
    () =>
      ctx.locale.register(ABOUT_NAMESPACE, {
        zh: aboutZh,
        en: aboutEn,
      }),
    "minke-overlay: About dictionaries",
  );
  const aboutT = ctx.locale.bind<AboutLocaleKey>(
    ABOUT_NAMESPACE,
  ) as AboutTranslate;
  ctx.effect(
    () => installAboutStyles(),
    "minke-overlay: About styles",
  );
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "minke-about",
        order: 100,
        label: () => aboutT("trigger"),
        locale: ABOUT_NAMESPACE,
        inject: () => ({
          info: aboutInfo,
          openExternal: (url: string) => {
            tabsPort.openExternal(url);
          },
        }),
      },
      MinkeAboutDialog as ComponentType<never>,
    ),
  );
}
