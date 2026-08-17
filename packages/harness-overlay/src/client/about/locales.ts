export const zh = {
  trigger: "关于 Minke",
  iconAlt: "Minke 应用图标",
  tagline: "为 {harness} 打造的原生桌面工作空间",
  metadata: "版本 {version} · {platform} · {arch}",
  community:
    "Minke 是独立的开源社区项目，并非 DeepSeek 官方产品。",
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
  project: "Minke",
  harness: "DeepSeek Harness",
  close: "Close",
};
