export const remoteZh = {
  nav: "远程访问",
  title: "远程访问",
  description:
    "从手机或另一台设备安全地打开当前 Minke；同一时间只启用一条访问链路。",
  methodTitle: "访问方式",
  tailscaleTitle: "私有网络",
  tailscaleDescription:
    "通过 Tailscale 访问。适合已经加入同一 tailnet 的设备。",
  cloudflareTitle: "公网访问",
  cloudflareDescription:
    "通过 Cloudflare Access 登录后访问，无需在手机上开启 Tailscale。",
  recommended: "推荐",
  advanced: "高级",
  tailscaleTransportTitle: "Tailscale 连接方式",
  serveTitle: "HTTPS Serve",
  serveDescription:
    "保持 Harness 仅监听本机回环地址，由 Tailscale 提供 HTTPS。",
  directTitle: "Direct IP",
  directDescription:
    "仅绑定本机的 Tailscale IPv4，不申请公开证书，也不会写入证书透明度日志。",
  directWarning:
    "此方式使用 HTTP（并非浏览器安全上下文），并且手机仍需保持 Tailscale 连接。",
  cloudflareSetupTitle: "Named Tunnel + Access",
  cloudflareSetupDescription:
    "配置文件只需提供 Tunnel 与凭据，不要定义 ingress；Minke 会把 Origin 固定到本机 JWT 网关。",
  hostnameModeTitle: "公开主机名",
  generatedHostnameTitle: "随机主机名",
  generatedHostnameDescription:
    "默认使用短小的随机标签，避免在 DNS 和证书日志中暴露设备名称。",
  customHostnameTitle: "自定义主机名",
  customHostnameDescription:
    "仅在需要可读地址时使用；名称会出现在公开 DNS 和证书日志中。",
  baseDomain: "基础域名",
  randomLabel: "随机标签",
  regenerateHostname: "重新生成",
  customHostname: "完整主机名",
  hostnamePreview: "最终主机名",
  hostnamePrivacyNote:
    "随机主机名只降低元数据可读性，不是密码，也不能替代 Cloudflare Access。",
  teamName: "Cloudflare Zero Trust 团队名",
  teamNameSuffix: ".cloudflareaccess.com",
  audience: "Access Application AUD",
  tunnelName: "Tunnel 名称或 UUID",
  configPath: "cloudflared 配置文件绝对路径",
  originPort: "本地 Origin 端口",
  originAddress: "Minke 固定的 Tunnel Origin",
  cloudflareAccessRequired:
    "Cloudflare 中必须先为最终主机名创建 Access 应用与身份策略。Minke 会在本机再次验证 Access JWT 的签名、Issuer 和 AUD。",
  enable: "启用远程访问",
  disable: "停用远程访问",
  advancedSettings: "高级设置",
  hideAdvancedSettings: "收起高级设置",
  lifecycle:
    "Minke 只在应用运行期间持有前台代理；退出时会停止。切换方式不会自动降级到另一条链路。",
  statusDisabled: "未启用",
  statusUnavailable: "未安装",
  statusStarting: "正在连接",
  statusStopping: "正在断开",
  statusRetrying: "等待重试",
  statusReady: "已就绪",
  statusActive: "运行中",
  statusError: "连接失败",
  statusSaving: "保存中",
  refresh: "刷新状态",
  refreshing: "检查中…",
  address: "访问地址",
  openAddress: "打开完整访问地址",
  copyAddress: "复制地址",
  copyingAddress: "复制中…",
  copiedAddress: "已复制",
  copyAddressError: "复制失败，请选中地址后手动复制。",
  unavailableTailscale:
    "未检测到 Tailscale 命令。安装并登录后请刷新状态；若已启用，Minke 会在后台继续探测。",
  unavailableCloudflare:
    "未检测到 cloudflared 命令。请安装 cloudflared，并准备 Named Tunnel 配置后刷新状态。",
  statusErrorHelp:
    "无法读取已连接的 Tailscale 节点。请确认 Tailscale 已登录且状态为 Running。",
  serveErrorHelp:
    "Tailscale Serve 启动失败。请确认当前版本支持 Serve，且 HTTPS 已获 tailnet 管理策略允许。",
  serveConflictErrorHelp:
    "另一个 Tailscale 客户端正在修改 Serve 配置，请稍等片刻后重试。",
  serveHttpsErrorHelp:
    "此 tailnet 尚未启用 HTTPS。请先在 Tailscale 管理后台启用 HTTPS，然后重试。",
  servePermissionErrorHelp:
    "Tailscale Standalone 无法将 Serve 配置写入 macOS 钥匙串。",
  servePermissionIssue: "查看 Tailscale 已知问题",
  directBindErrorHelp:
    "无法只在 Tailscale IPv4 上启动本地代理。请检查 Tailscale 是否在线，或该端口是否已被占用。",
  harnessControlErrorHelp:
    "Harness 未接受远程主机更新。远程链路保持关闭，请重新启动 Minke 后重试。",
  cloudflareConfigErrorHelp:
    "Cloudflare 配置无效，或 Origin 端口已被占用。请核对主机名、团队名、AUD、Tunnel 和配置文件。",
  cloudflareAccessErrorHelp:
    "Cloudflare Access JWT 校验失败。请核对团队名、应用 AUD 与 Access 策略。",
  cloudflareTunnelErrorHelp:
    "cloudflared 未能建立 Named Tunnel。请检查配置文件、Tunnel 凭据和网络连接。",
  savingChange: "正在保存更改…",
  securityTitle: "安全提示",
  securityBody:
    "远程页面可以启动代理任务并使用 Minke 已授权的本机工具。只允许你信任的 tailnet 成员或 Cloudflare Access 身份访问。",
  readError: "无法读取远程访问设置。",
  writeError: "无法保存远程访问设置。",
} as const;

