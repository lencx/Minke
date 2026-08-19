export const pluginCatalogZh = {
  "plugins.create.label": "插件",
  "plugins.tab.title": "插件",
  "plugins.page.title": "插件目录",
  "plugins.page.body":
    "浏览已验证插件和等待本机静态校验的候选仓库。",
  "plugins.action.sync": "同步最新数据",
  "plugins.action.syncing": "正在同步",
  "plugins.action.stop": "停止同步",
  "plugins.action.stopping": "正在停止",
  "plugins.action.github": "浏览 GitHub 插件主题",
  "plugins.action.token": "GitHub Token",
  "plugins.action.tokenConfigured": "Token 已配置",
  "plugins.search.label": "搜索插件和候选仓库",
  "plugins.search.placeholder": "搜索名称、仓库或描述",
  "plugins.summary":
    "{plugins} 个插件 · {candidates} 个候选",
  "plugins.status.lastSync": "上次同步：{time}",
  "plugins.status.never": "尚未同步",
  "plugins.status.pending":
    "仍有 {count} 个候选仓库等待静态校验。",
  "plugins.status.pendingVisible":
    "当前显示优先级最高的 {visible} / {count} 个候选仓库；同步时会继续校验。",
  "plugins.status.error":
    "同步已暂停：{message}。已发现的数据和上一次可用结果仍会保留。",
  "plugins.status.stale":
    "本次同步未完成，当前显示上一次可用数据。",
  "plugins.loading": "正在读取本地插件目录",
  "plugins.empty.title": "本地目录还没有内容",
  "plugins.empty.body":
    "同步后，已验证插件和等待校验的候选仓库会显示在这里。",
  "plugins.empty.pending":
    "已发现 {count} 个候选仓库，仍在等待静态校验。",
  "plugins.empty.action": "立即同步",
  "plugins.results.empty.title": "没有匹配结果",
  "plugins.results.empty.body": "请尝试更短的名称或仓库关键词。",
  "plugins.filter.label": "按状态筛选",
  "plugins.filter.all": "全部",
  "plugins.filter.verified": "已验证",
  "plugins.filter.pending": "待校验",
  "plugins.filter.installed": "已安装",
  "plugins.card.open": "打开“{name}”的仓库",
  "plugins.card.stars": "{count} 个 GitHub Star",
  "plugins.card.noDescription": "作者暂未提供插件说明。",
  "plugins.candidate.pending": "等待校验",
  "plugins.candidate.error": "等待重试",
  "plugins.candidate.noDescription": "仓库暂未提供说明。",
  "plugins.install.action": "一键安装",
  "plugins.install.installing": "正在安装",
  "plugins.install.installed": "已安装",
  "plugins.install.restart": "已安装；重启 Minke 后生效。",
  "plugins.credential.title": "GitHub Token",
  "plugins.credential.body":
    "Token 只在保存时单向传入，并使用系统安全存储加密；页面不会读回明文。",
  "plugins.credential.configured": "已配置",
  "plugins.credential.unconfigured": "未配置",
  "plugins.credential.environment":
    "当前 Token 来自启动环境，请在环境变量中更新或移除。",
  "plugins.credential.secure": "当前 Token 已在本机安全存储中加密。",
  "plugins.credential.unavailable":
    "系统安全存储不可用，无法在应用内保存 Token。仍可通过 GITHUB_TOKEN 或 GH_TOKEN 提供。",
  "plugins.credential.input": "新的 GitHub Token",
  "plugins.credential.placeholder": "粘贴 Token；保存后输入框会清空",
  "plugins.credential.invalid": "请输入不含空格或引号的完整 Token。",
  "plugins.credential.save": "保存并同步",
  "plugins.credential.saving": "正在保存",
  "plugins.credential.remove": "移除 Token",
  "plugins.credential.close": "关闭",
  "plugins.verification.verified": "文件已校验",
  "plugins.verification.buildRequired": "需要构建",
  "plugins.verification.buildAllowance": "需要构建授权",
  "plugins.verification.unverified": "入口待确认",
} as const;

