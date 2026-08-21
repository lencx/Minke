export const terminalTabsZh = {
  "terminal.create.label": "终端",
  "terminal.tab.new": "终端",
  "terminal.view.label": "交互式终端",
  "terminal.state.starting": "正在启动终端…",
  "terminal.state.exited": "进程已退出（代码 {code}）",
  "terminal.state.failed": "终端启动失败",
} as const;

export type TerminalTabsLocaleKey =
  keyof typeof terminalTabsZh;
export type TerminalTabsTranslate = (
  key: TerminalTabsLocaleKey,
  params?: Record<string, unknown>,
) => string;

export const terminalTabsEn: Record<
  TerminalTabsLocaleKey,
  string
> = {
  "terminal.create.label": "Terminal",
  "terminal.tab.new": "Terminal",
  "terminal.view.label": "Interactive terminal",
  "terminal.state.starting": "Starting terminal…",
  "terminal.state.exited": "Process exited with code {code}",
  "terminal.state.failed": "Terminal failed to start",
};
