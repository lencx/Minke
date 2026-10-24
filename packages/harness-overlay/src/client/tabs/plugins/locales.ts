export const pluginsZh = {
  "plugins.create.label": "发现插件",
  "plugins.tab.title": "发现插件",
  "plugins.recovery.title": "Minke 插件恢复",
  "plugins.recovery.description": "重启进入安全模式以排查插件启动问题。",
  "plugins.enterSafeMode": "以安全模式重启",
  "plugins.exitSafeMode": "退出安全模式并重启",
  "plugins.safeModeActive": "安全模式已开启",
  "plugins.restarting": "正在重启…",
} as const;

export type PluginsLocaleKey = keyof typeof pluginsZh;

export type PluginsTranslate = (
  key: PluginsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const pluginsEn: Record<PluginsLocaleKey, string> = {
  "plugins.create.label": "Discover plugins",
  "plugins.tab.title": "Discover plugins",
  "plugins.recovery.title": "Minke plugin recovery",
  "plugins.recovery.description": "Restart in safe mode to troubleshoot plugin startup problems.",
  "plugins.enterSafeMode": "Restart in safe mode",
  "plugins.exitSafeMode": "Exit safe mode and restart",
  "plugins.safeModeActive": "Safe mode is active",
  "plugins.restarting": "Restarting…",
};
