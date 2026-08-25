import type {
  BrowserAnnotationLabels,
} from "@minke/harness-overlay/client/tabs/browser-annotation/types.ts";

export const webTabsZh = {
  "web.create.label": "浏览器",
  "web.tab.new": "新标签页",
  "web.blank.title": "开始浏览",
  "web.blank.body": "输入网址或使用 Google 搜索",
  "web.nav.back": "后退",
  "web.nav.forward": "前进",
  "web.nav.reload": "重新加载",
  "web.nav.stop": "停止加载",
  "web.nav.external": "在默认浏览器中打开",
  "web.annotation.action.start": "框选网页并发送到对话",
  "web.annotation.action.cancel": "退出框选",
  "web.annotation.action.sending": "正在发送…",
  "web.annotation.action.sendCount": "发送 {count} 条标注",
  "web.annotation.action.dismiss": "关闭评论框",
  "web.annotation.action.add": "添加",
  "web.annotation.action.save": "保存",
  "web.annotation.action.delete": "删除",
  "web.annotation.action.editNumber": "编辑第 {number} 条标注",
  "web.annotation.comment.label": "网页元素评论",
  "web.annotation.comment.add": "添加评论",
  "web.annotation.comment.edit": "编辑评论",
  "web.annotation.comment.placeholder": "针对这个元素提问或说明…",
  "web.annotation.error.stale":
    "所选网页元素已不存在，请删除该标注或重新选择后再发送。",
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

export function webAnnotationLabels(
  t: WebTabsTranslate,
): BrowserAnnotationLabels {
  return {
    commentLabel: t("web.annotation.comment.label"),
    commentAdd: t("web.annotation.comment.add"),
    commentEdit: t("web.annotation.comment.edit"),
    commentPlaceholder: t(
      "web.annotation.comment.placeholder",
    ),
    actionDelete: t("web.annotation.action.delete"),
    actionDismiss: t("web.annotation.action.dismiss"),
    actionAdd: t("web.annotation.action.add"),
    actionSave: t("web.annotation.action.save"),
    errorStale: t("web.annotation.error.stale"),
    actionEditNumber: (number) =>
      t("web.annotation.action.editNumber")
        .replace("{number}", String(number)),
  };
}

export const webTabsEn: Record<WebTabsLocaleKey, string> = {
  "web.create.label": "Browser",
  "web.tab.new": "New tab",
  "web.blank.title": "Start browsing",
  "web.blank.body": "Enter a URL or search Google",
  "web.nav.back": "Back",
  "web.nav.forward": "Forward",
  "web.nav.reload": "Reload",
  "web.nav.stop": "Stop loading",
  "web.nav.external": "Open in default browser",
  "web.annotation.action.start": "Select page content for Chat",
  "web.annotation.action.cancel": "Stop selecting",
  "web.annotation.action.sending": "Sending…",
  "web.annotation.action.sendCount": "Send {count} annotations",
  "web.annotation.action.dismiss": "Close comment editor",
  "web.annotation.action.add": "Add",
  "web.annotation.action.save": "Save",
  "web.annotation.action.delete": "Delete",
  "web.annotation.action.editNumber": "Edit annotation {number}",
  "web.annotation.comment.label": "Page element comment",
  "web.annotation.comment.add": "Add comment",
  "web.annotation.comment.edit": "Edit comment",
  "web.annotation.comment.placeholder":
    "Ask about or describe this element…",
  "web.annotation.error.stale":
    "A selected page element is no longer available. Delete it or select it again before sending.",
  "web.address.label": "Search or enter a URL",
  "web.address.placeholder": "Search or enter a URL",
  "web.state.loading": "Loading {title}",
  "web.error.title": "This page could not be opened",
  "web.error.body":
    "The page failed to load. Try again or open it in your default browser.",
  "web.error.retry": "Try again",
  "web.error.external": "Open in browser",
};
