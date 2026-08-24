export const remoteHubZh = {
  trigger: "远端",
  triggerIdle: "远端：未连接",
  triggerWorking: "远端：正在处理",
  triggerActive: "远端：已有能力运行",
  triggerAttention: "远端：需要处理",
  title: "远端能力",
  description:
    "管理设备访问与消息通道。它们共享 Minke 运行时，但彼此不构成启用前置条件。",
  close: "关闭远端能力",
  channelsTitle: "消息通道",
  accessTitle: "远程连接",
  weixinTitle: "微信",
  weixinDescription:
    "扫码连接微信；仅扫码账号的一对一消息会进入 Minke Agent。",
  telegramTitle: "Telegram",
  telegramDescription: "使用 Bot Token 连接 Telegram Bot API。",
  discordTitle: "Discord",
  discordDescription:
    "使用 Bot Token 连接 Discord Gateway；Agent 授权接通前仅验证传输，不保存外部消息。",
  botTokenLabel: "{provider} Bot Token",
  botTokenPlaceholder: "粘贴 Bot Token",
  telegramTokenHelp:
    "Token 由 BotFather 提供，仅加密保存在本机。连接后 Minke 会保留待处理更新并接管 long polling，请勿让另一个实例同时使用该 Token 接收。",
  telegramProxyLabel: "Telegram HTTP 代理",
  telegramProxyPlaceholder: "http://127.0.0.1:7897",
  telegramProxyHelp:
    "可选的 HTTP CONNECT 代理；必须填写 http://主机:端口，留空则使用系统网络设置。Minke 不会自动探测本机代理。",
  applyTelegramProxy: "应用代理",
  discordTokenHelp:
    "Token 来自 Discord Developer Portal；Bot 还需启用 Message Content Intent。",
  connectBot: "连接 {provider}",
  reconnectBot: "重新连接",
  unlinkBot: "解除连接",
  telegramPairingWaiting: "等待私聊配对",
  telegramPairingApprovalRequired: "配对待确认",
  telegramPairingInstruction:
    "请先在 Telegram 中给 {account} 发送一条私聊消息。收到请求后，可在此核对配对码并批准。",
  telegramPairingRequestLabel: "Telegram 私聊配对请求",
  telegramPairingRequestFrom: "来自 {label} 的配对请求",
  telegramPairingCode: "配对码 {code}",
  telegramPairingExpires: "请求有效至 {time}",
  approveTelegramPairing: "批准配对",
  dismissTelegramPairing: "忽略",
  loading: "正在读取",
  unavailable: "不可用",
  unlinked: "未连接",
  waiting: "等待扫码",
  scanned: "已扫码",
  verificationRequired: "需要验证码",
  connecting: "正在连接",
  connected: "已连接",
  linkedLimited: "已连接 · 消息入口关闭",
  attention: "需要处理",
  connectWeixin: "连接微信",
  reconnectWeixin: "重新连接",
  cancelLink: "取消",
  unlinkWeixin: "解除连接",
  resetLocal: "重置本地数据",
  resetLocalWarning:
    "这会删除本机保存的微信凭据、收件箱和待发送消息，且无法撤销。",
  resetBotLocalWarning:
    "这会删除本机保存的 {provider} 凭据、收件箱和待发送消息，且无法撤销。",
  confirmResetLocal: "确认重置",
  resetGateway: "重建 IM Gateway",
  resetGatewayWarning:
    "共享 IM Gateway 无法打开。重建会删除本机所有消息通道的凭据、收件箱、待发送消息与投递记录，且无法撤销。",
  confirmResetGateway: "确认重建 Gateway",
  keepLocalData: "保留数据",
  verifyCode: "提交验证码",
  verificationCodeLabel: "手机端显示的验证码",
  verificationCodePlaceholder: "输入数字验证码",
  qrAlt: "用于连接 Minke 的微信二维码",
  qrPreparing: "正在生成二维码…",
  qrRenderError: "二维码无法生成，请取消后重新连接。",
  qrInstruction: "使用微信扫描二维码，然后在手机上确认。",
  scannedInstruction: "已扫码，请在手机上继续确认。",
  verificationInstruction:
    "微信要求额外验证。输入手机端显示的数字验证码。",
  qrExpires: "二维码有效至 {time}",
  account: "账号 {label}",
  agentRoutePending:
    "传输已连接；Agent 授权与路由尚未接通，外部消息会被默认拒绝且不会写入本机。",
  authorizationMissing:
    "微信未返回扫码用户身份，消息入口保持关闭。请解除连接后重新扫码。",
  agentIssue:
    "消息已安全保留，但 Minke Agent 当前不可用，正在后台重试。",
  deliveryIssue:
    "Agent 已生成回复，但微信投递未完成。Gateway 已保留待发送消息。",
  receiveIssue:
    "Gateway 已保留连接，但最近一次收取失败，正在后台重试。",
  botReceiveIssue:
    "{provider} 连接仍在运行，但最近一次收取失败，正在后台重试。",
  botAgentIssue:
    "{provider} 消息已安全保留，但 Minke Agent 当前不可用，正在后台重试。",
  botDeliveryIssue:
    "Agent 已生成回复，但 {provider} 投递未完成。Gateway 已保留待发送消息。",
  vaultUnavailable:
    "当前系统无法提供受保护的凭据存储，微信连接保持关闭。",
  botVaultUnavailable:
    "当前系统无法提供受保护的凭据存储，{provider} 连接保持关闭。",
  botCredentialInvalid:
    "{provider} Token 无效或已撤销，请粘贴新的 Token。",
  botCredentialRead: "无法读取本机保存的 {provider} 凭据。",
  botCredentialStore:
    "{provider} Token 已验证，但未能安全保存，请重试。",
  botNetwork:
    "{provider} 服务暂时不可达，请检查网络或代理后重试。",
  botPollingConflict:
    "另一个实例正在使用此 Telegram Token 接收消息。请先停止该实例，再重新连接。",
  botPrivilegedIntent:
    "Discord 拒绝了 Message Content Intent。请在 Developer Portal 启用它，再重新连接。",
  botTransportFatal:
    "{provider} 接收连接因协议错误或本地队列超限而停止。请检查消息流量与 Bot 配置后重新连接。",
  botTransportStart:
    "{provider} 凭据已保存，但接收连接启动失败。请检查 Bot 权限与 Intent 配置。",
  alreadyBound:
    "该微信账号已在服务端绑定，但本机没有收到可用凭据。请重新发起连接。",
  credentialRead: "无法读取本机保存的微信凭据。",
  credentialStore: "微信授权成功，但凭据未能安全保存；请重新扫码。",
  gatewayStore:
    "共享 IM Gateway 存储无法打开。可在确认影响所有消息通道后重建。",
  loginNetwork: "微信登录服务暂时不可达，请检查网络后重试。",
  loginProtocol: "微信登录响应无法识别，请重新扫码。",
  transportStart: "微信凭据已保存，但接收连接启动失败。",
  sessionStale: "微信会话已失效，请重新扫码。",
  commandError: "操作未完成，请重试。",
  readError: "无法读取消息通道状态。",
  busy: "处理中…",
  dependencyTitle: "运行依赖",
  vaultReady: "系统凭据保护",
  vaultChecking: "正在检查凭据保护",
  vaultMissing: "凭据保护不可用",
  agentRoutePendingShort: "Agent 路由待接入 · 消息入口关闭",
  agentRouteReadyShort: "Agent 路由已接通",
} as const;

