import type {
  TerminalSettings,
} from "@minke/harness-overlay/terminal-settings-contract.ts";

const FALLBACK_TERMINAL_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

interface TerminalRenderingTarget {
  options: {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
  };
}

export interface TerminalRenderingOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

/** Resolve persisted overrides against the active Harness code-font token. */
export function terminalRenderingOptions(
  settings: Readonly<TerminalSettings>,
  themeFontFamily: string,
): TerminalRenderingOptions {
  return {
    fontFamily:
      settings.fontFamily ||
      themeFontFamily.trim() ||
      FALLBACK_TERMINAL_FONT_FAMILY,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  };
}

/** Mutate an existing xterm instance without replacing its session or DOM. */
export function applyTerminalRenderingSettings(
  terminal: TerminalRenderingTarget,
  settings: Readonly<TerminalSettings>,
  themeFontFamily: string,
): void {
  const options = terminalRenderingOptions(settings, themeFontFamily);
  terminal.options.fontFamily = options.fontFamily;
  terminal.options.fontSize = options.fontSize;
  terminal.options.lineHeight = options.lineHeight;
}
