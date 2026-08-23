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
    "第三方插件可在安装时运行脚本，并在每次启动时以受信任的 Host/Client 代码运行；它可访问 DSH 数据、工作区与已授权服务。请只安装并保留你完全信任的来源。",
  "plugins.install.success": "安装完成。重启 Minke 后插件生效。",
  "plugins.install.failed": "安装失败：{message}",
  "plugins.view.label": "插件管理视图",
  "plugins.view.installed": "已安装",
  "plugins.view.discover": "GitHub 发现",
  "plugins.installed.refresh": "刷新已安装插件",
  "plugins.installed.loading": "正在读取已安装插件",
  "plugins.installed.emptyTitle": "还没有安装第三方插件",
  "plugins.installed.emptyBody":
    "可以前往 GitHub 发现插件，复制仓库提供的安装命令后在上方安装。",
  "plugins.installed.emptyAction": "浏览 GitHub 插件",
  "plugins.installed.errorTitle": "无法读取已安装插件",
  "plugins.installed.errorBody":
    "请重试；如果问题持续存在，请检查当前 web profile。",
  "plugins.installed.retry": "重试",
  "plugins.installed.active": "运行中",
  "plugins.installed.failed": "加载失败",
  "plugins.installed.failedBody":
    "dsh 已隔离此次加载失败，Minke 可继续运行。请检查启动日志，修复或卸载后重启。",
  "plugins.installed.disabled": "已禁用",
  "plugins.installed.disabledBody":
    "此插件当前在 dsh loader 中处于禁用状态。",
  "plugins.installed.pending": "加载中",
  "plugins.installed.pendingBody":
    "dsh loader 尚未完成此插件的加载或卸载。",
  "plugins.installed.unobserved": "未检测到",
  "plugins.installed.unobservedBody":
    "运行时清单中未发现同名插件入口；如果刚完成安装，请重启 Minke。",
  "plugins.installed.unknown": "状态未知",
  "plugins.installed.unknownBody":
    "插件文件已安装，但当前无法确认 dsh loader 状态。",
  "plugins.installed.missing": "需修复",
  "plugins.installed.missingBody":
    "此插件已登记在 web profile 中，但本地文件缺失。请重新安装。",
  "plugins.installed.noDescription": "此插件没有提供说明。",
  "plugins.installed.requested": "安装来源",
  "plugins.installed.repository": "在内部标签页打开插件仓库",
  "plugins.installed.uninstall": "卸载",
  "plugins.installed.uninstallLabel": "卸载 {name}",
  "plugins.installed.uninstalling": "正在卸载 {name}",
  "plugins.installed.uninstallConfirm":
    "确定卸载 {name} 吗？卸载成功后 Minke 将自动重启。",
  "plugins.installed.uninstallSuccess":
    "已卸载 {name}，正在重启 Minke…",
  "plugins.installed.uninstallFailed": "卸载失败：{message}",
  "plugins.installed.runtimeUnavailable":
    "无法读取 dsh loader 运行状态：{message}",
  "plugins.installed.failedNotice":
    "一个或多个插件加载失败，但失败已被隔离，不会阻止 Minke 启动。",
  "plugins.installed.unobservedNotice":
    "部分已安装插件尚未出现在运行时清单中，可能需要重启后加载。",
  "plugins.installed.restart": "重启 Minke",
  "plugins.installed.restarting": "正在重启…",
  "plugins.installed.restartFailed": "无法重启 Minke：{message}",
  "plugins.browser.title": "在 GitHub 上浏览插件",
  "plugins.browser.topic": "github.com/topics/dsh-plugin",
  "plugins.browser.searchLabel": "搜索 GitHub 插件仓库",
  "plugins.browser.searchPlaceholder": "搜索插件",
  "plugins.browser.searchClear": "清除搜索内容",
  "plugins.browser.loading": "正在载入 GitHub",
  "plugins.browser.back": "后退",
  "plugins.browser.forward": "前进",
  "plugins.browser.home": "返回插件主题",
  "plugins.browser.reload": "重新载入",
  "plugins.browser.stop": "停止载入",
  "plugins.browser.external": "在默认浏览器中打开",
  "plugins.browser.errorTitle": "GitHub 页面无法载入",
  "plugins.browser.errorBody": "请检查网络后重试，或在系统浏览器中打开。",
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
    "Third-party plugins may run install scripts and execute as trusted Host/Client code on every launch; they can access DSH data, workspaces, and authorized services. Install and keep only sources you fully trust.",
  "plugins.install.success": "Installed. Restart Minke to activate the plugin.",
  "plugins.install.failed": "Installation failed: {message}",
  "plugins.view.label": "Plugin management view",
  "plugins.view.installed": "Installed",
  "plugins.view.discover": "Discover on GitHub",
  "plugins.installed.refresh": "Refresh installed plugins",
  "plugins.installed.loading": "Reading installed plugins",
  "plugins.installed.emptyTitle": "No third-party plugins installed",
  "plugins.installed.emptyBody":
    "Browse GitHub, copy a repository's install command, then install it above.",
  "plugins.installed.emptyAction": "Browse GitHub plugins",
  "plugins.installed.errorTitle": "Installed plugins could not be read",
  "plugins.installed.errorBody":
    "Retry, or check the current web profile if the problem continues.",
  "plugins.installed.retry": "Retry",
  "plugins.installed.active": "Active",
  "plugins.installed.failed": "Load failed",
  "plugins.installed.failedBody":
    "dsh isolated this load failure so Minke can keep running. Check the startup log, then fix or uninstall the plugin and restart.",
  "plugins.installed.disabled": "Disabled",
  "plugins.installed.disabledBody":
    "This plugin is currently disabled in the dsh loader.",
  "plugins.installed.pending": "Loading",
  "plugins.installed.pendingBody":
    "The dsh loader has not finished loading or unloading this plugin.",
  "plugins.installed.unobserved": "Not observed",
  "plugins.installed.unobservedBody":
    "No same-name entry appears in the runtime inventory. Restart Minke if the plugin was just installed.",
  "plugins.installed.unknown": "Status unknown",
  "plugins.installed.unknownBody":
    "The plugin files are installed, but the current dsh loader state could not be confirmed.",
  "plugins.installed.missing": "Needs repair",
  "plugins.installed.missingBody":
    "This plugin is registered in the web profile, but its local files are missing. Reinstall it to repair.",
  "plugins.installed.noDescription":
    "No description was provided for this plugin.",
  "plugins.installed.requested": "Install source",
  "plugins.installed.repository": "Open plugin repository in a tab",
  "plugins.installed.uninstall": "Uninstall",
  "plugins.installed.uninstallLabel": "Uninstall {name}",
  "plugins.installed.uninstalling": "Uninstalling {name}",
  "plugins.installed.uninstallConfirm":
    "Uninstall {name}? Minke will restart automatically after removal.",
  "plugins.installed.uninstallSuccess":
    "Uninstalled {name}. Restarting Minke…",
  "plugins.installed.uninstallFailed": "Uninstall failed: {message}",
  "plugins.installed.runtimeUnavailable":
    "The dsh loader state could not be read: {message}",
  "plugins.installed.failedNotice":
    "One or more plugins failed to load, but the failures were isolated and did not stop Minke.",
  "plugins.installed.unobservedNotice":
    "Some installed plugins are not yet visible in the runtime inventory and may need a restart.",
  "plugins.installed.restart": "Restart Minke",
  "plugins.installed.restarting": "Restarting…",
  "plugins.installed.restartFailed":
    "Minke could not restart: {message}",
  "plugins.browser.title": "Browse plugins on GitHub",
  "plugins.browser.topic": "github.com/topics/dsh-plugin",
  "plugins.browser.searchLabel": "Search GitHub plugin repositories",
  "plugins.browser.searchPlaceholder": "Search plugins",
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
