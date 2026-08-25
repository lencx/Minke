export const remoteZh = {
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
    "流量仍由 Tailscale 端到端加密，但浏览器地址为 HTTP（不属于安全上下文）；手机必须保持 Tailscale 连接。",
  tailscaleIpAddress: "Tailscale IP（可选）",
  tailscaleIpPlaceholder: "自动检测",
  tailscaleIpHint:
    "留空时自动检测当前设备的 Tailscale IPv4。手动填写的地址必须已分配给当前设备，否则启用会失败。",
  tailscaleIpInvalidWarning:
    "请输入 100.64.0.0/10 范围内的 Tailscale IPv4；你也可以清空并使用自动检测。",
  tailscaleReferencesTitle: "配置参考",
  tailscaleServeReference: "了解 Tailscale Serve",
  tailscaleIpReference: "了解 Tailscale IP 地址",
  tailscaleAccessControlReference: "配置 Access controls",
  tailscaleSharingReference: "管理设备共享",
  tailscaleRemoveDeviceReference: "从 tailnet 移除设备",
  cloudflareSetupTitle: "Named Tunnel + Access",
  cloudflareSetupDescription:
    "配置文件只需提供 Tunnel 与凭据，不要定义 ingress；Minke 会把 Origin 固定到本机 JWT 网关。",
  cloudflareReferencesTitle: "配置参考",
  cloudflareTunnelReference: "创建本地管理 Tunnel",
  cloudflareAccessAppReference:
    "创建 Self-hosted Access 应用",
  cloudflareAudienceReference: "查找 Application AUD",
  baseDomain: "基础域名",
  baseDomainHelpLabel: "查看基础域名说明",
  baseDomainHint:
    "建议填写 Cloudflare 区域根域（如 example.com）。右侧标签会成为它的直接子域名；若基础域名本身已是子域名，最终地址可能超出免费 Universal SSL 的证书覆盖范围。",
  baseDomainInvalidWarning:
    "域名格式似乎无效。请检查标签、连字符和后缀；你仍可保留此配置并尝试启用。",
  baseDomainNestedWarning:
    "该基础域名包含多级子域，最终主机名可能超出免费 Universal SSL 的覆盖范围。若它就是你的 Cloudflare 区域根域，可忽略并继续。",
  randomLabel: "随机或自定义标签",
  randomLabelInvalidWarning:
    "标签只能包含小写字母、数字和连字符（1–63 位），且不能以连字符开头或结尾；你仍可保留此配置并尝试启用。",
  regenerateHostname: "生成随机标签",
  hostnamePreview: "最终主机名",
  hostnamePrivacyNote:
    "标签不是密码；手动改为可读名称会暴露在 DNS 与证书日志中，也不能替代 Cloudflare Access。",
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
  configurationLocked:
    "远程访问运行时无法修改配置，请先停用后再调整。",
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
  directIpErrorHelp:
    "配置的 Tailscale IP 未分配给当前设备，或格式无效。请清空后自动检测，或填写 tailscale ip -4 返回的地址。",
  harnessControlErrorHelp:
    "Harness 未接受远程主机更新。远程链路保持关闭，请重新启动 Minke 后重试。",
  cloudflareConfigErrorHelp:
    "Cloudflare 配置无效，或 Origin 端口已被占用。请核对主机名、团队名、AUD、Tunnel 和配置文件。",
  cloudflareAccessErrorHelp:
    "Cloudflare Access JWT 校验失败。请核对团队名、应用 AUD 与 Access 策略。",
  cloudflareTunnelErrorHelp:
    "cloudflared 未能建立 Named Tunnel。请检查配置文件、Tunnel 凭据和网络连接。",
  savingChange: "正在保存更改…",
  securityTitle: "远程访问注意事项",
  securityBody:
    "远程页面可以启动代理任务并使用 Minke 已授权的本机工具。公网链路必须由 Cloudflare Access 身份策略保护，并且只允许预期的身份访问。",
  tailscaleSecurityBody:
    "远程页面可以启动代理任务并使用 Minke 已授权的本机工具。Minke 不会为 Tailscale 链路增加第二层登录；请通过 Access controls 与设备共享，只允许预期的用户和设备连接。",
  securityCleanupTitle: "不再使用公网访问时，请完整撤销",
  securityCleanupIntro:
    "仅在 Minke 中停用会停止本机代理，但不会自动删除 Cloudflare 中的 DNS、Access 应用或 Tunnel。请按以下顺序清理，避免遗留可被发现的入口或造成后续误配置：",
  securityCleanupStepDisable:
    "在 Minke 中选择“停用远程访问”，等待状态变为“未启用”。",
  securityCleanupStepProcess:
    "确认原远程地址已无法连接，并在系统进程列表中确认由 Minke 启动的 cloudflared 已退出。",
  securityCleanupStepDns:
    "进入 Cloudflare 的 DNS Records，找到最终主机名对应的 CNAME，选择 Edit → Delete 并确认。",
  securityCleanupStepAccess:
    "进入 Zero Trust → Access controls → Applications，删除对应的 Self-hosted Access 应用；仅在其策略未被其他应用复用时，再删除该策略。",
  securityCleanupStepTunnel:
    "仅当 Tunnel 未被其他主机名或服务复用且以后不再使用时，再从 Networking → Tunnels（或 Zero Trust → Networks → Connectors）删除 Tunnel，并移除它的本机配置与 <Tunnel-UUID>.json 凭据。cert.pem 是账户级管理凭据，不要把它当作单个 Tunnel 的文件删除；只有确定本机不再管理其他 Tunnel 时才删除本地副本，若要让所有副本失效，再到 My Profile → API Tokens 撤销对应令牌。",
  securityCleanupNote:
    "完成后再次访问原地址，确认新请求已无法到达服务且不再出现 Access 登录页。DNS 缓存可能在 TTL 到期前继续解析；删除资源也无法抹除已经进入证书透明度日志的历史主机名。",
  tailscaleCleanupTitle: "不再使用私有网络访问时，请完成检查",
  tailscaleCleanupIntro:
    "Minke 停用后会关闭自己启动的前台 Serve 进程或 Direct IP 本地监听，但不会修改 Tailscale 的 Access controls、设备共享或设备注册。请按当前连接方式检查：",
  tailscaleCleanupStepDisable:
    "在 Minke 中选择“停用远程访问”，等待状态变为“未启用”，并确认原远程地址已无法连接。",
  tailscaleCleanupStepServe:
    "若使用 HTTPS Serve，运行 tailscale serve status，确认没有活动映射指向 Minke 本地端口。若仍有映射，请先确认归属，再按 Tailscale 的 Disable Serve 流程只关闭对应项。",
  tailscaleCleanupStepDirect:
    "若使用 Direct IP，确认原 100.x 地址和端口已无法连接。此方式不会创建 Serve 配置或 DNS 记录；设备保持注册时仍会保留 Tailscale IP，这不表示 Minke 仍在监听。",
  tailscaleCleanupStepAccess:
    "检查 Tailscale 管理后台的 Access controls 和设备 Share 设置。共享可以授权 tailnet 外部用户访问；仅保留预期的用户、设备与端口，并只移除专为 Minke 添加且未被其他服务复用的 Grant、ACL 或共享邀请。",
  tailscaleCleanupStepDevice:
    "仅当整台设备以后都不需要加入 tailnet 时，才从 Machines 中移除该设备；这会切断该设备的全部 Tailscale 访问，而不只是 Minke。",
  tailscaleCleanupNote:
    "不要把 tailscale serve reset 当作默认清理命令，它会清空该设备的全部 Serve 配置。卸载 Tailscale 也不会自动从 tailnet 中移除该设备。",
  readError: "无法读取远程访问设置。",
  writeError: "无法保存远程访问设置。",
} as const;

