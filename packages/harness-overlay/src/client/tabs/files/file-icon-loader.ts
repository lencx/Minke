import { icons } from "@iconify-json/vscode-icons";

interface IconSource {
  readonly body: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
}

interface IconAliasSource {
  readonly parent: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface LoadedFileIcon {
  readonly name: string;
  readonly body: string;
  readonly viewBox: string;
}

export interface FolderIconOptions {
  readonly expanded?: boolean;
  readonly root?: boolean;
}

const FILE_PREFIX = "file-type-";
const FOLDER_PREFIX = "folder-type-";
const DEFAULT_FILE_ICON = "default-file";
const DEFAULT_FOLDER_ICON = "default-folder";
const DEFAULT_FOLDER_OPENED_ICON = "default-folder-opened";
const DEFAULT_ROOT_FOLDER_ICON = "default-root-folder";
const DEFAULT_ROOT_FOLDER_OPENED_ICON =
  "default-root-folder-opened";

const iconAliases = icons.aliases ?? {};
const iconCache = new Map<string, LoadedFileIcon>();

const exactFileIcons: Readonly<Record<string, string>> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  ".npmrc": "npm",
  ".npmignore": "npm",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  ".pnpmfile.cjs": "pnpm",
  "yarn.lock": "yarn",
  ".yarnrc": "yarn",
  ".yarnrc.yml": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "deno.json": "deno",
  "deno.jsonc": "deno",
  "jsr.json": "jsr",
  "jsr.jsonc": "jsr",
  "tsconfig.json": "tsconfig-official",
  "jsconfig.json": "jsconfig",
  "biome.json": "biome",
  "biome.jsonc": "biome",
  "cargo.toml": "cargo",
  "cargo.lock": "cargo",
  "clippy.toml": "rust",
  "rustfmt.toml": "rust",
  "rust-toolchain": "rust-toolchain",
  "rust-toolchain.toml": "rust-toolchain",
  "pyproject.toml": "pythonconfig",
  "poetry.lock": "poetry",
  "uv.lock": "uv",
  "requirements.txt": "python",
  "pipfile": "python",
  "pipfile.lock": "python",
  "gemfile": "ruby",
  "gemfile.lock": "ruby",
  "brewfile": "brew",
  "rakefile": "rake",
  "mix.exs": "elixir",
  "mix.lock": "elixir",
  "go.mod": "go",
  "go.sum": "go",
  "go.work": "go-work",
  "composer.json": "composer",
  "composer.lock": "composer",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "gradle.properties": "gradle",
  "package.swift": "swift",
  "package.resolved": "swift",
  "pubspec.yaml": "flutter-package",
  "pubspec.lock": "flutter-package",
  "analysis_options.yaml": "dartlang",
  "build.zig": "zig",
  "build.zig.zon": "zig",
  "flake.nix": "nix",
  "default.nix": "nix",
  "shell.nix": "nix",
  "cmakelists.txt": "cmake",
  "makefile": "makefile",
  "justfile": "just",
  "taskfile.yml": "taskfile",
  "taskfile.yaml": "taskfile",
  "earthfile": "earthly",
  "procfile": "procfile",
  "vagrantfile": "vagrant",
  "jenkinsfile": "jenkins",
  "caddyfile": "caddy",
  "nginx.conf": "nginx",
  "dockerfile": "docker",
  "containerfile": "docker",
  "compose.yaml": "docker",
  "compose.yml": "docker",
  "docker-compose.yaml": "docker",
  "docker-compose.yml": "docker",
  ".dockerignore": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".gitconfig": "git",
  ".clang-format": "clangd",
  ".clang-tidy": "clangd",
  ".htaccess": "apache",
  ".editorconfig": "editorconfig",
  ".env": "dotenv",
  ".env.example": "dotenv",
  "wrangler.toml": "cloudflare",
  "codeowners": "codeowners",
  "agents.md": "agents",
  "claude.md": "claude",
  "skill.md": "skill",
  "robots.txt": "robots",
  "humans.txt": "humanstxt",
  "settings.json": "vscode",
  "launch.json": "vscode",
  "tasks.json": "vscode",
  "extensions.json": "vscode",
  ".vscodeignore": "vscode",
};

