export const pluginsZh = {
  "plugins.create.label": "插件",
  "plugins.tab.title": "插件",
  "plugins.install.title": "安装插件",
  "plugins.install.body":
    "粘贴插件仓库提供的安装命令。Minke 只会解析并安装一个 web profile 插件。",
  "plugins.install.label": "插件安装命令",
  "plugins.install.placeholder":
    "dsh plugin --profile web add <package-or-github-repo>",
  "plugins.install.action": "安装",
  "plugins.install.installing": "正在安装",
  "plugins.install.invalid":
    "仅支持 dsh plugin --profile web add <包名或 github:仓库>。",
  "plugins.install.trust":
    "第三方插件可能执行安装脚本，请只安装你信任的来源。",
  "plugins.install.success":
    "安装完成。重启 Minke 后插件生效。",
  "plugins.install.failed": "安装失败：{message}",
  "plugins.browser.title": "在 GitHub 上浏览插件",
  "plugins.browser.topic": "github.com/topics/dsh-plugin",
  "plugins.browser.searchLabel": "搜索 GitHub 插件仓库",
  "plugins.browser.searchPlaceholder":
    "搜索插件名称、仓库或描述",
  "plugins.browser.searchClear": "清除搜索内容",
  "plugins.browser.loading": "正在载入 GitHub",
  "plugins.browser.back": "后退",
  "plugins.browser.forward": "前进",
  "plugins.browser.home": "返回插件主题",
  "plugins.browser.reload": "重新载入",
  "plugins.browser.stop": "停止载入",
  "plugins.browser.external": "在默认浏览器中打开",
  "plugins.browser.errorTitle": "GitHub 页面无法载入",
  "plugins.browser.errorBody":
    "请检查网络后重试，或在系统浏览器中打开。",
  "plugins.browser.retry": "重试",
} as const;

export type PluginsLocaleKey = keyof typeof pluginsZh;

export type PluginsTranslate = (
  key: PluginsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const pluginsEn: Record<PluginsLocaleKey, string> = {
  "plugins.create.label": "Plugins",
  "plugins.tab.title": "Plugins",
  "plugins.install.title": "Install a plugin",
  "plugins.install.body":
    "Paste the install command from a plugin repository. Minke parses and installs one web-profile plugin.",
  "plugins.install.label": "Plugin install command",
  "plugins.install.placeholder":
    "dsh plugin --profile web add <package-or-github-repo>",
  "plugins.install.action": "Install",
  "plugins.install.installing": "Installing",
  "plugins.install.invalid":
    "Use dsh plugin --profile web add <package or github:repository>.",
  "plugins.install.trust":
    "Third-party plugins may run install scripts. Install only from sources you trust.",
  "plugins.install.success":
    "Installed. Restart Minke to activate the plugin.",
  "plugins.install.failed": "Installation failed: {message}",
  "plugins.browser.title": "Browse plugins on GitHub",
  "plugins.browser.topic": "github.com/topics/dsh-plugin",
  "plugins.browser.searchLabel":
    "Search GitHub plugin repositories",
  "plugins.browser.searchPlaceholder":
    "Search plugin names, repositories, or descriptions",
  "plugins.browser.searchClear": "Clear search",
  "plugins.browser.loading": "Loading GitHub",
  "plugins.browser.back": "Back",
  "plugins.browser.forward": "Forward",
  "plugins.browser.home": "Return to the plugin topic",
  "plugins.browser.reload": "Reload",
  "plugins.browser.stop": "Stop loading",
  "plugins.browser.external": "Open in default browser",
  "plugins.browser.errorTitle": "GitHub could not be loaded",
  "plugins.browser.errorBody":
    "Check your connection and retry, or open the page in your browser.",
  "plugins.browser.retry": "Retry",
};
