import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopTabsPort,
} from "../desktop/index.ts";
import {
  MinkeBrandMark,
  MinkeBrandName,
} from "./MinkeBrand.tsx";

const MINKE_BRAND_PRIORITY = -100;

/** Replace official DSH brand slots only in the normal Web projection. */
export function installWebBrand(ctx: HarnessClientContext): void {
  if (desktopTabsPort().embeddedWebAvailable) return;

  for (const name of [
    "conversation.hero.brand.mark",
    "sidebar.brand.mark",
  ]) {
    ctx.slots.inject(name, () =>
      ctx.slots.register(
        {
          name,
          priority: MINKE_BRAND_PRIORITY,
        },
        MinkeBrandMark as ComponentType<never>,
      )
    );
  }
  ctx.slots.inject("sidebar.brand.name", () =>
    ctx.slots.register(
      {
        name: "sidebar.brand.name",
        priority: MINKE_BRAND_PRIORITY,
      },
      MinkeBrandName as ComponentType<never>,
    ),
  );
}
