export const zh = {
  trigger: "安装 Minke",
  installing: "正在打开安装窗口",
  guideTitle: "将 Minke 安装为应用",
  iosGuide:
    "点击浏览器的“分享”，然后选择“添加到主屏幕”。",
  browserGuide:
    "打开浏览器菜单，选择“安装 Minke”或“添加到主屏幕”。",
  errorGuide:
    "浏览器未能打开安装窗口，请改用浏览器菜单安装。",
  close: "关闭安装说明",
} as const;

export type PwaLocaleKey = keyof typeof zh;
export type PwaTranslate = (key: PwaLocaleKey) => string;

export const en: Record<PwaLocaleKey, string> = {
  trigger: "Install Minke",
  installing: "Opening the install prompt",
  guideTitle: "Install Minke as an app",
  iosGuide:
    "Tap Share in the browser, then choose Add to Home Screen.",
  browserGuide:
    "Open the browser menu and choose Install Minke or Add to Home Screen.",
  errorGuide:
    "The browser could not open the install prompt. Install from the browser menu instead.",
  close: "Close install guidance",
};