const preferredExtensionIcons: Readonly<
  Record<string, string>
> = {
  "d.ts": "typescriptdef-official",
  "d.cts": "typescriptdef-official",
  "d.mts": "typescriptdef-official",
  "js.map": "jsmap",
  "cjs.map": "jsmap",
  "mjs.map": "jsmap",
  js: "js-official",
  cjs: "js-official",
  mjs: "js-official",
  jsx: "reactjs",
  ts: "typescript-official",
  cts: "typescript-official",
  mts: "typescript-official",
  tsx: "reactts",
  json: "json-official",
  jsonc: "json-official",
  json5: "json5",
  jsonld: "jsonld",
  jsonl: "json-official",
  ndjson: "json-official",
  hjson: "hjson",
  geojson: "geojson",
  md: "markdown",
  mdown: "markdown",
  mdx: "mdx",
  adoc: "asciidoc",
  asciidoc: "asciidoc",
  rst: "text",
  org: "org",
  yml: "yaml",
  htm: "html",
  xhtml: "html",
  xsd: "xml",
  xsl: "xsl",
  xslt: "xsl",
  dtd: "dtd",
  cfg: "config",
  conf: "config",
  properties: "config",
  ini: "ini",
  env: "dotenv",
  bash: "shell",
  fish: "shell",
  sh: "shell",
  zsh: "shell",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  nu: "nushell",
  py: "python",
  pyi: "python",
  pyw: "python",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  rs: "rust",
  rlib: "rust",
  r: "r",
  rmd: "rmd",
  rproj: "rproj",
  jl: "julia",
  h: "cheader",
  hh: "cppheader",
  hpp: "cppheader",
  hxx: "cppheader",
  cc: "cpp",
  cxx: "cpp",
  inl: "cpp",
  cs: "csharp",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  fsproj: "fsproj",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sc: "scala",
  sbt: "sbt",
  groovy: "groovy",
  gvy: "groovy",
  gradle: "gradle",
  m: "objectivec",
  mm: "objectivecpp",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  ml: "ocaml",
  mli: "ocaml-intf",
  elm: "elm",
  cr: "crystal",
  d: "dlang",
  nim: "nim",
  nims: "nim",
  nimble: "nimble",
  zig: "zig",
  v: "vlang",
  vsh: "vlang",
  vala: "vala",
  vapi: "vapi",
  pl: "perl",
  pm: "perl",
  t: "perl",
  raku: "raku",
  rakumod: "raku",
  p6: "raku",
  lua: "lua",
  luau: "luau",
  tcl: "tcl",
  awk: "awk",
  pas: "delphi",
  pp: "delphi",
  dpr: "delphi",
  cob: "cobol",
  cbl: "cobol",
  cpy: "cobol",
  f: "fortran",
  for: "fortran",
  f77: "fortran",
  f90: "fortran",
  f95: "fortran",
  f03: "fortran",
  f08: "fortran",
  asm: "assembly",
  s: "assembly",
  adb: "ada",
  ads: "ada",
  agda: "agda",
  lean: "lean",
  idr: "idris",
  purs: "purescript",
  re: "reason",
  rei: "reason",
  res: "rescript",
  resi: "rescript",
  hx: "haxe",
  hxml: "haxe",
  gleam: "gleam",
  sol: "solidity",
  vy: "vyper",
  cairo: "cairo",
  rkt: "racket",
  lisp: "lisp",
  cl: "lisp",
  el: "emacs",
  coffee: "coffeescript",
  litcoffee: "coffeescript",
  as: "actionscript",
  dart: "dartlang",
  gql: "graphql",
  graphql: "graphql",
  proto: "protobuf",
  capnp: "capnp",
  fbs: "flatbuffers",
  avro: "avro",
  parquet: "parquet",
  raml: "raml",
  apib: "apib",
  wat: "wasm",
  wasm: "wasm",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "hashicorp",
  cue: "cue",
  dhall: "dhall",
  nix: "nix",
  bicep: "bicep",
  rego: "rego",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  stylus: "stylus",
  hbs: "handlebars",
  handlebars: "handlebars",
  mustache: "mustache",
  pug: "pug",
  jade: "pug",
  ejs: "ejs",
  njk: "nunjucks",
  nunjucks: "nunjucks",
  twig: "twig",
  liquid: "liquid",
  erb: "erb",
  haml: "haml",
  slim: "slim",
  slang: "slang",
  "blade.php": "blade",
  cshtml: "razor",
  razor: "razor",
  jsp: "jsp",
  asp: "asp",
  aspx: "aspx",
  mjml: "mjml",
  marko: "marko",
  wxml: "wxml",
  wxss: "wxss",
  tex: "tex",
  sty: "tex",
  cls: "tex",
  bib: "tex",
  tfstate: "terraform",
  dbml: "dbml",
  prisma: "prisma",
  psql: "pgsql",
  pgsql: "pgsql",
  mysql: "mysql",
  mongo: "mongo",
  vert: "glsl",
  frag: "glsl",
  geom: "glsl",
  tesc: "glsl",
  tese: "glsl",
  glsl: "glsl",
  hlsl: "hlsl",
  wgsl: "wgsl",
  wesl: "wesl",
  metal: "metal",
  shader: "shaderlab",
  gd: "gdscript",
  godot: "godot",
  tres: "tres",
  tscn: "tscn",
  mk: "makefile",
  cmake: "cmake",
  bazel: "bazel",
  bzl: "bazel",
  ninja: "ninja",
  meson: "meson",
  xcodeproj: "xcode",
  xcworkspace: "xcode",
  pbxproj: "xcode",
  podspec: "ruby",
  class: "class",
  jar: "jar",
  dll: "binary",
  exe: "binary",
  bin: "binary",
  pem: "key",
  key: "key",
  crt: "cert",
  cer: "cert",
  gpg: "gpg",
  asc: "gpg",
  http: "http",
  rest: "rest",
  hurl: "hurl",
  log: "log",
  map: "map",
  tsbuildinfo: "tsbuildinfo",
  jpg: "image",
  jpeg: "image",
  jpe: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  webp: "image",
  heic: "image",
  heif: "image",
  ico: "image",
  psd: "photoshop",
  ai: "ai",
  eps: "eps",
  blend: "blender",
  sketch: "sketch",
  drawio: "drawio",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  ogg: "audio",
  opus: "audio",
  midi: "audio",
  mid: "audio",
  m3u: "audio",
  mp4: "video",
  m4v: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
  wmv: "video",
  pdf: "pdf2",
  doc: "word",
  docx: "word",
  odt: "word",
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  ods: "excel",
  csv: "excel",
  tsv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  rtf: "word",
  pages: "word",
  numbers: "excel",
  "7z": "zip",
  bz2: "zip",
  gz: "zip",
  rar: "zip",
  tar: "zip",
  "tar.bz2": "zip",
  "tar.gz": "zip",
  "tar.xz": "zip",
  tbz: "zip",
  tbz2: "zip",
  tgz: "zip",
  txz: "zip",
  xz: "zip",
  zst: "zip",
  lz: "zip",
  lzma: "zip",
  cab: "zip",
  zip: "zip",
  eot: "font",
  otf: "font",
  ttf: "font",
  ttc: "font",
  woff: "font",
  woff2: "font",
  db: "db",
  db3: "db",
  sqlite: "sqlite",
  sqlite3: "sqlite",
};

