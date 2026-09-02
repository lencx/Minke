export const preferencesZh = {
  "preferences.nav": "偏好设置",
  "preferences.title": "偏好设置",
  "preferences.description":
    "自定义 Minke 在当前设备上的显示与运行方式。",
  "preferences.category.workspace.title": "工作区",
  "preferences.category.workspace.description":
    "设置代码视图与终端的显示方式。",
  "preferences.category.application.title": "应用行为",
  "preferences.category.application.description":
    "管理作用于整个桌面应用的默认行为。",
  "preferences.code.title": "代码外观",
  "preferences.code.description":
    "文件视图与终端共享代码配色。为浅色和深色模式分别选择主题。",
  "preferences.codeTheme.light.label": "浅色模式",
  "preferences.codeTheme.light.help":
    "Minke 使用浅色外观时应用，可选择任意明暗配色。",
  "preferences.codeTheme.dark.label": "深色模式",
  "preferences.codeTheme.dark.help":
    "Minke 使用深色外观时应用，可选择任意明暗配色。",
  "preferences.codeTheme.preview": "{mode} · {theme}",
  "preferences.codeTheme.active": "当前",
  "preferences.code.error.unavailable":
    "当前环境无法保存代码主题。",
  "preferences.code.error.read":
    "无法读取代码主题，已暂时使用 GitHub 默认主题。",
  "preferences.code.error.write":
    "代码主题尚未保存，请检查磁盘权限后重试。",
  "preferences.terminal.title": "终端",
  "preferences.terminal.description":
    "设置所有终端标签页的字体与行距；终端颜色与代码视图保持一致。",
  "preferences.terminal.fontFamily.label": "字体",
  "preferences.terminal.fontFamily.help":
    "留空以使用应用的代码字体。支持 CSS 字体列表。",
  "preferences.terminal.fontFamily.placeholder": "使用应用代码字体",
  "preferences.terminal.fontSize.label": "字号",
  "preferences.terminal.fontSize.help": "{min}–{max} 像素",
  "preferences.terminal.lineHeight.label": "行高",
  "preferences.terminal.lineHeight.help": "{min}–{max}",
  "preferences.terminal.preview": "终端预览",
  "preferences.terminal.reset": "恢复终端默认值",
  "preferences.terminal.error.unavailable":
    "当前环境无法保存终端设置。",
  "preferences.terminal.error.read":
    "无法读取终端设置，修复配置文件后请重新启动应用。",
  "preferences.terminal.error.write":
    "终端设置尚未保存，请检查磁盘权限后重试。",
  "preferences.terminal.validation.fontFamily":
    "请输入有效的字体名称或字体列表。",
  "preferences.terminal.validation.fontSize":
    "字号必须是 {min} 到 {max} 之间的整数。",
  "preferences.terminal.validation.lineHeight":
    "行高必须在 {min} 到 {max} 之间。",
  "preferences.webSearch.title": "网页搜索",
  "preferences.webSearch.description":
    "设置 Minke 在原生网页工具失败时的后备行为。",
  "preferences.webSearch.fallback.label":
    "搜索失败时尝试备用来源",
  "preferences.webSearch.fallback.help":
    "原生 web_search 失败时使用相同查询重试；web_fetch 失败时搜索替代来源并保留原错误。重启 Minke 后生效。",
  "preferences.webSearch.error.unavailable":
    "当前环境无法保存网页搜索设置。",
  "preferences.webSearch.error.read":
    "无法读取网页搜索设置，已暂时使用默认值。",
  "preferences.webSearch.error.write":
    "网页搜索设置尚未保存，请检查磁盘权限后重试。",
  "preferences.update.title": "软件更新",
  "preferences.update.description":
    "控制 Minke 获取并验证新版本的方式。",
  "preferences.update.autoDownload.label": "自动下载更新",
  "preferences.update.autoDownload.help":
    "在后台下载并验证可信新版本；打开安装程序或显示 AppImage 前仍会请求确认。",
  "preferences.update.error.unavailable":
    "当前构建或平台不支持应用更新。",
  "preferences.update.error.read":
    "无法读取应用更新设置，已暂时使用默认值。",
  "preferences.update.error.write":
    "应用更新设置尚未保存，请检查磁盘权限后重试。",
} as const;

