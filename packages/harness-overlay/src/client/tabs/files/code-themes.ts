import type {
  ThemeRegistration,
} from "shiki/types";
import type {
  HarnessColorScheme,
} from "@minke/harness-overlay/client/core/context.ts";
import type {
  FileManagerCodeTheme,
} from "@minke/harness-overlay/tabs/files-contract.ts";

export const CODE_THEMES = [
  {
    id: "github-light-default",
    name: "GitHub Light Default",
    variantName: "Light Default",
    colorScheme: "light",
  },
  {
    id: "github-dark-default",
    name: "GitHub Dark Default",
    variantName: "Dark Default",
    colorScheme: "dark",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    variantName: "Latte",
    colorScheme: "light",
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    variantName: "Mocha",
    colorScheme: "dark",
  },
  {
    id: "gruvbox-light-medium",
    name: "Gruvbox Light Medium",
    variantName: "Light Medium",
    colorScheme: "light",
  },
  {
    id: "gruvbox-dark-medium",
    name: "Gruvbox Dark Medium",
    variantName: "Dark Medium",
    colorScheme: "dark",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    variantName: "Light",
    colorScheme: "light",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    variantName: "Dark",
    colorScheme: "dark",
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine Dawn",
    variantName: "Dawn",
    colorScheme: "light",
  },
  {
    id: "rose-pine-moon",
    name: "Rosé Pine Moon",
    variantName: "Moon",
    colorScheme: "dark",
  },
] as const satisfies readonly {
  readonly id: FileManagerCodeTheme;
  readonly name: string;
  readonly variantName: string;
  readonly colorScheme: HarnessColorScheme;
}[];

export const CODE_THEME_GROUPS = [
  {
    name: "GitHub",
    themes: [CODE_THEMES[0], CODE_THEMES[1]],
  },
  {
    name: "Catppuccin",
    themes: [CODE_THEMES[2], CODE_THEMES[3]],
  },
  {
    name: "Gruvbox",
    themes: [CODE_THEMES[4], CODE_THEMES[5]],
  },
  {
    name: "Solarized",
    themes: [CODE_THEMES[6], CODE_THEMES[7]],
  },
  {
    name: "Rosé Pine",
    themes: [CODE_THEMES[8], CODE_THEMES[9]],
  },
] as const;

export type ShikiCodeTheme = FileManagerCodeTheme;

export interface CodeThemePalette {
  readonly colorScheme: HarnessColorScheme;
  readonly background: string;
  readonly foreground: string;
  readonly gutterForeground: string;
  readonly gutterActiveForeground: string;
  readonly activeLine: string;
  readonly selection: string;
  readonly cursor: string;
  readonly border: string;
  readonly comment: string;
  readonly keyword: string;
  readonly string: string;
  readonly added: string;
  readonly deleted: string;
}

export interface TerminalCodeTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly black?: string;
  readonly red?: string;
  readonly green?: string;
  readonly yellow?: string;
  readonly blue?: string;
  readonly magenta?: string;
  readonly cyan?: string;
  readonly white?: string;
  readonly brightBlack?: string;
  readonly brightRed?: string;
  readonly brightGreen?: string;
  readonly brightYellow?: string;
  readonly brightBlue?: string;
  readonly brightMagenta?: string;
  readonly brightCyan?: string;
  readonly brightWhite?: string;
}