const folderAliases: Readonly<Record<string, string>> = {
  "__mocks__": "mock",
  "__tests__": "test",
  apis: "api",
  applications: "app",
  apps: "app",
  assets: "asset",
  bin: "binary",
  build: "dist",
  cache: "temp",
  caches: "temp",
  cmd: "cli",
  commands: "cli",
  components: "component",
  configs: "config",
  configurations: "config",
  controllers: "controller",
  documentation: "docs",
  examples: "docs",
  fixtures: "mock",
  helpers: "helper",
  hooks: "hook",
  i18n: "locale",
  icons: "images",
  img: "images",
  lib: "library",
  libs: "library",
  locales: "locale",
  logs: "log",
  migrations: "db",
  mocks: "mock",
  models: "model",
  node_modules: "node",
  out: "dist",
  packages: "package",
  repositories: "git",
  resources: "asset",
  routes: "route",
  scripts: "script",
  source: "src",
  specs: "test",
  static: "asset",
  storybook: "story",
  styles: "style",
  tests: "test",
  tmp: "temp",
  tools: "tools",
  translations: "locale",
  types: "interfaces",
  utils: "helper",
  vendor: "library",
  views: "view",
  workflows: "github",
};

const filePatterns: readonly {
  readonly pattern: RegExp;
  readonly icon: string;
}[] = [
  {
    pattern: /^(?:readme|changelog|changes|history)(?:\..+)?$/u,
    icon: "markdown",
  },
  {
    pattern:
      /^(?:license|licence|copying|notice)(?:\..+)?$/u,
    icon: "license",
  },
  {
    pattern: /^\.env(?:\..+)?$/u,
    icon: "dotenv",
  },
  {
    pattern: /^(?:dockerfile|containerfile)(?:\..+)?$/u,
    icon: "docker",
  },
  {
    pattern:
      /^(?:docker-)?compose(?:\..+)?\.ya?ml$/u,
    icon: "docker",
  },
  {
    pattern: /^.+\.(?:test|spec)\.(?:ts|cts|mts|tsx)$/u,
    icon: "testts",
  },
  {
    pattern: /^.+\.(?:test|spec)\.(?:js|cjs|mjs|jsx)$/u,
    icon: "testjs",
  },
  {
    pattern:
      /^.+\.(?:stories|story)\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/u,
    icon: "storybook",
  },
];

