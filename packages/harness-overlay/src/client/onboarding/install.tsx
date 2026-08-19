import type { ComponentType } from "react";
import type {
  HarnessClientContext,
} from "../core/context.ts";
import { WelcomeNoticeBypass } from "./WelcomeNoticeBypass.tsx";

/** Shadow the upstream internal-testing onboarding notice. */
export function installOnboarding(
  ctx: HarnessClientContext,
): void {
  ctx.slots.inject("settings.onboarding", () =>
    ctx.slots.register(
      {
        name: "settings.onboarding",
        id: "welcome-notice",
        order: -100,
        priority: -100,
      },
      WelcomeNoticeBypass as ComponentType<never>,
    ),
  );
}