const palettes = {
  "github-light-default": {
    colorScheme: "light",
    background: "#ffffff",
    foreground: "#1f2328",
    gutterForeground: "#8c959f",
    gutterActiveForeground: "#1f2328",
    activeLine: "#eaeef280",
    selection: "#0969da33",
    cursor: "#0969da",
    border: "#d0d7de",
    comment: "#6e7781",
    keyword: "#cf222e",
    string: "#0a3069",
    added: "#1a7f37",
    deleted: "#cf222e",
  },
  "github-dark-default": {
    colorScheme: "dark",
    background: "#0d1117",
    foreground: "#e6edf3",
    gutterForeground: "#6e7681",
    gutterActiveForeground: "#e6edf3",
    activeLine: "#6e76811a",
    selection: "#1f6feb55",
    cursor: "#2f81f7",
    border: "#30363d",
    comment: "#8b949e",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    added: "#3fb950",
    deleted: "#ff7b72",
  },
  "catppuccin-latte": {
    colorScheme: "light",
    background: "#eff1f5",
    foreground: "#4c4f69",
    gutterForeground: "#8c8fa1",
    gutterActiveForeground: "#8839ef",
    activeLine: "#4c4f6912",
    selection: "#7c7f934d",
    cursor: "#dc8a78",
    border: "#acb0be",
    comment: "#7c7f93",
    keyword: "#8839ef",
    string: "#40a02b",
    added: "#40a02b",
    deleted: "#d20f39",
  },
  "catppuccin-mocha": {
    colorScheme: "dark",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    gutterForeground: "#7f849c",
    gutterActiveForeground: "#cba6f7",
    activeLine: "#cdd6f412",
    selection: "#9399b240",
    cursor: "#f5e0dc",
    border: "#585b70",
    comment: "#9399b2",
    keyword: "#cba6f7",
    string: "#a6e3a1",
    added: "#a6e3a1",
    deleted: "#f38ba8",
  },
  "gruvbox-light-medium": {
    colorScheme: "light",
    background: "#fbf1c7",
    foreground: "#3c3836",
    gutterForeground: "#928374",
    gutterActiveForeground: "#3c3836",
    activeLine: "#ebdbb260",
    selection: "#689d6a40",
    cursor: "#3c3836",
    border: "#ebdbb2",
    comment: "#928374",
    keyword: "#9d0006",
    string: "#79740e",
    added: "#79740e",
    deleted: "#9d0006",
  },
  "gruvbox-dark-medium": {
    colorScheme: "dark",
    background: "#282828",
    foreground: "#ebdbb2",
    gutterForeground: "#928374",
    gutterActiveForeground: "#ebdbb2",
    activeLine: "#3c383660",
    selection: "#689d6a40",
    cursor: "#ebdbb2",
    border: "#3c3836",
    comment: "#928374",
    keyword: "#fb4934",
    string: "#b8bb26",
    added: "#b8bb26",
    deleted: "#fb4934",
  },
  "solarized-light": {
    colorScheme: "light",
    background: "#fdf6e3",
    foreground: "#657b83",
    gutterForeground: "#93a1a1",
    gutterActiveForeground: "#567983",
    activeLine: "#eee8d5",
    selection: "#ddd6c1",
    cursor: "#657b83",
    border: "#ddd6c1",
    comment: "#93a1a1",
    keyword: "#859900",
    string: "#2aa198",
    added: "#859900",
    deleted: "#dc322f",
  },
  "solarized-dark": {
    colorScheme: "dark",
    background: "#002b36",
    foreground: "#839496",
    gutterForeground: "#586e75",
    gutterActiveForeground: "#93a1a1",
    activeLine: "#073642",
    selection: "#274642",
    cursor: "#d30102",
    border: "#073642",
    comment: "#586e75",
    keyword: "#859900",
    string: "#2aa198",
    added: "#859900",
    deleted: "#dc322f",
  },
  "rose-pine-dawn": {
    colorScheme: "light",
    background: "#faf4ed",
    foreground: "#575279",
    gutterForeground: "#797593",
    gutterActiveForeground: "#575279",
    activeLine: "#6e6a860d",
    selection: "#6e6a861f",
    cursor: "#9893a5",
    border: "#dfdad9",
    comment: "#9893a5",
    keyword: "#286983",
    string: "#ea9d34",
    added: "#56949f",
    deleted: "#b4637a",
  },
  "rose-pine-moon": {
    colorScheme: "dark",
    background: "#232136",
    foreground: "#e0def4",
    gutterForeground: "#908caa",
    gutterActiveForeground: "#e0def4",
    activeLine: "#817c9c14",
    selection: "#817c9c33",
    cursor: "#c4a7e7",
    border: "#393552",
    comment: "#6e6a86",
    keyword: "#3e8fb0",
    string: "#f6c177",
    added: "#9ccfd8",
    deleted: "#eb6f92",
  },
} as const satisfies Record<ShikiCodeTheme, CodeThemePalette>;

type ThemeModule = {
  readonly default: ThemeRegistration;
};

type ThemeLoader = () => Promise<ThemeModule>;

const themeLoaders = {
  "github-light-default": () =>
    import("@shikijs/themes/github-light-default"),
  "github-dark-default": () =>
    import("@shikijs/themes/github-dark-default"),
  "catppuccin-latte": () =>
    import("@shikijs/themes/catppuccin-latte"),
  "catppuccin-mocha": () =>
    import("@shikijs/themes/catppuccin-mocha"),
  "gruvbox-light-medium": () =>
    import("@shikijs/themes/gruvbox-light-medium"),
  "gruvbox-dark-medium": () =>
    import("@shikijs/themes/gruvbox-dark-medium"),
  "solarized-light": () =>
    import("@shikijs/themes/solarized-light"),
  "solarized-dark": () =>
    import("@shikijs/themes/solarized-dark"),
  "rose-pine-dawn": () =>
    import("@shikijs/themes/rose-pine-dawn"),
  "rose-pine-moon": () =>
    import("@shikijs/themes/rose-pine-moon"),
} satisfies Record<ShikiCodeTheme, ThemeLoader>;

