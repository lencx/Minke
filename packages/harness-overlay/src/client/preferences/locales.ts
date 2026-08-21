export const preferencesZh = {
  "preferences.nav": "个人偏好",
  "preferences.title": "个人偏好",
  "preferences.description":
    "集中管理代码编辑器和终端的显示偏好。更改会立即应用。",
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
    "Manage how the code editor and Terminal look in one place. Changes apply immediately.",
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
};
