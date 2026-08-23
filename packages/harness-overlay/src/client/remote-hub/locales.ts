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
  weixinDescription: "扫码连接微信，将消息可靠写入 Minke Gateway。",
  telegramTitle: "Telegram",
  discordTitle: "Discord",
  planned: "待接入",
  loading: "正在读取",
  unavailable: "不可用",
  unlinked: "未连接",
  waiting: "等待扫码",
  scanned: "已扫码",
  verificationRequired: "需要验证码",
  connecting: "正在连接",
  linkedLimited: "已连接 · 路由待接入",
  attention: "需要处理",
  connectWeixin: "连接微信",
  reconnectWeixin: "重新连接",
  cancelLink: "取消",
  unlinkWeixin: "解除连接",
  resetLocal: "重置本地数据",
  resetLocalWarning:
    "这会删除本机保存的微信凭据、收件箱和待发送消息，且无法撤销。",
  confirmResetLocal: "确认重置",
  resetGateway: "重建 IM Gateway",
  resetGatewayWarning:
    "共享 IM Gateway 无法打开。重建会删除本机所有消息通道的收件箱、待发送消息与投递记录，并解除微信连接，且无法撤销。",
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
    "Gateway 正在接收消息；Agent 路由尚未接通，因此暂时不会自动回复。",
  receiveIssue:
    "Gateway 已保留连接，但最近一次收取失败，正在后台重试。",
  vaultUnavailable:
    "当前系统无法提供受保护的凭据存储，微信连接保持关闭。",
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
  agentRoutePendingShort: "Agent 路由待接入",
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
    "Scan to connect Weixin and durably admit messages into Minke Gateway.",
  telegramTitle: "Telegram",
  discordTitle: "Discord",
  planned: "Planned",
  loading: "Reading",
  unavailable: "Unavailable",
  unlinked: "Not connected",
  waiting: "Waiting for scan",
  scanned: "Scanned",
  verificationRequired: "Code required",
  connecting: "Connecting",
  linkedLimited: "Connected · route pending",
  attention: "Needs attention",
  connectWeixin: "Connect Weixin",
  reconnectWeixin: "Reconnect",
  cancelLink: "Cancel",
  unlinkWeixin: "Disconnect",
  resetLocal: "Reset local data",
  resetLocalWarning:
    "This permanently deletes the saved Weixin credential, inbox, and pending deliveries on this device.",
  confirmResetLocal: "Reset now",
  resetGateway: "Recreate IM Gateway",
  resetGatewayWarning:
    "The shared IM Gateway cannot be opened. Recreating it permanently deletes every messaging channel's local inbox, pending deliveries, and delivery records, and disconnects Weixin.",
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
    "Gateway is receiving messages. Agent routing is not connected yet, so automatic replies remain off.",
  receiveIssue:
    "Gateway kept the connection, but the latest receive failed and is retrying.",
  vaultUnavailable:
    "Protected credential storage is unavailable on this system, so Weixin stays off.",
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
  agentRoutePendingShort: "Agent route pending",
};

export type RemoteHubTranslate = (
  key: RemoteHubLocaleKey,
) => string;
