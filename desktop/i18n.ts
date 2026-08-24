import type { DesktopLocale } from "./locale-contract.ts";

const zh = {
  "bootstrap.loading": "正在启动 Minke",
  "runtime.exitCode": "退出码：{value}",
  "runtime.signal": "信号：{value}",
  "runtime.stoppedTitle": "DeepSeek Harness 已停止",
  "runtime.stoppedMessage": "本地 Harness 进程意外退出。",
  "runtime.restart": "重新启动",
  "runtime.quit": "退出 Minke",
  "runtime.restartFailedTitle": "无法重新启动 DeepSeek Harness",
  "runtime.startupFailedTitle": "Minke 启动失败",
  "menu.file": "文件",
  "menu.view": "视图",
  "menu.commandPalette": "命令面板…",
  "menu.settings": "设置…",
  "menu.newSession": "新建会话",
  "menu.focusComposer": "聚焦消息输入框",
  "menu.sessionBack": "返回上一会话",
  "menu.sessionForward": "前往下一会话",
  "menu.toggleSidebar": "展开或折叠左侧栏",
  "menu.toggleRightSidebar": "展开或折叠右侧栏",
  "menu.toggleBottomPanel": "展开或折叠底部栏",
  "dataHome.chooseDirectoryTitle": "选择 DSH 数据目录",
  "dataHome.chooseDirectoryButton": "选择目录",
  "sessionExport.saveDialogTitle": "导出 Session 日志",
  "sessionExport.zipFilter": "ZIP 归档",
  "sessionExport.failedTitle": "无法导出 Session 日志",
  "sessionExport.failedMessage": "Session 日志导出失败。",
  "sessionExport.ok": "确定",
  "update.availableTitle": "Minke 更新",
  "update.availableMessage": "Minke {version} 已发布",
  "update.availableDetail":
    "当前版本为 {current}。Minke 将从不可变 GitHub Release 下载对应平台的安装包，并校验下载地址、大小、SHA-256，以及系统提供下载来源标记时的来源属性。",
  "update.download": "下载更新",
  "update.later": "稍后",
  "update.readyTitle": "更新已验证",
  "update.readyMessage": "Minke {version} 更新包已准备好",
  "update.readyDetail.dmg":
    "将打开 DMG。请退出 Minke 后，将新版本拖入“应用程序”。若 macOS 拦截，请在“系统设置 → 隐私与安全性”中审查并手动允许；Minke 不会自动移除隔离属性。",
  "update.readyDetail.exe":
    "将启动 Windows 安装程序。安装程序仍保留 Mark-of-the-Web，Windows 可能显示 SmartScreen 提示；请核对发布者与版本后继续。",
  "update.readyDetail.deb":
    "将用系统默认的软件安装器打开 DEB。安装时可能需要管理员授权；请按系统提示完成安装。",
  "update.readyDetail.rpm":
    "将用系统默认的软件安装器打开 RPM。安装时可能需要管理员授权；请按系统提示完成安装。",
  "update.readyDetail.appimage":
    "将在文件管理器中显示已验证的 AppImage。请退出 Minke，用新文件替换当前 AppImage，并保留其可执行权限。",
  "update.openInstaller": "打开安装包",
  "update.showAppImage": "显示 AppImage",
  "update.failedTitle": "无法安全下载更新",
  "update.failedMessage": "Minke 未打开未通过校验的安装包。",
  "update.failedDetail":
    "{error}\n\n你可以改用浏览器打开官方 Release 页面。",
  "update.openReleasePage": "打开 Release 页面",
  "update.cancel": "取消",
} as const;

export type DesktopMessageKey = keyof typeof zh;