export function codeThemePalette(
  theme: ShikiCodeTheme,
): CodeThemePalette {
  return palettes[theme];
}

export function codeThemeCssVariables(
  theme: ShikiCodeTheme,
): Readonly<Record<`--minke-code-${string}`, string>> {
  const palette = codeThemePalette(theme);
  return {
    "--minke-code-background": palette.background,
    "--minke-code-foreground": palette.foreground,
    "--minke-code-gutter": palette.gutterForeground,
    "--minke-code-gutter-active": palette.gutterActiveForeground,
    "--minke-code-active-line": palette.activeLine,
    "--minke-code-selection": palette.selection,
    "--minke-code-cursor": palette.cursor,
    "--minke-code-border": palette.border,
    "--minke-code-comment": palette.comment,
    "--minke-code-keyword": palette.keyword,
    "--minke-code-string": palette.string,
    "--minke-code-added": palette.added,
    "--minke-code-deleted": palette.deleted,
  };
}

export async function loadCodeTheme(
  theme: ShikiCodeTheme,
): Promise<ThemeRegistration> {
  return (await themeLoaders[theme]()).default;
}

/** Provide an immediate xterm palette while the full local theme loads. */
export function terminalCodeThemeFallback(
  theme: ShikiCodeTheme,
): TerminalCodeTheme {
  const palette = codeThemePalette(theme);
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    cursorAccent: palette.background,
    selectionBackground: palette.selection,
  };
}

function registeredThemeColor(
  colors: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  const value = colors[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Load the exact terminal colors bundled with the selected Shiki theme.
 * Every supported theme remains local and available offline.
 */
export async function loadTerminalCodeTheme(
  theme: ShikiCodeTheme,
): Promise<TerminalCodeTheme> {
  const registration = await loadCodeTheme(theme);
  const colors = (registration.colors ?? {}) as Readonly<
    Record<string, unknown>
  >;
  const fallback = terminalCodeThemeFallback(theme);
  const palette = codeThemePalette(theme);
  const resolve = (key: string, value: string): string =>
    registeredThemeColor(colors, key, value);

  return {
    background: resolve(
      "terminal.background",
      fallback.background,
    ),
    foreground: resolve(
      "terminal.foreground",
      fallback.foreground,
    ),
    cursor: resolve(
      "terminalCursor.foreground",
      fallback.cursor,
    ),
    cursorAccent: resolve(
      "terminalCursor.background",
      fallback.cursorAccent,
    ),
    selectionBackground: resolve(
      "terminal.selectionBackground",
      fallback.selectionBackground,
    ),
    black: resolve(
      "terminal.ansiBlack",
      palette.gutterForeground,
    ),
    red: resolve("terminal.ansiRed", palette.deleted),
    green: resolve("terminal.ansiGreen", palette.added),
    yellow: resolve("terminal.ansiYellow", palette.string),
    blue: resolve("terminal.ansiBlue", palette.cursor),
    magenta: resolve("terminal.ansiMagenta", palette.keyword),
    cyan: resolve("terminal.ansiCyan", palette.string),
    white: resolve("terminal.ansiWhite", palette.foreground),
    brightBlack: resolve(
      "terminal.ansiBrightBlack",
      palette.comment,
    ),
    brightRed: resolve(
      "terminal.ansiBrightRed",
      palette.deleted,
    ),
    brightGreen: resolve(
      "terminal.ansiBrightGreen",
      palette.added,
    ),
    brightYellow: resolve(
      "terminal.ansiBrightYellow",
      palette.string,
    ),
    brightBlue: resolve(
      "terminal.ansiBrightBlue",
      palette.cursor,
    ),
    brightMagenta: resolve(
      "terminal.ansiBrightMagenta",
      palette.keyword,
    ),
    brightCyan: resolve(
      "terminal.ansiBrightCyan",
      palette.string,
    ),
    brightWhite: resolve(
      "terminal.ansiBrightWhite",
      palette.foreground,
    ),
  };
}