export type RemoteHubLocaleKey = keyof typeof remoteHubZh;

export const remoteHubEn: Record<RemoteHubLocaleKey, string> = {
  trigger: "Remote",
  triggerIdle: "Remote: not connected",
  triggerWorking: "Remote: working",
  triggerActive: "Remote: capability active",
  triggerAttention: "Remote: needs attention",
  title: "Remote capabilities",
  description:
    "Manage device access and messaging channels. They share the Minke runtime without blocking one another.",
  close: "Close remote capabilities",
  channelsTitle: "Messaging channels",
  accessTitle: "Remote connection",
  weixinTitle: "Weixin",
  weixinDescription:
    "Connect Weixin. Only direct messages from the account that scanned the QR code reach Minke Agent.",
  telegramTitle: "Telegram",
  telegramDescription: "Connect Telegram through a Bot API token.",
  discordTitle: "Discord",
  discordDescription:
    "Connect a bot token to Discord Gateway. External messages are not stored until Agent authorization is available.",
  botTokenLabel: "{provider} Bot Token",
  botTokenPlaceholder: "Paste Bot Token",
  telegramTokenHelp:
    "BotFather provides this token and Minke encrypts it locally. Connecting preserves queued updates and takes long-poll ownership; do not receive with the same token elsewhere.",
  telegramProxyLabel: "Telegram HTTP proxy",
  telegramProxyPlaceholder: "http://127.0.0.1:7897",
  telegramProxyHelp:
    "Optional HTTP CONNECT proxy. Enter http://host:port, or leave it blank to use system network settings. Minke never auto-detects local proxies.",
  applyTelegramProxy: "Apply proxy",
  discordTokenHelp:
    "Get this token from the Discord Developer Portal and enable Message Content Intent for the bot.",
  connectBot: "Connect {provider}",
  reconnectBot: "Reconnect",
  unlinkBot: "Disconnect",
  telegramPairingWaiting: "Waiting for a direct message",
  telegramPairingApprovalRequired: "Pairing approval required",
  telegramPairingInstruction:
    "First, send {account} a direct message in Telegram. The pairing request and code will appear here for approval.",
  telegramPairingRequestLabel:
    "Telegram direct-message pairing request",
  telegramPairingRequestFrom:
    "Pairing request from {label}",
  telegramPairingCode: "Pairing code {code}",
  telegramPairingExpires: "Request expires at {time}",
  approveTelegramPairing: "Approve pairing",
  dismissTelegramPairing: "Ignore",
  loading: "Reading",
  unavailable: "Unavailable",
  unlinked: "Not connected",
  waiting: "Waiting for scan",
  scanned: "Scanned",
  verificationRequired: "Code required",
  connecting: "Connecting",
  connected: "Connected",
  linkedLimited: "Connected · ingress disabled",
  attention: "Needs attention",
  connectWeixin: "Connect Weixin",
  reconnectWeixin: "Reconnect",
  cancelLink: "Cancel",
  unlinkWeixin: "Disconnect",
  resetLocal: "Reset local data",
  resetLocalWarning:
    "This permanently deletes the saved Weixin credential, inbox, and pending deliveries on this device.",
  resetBotLocalWarning:
    "This permanently deletes the saved {provider} credential, inbox, and pending deliveries on this device.",
  confirmResetLocal: "Reset now",
  resetGateway: "Recreate IM Gateway",
  resetGatewayWarning:
    "The shared IM Gateway cannot be opened. Recreating it permanently deletes every messaging channel's local credentials, inbox, pending deliveries, and delivery records.",
  confirmResetGateway: "Recreate Gateway",
  keepLocalData: "Keep data",
  verifyCode: "Submit code",
  verificationCodeLabel: "Code shown on your phone",
  verificationCodePlaceholder: "Enter the numeric code",
  qrAlt: "Weixin QR code for connecting Minke",
  qrPreparing: "Generating QR code…",
  qrRenderError:
    "Minke could not render this QR code. Cancel and start linking again.",
  qrInstruction: "Scan with Weixin, then confirm on your phone.",
  scannedInstruction: "Scanned. Continue the confirmation on your phone.",
  verificationInstruction:
    "Weixin requires another check. Enter the numeric code shown on your phone.",
  qrExpires: "QR code valid until {time}",
  account: "Account {label}",
  agentRoutePending:
    "Transport is connected. Until Agent authorization and routing are available, external messages are denied by default and never stored locally.",
  authorizationMissing:
    "Weixin did not return the scanning user's identity, so ingress remains closed. Disconnect and scan again.",
  agentIssue:
    "The message is safely retained, but Minke Agent is unavailable and will retry in the background.",
  deliveryIssue:
    "Agent produced a reply, but Weixin delivery did not complete. Gateway retained the pending delivery.",
  receiveIssue:
    "Gateway kept the connection, but the latest receive failed and is retrying.",
  botReceiveIssue:
    "{provider} remains connected, but the latest receive failed and is retrying.",
  botAgentIssue:
    "{provider} messages are safely retained while Minke Agent is unavailable and retries in the background.",
  botDeliveryIssue:
    "Agent produced a reply, but {provider} delivery did not complete. Gateway retained the pending delivery.",
  vaultUnavailable:
    "Protected credential storage is unavailable on this system, so Weixin stays off.",
  botVaultUnavailable:
    "Protected credential storage is unavailable on this system, so {provider} stays off.",
  botCredentialInvalid:
    "The {provider} token is invalid or revoked. Paste a new token.",
  botCredentialRead:
    "Minke could not read the saved {provider} credential.",
  botCredentialStore:
    "The {provider} token was verified but could not be saved securely. Try again.",
  botNetwork:
    "{provider} is temporarily unreachable. Check the network or proxy, then retry.",
  botPollingConflict:
    "Another instance is receiving with this Telegram token. Stop it, then reconnect.",
  botPrivilegedIntent:
    "Discord rejected Message Content Intent. Enable it in the Developer Portal, then reconnect.",
  botTransportFatal:
    "{provider} receiving stopped after a protocol or local queue failure. Review bot traffic and configuration, then reconnect.",
  botTransportStart:
    "The {provider} credential is saved, but its receive connection could not start. Check the bot permissions and intents.",
  alreadyBound:
    "This Weixin account is already bound remotely, but this device received no usable credential. Start linking again.",
  credentialRead: "Minke could not read the saved Weixin credential.",
  credentialStore:
    "Weixin authorized the device, but Minke could not save the credential safely. Scan again.",
  gatewayStore:
    "The shared IM Gateway storage cannot be opened. You can recreate it after confirming the impact on every messaging channel.",
  loginNetwork:
    "The Weixin login service is temporarily unreachable. Check the network and retry.",
  loginProtocol:
    "Minke could not understand the Weixin login response. Scan again.",
  transportStart:
    "The Weixin credential is saved, but the receive connection could not start.",
  sessionStale: "The Weixin session expired. Scan again.",
  commandError: "The operation did not complete. Try again.",
  readError: "Minke could not read messaging-channel status.",
  busy: "Working…",
  dependencyTitle: "Runtime dependencies",
  vaultReady: "System credential protection",
  vaultChecking: "Checking credential protection",
  vaultMissing: "Credential protection unavailable",
  agentRoutePendingShort: "Agent route pending · ingress disabled",
  agentRouteReadyShort: "Agent route connected",
};

export type RemoteHubTranslate = (
  key: RemoteHubLocaleKey,
) => string;
