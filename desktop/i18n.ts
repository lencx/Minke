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
  "menu.settings": "设置…",
  "menu.newSession": "新建会话",
  "menu.toggleSidebar": "展开或折叠左侧栏",
  "menu.toggleRightSidebar": "展开或折叠右侧栏",
  "sessionExport.saveDialogTitle": "导出 Session 日志",
  "sessionExport.zipFilter": "ZIP 归档",
  "sessionExport.failedTitle": "无法导出 Session 日志",
  "sessionExport.failedMessage": "Session 日志导出失败。",
  "sessionExport.ok": "确定",
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
  "menu.settings": "Settings…",
  "menu.newSession": "New Session",
  "menu.toggleSidebar": "Toggle Sidebar",
  "menu.toggleRightSidebar": "Toggle Right Sidebar",
  "sessionExport.saveDialogTitle": "Export Session log",
  "sessionExport.zipFilter": "ZIP archives",
  "sessionExport.failedTitle": "Unable to export Session log",
  "sessionExport.failedMessage":
    "The Session log could not be exported.",
  "sessionExport.ok": "OK",
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
