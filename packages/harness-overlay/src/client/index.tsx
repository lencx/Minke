import { installAbout } from "./about/install.tsx";
import { installBrand } from "./brand/install.tsx";
import { installBrowserSettings } from "./browser-settings/index.ts";
import type {
  HarnessClientContext,
} from "./core/context.ts";
import { installDataHome } from "./data-home/install.tsx";
import { installDesktopClient } from "./desktop/install.ts";
import { installFeedback } from "./feedback/install.ts";
import { installLocalModel } from "./local-model/install.ts";
import {
  installMinkeSettings,
  MinkeSettingsRuntime,
} from "./minke-settings/index.ts";
import { installOnboarding } from "./onboarding/install.tsx";
import { installPwa } from "./pwa/install.tsx";
import { installRemote } from "./remote/install.tsx";
import { installRemoteHub } from "./remote-hub/install.tsx";
import { installIconButtonStyles } from "./shared/icon-button.ts";
import { installShortcuts } from "./shortcuts/install.tsx";
import { installTabs } from "./tabs/install.tsx";

/** Cordis services required by this out-of-tree browser plugin. */
export const inject = [
  "connection",
  "remote",
  "slots",
  "locale",
  "theme",
  "uiWorkspace",
  "sessions",
  "layout",
  "shortcuts",
];

/** Compose Minke features through Harness's public services and slots. */
export function apply(ctx: HarnessClientContext): void {
  const minkeSettings = new MinkeSettingsRuntime();
  ctx.effect(() => installIconButtonStyles(), "minke-overlay: icon button styles");
  installDesktopClient(ctx);
  installFeedback(ctx);
  installAbout(ctx);
  installDataHome(ctx, minkeSettings);
  installBrowserSettings(ctx, minkeSettings);
  installBrand(ctx);
  installPwa(ctx);
  installLocalModel(ctx);
  const remote = installRemote(ctx);
  installRemoteHub(ctx, remote);
  const tabsRuntimes = installTabs(ctx, minkeSettings);
  installShortcuts(ctx, tabsRuntimes);
  installMinkeSettings(ctx, minkeSettings);
  installOnboarding(ctx);
}
