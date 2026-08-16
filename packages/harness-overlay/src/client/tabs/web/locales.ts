export const webTabsZh = {
  "web.create.label": "浏览器",
  "web.create.plugins": "插件",
  "web.tab.new": "新标签页",
  "web.blank.title": "开始浏览",
  "web.blank.body": "输入网址或使用 Google 搜索",
  "web.nav.back": "后退",
  "web.nav.forward": "前进",
  "web.nav.reload": "重新加载",
  "web.nav.stop": "停止加载",
  "web.nav.external": "在默认浏览器中打开",
  "web.address.label": "搜索或输入网址",
  "web.address.placeholder": "搜索或输入网址",
  "web.state.loading": "正在加载 {title}",
  "web.error.title": "无法打开此页面",
  "web.error.body":
    "页面加载失败。你可以重试，或改用默认浏览器打开。",
  "web.error.retry": "重试",
  "web.error.external": "在浏览器中打开",
} as const;

export type WebTabsLocaleKey = keyof typeof webTabsZh;
export type WebTabsTranslate = (
  key: WebTabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const webTabsEn: Record<WebTabsLocaleKey, string> = {
  "web.create.label": "Browser",
  "web.create.plugins": "Plugins",
  "web.tab.new": "New tab",
  "web.blank.title": "Start browsing",
  "web.blank.body": "Enter a URL or search Google",
  "web.nav.back": "Back",
  "web.nav.forward": "Forward",
  "web.nav.reload": "Reload",
  "web.nav.stop": "Stop loading",
  "web.nav.external": "Open in default browser",
  "web.address.label": "Search or enter a URL",
  "web.address.placeholder": "Search or enter a URL",
  "web.state.loading": "Loading {title}",
  "web.error.title": "This page could not be opened",
  "web.error.body":
    "The page failed to load. Try again or open it in your default browser.",
  "web.error.retry": "Try again",
  "web.error.external": "Open in browser",
};
