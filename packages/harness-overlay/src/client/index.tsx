import { installAbout } from "./about/install.tsx";
import { installWebBrand } from "./brand/install.tsx";
import type {
  HarnessClientContext,
} from "./core/context.ts";
import { installDataHome } from "./data-home/install.tsx";
import { installDesktopClient } from "./desktop/install.ts";
import { installLocalModel } from "./local-model/install.ts";
import { installOnboarding } from "./onboarding/install.tsx";
import { installPwa } from "./pwa/install.tsx";
import { installRemote } from "./remote/install.tsx";
import { installShortcuts } from "./shortcuts/install.tsx";
import { installTabs } from "./tabs/install.tsx";

/** Cordis services required by this out-of-tree browser plugin. */
export const inject = [
  "connection",
  "slots",
  "locale",
  "theme",
  "workspaces",
  "sessions",
  "layout",
];

/** Compose Minke features through Harness's public services and slots. */
export function apply(ctx: HarnessClientContext): void {
  installDesktopClient(ctx);
  installAbout(ctx);
  installDataHome(ctx);
  installWebBrand(ctx);
  installPwa(ctx);
  installLocalModel(ctx);
  installRemote(ctx);
  const tabsRuntimes = installTabs(ctx);
  installShortcuts(ctx, tabsRuntimes);
  installOnboarding(ctx);
}