const en: Record<DesktopMessageKey, string> = {
  "bootstrap.loading": "Starting Minke",
  "runtime.exitCode": "Exit code: {value}",
  "runtime.signal": "Signal: {value}",
  "runtime.stoppedTitle": "DeepSeek Harness stopped",
  "runtime.stoppedMessage":
    "The local Harness process exited unexpectedly.",
  "runtime.restart": "Restart",
  "runtime.quit": "Quit Minke",
  "runtime.restartFailedTitle":
    "Unable to restart DeepSeek Harness",
  "runtime.startupFailedTitle": "Minke failed to start",
  "menu.file": "File",
  "menu.view": "View",
  "menu.commandPalette": "Command Palette…",
  "menu.settings": "Settings…",
  "menu.newSession": "New Session",
  "menu.focusComposer": "Focus Message Input",
  "menu.sessionBack": "Back to Previous Session",
  "menu.sessionForward": "Forward to Next Session",
  "menu.toggleSidebar": "Toggle Sidebar",
  "menu.toggleRightSidebar": "Toggle Right Sidebar",
  "menu.toggleBottomPanel": "Toggle Bottom Panel",
  "dataHome.chooseDirectoryTitle": "Choose DSH data directory",
  "dataHome.chooseDirectoryButton": "Choose folder",
  "sessionExport.saveDialogTitle": "Export Session log",
  "sessionExport.zipFilter": "ZIP archives",
  "sessionExport.failedTitle": "Unable to export Session log",
  "sessionExport.failedMessage":
    "The Session log could not be exported.",
  "sessionExport.ok": "OK",
  "update.availableTitle": "Minke update",
  "update.availableMessage": "Minke {version} is available",
  "update.availableDetail":
    "The current version is {current}. Minke will download the platform installer from an immutable GitHub Release and verify its URL, size, SHA-256 digest, and OS provenance marker when the platform provides one.",
  "update.download": "Download update",
  "update.later": "Later",
  "update.readyTitle": "Update verified",
  "update.readyMessage": "The Minke {version} update is ready",
  "update.readyDetail.dmg":
    "The DMG will open. Quit Minke before dragging the new version into Applications. If macOS blocks it, review and allow it manually in System Settings → Privacy & Security; Minke never removes the quarantine attribute automatically.",
  "update.readyDetail.exe":
    "The Windows installer will launch. Its Mark-of-the-Web remains intact, so Windows may show SmartScreen; verify the publisher and version before continuing.",
  "update.readyDetail.deb":
    "The DEB will open in the system package installer. Administrator authorization may be required; follow the operating-system prompts to finish.",
  "update.readyDetail.rpm":
    "The RPM will open in the system package installer. Administrator authorization may be required; follow the operating-system prompts to finish.",
  "update.readyDetail.appimage":
    "The verified AppImage will be shown in the file manager. Quit Minke, replace the current AppImage with the new file, and keep it executable.",
  "update.openInstaller": "Open installer",
  "update.showAppImage": "Show AppImage",
  "update.failedTitle": "Unable to download update safely",
  "update.failedMessage":
    "Minke did not open an installer that failed verification.",
  "update.failedDetail":
    "{error}\n\nYou can use a browser to open the official Release page instead.",
  "update.openReleasePage": "Open Release page",
  "update.cancel": "Cancel",
};

export const desktopDictionaries = Object.freeze({
  zh: Object.freeze(zh),
  en: Object.freeze(en),
});

export type DesktopTranslateParams = Readonly<
  Record<string, unknown>
>;

/** Translate one desktop-owned native string using Harness-compatible braces. */
export function translateDesktop(
  locale: DesktopLocale,
  key: DesktopMessageKey,
  params?: DesktopTranslateParams,
): string {
  const template = desktopDictionaries[locale][key];
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    params !== undefined && Object.hasOwn(params, name)
      ? String(params[name])
      : match,
  );
}

export type DesktopLocaleSnapshot = Readonly<{
  active: DesktopLocale;
  revision: number;
}>;

/** In-memory desktop projection of Harness's authoritative active locale. */
export class DesktopLocaleRuntime {
  #snapshot: DesktopLocaleSnapshot;
  readonly #listeners = new Set<() => void>();

  constructor(initial: DesktopLocale) {
    this.#snapshot = Object.freeze({
      active: initial,
      revision: 0,
    });
  }

  getSnapshot(): DesktopLocaleSnapshot {
    return this.#snapshot;
  }

  setLocale(locale: DesktopLocale): void {
    if (locale === this.#snapshot.active) return;
    this.#snapshot = Object.freeze({
      active: locale,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  t(
    key: DesktopMessageKey,
    params?: DesktopTranslateParams,
  ): string {
    return translateDesktop(this.#snapshot.active, key, params);
  }
}
