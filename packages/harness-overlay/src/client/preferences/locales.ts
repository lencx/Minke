export const preferencesZh = {
  "preferences.nav": "个人偏好",
  "preferences.title": "个人偏好",
  "preferences.description":
    "集中管理编辑器、终端、网页搜索和应用更新偏好。",
  "preferences.code.title": "代码与终端主题",
  "preferences.code.description":
    "代码编辑器与终端共享同一主题。分别设置 Minke 浅色与深色外观，每个外观都可选择任意配色。",
  "preferences.codeTheme.light.label": "浅色外观",
  "preferences.codeTheme.light.help":
    "Minke 使用浅色外观时应用，也可以选择深色代码主题。",
  "preferences.codeTheme.dark.label": "深色外观",
  "preferences.codeTheme.dark.help":
    "Minke 使用深色外观时应用，也可以选择浅色代码主题。",
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
    "调整所有终端标签页的字体和文本间距；颜色跟随上方当前主题。",
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
    "控制 Minke 是否注册免凭据的默认搜索 provider。",
  "preferences.webSearch.fallback.label":
    "启用 Minke 默认搜索兜底",
  "preferences.webSearch.fallback.help":
    "仅在未通过 web.searchProvider 或 DSH_WEB_SEARCH_PROVIDER 显式选择 provider 时生效。关闭后不会自动回退；重启 Minke 后生效。",
  "preferences.webSearch.error.unavailable":
    "当前环境无法保存网页搜索设置。",
  "preferences.webSearch.error.read":
    "无法读取网页搜索设置，已暂时使用默认值。",
  "preferences.webSearch.error.write":
    "网页搜索设置尚未保存，请检查磁盘权限后重试。",
  "preferences.update.title": "应用更新",
  "preferences.update.description":
    "Minke 只接受不可变 GitHub Release，并在打开对应平台安装包前校验下载地址、大小、SHA-256 和可用的系统来源属性。",
  "preferences.update.autoDownload.label": "自动下载更新",
  "preferences.update.autoDownload.help":
    "开启后在后台下载并校验可信新版本；打开安装包或显示 AppImage 始终需要你的确认。",
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
  "preferences.title": "Personal preferences",
  "preferences.description":
    "Manage editor, Terminal, web search, and update preferences in one place.",
  "preferences.code.title": "Code & Terminal themes",
  "preferences.code.description":
    "The code editor and Terminal share one theme. Choose any palette separately for Minke's light and dark appearances.",
  "preferences.codeTheme.light.label": "Light appearance",
  "preferences.codeTheme.light.help":
    "Used when Minke has a light appearance. Dark code themes are also available.",
  "preferences.codeTheme.dark.label": "Dark appearance",
  "preferences.codeTheme.dark.help":
    "Used when Minke has a dark appearance. Light code themes are also available.",
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
    "Adjust type and text spacing across every Terminal tab. Colors follow the active theme above.",
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
    "Control whether Minke registers its credential-free default search provider.",
  "preferences.webSearch.fallback.label":
    "Enable Minke default search fallback",
  "preferences.webSearch.fallback.help":
    "Used only when no provider is selected through web.searchProvider or DSH_WEB_SEARCH_PROVIDER. Disabling it does not fall back automatically; restart Minke for changes to take effect.",
  "preferences.webSearch.error.unavailable":
    "Web search settings cannot be saved in this environment.",
  "preferences.webSearch.error.read":
    "Web search settings could not be read. Defaults are in use for now.",
  "preferences.webSearch.error.write":
    "Web search settings were not saved. Check disk permissions and try again.",
  "preferences.update.title": "Application updates",
  "preferences.update.description":
    "Minke accepts only immutable GitHub Releases and verifies the download URL, size, SHA-256 digest, and available OS provenance marker before opening the platform installer.",
  "preferences.update.autoDownload.label":
    "Download updates automatically",
  "preferences.update.autoDownload.help":
    "Download and verify trusted new versions in the background. Opening an installer or revealing an AppImage always requires your confirmation.",
  "preferences.update.error.unavailable":
    "Application updates are unavailable for this build or platform.",
  "preferences.update.error.read":
    "Application update settings could not be read. Defaults are in use for now.",
  "preferences.update.error.write":
    "Application update settings were not saved. Check disk permissions and try again.",
};
