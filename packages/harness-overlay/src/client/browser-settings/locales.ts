export const browserSettingsZh = {
  "browser.nav": "浏览器",
  "browser.title": "浏览器标识",
  "browser.description":
    "分别设置普通网页与 Agent 浏览会话使用的 User-Agent。输入框默认使用与当前 Chromium 内核匹配的推荐 Chrome UA，不包含 Minke 或 Electron 标识，也可以直接自定义。",
  // Compatibility for an older view retained during renderer hot updates.
  "browser.automatic.label": "推荐 Chrome UA",
  "browser.web.label": "普通访问",
  "browser.web.help":
    "用于普通 Web Tab。新的浏览器标识会在页面重新加载后生效。",
  "browser.agent.label": "Agent 访问",
  "browser.agent.help":
    "用于 Agent 创建和控制的临时浏览器会话。新的浏览会话会使用更新后的标识。",
  "browser.editHint":
    "修改后，离开输入框即自动保存；⌘/Ctrl + Enter 也可立即保存，换行会折叠为空格。",
  "browser.reset": "恢复推荐 UA",
  "browser.validation":
    "请输入不超过 512 个字符、仅包含可见 ASCII 字符的 User-Agent。",
  "browser.error.unavailable":
    "当前环境无法保存浏览器标识设置。",
  "browser.error.read":
    "无法读取浏览器标识设置，已暂时使用自动 Chrome UA。",
  "browser.error.write":
    "浏览器标识尚未保存，请检查输入内容或磁盘权限后重试。",
} as const;

export type BrowserSettingsLocaleKey =
  keyof typeof browserSettingsZh;

export type BrowserSettingsTranslate = (
  key: BrowserSettingsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const browserSettingsEn: Record<
  BrowserSettingsLocaleKey,
  string
> = {
  "browser.nav": "Browser",
  "browser.title": "Browser identity",
  "browser.description":
    "Set separate User-Agent values for ordinary pages and Agent browser sessions. Each field starts with the recommended Chrome UA for the embedded Chromium runtime, without Minke or Electron tokens, and remains fully editable.",
  "browser.automatic.label": "Recommended Chrome UA",
  "browser.web.label": "Ordinary browsing",
  "browser.web.help":
    "Used by ordinary Web Tabs. The new browser identity takes effect after the page reloads.",
  "browser.agent.label": "Agent browsing",
  "browser.agent.help":
    "Used by temporary browser sessions created and controlled by an Agent. New sessions use the updated identity.",
  "browser.editHint":
    "Changes save automatically when you leave the field; press Command/Ctrl + Enter to save immediately. Line breaks are folded into spaces.",
  "browser.reset": "Restore recommended UA",
  "browser.validation":
    "Enter a User-Agent with no more than 512 visible ASCII characters.",
  "browser.error.unavailable":
    "Browser identity settings cannot be saved in this environment.",
  "browser.error.read":
    "Browser identity settings could not be read. The automatic Chrome UA is in use for now.",
  "browser.error.write":
    "Browser identity settings were not saved. Check the value or disk permissions and try again.",
};
