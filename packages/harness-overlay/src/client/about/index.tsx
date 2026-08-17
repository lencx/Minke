import MINKE_ICON_URL from "@minke/resources/icons/icon.png";
import type { ReactNode } from "react";
import {
  AboutDialog,
  type AboutDialogProps,
} from "./view.tsx";

export {
  AboutPanel,
  type AboutPanelProps,
} from "./view.tsx";
export {
  aboutMetadata,
  aboutTagline,
  DEEPSEEK_HARNESS_URL,
  MINKE_PROJECT_URL,
  platformLabel,
} from "./model.ts";
export {
  en as aboutEn,
  zh as aboutZh,
  type AboutLocaleKey,
  type AboutTranslate,
} from "./locales.ts";
export {
  ABOUT_STYLES,
  installAboutStyles,
} from "./styles.ts";

/** Bind the packaged Minke icon to the generic About surface. */
export function MinkeAboutDialog(
  props: Omit<AboutDialogProps, "iconUrl">,
): ReactNode {
  return <AboutDialog {...props} iconUrl={MINKE_ICON_URL} />;
}
