/** Shortcut settings dictionaries. */
export const zh = {
  nav: "快捷键",
  title: "快捷键",
  description: "选择一个操作，然后按下新的组合键。设置由 Minke 保存。",
  record: "录制快捷键",
  recording: "请按下组合键…",
  unassigned: "未设置",
  reset: "恢复默认",
  disableHint: "按 Backspace 或 Delete 可取消分配，按 Escape 可退出录制。",
  conflict: "此快捷键已分配给“{action}”。",
  "action.settings": "打开设置",
  "action.commandPalette": "打开命令面板",
  "action.newSession": "新建会话",
  "action.focusComposer": "聚焦消息输入框",
  "action.sessionBack": "返回上一会话",
  "action.sessionForward": "前往下一会话",
  "action.toggleSidebar": "展开或折叠左侧栏",
  "action.toggleRightSidebar": "展开或折叠右侧栏",
  "action.toggleBottomPanel": "展开或折叠底部栏",
  "action.openRightFiles": "在右栏打开文件管理器",
  "action.openBottomFiles": "在底栏打开文件管理器",
  "action.openRightTerminal": "在右栏打开终端",
  "action.openBottomTerminal": "在底栏打开终端",
  "action.openRightBrowser": "在右栏打开浏览器",
  "action.openBottomBrowser": "在底栏打开浏览器",
  "action.openRightBrowserHistory": "在右栏打开浏览历史",
  "action.openBottomBrowserHistory": "在底栏打开浏览历史",
  "action.openRightPlugins": "在右栏打开插件",
  "action.openBottomPlugins": "在底栏打开插件",
  "error.unavailable": "当前页面没有连接到 Minke 桌面设置。",
  "error.read": "无法读取快捷键设置，请重新启动 Minke 后重试。",
  "error.write": "快捷键暂时无法保存，请再次修改以重试。",
} as const;

export type ShortcutLocaleKey = keyof typeof zh;
export type ShortcutTranslate = (
  key: ShortcutLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const en: Record<ShortcutLocaleKey, string> = {
  nav: "Shortcuts",
  title: "Keyboard shortcuts",
  description:
    "Select an action, then press its new key combination. Minke saves these settings.",
  record: "Record shortcut",
  recording: "Press a shortcut…",
  unassigned: "Unassigned",
  reset: "Reset to default",
  disableHint:
    "Press Backspace or Delete to unassign, or Escape to stop recording.",
  conflict: "This shortcut is already assigned to “{action}”.",
  "action.settings": "Open Settings",
  "action.commandPalette": "Open Command Palette",
  "action.newSession": "New Session",
  "action.focusComposer": "Focus Message Input",
  "action.sessionBack": "Back to Previous Session",
  "action.sessionForward": "Forward to Next Session",
  "action.toggleSidebar": "Toggle Sidebar",
  "action.toggleRightSidebar": "Toggle Right Sidebar",
  "action.toggleBottomPanel": "Toggle Bottom Panel",
  "action.openRightFiles": "Open File Manager in Right Panel",
  "action.openBottomFiles": "Open File Manager in Bottom Panel",
  "action.openRightTerminal": "Open Terminal in Right Panel",
  "action.openBottomTerminal": "Open Terminal in Bottom Panel",
  "action.openRightBrowser": "Open Browser in Right Panel",
  "action.openBottomBrowser": "Open Browser in Bottom Panel",
  "action.openRightBrowserHistory":
    "Open Browser History in Right Panel",
  "action.openBottomBrowserHistory":
    "Open Browser History in Bottom Panel",
  "action.openRightPlugins": "Open Plugins in Right Panel",
  "action.openBottomPlugins": "Open Plugins in Bottom Panel",
  "error.unavailable":
    "This page is not connected to Minke desktop settings.",
  "error.read":
    "Minke could not read shortcut settings. Restart Minke and try again.",
  "error.write":
    "Minke could not save this shortcut. Change it again to retry.",
};