export type PreferencesLocaleKey = keyof typeof preferencesZh;
export type PreferencesTranslate = (
  key: PreferencesLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const preferencesEn: Record<
  PreferencesLocaleKey,
  string
> = {
  "preferences.nav": "Preferences",
  "preferences.title": "Preferences",
  "preferences.description":
    "Customize how Minke looks and behaves on this device.",
  "preferences.category.workspace.title": "Workspace",
  "preferences.category.workspace.description":
    "Control how code and Terminal content are displayed.",
  "preferences.category.application.title": "Application behavior",
  "preferences.category.application.description":
    "Manage defaults that apply across the desktop app.",
  "preferences.code.title": "Code appearance",
  "preferences.code.description":
    "Files and Terminal share code colors. Choose a theme for light and dark mode.",
  "preferences.codeTheme.light.label": "Light mode",
  "preferences.codeTheme.light.help":
    "Used when Minke has a light appearance. Any light or dark palette can be selected.",
  "preferences.codeTheme.dark.label": "Dark mode",
  "preferences.codeTheme.dark.help":
    "Used when Minke has a dark appearance. Any light or dark palette can be selected.",
  "preferences.codeTheme.preview": "{mode} · {theme}",
  "preferences.codeTheme.active": "Current",
  "preferences.code.error.unavailable":
    "Code theme preferences cannot be saved in this environment.",
  "preferences.code.error.read":
    "The code themes could not be read. GitHub defaults are being used for now.",
  "preferences.code.error.write":
    "The code theme was not saved. Check disk permissions and try again.",
  "preferences.terminal.title": "Terminal",
  "preferences.terminal.description":
    "Set the font and line spacing across all Terminal tabs. Terminal colors stay aligned with code views.",
  "preferences.terminal.fontFamily.label": "Font family",
  "preferences.terminal.fontFamily.help":
    "Leave blank to use the app code font. CSS font lists are supported.",
  "preferences.terminal.fontFamily.placeholder": "Use app code font",
  "preferences.terminal.fontSize.label": "Font size",
  "preferences.terminal.fontSize.help": "{min}–{max} pixels",
  "preferences.terminal.lineHeight.label": "Line height",
  "preferences.terminal.lineHeight.help": "{min}–{max}",
  "preferences.terminal.preview": "Terminal preview",
  "preferences.terminal.reset": "Restore Terminal defaults",
  "preferences.terminal.error.unavailable":
    "Terminal settings cannot be saved in this environment.",
  "preferences.terminal.error.read":
    "Terminal settings could not be read. Fix the settings file, then restart the app.",
  "preferences.terminal.error.write":
    "Terminal settings were not saved. Check disk permissions and try again.",
  "preferences.terminal.validation.fontFamily":
    "Enter a valid font name or font list.",
  "preferences.terminal.validation.fontSize":
    "Font size must be a whole number from {min} to {max}.",
  "preferences.terminal.validation.lineHeight":
    "Line height must be between {min} and {max}.",
  "preferences.webSearch.title": "Web search",
  "preferences.webSearch.description":
    "Choose what Minke does when native web tools cannot complete.",
  "preferences.webSearch.fallback.label":
    "Try alternate sources when search fails",
  "preferences.webSearch.fallback.help":
    "Retry the same query when native web_search fails. If web_fetch fails, search for alternate sources and preserve the original error. Restart Minke to apply changes.",
  "preferences.webSearch.error.unavailable":
    "Web search settings cannot be saved in this environment.",
  "preferences.webSearch.error.read":
    "Web search settings could not be read. Defaults are in use for now.",
  "preferences.webSearch.error.write":
    "Web search settings were not saved. Check disk permissions and try again.",
  "preferences.update.title": "Software updates",
  "preferences.update.description":
    "Control how Minke gets and verifies new versions.",
  "preferences.update.autoDownload.label":
    "Download updates automatically",
  "preferences.update.autoDownload.help":
    "Download and verify trusted versions in the background. Minke still asks before opening an installer or revealing an AppImage.",
  "preferences.update.error.unavailable":
    "Application updates are unavailable for this build or platform.",
  "preferences.update.error.read":
    "Application update settings could not be read. Defaults are in use for now.",
  "preferences.update.error.write":
    "Application update settings were not saved. Check disk permissions and try again.",
};