function pathEntryName(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  const separator = normalized.lastIndexOf("/");
  return normalized.slice(separator + 1);
}

function iconToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[@.]+/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function fileIconName(stem: string): string {
  return `${FILE_PREFIX}${stem}`;
}

function folderIconName(stem: string): string {
  return `${FOLDER_PREFIX}${stem}`;
}

function hasIcon(name: string): boolean {
  return (
    icons.icons[name] !== undefined ||
    iconAliases[name] !== undefined
  );
}

function sourceForIcon(
  name: string,
  visited: ReadonlySet<string> = new Set(),
): IconSource | undefined {
  const direct = icons.icons[name] as IconSource | undefined;
  if (direct !== undefined) return direct;
  if (visited.has(name)) return undefined;
  const alias = iconAliases[name] as
    | IconAliasSource
    | undefined;
  if (alias === undefined) return undefined;
  const nextVisited = new Set(visited);
  nextVisited.add(name);
  const parent = sourceForIcon(alias.parent, nextVisited);
  if (parent === undefined) return undefined;
  return {
    body: parent.body,
    left: alias.left ?? parent.left,
    top: alias.top ?? parent.top,
    width: alias.width ?? parent.width,
    height: alias.height ?? parent.height,
  };
}

function loadIcon(
  requestedName: string,
  fallbackName: string,
): LoadedFileIcon {
  const name = hasIcon(requestedName)
    ? requestedName
    : fallbackName;
  const cached = iconCache.get(name);
  if (cached !== undefined) return cached;

  const source = sourceForIcon(name);
  if (source === undefined) {
    throw new Error(`Missing bundled VS Code icon: ${name}`);
  }
  const left = source.left ?? 0;
  const top = source.top ?? 0;
  const width = source.width ?? icons.width ?? 32;
  const height = source.height ?? icons.height ?? 32;
  const loaded = Object.freeze({
    name,
    body: source.body,
    viewBox: `${left} ${top} ${width} ${height}`,
  });
  iconCache.set(name, loaded);
  return loaded;
}