export type RemoteLocaleKey = keyof typeof remoteZh;

export const remoteEn: Record<RemoteLocaleKey, string> = {
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
    "Traffic remains end-to-end encrypted by Tailscale, but the browser URL is HTTP and is not a secure context. The phone must keep Tailscale connected.",
  tailscaleIpAddress: "Tailscale IP (optional)",
  tailscaleIpPlaceholder: "Auto-detect",
  tailscaleIpHint:
    "Leave blank to detect this device's Tailscale IPv4 automatically. A manual address must be assigned to this device or enabling will fail.",
  tailscaleIpInvalidWarning:
    "Enter a Tailscale IPv4 in 100.64.0.0/10, or clear the field to use automatic detection.",
  tailscaleReferencesTitle: "Configuration references",
  tailscaleServeReference: "Learn about Tailscale Serve",
  tailscaleIpReference: "Understand Tailscale IP addresses",
  tailscaleAccessControlReference: "Configure access controls",
  tailscaleSharingReference: "Manage device sharing",
  tailscaleRemoveDeviceReference:
    "Remove a device from the tailnet",
  cloudflareSetupTitle: "Named Tunnel + Access",
  cloudflareSetupDescription:
    "The config file should provide only the Tunnel and credentials, with no ingress rules. Minke pins the origin to its local JWT gateway.",
  cloudflareReferencesTitle: "Configuration references",
  cloudflareTunnelReference:
    "Create a locally managed Tunnel",
  cloudflareAccessAppReference:
    "Create a Self-hosted Access application",
  cloudflareAudienceReference: "Find the Application AUD",
  baseDomain: "Base domain",
  baseDomainHelpLabel: "Show base domain guidance",
  baseDomainHint:
    "Use the Cloudflare zone apex (for example, example.com). The label becomes its direct subdomain; using an existing subdomain may put the final hostname outside free Universal SSL certificate coverage.",
  baseDomainInvalidWarning:
    "This does not look like a valid domain. Check its labels, hyphens, and suffix; you can still keep the value and try enabling it.",
  baseDomainNestedWarning:
    "This base contains multiple subdomain levels, so the final hostname may fall outside free Universal SSL coverage. If it is your Cloudflare zone apex, you can ignore this warning and continue.",
  randomLabel: "Random or custom label",
  randomLabelInvalidWarning:
    "Use 1–63 lowercase letters, numbers, or hyphens, without a leading or trailing hyphen; you can still keep the value and try enabling it.",
  regenerateHostname: "Generate random label",
  hostnamePreview: "Final hostname",
  hostnamePrivacyNote:
    "The label is not a password. A readable value appears in DNS and certificate logs, and never replaces Cloudflare Access.",
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
  configurationLocked:
    "Disable remote access before changing the connection configuration.",
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
  directIpErrorHelp:
    "The configured Tailscale IP is invalid or is not assigned to this device. Clear it to auto-detect, or enter the address returned by tailscale ip -4.",
  harnessControlErrorHelp:
    "Harness did not accept the remote-host update. The remote route remains closed; restart Minke and try again.",
  cloudflareConfigErrorHelp:
    "The Cloudflare profile is invalid or its origin port is occupied. Check the hostname, team, AUD, Tunnel, and config file.",
  cloudflareAccessErrorHelp:
    "Cloudflare Access JWT validation failed. Check the team name, application AUD, and Access policy.",
  cloudflareTunnelErrorHelp:
    "cloudflared could not establish the Named Tunnel. Check its config, Tunnel credentials, and network connection.",
  savingChange: "Saving your change…",
  securityTitle: "Remote access notes",
  securityBody:
    "The remote page can start agent tasks and use local tools already authorized in Minke. Protect the internet route with a Cloudflare Access identity policy and allow only intended identities.",
  tailscaleSecurityBody:
    "The remote page can start agent tasks and use local tools already authorized in Minke. Minke adds no second sign-in layer to the Tailscale route; use access controls and device sharing to allow only intended users and devices.",
  securityCleanupTitle:
    "Remove public access completely when you no longer use it",
  securityCleanupIntro:
    "Turning it off in Minke stops the local proxy, but does not remove Cloudflare DNS, the Access application, or the Tunnel. Clean them up in this order to avoid leaving a discoverable entry point or causing a future misconfiguration:",
  securityCleanupStepDisable:
    "Choose Disable remote access in Minke and wait for the status to change to Off.",
  securityCleanupStepProcess:
    "Confirm that the old remote address no longer connects and that the cloudflared process started by Minke has exited in your system process list.",
  securityCleanupStepDns:
    "Open Cloudflare DNS Records, find the CNAME for the final hostname, then choose Edit → Delete and confirm.",
  securityCleanupStepAccess:
    "Go to Zero Trust → Access controls → Applications and delete the matching Self-hosted Access application. Delete its policy only if no other application reuses it.",
  securityCleanupStepTunnel:
    "Only if no other hostname or service reuses the Tunnel and you will not need it again, delete it from Networking → Tunnels (or Zero Trust → Networks → Connectors), then remove its local config and <Tunnel-UUID>.json credential. cert.pem is an account-wide management credential, not a per-Tunnel file. Delete its local copy only when this machine will manage no other Tunnel; to invalidate every copy, revoke the matching token under My Profile → API Tokens.",
  securityCleanupNote:
    "Visit the old address again and confirm that new requests can no longer reach the service and the Access login page no longer appears. DNS caches may continue resolving until their TTL expires, and cleanup cannot erase a hostname already recorded in Certificate Transparency logs.",
  tailscaleCleanupTitle:
    "Complete these checks when you stop using private access",
  tailscaleCleanupIntro:
    "Disabling Minke closes the foreground Serve process or Direct IP listener that it started, but does not change Tailscale access controls, device shares, or device registration. Check the active connection type:",
  tailscaleCleanupStepDisable:
    "Choose Disable remote access in Minke, wait for the status to change to Off, and confirm that the old remote address no longer connects.",
  tailscaleCleanupStepServe:
    "For HTTPS Serve, run tailscale serve status and confirm that no active mapping points to Minke's local port. If one remains, identify its owner first, then use Tailscale's Disable Serve procedure to turn off only that mapping.",
  tailscaleCleanupStepDirect:
    "For Direct IP, confirm that the old 100.x address and port no longer connect. This mode creates no Serve configuration or DNS record. The device keeps its Tailscale IP while it remains registered; that does not mean Minke is still listening.",
  tailscaleCleanupStepAccess:
    "Review Access controls and the device's Share settings in the Tailscale admin console. A share can authorize users outside your tailnet; keep only intended users, devices, and ports, and remove only Grants, ACLs, or share invitations created solely for Minke and not reused elsewhere.",
  tailscaleCleanupStepDevice:
    "Remove the device from Machines only if the entire device no longer needs the tailnet. This revokes all Tailscale access for the device, not just Minke.",
  tailscaleCleanupNote:
    "Do not use tailscale serve reset as routine cleanup; it clears every Serve configuration on the device. Uninstalling Tailscale also does not remove the device from the tailnet.",
  readError: "Could not read remote access settings.",
  writeError: "Could not save remote access settings.",
};

export type RemoteTranslate = (
  key: RemoteLocaleKey,
) => string;
