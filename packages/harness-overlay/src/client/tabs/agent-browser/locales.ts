import type {
  BrowserAnnotationLabels,
} from "@minke/harness-overlay/client/tabs/browser-annotation/types.ts";

export const agentBrowserTabsZh = {
  "agentBrowser.action.takeControl": "接管页面",
  "agentBrowser.action.returnControl": "交还给 Agent",
  "agentBrowser.nav.back": "后退",
  "agentBrowser.nav.forward": "前进",
  "agentBrowser.nav.reload": "刷新",
  "agentBrowser.nav.stop": "停止加载",
  "agentBrowser.history.action.open": "浏览历史",
  "agentBrowser.history.action.close": "关闭浏览足迹",
  "agentBrowser.history.action.clear": "清空浏览足迹",
  "agentBrowser.history.title": "浏览足迹",
  "agentBrowser.history.privacy":
    "记录仅保存在本机，不会自动提供给 Agent。",
  "agentBrowser.history.summary.label": "浏览足迹概览",
  "agentBrowser.history.summary.total": "{count} 次访问",
  "agentBrowser.history.summary.paths": "{count} 个路径",
  "agentBrowser.history.summary.actors":
    "Agent {agent} · 你 {human}",
  "agentBrowser.history.filter.all": "全部",
  "agentBrowser.history.filter.human": "你",
  "agentBrowser.history.filter.agent": "Agent",
  "agentBrowser.history.timeline":
    "显示 {shown} 条 · 本机保留 {retained} 条",
  "agentBrowser.history.actor.human": "你",
  "agentBrowser.history.actor.agent": "Agent",
  "agentBrowser.history.visit.count": "此路径共 {count} 次",
  "agentBrowser.history.loading": "正在读取浏览足迹…",
  "agentBrowser.history.empty": "还没有符合条件的浏览足迹",
  "agentBrowser.history.error": "无法读取浏览足迹",
  "agentBrowser.history.clear.confirm":
    "清空所有浏览足迹？此操作无法撤销。",
  "agentBrowser.history.clear.cancel": "取消",
  "agentBrowser.history.clear.confirmAction": "确认清空",
  "agentBrowser.history.clear.clearing": "正在清空…",
  "agentBrowser.annotation.action.start": "标注网页",
  "agentBrowser.annotation.action.cancel": "退出标注",
  "agentBrowser.annotation.action.send": "发送",
  "agentBrowser.annotation.action.sending": "正在发送…",
  "agentBrowser.annotation.action.sendCount": "发送 {count} 条标注",
  "agentBrowser.annotation.action.dismiss": "关闭评论框",
  "agentBrowser.annotation.action.add": "添加",
  "agentBrowser.annotation.action.save": "保存",
  "agentBrowser.annotation.action.delete": "删除",
  "agentBrowser.annotation.action.editNumber": "编辑第 {number} 条标注",
  "agentBrowser.annotation.comment.label": "网页元素评论",
  "agentBrowser.annotation.comment.add": "添加评论",
  "agentBrowser.annotation.comment.edit": "编辑评论",
  "agentBrowser.annotation.comment.placeholder": "针对这个元素提问或说明…",
  "agentBrowser.annotation.comment.shortcut": "⌘/Ctrl + Enter 添加",
  "agentBrowser.annotation.error.stale":
    "所选网页元素已不存在，请删除该标注或重新选择后再发送。",
  "agentBrowser.annotation.status.active": "正在标注",
  "agentBrowser.annotation.status.pick": "点击网页元素",
  "agentBrowser.annotation.status.count": "已添加 {count} 条",
  "agentBrowser.state.agent": "Agent 正在操作",
  "agentBrowser.state.human": "你正在操作",
  "agentBrowser.state.pending": "正在切换控制权",
  "agentBrowser.state.crashed": "浏览器页面已崩溃",
  "agentBrowser.tab.defaultTitle": "Agent 浏览器",
} as const;

export type AgentBrowserTabsLocaleKey =
  keyof typeof agentBrowserTabsZh;

export type AgentBrowserTabsTranslate = (
  key: AgentBrowserTabsLocaleKey,
) => string;

