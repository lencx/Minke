export const agentBrowserTabsZh = {
  "agentBrowser.action.takeControl": "接管页面",
  "agentBrowser.action.returnControl": "交还给 Agent",
  "agentBrowser.annotation.action.start": "标注网页",
  "agentBrowser.annotation.action.cancel": "退出标注",
  "agentBrowser.annotation.action.send": "发送",
  "agentBrowser.annotation.action.sendCount": "发送 {count} 条标注",
  "agentBrowser.annotation.action.dismiss": "关闭评论框",
  "agentBrowser.annotation.action.add": "添加",
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

export const agentBrowserTabsEn: Record<
  AgentBrowserTabsLocaleKey,
  string
> = {
  "agentBrowser.action.takeControl": "Take control",
  "agentBrowser.action.returnControl": "Return control",
  "agentBrowser.annotation.action.start": "Annotate page",
  "agentBrowser.annotation.action.cancel": "Stop annotating",
  "agentBrowser.annotation.action.send": "Send",
  "agentBrowser.annotation.action.sendCount": "Send {count} annotations",
  "agentBrowser.annotation.action.dismiss": "Close comment editor",
  "agentBrowser.annotation.action.add": "Add",
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