export type PluginCatalogLocaleKey =
  keyof typeof pluginCatalogZh;

export type PluginCatalogTranslate = (
  key: PluginCatalogLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const pluginCatalogEn: Record<
  PluginCatalogLocaleKey,
  string
> = {
  "plugins.create.label": "Plugins",
  "plugins.tab.title": "Plugins",
  "plugins.page.title": "Plugin catalog",
  "plugins.page.body":
    "Browse validated plugins and candidate repositories awaiting local static validation.",
  "plugins.action.sync": "Sync latest",
  "plugins.action.syncing": "Syncing",
  "plugins.action.stop": "Stop syncing",
  "plugins.action.stopping": "Stopping",
  "plugins.action.github": "Browse the GitHub plugin topic",
  "plugins.action.token": "GitHub Token",
  "plugins.action.tokenConfigured": "Token configured",
  "plugins.search.label": "Search plugins and candidates",
  "plugins.search.placeholder":
    "Search names, repositories, or descriptions",
  "plugins.summary":
    "{plugins} plugins · {candidates} candidates",
  "plugins.status.lastSync": "Last synced {time}",
  "plugins.status.never": "Not synced yet",
  "plugins.status.pending":
    "{count} candidate repositories are waiting for static validation.",
  "plugins.status.pendingVisible":
    "Showing the highest-priority {visible} of {count} candidate repositories; validation continues during sync.",
  "plugins.status.error":
    "Sync paused: {message}. Discovered data and the last usable results are preserved.",
  "plugins.status.stale":
    "The latest sync did not finish. Showing the last usable data.",
  "plugins.loading": "Reading the local plugin catalog",
  "plugins.empty.title": "Nothing in the local catalog yet",
  "plugins.empty.body":
    "Validated plugins and candidates awaiting validation will appear after a sync.",
  "plugins.empty.pending":
    "{count} candidate repositories were discovered and are awaiting static validation.",
  "plugins.empty.action": "Sync now",
  "plugins.results.empty.title": "No matching results",
  "plugins.results.empty.body":
    "Try a shorter name or repository keyword.",
  "plugins.filter.label": "Filter by status",
  "plugins.filter.all": "All",
  "plugins.filter.verified": "Validated",
  "plugins.filter.pending": "Pending",
  "plugins.filter.installed": "Installed",
  "plugins.card.open": "Open the repository for “{name}”",
  "plugins.card.stars": "{count} GitHub stars",
  "plugins.card.noDescription":
    "The author has not provided a plugin description.",
  "plugins.candidate.pending": "Awaiting validation",
  "plugins.candidate.error": "Awaiting retry",
  "plugins.candidate.noDescription":
    "The repository has no description.",
  "plugins.install.action": "Install",
  "plugins.install.installing": "Installing",
  "plugins.install.installed": "Installed",
  "plugins.install.restart":
    "Installed; restart Minke to activate it.",
  "plugins.credential.title": "GitHub Token",
  "plugins.credential.body":
    "The token travels only during save and is encrypted with system secure storage. Its value is never read back into this page.",
  "plugins.credential.configured": "Configured",
  "plugins.credential.unconfigured": "Not configured",
  "plugins.credential.environment":
    "The current token comes from the launch environment. Update or remove it there.",
  "plugins.credential.secure":
    "The current token is encrypted in local secure storage.",
  "plugins.credential.unavailable":
    "System secure storage is unavailable, so the app cannot save a token. GITHUB_TOKEN or GH_TOKEN can still be used.",
  "plugins.credential.input": "New GitHub Token",
  "plugins.credential.placeholder":
    "Paste a token; the field clears after save",
  "plugins.credential.invalid":
    "Enter the complete token without spaces or quotes.",
  "plugins.credential.save": "Save and sync",
  "plugins.credential.saving": "Saving",
  "plugins.credential.remove": "Remove token",
  "plugins.credential.close": "Close",
  "plugins.verification.verified": "Files verified",
  "plugins.verification.buildRequired": "Build required",
  "plugins.verification.buildAllowance":
    "Build approval required",
  "plugins.verification.unverified": "Entry unverified",
};
