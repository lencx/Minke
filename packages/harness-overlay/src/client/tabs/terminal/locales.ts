export const terminalTabsZh = {
  "terminal.create.label": "终端",
  "terminal.tab.new": "终端",
  "terminal.view.label": "交互式终端",
  "terminal.state.starting": "正在启动终端…",
  "terminal.state.exited": "进程已退出（代码 {code}）",
  "terminal.state.failed": "终端启动失败",
  "terminal.settings.nav": "终端",
  "terminal.settings.title": "终端",
  "terminal.settings.description":
    "调整所有终端标签页的字体和文本间距。更改会立即应用。",
  "terminal.settings.fontFamily.label": "字体",
  "terminal.settings.fontFamily.help":
    "留空以使用应用的代码字体。支持 CSS 字体列表。",
  "terminal.settings.fontFamily.placeholder": "使用应用代码字体",
  "terminal.settings.fontSize.label": "字号",
  "terminal.settings.fontSize.help": "{min}–{max} 像素",
  "terminal.settings.lineHeight.label": "行高",
  "terminal.settings.lineHeight.help": "{min}–{max}",
  "terminal.settings.preview": "终端预览",
  "terminal.settings.reset": "恢复默认",
  "terminal.settings.error.unavailable": "当前环境无法保存终端设置。",
  "terminal.settings.error.read":
    "无法读取终端设置，修复配置文件后请重新启动应用。",
  "terminal.settings.error.write":
    "终端设置尚未保存，请检查磁盘权限后重试。",
  "terminal.settings.validation.fontFamily":
    "请输入有效的字体名称或字体列表。",
  "terminal.settings.validation.fontSize":
    "字号必须是 {min} 到 {max} 之间的整数。",
  "terminal.settings.validation.lineHeight":
    "行高必须在 {min} 到 {max} 之间。",
} as const;

export type TerminalTabsLocaleKey =
  keyof typeof terminalTabsZh;
export type TerminalTabsTranslate = (
  key: TerminalTabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const terminalTabsEn: Record<
  TerminalTabsLocaleKey,
  string
> = {
  "terminal.create.label": "Terminal",
  "terminal.tab.new": "Terminal",
  "terminal.view.label": "Interactive terminal",
  "terminal.state.starting": "Starting terminal…",
  "terminal.state.exited": "Process exited with code {code}",
  "terminal.state.failed": "Terminal failed to start",
  "terminal.settings.nav": "Terminal",
  "terminal.settings.title": "Terminal",
  "terminal.settings.description":
    "Adjust type and text spacing across every Terminal tab. Changes apply immediately.",
  "terminal.settings.fontFamily.label": "Font family",
  "terminal.settings.fontFamily.help":
    "Leave blank to use the app code font. CSS font lists are supported.",
  "terminal.settings.fontFamily.placeholder": "Use app code font",
  "terminal.settings.fontSize.label": "Font size",
  "terminal.settings.fontSize.help": "{min}–{max} pixels",
  "terminal.settings.lineHeight.label": "Line height",
  "terminal.settings.lineHeight.help": "{min}–{max}",
  "terminal.settings.preview": "Terminal preview",
  "terminal.settings.reset": "Restore defaults",
  "terminal.settings.error.unavailable":
    "Terminal settings cannot be saved in this environment.",
  "terminal.settings.error.read":
    "Terminal settings could not be read. Fix the settings file, then restart the app.",
  "terminal.settings.error.write":
    "Terminal settings were not saved. Check disk permissions and try again.",
  "terminal.settings.validation.fontFamily":
    "Enter a valid font name or font list.",
  "terminal.settings.validation.fontSize":
    "Font size must be a whole number from {min} to {max}.",
  "terminal.settings.validation.lineHeight":
    "Line height must be between {min} and {max}.",
};
