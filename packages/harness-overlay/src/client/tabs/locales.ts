/** Copy owned by the content-agnostic right-side Tabs surface. */
export const tabsZh = {
  "panel.label": "标签页",
  "panel.create": "选择标签页类型",
  "panel.hide": "隐藏标签页面板",
  "panel.resizeRight": "调整标签页面板宽度",
  "panel.resizeBottom": "调整标签页面板高度",
  "header.sessionLog": "导出 Session 日志",
  "header.placement": "标签页面板位置",
  "header.openRight": "在右侧打开标签页面板",
  "header.closeRight": "关闭右侧标签页面板",
  "header.openBottom": "在底部打开标签页面板",
  "header.closeBottom": "关闭底部标签页面板",
  "tab.close": "关闭“{title}”",
  "tab.new": "新建标签页",
  "tab.reorder": "拖拽以重新排序“{title}”",
  "error.unsupported.title": "无法显示此标签页",
  "error.unsupported.body": "尚未安装用于显示“{kind}”内容的渲染器。",
} as const;

export type TabsLocaleKey = keyof typeof tabsZh;
export type TabsTranslate = (
  key: TabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const tabsEn: Record<TabsLocaleKey, string> = {
  "panel.label": "Tabs",
  "panel.create": "Choose a tab type",
  "panel.hide": "Hide Tabs panel",
  "panel.resizeRight": "Resize right Tabs panel",
  "panel.resizeBottom": "Resize bottom Tabs panel",
  "header.sessionLog": "Export Session log",
  "header.placement": "Tabs panel placement",
  "header.openRight": "Open Tabs panel on right",
  "header.closeRight": "Close right Tabs panel",
  "header.openBottom": "Open Tabs panel at bottom",
  "header.closeBottom": "Close bottom Tabs panel",
  "tab.close": "Close “{title}”",
  "tab.new": "New tab",
  "tab.reorder": "Drag to reorder “{title}”",
  "error.unsupported.title": "This tab cannot be displayed",
  "error.unsupported.body":
    "No renderer is installed for “{kind}” content yet.",
};
