export const minkeSettingsZh = {
  nav: "Minke",
  title: "Minke 设置",
  empty: "当前环境没有可用的 Minke 设置。",
  pageError: "此设置页暂时无法显示，其他 Minke 设置仍可使用。",
  retry: "重试",
} as const;

export type MinkeSettingsLocaleKey =
  keyof typeof minkeSettingsZh;

export const minkeSettingsEn: Record<
  MinkeSettingsLocaleKey,
  string
> = {
  nav: "Minke",
  title: "Minke Settings",
  empty: "No Minke settings are available in this environment.",
  pageError:
    "This settings page could not be displayed. Other Minke settings remain available.",
  retry: "Retry",
};

export type MinkeSettingsTranslate = (
  key: MinkeSettingsLocaleKey,
) => string;
