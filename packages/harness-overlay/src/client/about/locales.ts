export const zh = {
  trigger: "关于 Minke",
  iconAlt: "Minke 应用图标",
  tagline: "为 {harness} 打造的原生桌面工作空间",
  metadata: "版本 {version} · {platform} · {arch}",
  community:
    "Minke 是独立的开源社区项目，并非 DeepSeek 官方产品。",
  checkUpdate: "检查更新",
  checkingUpdate: "正在检查…",
  updateStatusUpToDate: "当前已是最新版本。",
  updateStatusAvailable: "发现新版本，已打开更新流程。",
  updateStatusBusy: "更新检查或下载正在进行中。",
  updateStatusUnavailable: "当前构建不支持应用更新。",
  updateStatusFailed: "检查更新失败，请稍后重试。",
  project: "Minke",
  harness: "DeepSeek Harness",
  close: "关闭",
} as const;

export type AboutLocaleKey = keyof typeof zh;
export type AboutTranslate = (
  key: AboutLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const en: Record<AboutLocaleKey, string> = {
  trigger: "About Minke",
  iconAlt: "Minke app icon",
  tagline: "A native desktop workspace for {harness}",
  metadata: "Version {version} · {platform} · {arch}",
  community:
    "Minke is an independent open-source community project, not an official DeepSeek product.",
  checkUpdate: "Check for updates",
  checkingUpdate: "Checking…",
  updateStatusUpToDate: "Minke is up to date.",
  updateStatusAvailable:
    "A new version was found and the update flow is open.",
  updateStatusBusy:
    "An update check or download is already in progress.",
  updateStatusUnavailable:
    "Application updates are unavailable in this build.",
  updateStatusFailed:
    "The update check failed. Please try again later.",
  project: "Minke",
  harness: "DeepSeek Harness",
  close: "Close",
};
