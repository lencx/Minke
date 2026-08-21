import {
  createHighlighterCore,
} from "shiki/core";
import {
  createJavaScriptRegexEngine,
} from "shiki/engine/javascript";
import type {
  LanguageRegistration,
  ThemedToken,
} from "shiki/types";
import type {
  FileManagerCodeTheme,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  codeThemePalette,
  loadCodeTheme as loadCodeThemeRegistration,
  type ShikiCodeTheme,
} from "./code-themes.ts";

export const SYNTAX_HIGHLIGHT_MAX_CHARACTERS = 256 * 1_024;
const SYNTAX_HIGHLIGHT_MAX_LINE_CHARACTERS = 4 * 1_024;

type LanguageModule = {
  readonly default: LanguageRegistration[];
};

type LanguageLoader = () => Promise<LanguageModule>;

/**
 * A fine-grained, offline Shiki bundle. Each grammar is a local package
 * module and loads only when a preview actually needs it.
 */
const languageLoaders = {
  abap: () => import("@shikijs/langs/abap"),
  apache: () => import("@shikijs/langs/apache"),
  asciidoc: () => import("@shikijs/langs/asciidoc"),
  asm: () => import("@shikijs/langs/asm"),
  astro: () => import("@shikijs/langs/astro"),
  awk: () => import("@shikijs/langs/awk"),
  bash: () => import("@shikijs/langs/bash"),
  batch: () => import("@shikijs/langs/batch"),
  bicep: () => import("@shikijs/langs/bicep"),
  blade: () => import("@shikijs/langs/blade"),
  c: () => import("@shikijs/langs/c"),
  clojure: () => import("@shikijs/langs/clojure"),
  cmake: () => import("@shikijs/langs/cmake"),
  cobol: () => import("@shikijs/langs/cobol"),
  codeowners: () => import("@shikijs/langs/codeowners"),
  coffeescript: () => import("@shikijs/langs/coffeescript"),
  "common-lisp": () => import("@shikijs/langs/common-lisp"),
  cpp: () => import("@shikijs/langs/cpp"),
  crystal: () => import("@shikijs/langs/crystal"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  csv: () => import("@shikijs/langs/csv"),
  cue: () => import("@shikijs/langs/cue"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  elixir: () => import("@shikijs/langs/elixir"),
  elm: () => import("@shikijs/langs/elm"),
  erb: () => import("@shikijs/langs/erb"),
  erlang: () => import("@shikijs/langs/erlang"),
  fish: () => import("@shikijs/langs/fish"),
  "fortran-free-form": () =>
    import("@shikijs/langs/fortran-free-form"),
  fsharp: () => import("@shikijs/langs/fsharp"),
  gdscript: () => import("@shikijs/langs/gdscript"),
  "git-commit": () => import("@shikijs/langs/git-commit"),
  "git-rebase": () => import("@shikijs/langs/git-rebase"),
  gleam: () => import("@shikijs/langs/gleam"),
  glsl: () => import("@shikijs/langs/glsl"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  groovy: () => import("@shikijs/langs/groovy"),
  handlebars: () => import("@shikijs/langs/handlebars"),
  haskell: () => import("@shikijs/langs/haskell"),
  hcl: () => import("@shikijs/langs/hcl"),
  hlsl: () => import("@shikijs/langs/hlsl"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  jinja: () => import("@shikijs/langs/jinja"),
  json: () => import("@shikijs/langs/json"),
  json5: () => import("@shikijs/langs/json5"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  julia: () => import("@shikijs/langs/julia"),
  just: () => import("@shikijs/langs/just"),
  kdl: () => import("@shikijs/langs/kdl"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  latex: () => import("@shikijs/langs/latex"),
  less: () => import("@shikijs/langs/less"),
  liquid: () => import("@shikijs/langs/liquid"),
  lua: () => import("@shikijs/langs/lua"),
  makefile: () => import("@shikijs/langs/makefile"),
  markdown: () => import("@shikijs/langs/markdown"),
  matlab: () => import("@shikijs/langs/matlab"),
  mdx: () => import("@shikijs/langs/mdx"),
  nginx: () => import("@shikijs/langs/nginx"),
  nim: () => import("@shikijs/langs/nim"),
  nix: () => import("@shikijs/langs/nix"),
  nushell: () => import("@shikijs/langs/nushell"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  ocaml: () => import("@shikijs/langs/ocaml"),
  pascal: () => import("@shikijs/langs/pascal"),
  perl: () => import("@shikijs/langs/perl"),
  php: () => import("@shikijs/langs/php"),
  plsql: () => import("@shikijs/langs/plsql"),
  powershell: () => import("@shikijs/langs/powershell"),
  prisma: () => import("@shikijs/langs/prisma"),
  protobuf: () => import("@shikijs/langs/protobuf"),
  pug: () => import("@shikijs/langs/pug"),
  purescript: () => import("@shikijs/langs/purescript"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  racket: () => import("@shikijs/langs/racket"),
  rst: () => import("@shikijs/langs/rst"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  sass: () => import("@shikijs/langs/sass"),
  scala: () => import("@shikijs/langs/scala"),
  scheme: () => import("@shikijs/langs/scheme"),
  scss: () => import("@shikijs/langs/scss"),
  solidity: () => import("@shikijs/langs/solidity"),
  sql: () => import("@shikijs/langs/sql"),
  stylus: () => import("@shikijs/langs/stylus"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  "system-verilog": () =>
    import("@shikijs/langs/system-verilog"),
  terraform: () => import("@shikijs/langs/terraform"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  twig: () => import("@shikijs/langs/twig"),
  typescript: () => import("@shikijs/langs/typescript"),
  v: () => import("@shikijs/langs/v"),
  vb: () => import("@shikijs/langs/vb"),
  verilog: () => import("@shikijs/langs/verilog"),
  vhdl: () => import("@shikijs/langs/vhdl"),
  vue: () => import("@shikijs/langs/vue"),
  wgsl: () => import("@shikijs/langs/wgsl"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
} satisfies Record<string, LanguageLoader>;

export type SyntaxLanguage = keyof typeof languageLoaders;

const exactLanguages = new Map<string, SyntaxLanguage>([
  [".babelrc", "jsonc"],
  [".browserslistrc", "ini"],
  [".editorconfig", "ini"],
  [".env", "dotenv"],
  [".eslintrc", "jsonc"],
  [".gitattributes", "bash"],
  [".gitignore", "bash"],
  [".npmrc", "ini"],
  [".prettierrc", "jsonc"],
  [".stylelintrc", "jsonc"],
  [".swcrc", "jsonc"],
  [".yarnrc", "yaml"],
  ["apache.conf", "apache"],
  ["brewfile", "ruby"],
  ["bun.lock", "jsonc"],
  ["cargo.lock", "toml"],
  ["cargo.toml", "toml"],
  ["cmakelists.txt", "cmake"],
  ["codeowners", "codeowners"],
  ["composer.json", "json"],
  ["composer.lock", "json"],
  ["containerfile", "dockerfile"],
  ["deno.json", "json"],
  ["deno.jsonc", "jsonc"],
  ["dockerfile", "dockerfile"],
  ["fastfile", "ruby"],
  ["flake.nix", "nix"],
  ["gemfile", "ruby"],
  ["gnumakefile", "makefile"],
  ["go.mod", "go"],
  ["go.work", "go"],
  ["gradle", "groovy"],
  ["jenkinsfile", "groovy"],
  ["jsconfig.json", "jsonc"],
  ["justfile", "just"],
  ["makefile", "makefile"],
  ["nginx.conf", "nginx"],
  ["package-lock.json", "json"],
  ["package.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["podfile", "ruby"],
  ["rakefile", "ruby"],
  ["settings.gradle", "groovy"],
  ["terraform.lock.hcl", "hcl"],
  ["tsconfig.json", "jsonc"],
  ["vagrantfile", "ruby"],
  ["yarn.lock", "yaml"],
]);

const compoundExtensions = new Map<string, SyntaxLanguage>([
  [".blade.php", "blade"],
  [".d.cts", "typescript"],
  [".d.mts", "typescript"],
  [".d.ts", "typescript"],
  [".html.eex", "elixir"],
  [".tf.json", "json"],
]);

const extensionLanguages = new Map<string, SyntaxLanguage>([
  ["abap", "abap"],
  ["adoc", "asciidoc"],
  ["apacheconf", "apache"],
  ["asm", "asm"],
  ["astro", "astro"],
  ["awk", "awk"],
  ["bash", "bash"],
  ["bat", "batch"],
  ["bicep", "bicep"],
  ["c", "c"],
  ["cc", "cpp"],
  ["clj", "clojure"],
  ["cljs", "clojure"],
  ["cljc", "clojure"],
  ["cmake", "cmake"],
  ["cob", "cobol"],
  ["cobol", "cobol"],
  ["coffee", "coffeescript"],
  ["conf", "ini"],
  ["cpp", "cpp"],
  ["cr", "crystal"],
  ["cs", "csharp"],
  ["css", "css"],
  ["csv", "csv"],
  ["cts", "typescript"],
  ["cue", "cue"],
  ["cxx", "cpp"],
  ["dart", "dart"],
  ["diff", "diff"],
  ["dockerfile", "dockerfile"],
  ["eex", "elixir"],
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["fish", "fish"],
  ["f90", "fortran-free-form"],
  ["f95", "fortran-free-form"],
  ["fs", "fsharp"],
  ["fsx", "fsharp"],
  ["gd", "gdscript"],
  ["gleam", "gleam"],
  ["glsl", "glsl"],
  ["gql", "graphql"],
  ["go", "go"],
  ["gradle", "groovy"],
  ["graphql", "graphql"],
  ["groovy", "groovy"],
  ["h", "c"],
  ["handlebars", "handlebars"],
  ["hbs", "handlebars"],
  ["hcl", "hcl"],
  ["hh", "cpp"],
  ["hlsl", "hlsl"],
  ["hpp", "cpp"],
  ["hs", "haskell"],
  ["htm", "html"],
  ["html", "html"],
  ["ini", "ini"],
  ["java", "java"],
  ["jinja", "jinja"],
  ["jinja2", "jinja"],
  ["jl", "julia"],
  ["js", "javascript"],
  ["json", "json"],
  ["json5", "json5"],
  ["jsonc", "jsonc"],
  ["jsx", "jsx"],
  ["kdl", "kdl"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["less", "less"],
  ["liquid", "liquid"],
  ["lisp", "common-lisp"],
  ["lua", "lua"],
  ["m", "objective-c"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["mdx", "mdx"],
  ["mjs", "javascript"],
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  ["mm", "objective-c"],
  ["mts", "typescript"],
  ["nim", "nim"],
  ["nix", "nix"],
  ["nu", "nushell"],
  ["pas", "pascal"],
  ["patch", "diff"],
  ["php", "php"],
  ["pl", "perl"],
  ["pls", "plsql"],
  ["prisma", "prisma"],
  ["proto", "protobuf"],
  ["ps1", "powershell"],
  ["pug", "pug"],
  ["purs", "purescript"],
  ["py", "python"],
  ["r", "r"],
  ["rake", "ruby"],
  ["rkt", "racket"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["rst", "rst"],
  ["sass", "sass"],
  ["scala", "scala"],
  ["scm", "scheme"],
  ["scss", "scss"],
  ["sh", "bash"],
  ["sol", "solidity"],
  ["sql", "sql"],
  ["styl", "stylus"],
  ["svelte", "svelte"],
  ["swift", "swift"],
  ["sv", "system-verilog"],
  ["svh", "system-verilog"],
  ["tex", "latex"],
  ["tf", "terraform"],
  ["tfvars", "terraform"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["twig", "twig"],
  ["v", "v"],
  ["vb", "vb"],
  ["vbs", "vb"],
  ["vert", "glsl"],
  ["frag", "glsl"],
  ["verilog", "verilog"],
  ["vhd", "vhdl"],
  ["vhdl", "vhdl"],
  ["vue", "vue"],
  ["wgsl", "wgsl"],
  ["xml", "xml"],
  ["xsl", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zig", "zig"],
  ["zsh", "bash"],
]);

function leafName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function resolveSyntaxLanguage(
  path: string,
): SyntaxLanguage | undefined {
  const name = leafName(path).toLowerCase();
  const exact = exactLanguages.get(name);
  if (exact !== undefined) return exact;
  if (name.startsWith(".env.")) return "dotenv";
  if (
    name.startsWith("dockerfile.") ||
    name.startsWith("containerfile.")
  ) {
    return "dockerfile";
  }
  if (name.startsWith("makefile.")) return "makefile";
  for (const [extension, language] of compoundExtensions) {
    if (name.endsWith(extension)) return language;
  }
  const separator = name.lastIndexOf(".");
  if (separator < 0) return undefined;
  return extensionLanguages.get(name.slice(separator + 1));
}

export interface HighlightedToken {
  readonly content: string;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly fontStyle?: number;
}

export interface HighlightedFileCode {
  readonly lines: readonly (readonly HighlightedToken[])[];
  readonly lineStarts: readonly number[];
  readonly language: SyntaxLanguage;
  readonly theme: ShikiCodeTheme;
  readonly background: string;
  readonly foreground: string;
  readonly partiallyHighlighted: boolean;
  readonly remainder: string;
}

function lineStartOffsets(content: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\r") {
      if (content[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    } else if (character === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

let highlighterPromise:
  | ReturnType<typeof createHighlighterCore>
  | undefined;
const languagePromises = new Map<SyntaxLanguage, Promise<void>>();
const themePromises = new Map<ShikiCodeTheme, Promise<void>>();

function highlighter() {
  highlighterPromise ??= createHighlighterCore({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine(),
    warnings: false,
  });
  return highlighterPromise;
}

async function loadTheme(theme: ShikiCodeTheme): Promise<void> {
  const pending = themePromises.get(theme);
  if (pending !== undefined) {
    await pending;
    return;
  }
  const next = (async () => {
    const [instance, registration] = await Promise.all([
      highlighter(),
      loadCodeThemeRegistration(theme),
    ]);
    await instance.loadTheme(registration);
  })();
  themePromises.set(theme, next);
  try {
    await next;
  } catch (error) {
    themePromises.delete(theme);
    throw error;
  }
}

async function loadLanguage(language: SyntaxLanguage): Promise<void> {
  const pending = languagePromises.get(language);
  if (pending !== undefined) {
    await pending;
    return;
  }
  const next = (async () => {
    const [instance, registration] = await Promise.all([
      highlighter(),
      languageLoaders[language](),
    ]);
    await instance.loadLanguage(registration.default);
  })();
  languagePromises.set(language, next);
  try {
    await next;
  } catch (error) {
    languagePromises.delete(language);
    throw error;
  }
}

function highlightedToken(token: ThemedToken): HighlightedToken {
  return {
    content: token.content,
    ...(token.color === undefined ? {} : { color: token.color }),
    ...(token.bgColor === undefined
      ? {}
      : { backgroundColor: token.bgColor }),
    ...(token.fontStyle === undefined || token.fontStyle <= 0
      ? {}
      : { fontStyle: token.fontStyle }),
  };
}

export async function highlightFileCode(
  path: string,
  content: string,
  theme: FileManagerCodeTheme = "github-light-default",
): Promise<HighlightedFileCode | undefined> {
  const language = resolveSyntaxLanguage(path);
  if (language === undefined) return undefined;
  const maximum = Math.min(
    content.length,
    SYNTAX_HIGHLIGHT_MAX_CHARACTERS,
  );
  let prefixLength = maximum;
  let lineStart = 0;
  for (let index = 0; index < maximum; index += 1) {
    if (
      content[index] === "\n" ||
      content[index] === "\r"
    ) {
      lineStart = index + 1;
    } else if (
      index - lineStart + 1 >=
        SYNTAX_HIGHLIGHT_MAX_LINE_CHARACTERS
    ) {
      prefixLength = index + 1;
      break;
    }
  }
  const highlightedPrefix = content.slice(0, prefixLength);
  const remainder = content.slice(prefixLength);
  try {
    await Promise.all([
      loadLanguage(language),
      loadTheme(theme),
    ]);
    const instance = await highlighter();
    const result = instance.codeToTokens(highlightedPrefix, {
      lang: language,
      theme,
    });
    const palette = codeThemePalette(theme);
    return {
      lines: result.tokens.map((line) =>
        line.map(highlightedToken)),
      lineStarts: lineStartOffsets(highlightedPrefix),
      language,
      theme,
      background: result.bg ?? palette.background,
      foreground: result.fg ?? palette.foreground,
      partiallyHighlighted: remainder.length > 0,
      remainder,
    };
  } catch {
    // A missing or incompatible grammar must never break file preview.
    return undefined;
  }
}
