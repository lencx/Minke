import { installAbout } from "./about/install.tsx";
import { installWebBrand } from "./brand/install.tsx";
import { installConversationOutline } from "./conversation-outline/install.tsx";
import type {
  HarnessClientContext,
} from "./core/context.ts";
import { installDataHome } from "./data-home/install.tsx";
import { installDesktopClient } from "./desktop/install.ts";
import { installLocalModel } from "./local-model/install.ts";
import {
  installMinkeSettings,
  MinkeSettingsRuntime,
} from "./minke-settings/index.ts";
import { installOnboarding } from "./onboarding/install.tsx";
import { installPwa } from "./pwa/install.tsx";
import { installRemote } from "./remote/install.tsx";
import { installRemoteHub } from "./remote-hub/install.tsx";
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
  const minkeSettings = new MinkeSettingsRuntime();
  installDesktopClient(ctx);
  installConversationOutline(ctx);
  installAbout(ctx);
  installDataHome(ctx, minkeSettings);
  installWebBrand(ctx);
  installPwa(ctx);
  installLocalModel(ctx);
  const remote = installRemote(ctx, minkeSettings);
  installRemoteHub(ctx, remote);
  const tabsRuntimes = installTabs(ctx, minkeSettings);
  installShortcuts(ctx, tabsRuntimes, minkeSettings);
  installMinkeSettings(ctx, minkeSettings);
  installOnboarding(ctx);
}
