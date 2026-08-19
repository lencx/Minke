export const pluginCatalogZh = {
  "plugins.create.label": "插件",
  "plugins.tab.title": "插件",
  "plugins.page.title": "插件目录",
  "plugins.page.body":
    "浏览 Minke 在本机发现并完成静态校验的插件。",
  "plugins.action.sync": "同步最新数据",
  "plugins.action.syncing": "正在同步",
  "plugins.action.stop": "停止同步",
  "plugins.action.stopping": "正在停止",
  "plugins.action.github": "浏览 GitHub 插件主题",
  "plugins.search.label": "搜索插件",
  "plugins.search.placeholder": "搜索名称、仓库或描述",
  "plugins.summary":
    "{plugins} 个插件 · {repositories} 个仓库",
  "plugins.status.lastSync": "上次同步：{time}",
  "plugins.status.never": "尚未同步",
  "plugins.status.pending": "仍有 {count} 个仓库等待扫描。",
  "plugins.status.error":
    "同步已暂停：{message}。已发现的数据和上一次可用结果仍会保留。",
  "plugins.status.stale":
    "本次同步未完成，当前显示上一次可用数据。",
  "plugins.loading": "正在读取本地插件目录",
  "plugins.empty.title": "本地目录还没有插件",
  "plugins.empty.body":
    "同步公开候选仓库后，完成静态校验的插件会显示在这里。",
  "plugins.empty.pending":
    "已发现 {count} 个候选仓库，仍在等待静态校验；通过后会显示在这里。",
  "plugins.empty.action": "立即同步",
  "plugins.results.empty.title": "没有匹配的插件",
  "plugins.results.empty.body": "请尝试更短的名称或仓库关键词。",
  "plugins.card.open": "打开“{name}”的仓库",
  "plugins.card.stars": "{count} 个 GitHub Star",
  "plugins.card.noDescription": "作者暂未提供插件说明。",
  "plugins.verification.verified": "文件已校验",
  "plugins.verification.buildRequired": "需要构建",
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
    "Browse plugins Minke discovered and statically validated on this device.",
  "plugins.action.sync": "Sync latest",
  "plugins.action.syncing": "Syncing",
  "plugins.action.stop": "Stop syncing",
  "plugins.action.stopping": "Stopping",
  "plugins.action.github": "Browse the GitHub plugin topic",
  "plugins.search.label": "Search plugins",
  "plugins.search.placeholder":
    "Search names, repositories, or descriptions",
  "plugins.summary":
    "{plugins} plugins · {repositories} repositories",
  "plugins.status.lastSync": "Last synced {time}",
  "plugins.status.never": "Not synced yet",
  "plugins.status.pending":
    "{count} repositories are still waiting to be scanned.",
  "plugins.status.error":
    "Sync paused: {message}. Discovered data and the last usable results are preserved.",
  "plugins.status.stale":
    "The latest sync did not finish. Showing the last usable data.",
  "plugins.loading": "Reading the local plugin catalog",
  "plugins.empty.title": "No plugins in the local catalog yet",
  "plugins.empty.body":
    "After a sync, plugins that pass static validation will appear here.",
  "plugins.empty.pending":
    "{count} candidate repositories were discovered and are waiting for static validation.",
  "plugins.empty.action": "Sync now",
  "plugins.results.empty.title": "No matching plugins",
  "plugins.results.empty.body":
    "Try a shorter plugin name or repository keyword.",
  "plugins.card.open": "Open the repository for “{name}”",
  "plugins.card.stars": "{count} GitHub stars",
  "plugins.card.noDescription":
    "The author has not provided a plugin description.",
  "plugins.verification.verified": "Files verified",
  "plugins.verification.buildRequired": "Build required",
  "plugins.verification.unverified": "Entry unverified",
};