function ownerIcon(lowerName: string): string | undefined {
  const visibleName = lowerName.replace(/^\.+/u, "");
  const config = /^(.+?)(?:\.config|rc)(?:\.|$)/u.exec(
    visibleName,
  );
  const ignored = /^(.+?)ignore(?:\.|$)/u.exec(visibleName);
  const owner = config?.[1] ?? ignored?.[1];
  if (owner === undefined) return undefined;

  const candidate = fileIconName(iconToken(owner));
  return hasIcon(candidate) ? candidate : undefined;
}

function extensionCandidates(lowerName: string): readonly string[] {
  const visibleName = lowerName.replace(/^\.+/u, "");
  const segments = visibleName.split(".");
  const candidates: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(index).join("."));
  }
  return candidates;
}

export function resolveFileIconName(pathOrName: string): string {
  const name = pathEntryName(pathOrName).toLowerCase();
  const exact = exactFileIcons[name];
  if (exact !== undefined) {
    const exactIcon = fileIconName(exact);
    if (hasIcon(exactIcon)) return exactIcon;
  }

  for (const candidate of filePatterns) {
    if (candidate.pattern.test(name)) {
      const patternIcon = fileIconName(candidate.icon);
      if (hasIcon(patternIcon)) return patternIcon;
    }
  }

  const owner = ownerIcon(name);
  if (owner !== undefined) return owner;

  for (const extension of extensionCandidates(name)) {
    const preferred = preferredExtensionIcons[extension];
    if (preferred !== undefined) {
      const preferredIcon = fileIconName(preferred);
      if (hasIcon(preferredIcon)) return preferredIcon;
    }
    const directIcon = fileIconName(iconToken(extension));
    if (hasIcon(directIcon)) return directIcon;
  }

  return DEFAULT_FILE_ICON;
}

export function resolveFolderIconName(
  pathOrName: string,
  options: FolderIconOptions = {},
): string {
  const name = pathEntryName(pathOrName);
  const normalized = iconToken(name);
  const alias = folderAliases[name.toLowerCase()] ??
    folderAliases[normalized];
  const candidates = [
    alias,
    normalized,
    normalized.endsWith("s") ? normalized.slice(0, -1) : undefined,
  ];

  for (const stem of candidates) {
    if (stem === undefined || stem.length === 0) continue;
    if (options.expanded === true) {
      const opened = folderIconName(`${stem}-opened`);
      if (hasIcon(opened)) return opened;
    }
    const closed = folderIconName(stem);
    if (hasIcon(closed)) return closed;
  }

  if (options.root === true) {
    return options.expanded === true
      ? DEFAULT_ROOT_FOLDER_OPENED_ICON
      : DEFAULT_ROOT_FOLDER_ICON;
  }
  return options.expanded === true
    ? DEFAULT_FOLDER_OPENED_ICON
    : DEFAULT_FOLDER_ICON;
}

export function loadFileIcon(pathOrName: string): LoadedFileIcon {
  return loadIcon(
    resolveFileIconName(pathOrName),
    DEFAULT_FILE_ICON,
  );
}

export function loadFolderIcon(
  pathOrName: string,
  options: FolderIconOptions = {},
): LoadedFileIcon {
  const fallback = options.root === true
    ? options.expanded === true
      ? DEFAULT_ROOT_FOLDER_OPENED_ICON
      : DEFAULT_ROOT_FOLDER_ICON
    : options.expanded === true
      ? DEFAULT_FOLDER_OPENED_ICON
      : DEFAULT_FOLDER_ICON;
  return loadIcon(
    resolveFolderIconName(pathOrName, options),
    fallback,
  );
}