export function agentBrowserAnnotationLabels(
  t: AgentBrowserTabsTranslate,
): BrowserAnnotationLabels {
  return {
    commentLabel: t("agentBrowser.annotation.comment.label"),
    commentAdd: t("agentBrowser.annotation.comment.add"),
    commentEdit: t("agentBrowser.annotation.comment.edit"),
    commentPlaceholder: t(
      "agentBrowser.annotation.comment.placeholder",
    ),
    actionDelete: t("agentBrowser.annotation.action.delete"),
    actionDismiss: t("agentBrowser.annotation.action.dismiss"),
    actionAdd: t("agentBrowser.annotation.action.add"),
    actionSave: t("agentBrowser.annotation.action.save"),
    errorStale: t("agentBrowser.annotation.error.stale"),
    actionEditNumber: (number) =>
      t("agentBrowser.annotation.action.editNumber")
        .replace("{number}", String(number)),
  };
}

export const agentBrowserTabsEn: Record<
  AgentBrowserTabsLocaleKey,
  string
> = {
  "agentBrowser.action.takeControl": "Take control",
  "agentBrowser.action.returnControl": "Return control",
  "agentBrowser.nav.back": "Back",
  "agentBrowser.nav.forward": "Forward",
  "agentBrowser.nav.reload": "Reload",
  "agentBrowser.nav.stop": "Stop loading",
  "agentBrowser.history.action.open": "Browser History",
  "agentBrowser.history.action.close": "Close browsing footprint",
  "agentBrowser.history.action.clear": "Clear browsing footprint",
  "agentBrowser.history.title": "Browsing footprint",
  "agentBrowser.history.privacy":
    "Stored only on this device and never shared with the agent automatically.",
  "agentBrowser.history.summary.label": "Browsing footprint summary",
  "agentBrowser.history.summary.total": "{count} visits",
  "agentBrowser.history.summary.paths": "{count} paths",
  "agentBrowser.history.summary.actors":
    "Agent {agent} · You {human}",
  "agentBrowser.history.filter.all": "All",
  "agentBrowser.history.filter.human": "You",
  "agentBrowser.history.filter.agent": "Agent",
  "agentBrowser.history.timeline":
    "Showing {shown} · {retained} retained locally",
  "agentBrowser.history.actor.human": "You",
  "agentBrowser.history.actor.agent": "Agent",
  "agentBrowser.history.visit.count": "{count} visits to this path",
  "agentBrowser.history.loading": "Loading browsing footprint…",
  "agentBrowser.history.empty": "No matching browsing footprint yet",
  "agentBrowser.history.error": "Could not load browsing footprint",
  "agentBrowser.history.clear.confirm":
    "Clear all browsing footprint data? This cannot be undone.",
  "agentBrowser.history.clear.cancel": "Cancel",
  "agentBrowser.history.clear.confirmAction": "Clear all",
  "agentBrowser.history.clear.clearing": "Clearing…",
  "agentBrowser.annotation.action.start": "Annotate page",
  "agentBrowser.annotation.action.cancel": "Stop annotating",
  "agentBrowser.annotation.action.send": "Send",
  "agentBrowser.annotation.action.sending": "Sending…",
  "agentBrowser.annotation.action.sendCount": "Send {count} annotations",
  "agentBrowser.annotation.action.dismiss": "Close comment editor",
  "agentBrowser.annotation.action.add": "Add",
  "agentBrowser.annotation.action.save": "Save",
  "agentBrowser.annotation.action.delete": "Delete",
  "agentBrowser.annotation.action.editNumber": "Edit annotation {number}",
  "agentBrowser.annotation.comment.label": "Page element comment",
  "agentBrowser.annotation.comment.add": "Add comment",
  "agentBrowser.annotation.comment.edit": "Edit comment",
  "agentBrowser.annotation.comment.placeholder": "Ask about or describe this element…",
  "agentBrowser.annotation.comment.shortcut": "⌘/Ctrl + Enter to add",
  "agentBrowser.annotation.error.stale":
    "A selected page element is no longer available. Delete it or select it again before sending.",
  "agentBrowser.annotation.status.active": "Annotating",
  "agentBrowser.annotation.status.pick": "Click a page element",
  "agentBrowser.annotation.status.count": "{count} added",
  "agentBrowser.state.agent": "Agent is controlling",
  "agentBrowser.state.human": "You are controlling",
  "agentBrowser.state.pending": "Switching control",
  "agentBrowser.state.crashed": "Browser crashed",
  "agentBrowser.tab.defaultTitle": "Agent Browser",
};
