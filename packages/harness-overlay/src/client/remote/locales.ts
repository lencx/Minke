export const remoteZh = {
  nav: "远程访问",
  title: "远程访问",
  description:
    "通过受控的私有网络，在手机或另一台设备上打开当前 Minke。",
  tailscaleTitle: "Tailscale",
  tailscaleDescription:
    "使用 Tailscale Serve 提供 HTTPS 地址；仅同一 tailnet 中获准的设备可以连接。",
  enable: "通过 Tailscale 访问",
  lifecycle:
    "代理由 Minke 前台管理，退出 Minke 后会自动停止；不会启用公开的 Funnel。",
  statusDisabled: "未启用",
  statusUnavailable: "未安装",
  statusReady: "已就绪",
  statusActive: "运行中",
  statusError: "连接失败",
  refresh: "刷新状态",
  refreshing: "检查中…",
  address: "移动端地址",
  unavailable:
    "未检测到 Tailscale 命令。请安装并登录 Tailscale，然后重新启动 Minke。",
  statusErrorHelp:
    "无法读取已连接的 Tailscale 节点。请确认 Tailscale 已登录且状态为 Running。",
  serveErrorHelp:
    "Tailscale Serve 启动失败。请确认当前版本支持 Serve，且 HTTPS 已获 tailnet 管理策略允许。",
  restartRequired: "设置已保存，完全退出并重新启动 Minke 后生效。",
  securityTitle: "安全提示",
  securityBody:
    "远程页面可以启动代理任务并使用 Minke 已授权的本机工具。只允许你信任的 tailnet 成员访问此设备。",
  readError: "无法读取远程访问设置。",
  writeError: "无法保存远程访问设置。",
} as const;

export type RemoteLocaleKey = keyof typeof remoteZh;

export const remoteEn: Record<RemoteLocaleKey, string> = {
  nav: "Remote access",
  title: "Remote access",
  description:
    "Open this Minke from a phone or another device over a controlled private network.",
  tailscaleTitle: "Tailscale",
  tailscaleDescription:
    "Use Tailscale Serve for an HTTPS address available only to authorized devices in the same tailnet.",
  enable: "Access through Tailscale",
  lifecycle:
    "Minke owns the foreground proxy and stops it on exit. Public Funnel access is never enabled.",
  statusDisabled: "Off",
  statusUnavailable: "Not installed",
  statusReady: "Ready",
  statusActive: "Active",
  statusError: "Connection failed",
  refresh: "Refresh status",
  refreshing: "Checking…",
  address: "Mobile address",
  unavailable:
    "The Tailscale command was not found. Install and sign in to Tailscale, then restart Minke.",
  statusErrorHelp:
    "Minke could not read a connected Tailscale node. Confirm that Tailscale is signed in and Running.",
  serveErrorHelp:
    "Tailscale Serve failed to start. Confirm that this version supports Serve and your tailnet policy allows HTTPS.",
  restartRequired:
    "Saved. Fully quit and restart Minke to apply this change.",
  securityTitle: "Security",
  securityBody:
    "The remote page can start agent tasks and use local tools already authorized in Minke. Allow access only to tailnet members you trust.",
  readError: "Could not read remote access settings.",
  writeError: "Could not save remote access settings.",
};

export type RemoteTranslate = (
  key: RemoteLocaleKey,
) => string;
