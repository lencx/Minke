import { translateDesktop } from "@minke/desktop/i18n";
import { resolveDesktopLocale } from "@minke/desktop/locale-contract";
import "./styles.css";

const locale = resolveDesktopLocale(
  new URLSearchParams(window.location.search).get("locale"),
);
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.getElementById("bootstrap-status")!.textContent =
  translateDesktop(locale, "bootstrap.loading");
