/** Copy owned by the content-agnostic right-side Tabs surface. */
export const tabsZh = {
  "panel.label": "标签页",
  "panel.create": "选择标签页类型",
  "panel.hide": "隐藏标签页面板",
  "panel.resize": "调整标签页面板宽度",
  "header.sessionLog": "导出 Session 日志",
  "header.open": "打开标签页侧栏",
  "header.close": "关闭标签页侧栏",
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
  "panel.resize": "Resize Tabs panel",
  "header.sessionLog": "Export Session log",
  "header.open": "Open Tabs sidebar",
  "header.close": "Close Tabs sidebar",
  "tab.close": "Close “{title}”",
  "tab.new": "New tab",
  "tab.reorder": "Drag to reorder “{title}”",
  "error.unsupported.title": "This tab cannot be displayed",
  "error.unsupported.body":
    "No renderer is installed for “{kind}” content yet.",
};