export type RemoteLocaleKey = keyof typeof remoteZh;

export const remoteEn: Record<RemoteLocaleKey, string> = {
  nav: "Remote access",
  title: "Remote access",
  description:
    "Open this Minke safely from a phone or another device. Only one access route can be active at a time.",
  methodTitle: "Access method",
  tailscaleTitle: "Private network",
  tailscaleDescription:
    "Connect through Tailscale. Best for devices already joined to the same tailnet.",
  cloudflareTitle: "Internet access",
  cloudflareDescription:
    "Sign in through Cloudflare Access without enabling Tailscale on the phone.",
  recommended: "Recommended",
  advanced: "Advanced",
  tailscaleTransportTitle: "Tailscale connection",
  serveTitle: "HTTPS Serve",
  serveDescription:
    "Keep Harness on loopback and let Tailscale provide the HTTPS endpoint.",
  directTitle: "Direct IP",
  directDescription:
    "Bind only to this node's Tailscale IPv4. No public certificate or Certificate Transparency entry is created.",
  directWarning:
    "This uses an HTTP browser context, and the phone must still keep Tailscale connected.",
  cloudflareSetupTitle: "Named Tunnel + Access",
  cloudflareSetupDescription:
    "The config file should provide only the Tunnel and credentials, with no ingress rules. Minke pins the origin to its local JWT gateway.",
  hostnameModeTitle: "Public hostname",
  generatedHostnameTitle: "Random hostname",
  generatedHostnameDescription:
    "Use a compact random label by default so DNS and certificate logs do not reveal a device name.",
  customHostnameTitle: "Custom hostname",
  customHostnameDescription:
    "Use only when a readable address matters. The name will appear in public DNS and certificate logs.",
  baseDomain: "Base domain",
  randomLabel: "Random label",
  regenerateHostname: "Regenerate",
  customHostname: "Full hostname",
  hostnamePreview: "Final hostname",
  hostnamePrivacyNote:
    "A random hostname only reduces readable metadata. It is not a password and does not replace Cloudflare Access.",
  teamName: "Cloudflare Zero Trust team name",
  teamNameSuffix: ".cloudflareaccess.com",
  audience: "Access Application AUD",
  tunnelName: "Tunnel name or UUID",
  configPath: "Absolute cloudflared config path",
  originPort: "Local origin port",
  originAddress: "Minke-pinned Tunnel origin",
  cloudflareAccessRequired:
    "Create an Access application and identity policy for the final hostname first. Minke also verifies the Access JWT signature, issuer, and AUD at the origin.",
  enable: "Enable remote access",
  disable: "Disable remote access",
  advancedSettings: "Advanced settings",
  hideAdvancedSettings: "Hide advanced settings",
  lifecycle:
    "Minke owns the foreground proxy only while the app is open and stops it on exit. A failed method never silently falls back to another route.",
  statusDisabled: "Off",
  statusUnavailable: "Not installed",
  statusStarting: "Connecting",
  statusStopping: "Disconnecting",
  statusRetrying: "Retrying",
  statusReady: "Ready",
  statusActive: "Active",
  statusError: "Connection failed",
  statusSaving: "Saving",
  refresh: "Refresh status",
  refreshing: "Checking…",
  address: "Access address",
  openAddress: "Open the full access address",
  copyAddress: "Copy address",
  copyingAddress: "Copying…",
  copiedAddress: "Copied",
  copyAddressError:
    "Could not copy the address. Select it and copy it manually.",
  unavailableTailscale:
    "The Tailscale command was not found. Install and sign in, then refresh; if already enabled, Minke keeps detecting it in the background.",
  unavailableCloudflare:
    "The cloudflared command was not found. Install cloudflared, prepare a Named Tunnel configuration, then refresh the status.",
  statusErrorHelp:
    "Minke could not read a connected Tailscale node. Confirm that Tailscale is signed in and Running.",
  serveErrorHelp:
    "Tailscale Serve failed to start. Confirm that this version supports Serve and your tailnet policy allows HTTPS.",
  serveConflictErrorHelp:
    "Another Tailscale client is changing the Serve configuration. Wait a moment, then try again.",
  serveHttpsErrorHelp:
    "HTTPS is not enabled for this tailnet. Enable HTTPS in the Tailscale admin console, then try again.",
  servePermissionErrorHelp:
    "Tailscale Standalone could not save the Serve configuration to macOS Keychain.",
  servePermissionIssue: "View the known Tailscale issue",
  directBindErrorHelp:
    "Minke could not bind only to the Tailscale IPv4 address. Check that Tailscale is online and the port is available.",
  harnessControlErrorHelp:
    "Harness did not accept the remote-host update. The remote route remains closed; restart Minke and try again.",
  cloudflareConfigErrorHelp:
    "The Cloudflare profile is invalid or its origin port is occupied. Check the hostname, team, AUD, Tunnel, and config file.",
  cloudflareAccessErrorHelp:
    "Cloudflare Access JWT validation failed. Check the team name, application AUD, and Access policy.",
  cloudflareTunnelErrorHelp:
    "cloudflared could not establish the Named Tunnel. Check its config, Tunnel credentials, and network connection.",
  savingChange: "Saving your change…",
  securityTitle: "Security",
  securityBody:
    "The remote page can start agent tasks and use local tools already authorized in Minke. Allow only trusted tailnet members or Cloudflare Access identities.",
  readError: "Could not read remote access settings.",
  writeError: "Could not save remote access settings.",
};

export type RemoteTranslate = (
  key: RemoteLocaleKey,
) => string;
