export {
  WebTabsController,
} from "./controller.ts";
export {
  installWebLinkTabs,
} from "./interceptor.ts";
export {
  recentWebHistorySuggestions,
  webHistoryDisplayAddress,
  WEB_HISTORY_SUGGESTION_LIMIT,
} from "./history-suggestions.ts";
export {
  webTabsEn,
  webTabsZh,
} from "./locales.ts";
export type {
  WebTabsLocaleKey,
  WebTabsTranslate,
} from "./locales.ts";
export {
  createWebTabRenderer,
} from "./renderer.tsx";
export {
  installWebTabStyles,
} from "./styles.ts";
