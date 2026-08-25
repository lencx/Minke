import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopBrowserSettingsStore,
} from "../desktop/index.ts";
import type {
  MinkeSettingsRuntime,
} from "../minke-settings/index.ts";
import {
  BrowserSettingsSection,
} from "./BrowserSettingsSection.tsx";
import {
  browserSettingsEn,
  browserSettingsZh,
  type BrowserSettingsLocaleKey,
  type BrowserSettingsTranslate,
} from "./locales.ts";
import {
  BrowserSettingsRuntime,
} from "./runtime.ts";
import {
  installBrowserSettingsStyles,
} from "./styles.ts";

const BROWSER_SETTINGS_NAMESPACE = "minke.browser-settings";

/** Install browser identity as an independent Minke Settings module. */
export function installBrowserSettings(
  ctx: HarnessClientContext,
  settings: MinkeSettingsRuntime,
): void {
  const store = desktopBrowserSettingsStore();
  if (!store.available) return;

  const runtime = new BrowserSettingsRuntime(
    store,
    globalThis.navigator.userAgent,
  );
  const t = ctx.locale.bind<BrowserSettingsLocaleKey>(
    BROWSER_SETTINGS_NAMESPACE,
  ) as BrowserSettingsTranslate;

  ctx.effect(
    () => () => runtime.dispose(),
    "minke-overlay: Browser settings runtime",
  );
  void runtime.initialize();
  ctx.effect(
    () =>
      ctx.locale.register(BROWSER_SETTINGS_NAMESPACE, {
        zh: browserSettingsZh,
        en: browserSettingsEn,
      }),
    "minke-overlay: Browser settings dictionaries",
  );
  ctx.effect(
    () => installBrowserSettingsStyles(),
    "minke-overlay: Browser settings styles",
  );
  ctx.effect(
    () =>
      settings.register({
        id: "browser",
        order: 10,
        label: () => t("browser.nav"),
        icon: "browser",
        render: () => (
          <BrowserSettingsSection runtime={runtime} t={t} />
        ),
      }),
    "minke-overlay: Browser Minke Settings page",
  );
}
