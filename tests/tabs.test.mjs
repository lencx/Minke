import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorState } from "@codemirror/state";
import {
  normalizeWebTabUrl,
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  FILES_IMAGE_PREVIEW_MAX_BYTES,
  FILES_TEXT_PREVIEW_MAX_BYTES,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  NewSessionTabsHeaderAction,
  SESSION_HEADER_ACTION_STYLES,
  SessionLogHeaderAction,
  TabsHeaderAction,
} from "@minke/harness-overlay/client/tabs/HeaderActions.ts";
import {
  tabsEn,
  tabsZh,
} from "@minke/harness-overlay/client/tabs/locales.ts";
import {
  TabRendererRegistry,
} from "@minke/harness-overlay/client/tabs/registry.ts";
import {
  TABS_CHROME_HEIGHT,
} from "@minke/harness-overlay/client/tabs/constants.ts";
import {
  clampTabsPanelWidth,
  TabsPanelResizeController,
  TABS_PANEL_MAX_WIDTH,
} from "@minke/harness-overlay/client/tabs/resize.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  TABS_STYLES,
} from "@minke/harness-overlay/client/tabs/styles.ts";
import {
  shikiDecorationRanges,
} from "@minke/harness-overlay/client/tabs/files/shiki-decorations.ts";
import {
  indentationFoldRange,
} from "@minke/harness-overlay/client/tabs/files/code-folding.ts";
import {
  FilesTabsController,
} from "@minke/harness-overlay/client/tabs/files/controller.ts";
import {
  loadFileIcon,
  loadFolderIcon,
  resolveFileIconName,
  resolveFolderIconName,
} from "@minke/harness-overlay/client/tabs/files/file-icon-loader.ts";
import {
  clampFilesPreviewWidth,
  defaultFilesPreviewWidth,
} from "@minke/harness-overlay/client/tabs/files/preview-resize.ts";
import {
  confirmFilesTabClose,
} from "@minke/harness-overlay/client/tabs/files/close-confirm.ts";
import {
  FILES_TAB_STYLES,
} from "@minke/harness-overlay/client/tabs/files/styles.ts";
import {
  highlightFileCode,
  resolveSyntaxLanguage,
  SYNTAX_HIGHLIGHT_MAX_CHARACTERS,
} from "@minke/harness-overlay/client/tabs/files/syntax-highlight.ts";
import {
  normalizeWebAddressInput,
  normalizeWebFaviconUrl,
  WebTabsController,
} from "@minke/harness-overlay/client/tabs/web/controller.ts";
import {
  DSH_PLUGINS_URL,
  openDshPlugins,
} from "@minke/harness-overlay/client/tabs/web/plugins.ts";
import {
  FileManagerRuntime,
} from "@minke/desktop/main/tabs/files.ts";
import {
  protectTabWebviewGuest,
  secureTabWebview,
} from "@minke/desktop/main/tabs/security.ts";

async function settleAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

function fileVersion(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function filesTestTranslate(key, params = {}) {
  if (key === "files.preview.discardConfirm") {
    return `Discard ${params.name}?`;
  }
  if (key === "files.preview.saveError") {
    return `Save failed: ${params.error}`;
  }
  return key;
}

test("Web tab URLs accept only credential-free HTTP(S)", () => {
  assert.equal(
    normalizeWebTabUrl("https://example.com/docs?q=1#intro"),
    "https://example.com/docs?q=1#intro",
  );
  assert.equal(
    normalizeWebTabUrl("http://localhost:4173"),
    "http://localhost:4173/",
  );
  for (const candidate of [
    "mailto:hello@example.com",
    "file:///tmp/report.html",
    "javascript:alert(1)",
    "https://user:secret@example.com/",
    "not a url",
  ]) {
    assert.equal(normalizeWebTabUrl(candidate), undefined);
  }
  assert.equal(
    normalizeWebAddressInput("example.com/docs"),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeWebAddressInput("localhost:4173"),
    "https://localhost:4173/",
  );
  assert.equal(
    normalizeWebAddressInput("666"),
    "https://www.google.com/search?q=666",
  );
  assert.equal(
    normalizeWebAddressInput("best terminal for mac"),
    "https://www.google.com/search?q=best+terminal+for+mac",
  );
  assert.equal(
    normalizeWebAddressInput("file:///tmp/report.html"),
    undefined,
  );
  assert.equal(
    normalizeWebAddressInput(
      "https://user:secret@example.com/",
    ),
    undefined,
  );
});

test("Files runtime falls back to the system root", async () => {
  const root = parse(process.cwd()).root;
  const opened = [];
  const entry = (name, kind) => ({
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
  const runtime = new FileManagerRuntime({
    rootPath: root,
    readDirectory: async (path) => {
      assert.equal(path, root);
      return [
        entry("zeta.txt", "file"),
        entry("Alpha", "directory"),
        entry("linked-file", "symlink"),
        entry("broken-link", "symlink"),
      ];
    },
    inspectPath: async (path) => {
      if (path.endsWith("linked-file")) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 1,
        };
      }
      throw new Error("broken link");
    },
    openPath: async (path) => {
      opened.push(path);
      return path.endsWith("blocked") ? "blocked by system" : "";
    },
  });

  const listing = await runtime.list({});
  assert.equal(listing.path, root);
  assert.equal(listing.parent, undefined);
  assert.deepEqual(
    listing.entries.map(({ name, kind }) => [name, kind]),
    [
      ["Alpha", "directory"],
      ["zeta.txt", "file"],
      ["broken-link", "symlink"],
      ["linked-file", "symlink"],
    ],
  );
  assert.equal(
    listing.entries.find(({ name }) => name === "linked-file")
      ?.targetKind,
    "file",
  );
  assert.equal(listing.truncated, false);

  await runtime.open({ path: join(root, "zeta.txt") });
  assert.deepEqual(opened, [join(root, "zeta.txt")]);
  await assert.rejects(
    runtime.open({ path: join(root, "blocked") }),
    /blocked by system/u,
  );
  await assert.rejects(
    runtime.list({ path: "relative/path" }),
    /must be absolute/u,
  );
});

test("Files runtime bounds text and image previews", async () => {
  assert.equal(
    FILES_TEXT_PREVIEW_MAX_BYTES,
    8 * 1_024 * 1_024,
  );
  assert.equal(
    FILES_IMAGE_PREVIEW_MAX_BYTES,
    32 * 1_024 * 1_024,
  );
  const root = parse(process.cwd()).root;
  const reads = [];
  const writes = [];
  const directoryPath = join(root, "folder");
  const sizes = new Map([
    [join(root, "notes.ts"), 18],
    [join(root, "binary.dat"), 4],
    [join(root, "pixel.png"), 4],
    [join(root, "large.png"), 33 * 1_024 * 1_024],
  ]);
  const content = new Map([
    [join(root, "notes.ts"), Buffer.from("export const ok = 1;")],
    [join(root, "binary.dat"), Buffer.from([0, 1, 2, 3])],
    [join(root, "pixel.png"), Buffer.from([137, 80, 78, 71])],
  ]);
  const runtime = new FileManagerRuntime({
    rootPath: root,
    inspectPath: async (path) =>
      path === directoryPath
        ? {
            isDirectory: () => true,
            isFile: () => false,
            size: 0,
          }
        : {
            isDirectory: () => false,
            isFile: () => true,
            size: sizes.get(path),
          },
    readBytes: async (path, limit) => {
      reads.push([path, limit]);
      return content.get(path) ?? Buffer.alloc(0);
    },
    writeText: async (path, next) => {
      writes.push([path, next]);
      content.set(path, Buffer.from(next));
    },
    openPath: async () => "",
  });

  assert.deepEqual(
    await runtime.preview({ path: join(root, "notes.ts") }),
    {
      kind: "text",
      path: join(root, "notes.ts"),
      name: "notes.ts",
      size: 18,
      content: "export const ok = 1;",
      truncated: false,
      version: fileVersion(
        Buffer.from("export const ok = 1;"),
      ),
    },
  );
  assert.equal(
    (await runtime.preview({
      path: join(root, "binary.dat"),
    })).kind,
    "unsupported",
  );
  const image = await runtime.preview({
    path: join(root, "pixel.png"),
  });
  assert.equal(image.kind, "image");
  assert.equal(image.mimeType, "image/png");
  assert.match(image.dataUrl, /^data:image\/png;base64,/u);
  assert.deepEqual(
    reads.map(([, limit]) => limit),
    [
      FILES_TEXT_PREVIEW_MAX_BYTES + 1,
      FILES_TEXT_PREVIEW_MAX_BYTES + 1,
      FILES_IMAGE_PREVIEW_MAX_BYTES + 1,
    ],
  );
  assert.deepEqual(
    await runtime.preview({ path: join(root, "large.png") }),
    {
      kind: "unsupported",
      path: join(root, "large.png"),
      name: "large.png",
      size: 33 * 1_024 * 1_024,
      reason: "too-large",
    },
  );
  assert.equal(
    reads.some(([path]) => path.endsWith("large.png")),
    false,
  );
  await assert.rejects(
    runtime.preview({ path: "relative.txt" }),
    /must be absolute/u,
  );
  const saved = "# Saved 🚀";
  const notesVersion = fileVersion(
    Buffer.from("export const ok = 1;"),
  );
  assert.deepEqual(
    await runtime.write({
      path: join(root, "notes.ts"),
      content: saved,
      expectedVersion: notesVersion,
    }),
    {
      path: join(root, "notes.ts"),
      size: Buffer.byteLength(saved, "utf8"),
      version: fileVersion(Buffer.from(saved)),
    },
  );
  assert.deepEqual(writes, [
    [join(root, "notes.ts"), saved],
  ]);
  await assert.rejects(
    runtime.write({
      path: "relative.txt",
      content: "no",
      expectedVersion: notesVersion,
    }),
    /must be absolute/u,
  );
  await assert.rejects(
    runtime.write({
      path: directoryPath,
      content: "no",
      expectedVersion: notesVersion,
    }),
    /must be a file/u,
  );
  await assert.rejects(
    runtime.write({
      path: join(root, "notes.ts"),
      content: "🚀".repeat(
        FILES_TEXT_PREVIEW_MAX_BYTES / 4 + 1,
      ),
      expectedVersion: notesVersion,
    }),
    /within the size limit/u,
  );
  content.set(
    join(root, "notes.ts"),
    Buffer.from("changed elsewhere"),
  );
  await assert.rejects(
    runtime.write({
      path: join(root, "notes.ts"),
      content: "stale editor contents",
      expectedVersion: fileVersion(Buffer.from(saved)),
    }),
    /changed on disk/u,
  );
});

test("Files writes atomically through symlinks and preserves permissions", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-files-write-"),
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const target = join(directory, "target.rs");
  const link = join(directory, "linked.rs");
  const initial = 'fn main() { println!("before"); }\n';
  const edited = 'fn main() { println!("after"); }\n';
  await writeFile(target, initial, "utf8");
  await chmod(target, 0o640);
  await symlink("target.rs", link);
  const initialMode = (await lstat(target)).mode & 0o7777;
  const runtime = new FileManagerRuntime({
    rootPath: directory,
    openPath: async () => "",
  });

  const preview = await runtime.preview({ path: link });
  assert.equal(preview.kind, "text");
  assert.equal(preview.content, initial);
  const result = await runtime.write({
    path: link,
    content: edited,
    expectedVersion: preview.version,
  });

  assert.equal(await readFile(target, "utf8"), edited);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(
    (await lstat(target)).mode & 0o7777,
    initialMode,
  );
  assert.equal(result.version, fileVersion(Buffer.from(edited)));
});

test("Files icons prefer semantic names and fall back by extension", () => {
  assert.deepEqual(
    [
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "vite.config.ts",
      "src/app.js",
      "src/app.ts",
      "src/app.jsx",
      "src/App.tsx",
      "types/index.d.ts",
      "README.md",
      "LICENSE",
      ".env.local",
      "Dockerfile.prod",
      ".gitignore",
      "photo.png",
      "song.mp3",
      "movie.mp4",
      "report.docx",
      "archive.tar.gz",
      "untitled.unknown-extension",
    ].map(resolveFileIconName),
    [
      "file-type-npm",
      "file-type-pnpm",
      "file-type-yarn",
      "file-type-bun",
      "file-type-vite",
      "file-type-js-official",
      "file-type-typescript-official",
      "file-type-reactjs",
      "file-type-reactts",
      "file-type-typescriptdef-official",
      "file-type-markdown",
      "file-type-license",
      "file-type-dotenv",
      "file-type-docker",
      "file-type-git",
      "file-type-image",
      "file-type-audio",
      "file-type-video",
      "file-type-word",
      "file-type-zip",
      "default-file",
    ],
  );
  assert.deepEqual(
    ["src", "components", "assets", "node_modules"].map(
      (name) => resolveFolderIconName(name),
    ),
    [
      "folder-type-src",
      "folder-type-component",
      "folder-type-asset",
      "folder-type-node",
    ],
  );
  assert.equal(
    resolveFolderIconName(".github", { expanded: true }),
    "folder-type-github-opened",
  );
  assert.equal(
    resolveFolderIconName("unmapped-directory"),
    "default-folder",
  );

  const loaded = loadFileIcon("src/App.tsx");
  assert.equal(loaded.name, "file-type-reactts");
  assert.match(loaded.body, /^</u);
  assert.match(loaded.viewBox, /^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/u);
  assert.strictEqual(loadFileIcon("src/App.tsx"), loaded);

  const aliased = loadFileIcon("Makefile");
  assert.equal(aliased.name, "file-type-makefile");
  assert.match(aliased.body, /^</u);
  assert.equal(aliased.viewBox, "0 0 32 32");

  const expandedFolder = loadFolderIcon(".github", {
    expanded: true,
  });
  assert.equal(
    expandedFolder.name,
    "folder-type-github-opened",
  );
  assert.strictEqual(
    loadFolderIcon(".github", { expanded: true }),
    expandedFolder,
  );
});

test("Files icons cover common languages without generic stem collisions", () => {
  const cases = [
    ["main.rs", "file-type-rust"],
    ["analysis.R", "file-type-r"],
    ["notebook.jl", "file-type-julia"],
    ["Main.scala", "file-type-scala"],
    ["build.sbt", "file-type-sbt"],
    ["app.ex", "file-type-elixir"],
    ["main.erl", "file-type-erlang"],
    ["lib.fs", "file-type-fsharp"],
    ["Main.hs", "file-type-haskell"],
    ["core.clj", "file-type-clojure"],
    ["main.ml", "file-type-ocaml"],
    ["app.cr", "file-type-crystal"],
    ["main.nim", "file-type-nim"],
    ["build.zig", "file-type-zig"],
    ["main.v", "file-type-vlang"],
    ["app.sol", "file-type-solidity"],
    ["contract.vy", "file-type-vyper"],
    ["Main.purs", "file-type-purescript"],
    ["app.res", "file-type-rescript"],
    ["main.gleam", "file-type-gleam"],
    ["main.asm", "file-type-assembly"],
    ["program.f90", "file-type-fortran"],
    ["app.cob", "file-type-cobol"],
    ["script.bat", "file-type-bat"],
    ["view.hbs", "file-type-handlebars"],
    ["view.cshtml", "file-type-razor"],
    ["doc.mdx", "file-type-mdx"],
    ["schema.avro", "file-type-avro"],
    ["data.parquet", "file-type-parquet"],
    ["main.tf", "file-type-terraform"],
    ["policy.rego", "file-type-rego"],
    ["shader.vert", "file-type-glsl"],
    ["shader.wgsl", "file-type-wgsl"],
    ["scene.gd", "file-type-gdscript"],
    ["BUILD.bazel", "file-type-bazel"],
    ["project.xcodeproj", "file-type-xcode"],
    ["request.http", "file-type-http"],
    ["app.tsbuildinfo", "file-type-tsbuildinfo"],
    ["AGENTS.md", "file-type-agents"],
    ["rustfmt.toml", "file-type-rust"],
  ];
  assert.deepEqual(
    cases.map(([name]) => resolveFileIconName(name)),
    cases.map(([, icon]) => icon),
  );
  assert.equal(
    cases.some(
      ([name]) => resolveFileIconName(name) === "default-file",
    ),
    false,
  );
  assert.deepEqual(
    [
      "workflows",
      "vendor",
      "commands",
      "repositories",
      "translations",
    ].map((name) => resolveFolderIconName(name)),
    [
      "folder-type-github",
      "folder-type-library",
      "folder-type-cli",
      "folder-type-git",
      "folder-type-locale",
    ],
  );
});

test("Files code previews use Shiki across mainstream formats", async () => {
  assert.deepEqual(
    [
      "vite.config.ts",
      "App.tsx",
      ".env.local",
      "Dockerfile.prod",
      "README.md",
      "settings.yaml",
      "main.rs",
      "main.go",
      "Program.cs",
      "schema.graphql",
      "main.tf",
      "shader.wgsl",
      "component.vue",
      "template.blade.php",
      "unknown.data",
    ].map((name) => resolveSyntaxLanguage(name)),
    [
      "typescript",
      "tsx",
      "dotenv",
      "dockerfile",
      "markdown",
      "yaml",
      "rust",
      "go",
      "csharp",
      "graphql",
      "terraform",
      "wgsl",
      "vue",
      "blade",
      undefined,
    ],
  );

  const source = 'const markup = "<script>alert(1)</script>";';
  const highlighted = await highlightFileCode(
    "unsafe.ts",
    source,
  );
  assert.ok(highlighted);
  assert.equal(highlighted.language, "typescript");
  assert.equal(
    highlighted.lines
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n"),
    source,
  );
  assert.equal(
    highlighted.lines.some((line) =>
      line.some((token) => token.color !== undefined)),
    true,
  );
  assert.equal(highlighted.partiallyHighlighted, false);

  const crlfSource =
    "const first = 1;\r\nconst second = 2;\r\n";
  const crlf = await highlightFileCode("windows.ts", crlfSource);
  assert.ok(crlf);
  assert.deepEqual(crlf.lineStarts, [0, 18, 37]);
  const crlfRanges = shikiDecorationRanges(
    crlf,
    crlfSource.length,
  );
  assert.equal(
    crlfRanges.some(
      ({ from, to }) => from === 18 && to > from,
    ),
    true,
  );
  assert.equal(
    crlfRanges.every(
      ({ from, to }) =>
        from >= 0 &&
        to <= crlfSource.length &&
        from < to,
    ),
    true,
  );

  const large = await highlightFileCode(
    "large.js",
    `${" ".repeat(SYNTAX_HIGHLIGHT_MAX_CHARACTERS)}<tail>`,
  );
  assert.ok(large);
  assert.equal(large.partiallyHighlighted, true);
  assert.equal(large.remainder.endsWith("<tail>"), true);
  assert.equal(
    await highlightFileCode("notes.txt", "plain text"),
    undefined,
  );
});

test("Files preview divider preserves usable explorer and preview widths", () => {
  assert.equal(defaultFilesPreviewWidth(500), 280);
  assert.equal(clampFilesPreviewWidth(500, 20), 180);
  assert.equal(clampFilesPreviewWidth(500, 900), 351);
  assert.equal(clampFilesPreviewWidth(300, 900), 151);
  assert.equal(clampFilesPreviewWidth(Number.NaN, 200), 0);
});

test("Files editor resolves one CodeMirror view instance", () => {
  const testRequire = createRequire(import.meta.url);
  const directView = realpathSync(
    testRequire.resolve("@codemirror/view"),
  );
  const codemirrorRequire = createRequire(
    testRequire.resolve("codemirror"),
  );
  const setupView = realpathSync(
    codemirrorRequire.resolve("@codemirror/view"),
  );
  assert.equal(setupView, directView);
});

test("Files editor folds indented code blocks without a language parser", () => {
  const rust = EditorState.create({
    doc: [
      "fn main() {",
      '    println!("hello");',
      "}",
      "",
    ].join("\n"),
  });
  const rustStart = rust.doc.line(1);
  assert.deepEqual(
    indentationFoldRange(
      rust.doc,
      rustStart.from,
      rustStart.to,
    ),
    {
      from: rustStart.to,
      to: rust.doc.line(3).from,
    },
  );

  const python = EditorState.create({
    doc: [
      "def greet():",
      '    print("hello")',
      '    print("world")',
      "greet()",
    ].join("\n"),
  });
  const pythonStart = python.doc.line(1);
  assert.deepEqual(
    indentationFoldRange(
      python.doc,
      pythonStart.from,
      pythonStart.to,
    ),
    {
      from: pythonStart.to,
      to: python.doc.line(3).to,
    },
  );

  const flat = EditorState.create({
    doc: "const one = 1;\nconst two = 2;\n",
  });
  assert.equal(
    indentationFoldRange(
      flat.doc,
      flat.doc.line(1).from,
      flat.doc.line(1).to,
    ),
    null,
  );
});

test("Files editor exposes visible save progress and errors", () => {
  const previewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FilePreviewPane.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const localeSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/locales.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    previewSource,
    /className="minke-files-preview__save-status"[\s\S]*data-state=/u,
  );
  assert.match(previewSource, /role="status"/u);
  assert.match(previewSource, /aria-live="polite"/u);
  assert.match(previewSource, /SavingPreviewIcon/u);
  assert.match(previewSource, /SavedPreviewIcon/u);
  assert.match(previewSource, /data-saving=/u);
  assert.match(
    previewSource,
    /className="minke-files-preview__save-error"[\s\S]*role="alert"/u,
  );
  assert.match(
    previewSource,
    /className="minke-files-preview__size"/u,
  );
  assert.doesNotMatch(
    previewSource,
    /minke-files-preview__meta/u,
  );
  assert.doesNotMatch(previewSource, /<figcaption>/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__save-status/u,
  );
  assert.match(FILES_TAB_STYLES, /@keyframes minke-files-spin/u);
  assert.match(localeSource, /"files\.preview\.saving"/u);
  assert.match(localeSource, /"files\.preview\.saved"/u);
  assert.match(localeSource, /"files\.preview\.saveError"/u);
});

test("Files tabs start at the project cwd and retain navigation history", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const requests = [];
  const opened = [];
  const previewed = [];
  const written = [];
  const initialReadmeVersion = fileVersion(
    Buffer.from("# Hello"),
  );
  const editedReadmeVersion = fileVersion(
    Buffer.from("# Edited"),
  );
  const readme = {
    name: "README.md",
    path: "/workspace/README.md",
    kind: "file",
  };
  const files = new FilesTabsController(tabs, {
    available: true,
    async list(request) {
      requests.push(request);
      const path = request.path ?? "/";
      return {
        path,
        ...(path === "/"
          ? {}
          : {
              parent:
                path === "/workspace/src"
                  ? "/workspace"
                  : "/",
            }),
        entries:
          path === "/workspace"
            ? [
                {
                  name: "src",
                  path: "/workspace/src",
                  kind: "directory",
                },
                readme,
              ]
            : [],
        truncated: false,
      };
    },
    async open(request) {
      opened.push(request.path);
    },
    async preview(request) {
      previewed.push(request.path);
      return {
        kind: "text",
        path: request.path,
        name: "README.md",
        size: 7,
        content: "# Hello",
        truncated: false,
        version: initialReadmeVersion,
      };
    },
    async write(request) {
      written.push(request);
      return {
        path: request.path,
        size: Buffer.byteLength(request.content, "utf8"),
        version: fileVersion(Buffer.from(request.content)),
      };
    },
  });

  const projectTab = files.create("/workspace", "Files");
  assert.ok(projectTab);
  await settleAsyncWork();
  assert.deepEqual(requests, [{ path: "/workspace" }]);
  assert.equal(tabs.tab(projectTab).payload.path, "/workspace");
  assert.equal(tabs.tab(projectTab).title, "workspace");
  assert.equal(tabs.tab(projectTab).payload.viewMode, "list");

  files.setViewMode(projectTab, "tree");
  assert.equal(tabs.tab(projectTab).payload.viewMode, "tree");
  files.toggleTreeDirectory(
    projectTab,
    tabs.tab(projectTab).payload.entries[0],
  );
  await settleAsyncWork();
  assert.deepEqual(requests.at(-1), {
    path: "/workspace/src",
  });
  assert.equal(
    tabs.tab(projectTab).payload.tree["/workspace/src"].expanded,
    true,
  );
  files.toggleTreeDirectory(
    projectTab,
    tabs.tab(projectTab).payload.entries[0],
  );
  assert.equal(
    tabs.tab(projectTab).payload.tree["/workspace/src"].expanded,
    false,
  );

  files.preview(projectTab, readme);
  await settleAsyncWork();
  assert.deepEqual(previewed, ["/workspace/README.md"]);
  assert.equal(
    tabs.tab(projectTab).payload.preview.result.content,
    "# Hello",
  );
  files.setPreviewWidth(projectTab, 416);
  files.updatePreviewDraft(
    projectTab,
    "/workspace/README.md",
    "# Edited",
  );
  assert.equal(tabs.tab(projectTab).payload.preview.dirty, true);
  assert.equal(
    tabs.tab(projectTab).payload.preview.draft,
    "# Edited",
  );
  let closePrompt;
  assert.equal(
    confirmFilesTabClose(
      tabs.tab(projectTab),
      filesTestTranslate,
      (message) => {
        closePrompt = message;
        return false;
      },
    ),
    false,
  );
  assert.equal(closePrompt, "Discard README.md?");
  assert.equal(
    confirmFilesTabClose(
      tabs.tab(projectTab),
      filesTestTranslate,
      () => true,
    ),
    true,
  );
  const browserTab = tabs.open({
    kind: "web",
    key: "web:preview-state-test",
    title: "Browser",
    payload: {},
  });
  assert.ok(browserTab);
  tabs.activate(browserTab);
  tabs.activate(projectTab);
  assert.equal(
    tabs.tab(projectTab).payload.preview.draft,
    "# Edited",
  );
  assert.equal(tabs.tab(projectTab).payload.preview.dirty, true);
  assert.equal(tabs.tab(projectTab).payload.previewWidth, 416);
  files.savePreview(projectTab);
  assert.equal(tabs.tab(projectTab).payload.preview.saving, true);
  assert.equal(
    confirmFilesTabClose(
      tabs.tab(projectTab),
      filesTestTranslate,
      () => {
        throw new Error("saving tabs must not prompt or close");
      },
    ),
    false,
  );
  await settleAsyncWork();
  assert.deepEqual(written, [
    {
      path: "/workspace/README.md",
      content: "# Edited",
      expectedVersion: initialReadmeVersion,
    },
  ]);
  assert.equal(
    tabs.tab(projectTab).payload.preview.result.content,
    "# Edited",
  );
  assert.equal(tabs.tab(projectTab).payload.preview.dirty, false);
  assert.equal(tabs.tab(projectTab).payload.preview.draft, undefined);
  assert.equal(tabs.tab(projectTab).payload.preview.saving, false);
  assert.equal(
    tabs.tab(projectTab).payload.preview.result.version,
    editedReadmeVersion,
  );
  assert.equal(
    tabs.tab(projectTab).payload.preview.saveStatus,
    "saved",
  );
  assert.equal(
    confirmFilesTabClose(
      tabs.tab(projectTab),
      filesTestTranslate,
      () => {
        throw new Error("clean tabs must not prompt");
      },
    ),
    true,
  );
  files.closePreview(projectTab);
  assert.equal(tabs.tab(projectTab).payload.preview, undefined);

  files.navigate(projectTab, "/workspace/src");
  await settleAsyncWork();
  assert.equal(tabs.tab(projectTab).payload.canGoBack, true);
  assert.equal(tabs.tab(projectTab).payload.path, "/workspace/src");
  files.back(projectTab);
  await settleAsyncWork();
  assert.equal(tabs.tab(projectTab).payload.path, "/workspace");
  assert.equal(tabs.tab(projectTab).payload.canGoForward, true);
  files.open(projectTab, "/workspace/readme.md");
  await settleAsyncWork();
  assert.deepEqual(opened, ["/workspace/readme.md"]);

  const rootTab = files.create(undefined, "Files");
  assert.ok(rootTab);
  await settleAsyncWork();
  assert.deepEqual(requests.at(-1), {});
  assert.equal(tabs.tab(rootTab).payload.path, "/");

  const rendererSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/renderer.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(rendererSource, /id:\s*"files"/u);
  assert.match(rendererSource, /order:\s*0/u);
  assert.match(
    rendererSource,
    /controller\.create\(\s*context\.cwd,\s*t\("files\.tab\.new"\)/u,
  );
  assert.match(rendererSource, /files\.mode\.tree/u);
  assert.doesNotMatch(rendererSource, /files\.nav\.refresh/u);
  assert.doesNotMatch(rendererSource, /RefreshIcon/u);
  const viewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FileManagerView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const editorSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/CodeMirrorEditor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const treeSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FileTreeView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const tabsPanelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const tabsIpcSource = readFileSync(
    new URL(
      "../desktop/main/tabs/ipc.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(viewSource, /files\.kind\./u);
  assert.match(viewSource, /controller\.preview\(tab\.id,\s*entry\)/u);
  assert.match(viewSource, /role="separator"/u);
  assert.match(viewSource, /setPointerCapture/u);
  assert.match(viewSource, /ResizeObserver/u);
  assert.match(viewSource, /ArrowLeft/u);
  assert.match(FILES_TAB_STYLES, /\.minke-files-row\s*\{/u);
  assert.match(FILES_TAB_STYLES, /\.minke-files-tree\s*\{/u);
  assert.match(FILES_TAB_STYLES, /\.minke-files-preview\s*\{/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview-resize\s*\{[\s\S]*cursor:\s*col-resize/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-mode\s*\{[\s\S]*height:\s*var\(--minke-tabs-control-height\)/u,
  );
  assert.match(FILES_TAB_STYLES, /\.minke-files-preview__editor/u);
  assert.match(editorSource, /new EditorView/u);
  assert.match(editorSource, /basicSetup/u);
  assert.doesNotMatch(
    editorSource,
    /\b(?:lineNumbers|foldGutter)\(\)|\bfoldKeymap\b/u,
  );
  assert.match(editorSource, /indentationFolding/u);
  assert.match(editorSource, /key:\s*"Mod-s"/u);
  assert.match(editorSource, /data-highlighter="shiki"/u);
  assert.match(editorSource, /data-line-numbers="true"/u);
  assert.match(editorSource, /data-code-folding="true"/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.cm-lineNumbers[\s\S]*\.cm-gutterElement/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.cm-foldGutter[\s\S]*\.cm-gutterElement/u,
  );
  assert.doesNotMatch(treeSource, /role="tree(?:item)?"/u);
  assert.match(treeSource, /aria-expanded=/u);
  assert.match(rendererSource, /beforeClose:/u);
  assert.match(tabsPanelSource, /\.beforeClose\?\.\(tab\)/u);
  assert.match(
    tabsPanelSource,
    /event\.key === "Delete"[\s\S]*closeTab\(tab\.id\)/u,
  );
  for (const handler of [
    "handleFilesList",
    "handleFilesOpen",
    "handleFilesPreview",
    "handleFilesWrite",
  ]) {
    const start = tabsIpcSource.indexOf(`const ${handler}`);
    const end = tabsIpcSource.indexOf("\n  };", start);
    assert.ok(start >= 0 && end > start);
    assert.match(
      tabsIpcSource.slice(start, end),
      /if \(!authorize\(event\)\)/u,
    );
  }
  assert.match(
    FILES_TAB_STYLES,
    /scrollbar-color:[\s\S]*var\(--dsw-alias-border-l3\)/u,
  );

  files.dispose();
  tabs.dispose();
});

test("Files keeps newer edits and failed-save drafts intact", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const entry = {
    name: "main.rs",
    path: "/workspace/main.rs",
    kind: "file",
  };
  const baseline = "fn main() {}\n";
  const firstEdit = 'fn main() { println!("first"); }\n';
  const secondEdit = 'fn main() { println!("second"); }\n';
  const baselineVersion = fileVersion(Buffer.from(baseline));
  const firstVersion = fileVersion(Buffer.from(firstEdit));
  const writes = [];
  let resolveFirstWrite;
  const files = new FilesTabsController(tabs, {
    available: true,
    async list(request) {
      return {
        path: request.path ?? "/",
        entries: [entry],
        truncated: false,
      };
    },
    async open() {},
    async preview() {
      return {
        kind: "text",
        path: entry.path,
        name: entry.name,
        size: Buffer.byteLength(baseline),
        content: baseline,
        truncated: false,
        version: baselineVersion,
      };
    },
    write(request) {
      writes.push(request);
      if (writes.length === 1) {
        return new Promise((resolve) => {
          resolveFirstWrite = resolve;
        });
      }
      return Promise.reject(new Error("permission denied"));
    },
  });

  const tabId = files.create("/workspace", "Files");
  assert.ok(tabId);
  await settleAsyncWork();
  files.preview(tabId, entry);
  await settleAsyncWork();
  files.updatePreviewDraft(tabId, entry.path, firstEdit);
  files.savePreview(tabId);
  assert.equal(tabs.tab(tabId).payload.preview.saving, true);

  files.updatePreviewDraft(tabId, entry.path, secondEdit);
  assert.equal(
    tabs.tab(tabId).payload.preview.draft,
    secondEdit,
  );
  resolveFirstWrite({
    path: entry.path,
    size: Buffer.byteLength(firstEdit),
    version: firstVersion,
  });
  await settleAsyncWork();
  assert.equal(
    tabs.tab(tabId).payload.preview.result.content,
    firstEdit,
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.result.version,
    firstVersion,
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.draft,
    secondEdit,
  );
  assert.equal(tabs.tab(tabId).payload.preview.dirty, true);
  assert.equal(tabs.tab(tabId).payload.preview.saving, false);
  assert.equal(
    tabs.tab(tabId).payload.preview.saveStatus,
    undefined,
  );

  files.savePreview(tabId);
  await settleAsyncWork();
  assert.equal(
    tabs.tab(tabId).payload.preview.saveError,
    "permission denied",
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.draft,
    secondEdit,
  );
  assert.equal(tabs.tab(tabId).payload.preview.dirty, true);
  assert.deepEqual(writes, [
    {
      path: entry.path,
      content: firstEdit,
      expectedVersion: baselineVersion,
    },
    {
      path: entry.path,
      content: secondEdit,
      expectedVersion: firstVersion,
    },
  ]);

  files.dispose();
  tabs.dispose();
});

test("the Plugins launcher opens the curated DSH topic", () => {
  const calls = [];
  const result = openDshPlugins(
    {
      open(url, title) {
        calls.push({ url, title });
        return "tab-plugins";
      },
    },
    "Plugins",
  );

  assert.equal(
    DSH_PLUGINS_URL,
    "https://github.com/topics/dsh-plugin",
  );
  assert.equal(result, "tab-plugins");
  assert.deepEqual(calls, [
    {
      url: DSH_PLUGINS_URL,
      title: "Plugins",
    },
  ]);
});

test("Web tab favicons accept safe site and CDN URLs", () => {
  assert.equal(
    normalizeWebFaviconUrl(
      "https://github.com/favicon.ico",
      "https://github.com/openai/codex",
    ),
    "https://github.com/favicon.ico",
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "https://cdn.example.com/favicon.ico",
      "https://example.com/",
    ),
    "https://cdn.example.com/favicon.ico",
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "data:image/png;base64,AAAA",
      "https://example.com/",
    ),
    undefined,
  );
  assert.equal(
    normalizeWebFaviconUrl(
      "https://user:secret@example.com/favicon.ico",
      "https://example.com/",
    ),
    undefined,
  );
});

test("webview attachment overwrites untrusted guest preferences", () => {
  const preferences = {
    contextIsolation: false,
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    preload: "/tmp/untrusted.cjs",
    sandbox: false,
    webSecurity: false,
    webviewTag: true,
  };
  const params = {
    src: "https://example.com/docs",
    allowpopups: "",
    partition: "persist:attacker",
    preload: "file:///tmp/untrusted.cjs",
    webpreferences: "nodeIntegration=yes",
  };

  assert.equal(secureTabWebview(preferences, params), true);
  assert.equal(params.src, "https://example.com/docs");
  assert.equal(params.partition, TABS_WEB_PARTITION);
  assert.equal(Object.hasOwn(params, "allowpopups"), false);
  assert.equal(Object.hasOwn(params, "preload"), false);
  assert.equal(Object.hasOwn(params, "webpreferences"), false);
  assert.equal(Object.hasOwn(preferences, "preload"), false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.nodeIntegrationInSubFrames, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.webviewTag, false);
  assert.equal(preferences.partition, TABS_WEB_PARTITION);

  assert.equal(
    secureTabWebview(
      {},
      { src: "file:///tmp/report.html" },
    ),
    false,
  );
});

test("attached Web guests keep navigation isolated and deny popups", () => {
  const listeners = new Map();
  const opened = [];
  let openWindow;
  const guest = {
    on(name, listener) {
      listeners.set(name, listener);
    },
    setWindowOpenHandler(handler) {
      openWindow = handler;
    },
  };
  protectTabWebviewGuest(guest, {
    openExternal(url) {
      opened.push(url);
      return Promise.resolve();
    },
  });

  let prevented = false;
  listeners.get("will-navigate")({
    isMainFrame: true,
    url: "https://example.com/next",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);

  listeners.get("will-redirect")({
    isMainFrame: true,
    url: "mailto:hello@example.com",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["mailto:hello@example.com"]);
  assert.deepEqual(
    openWindow({ url: "https://example.com/popup" }),
    { action: "deny" },
  );
  assert.deepEqual(opened, [
    "mailto:hello@example.com",
    "https://example.com/popup",
  ]);
  assert.deepEqual(
    openWindow({ url: "javascript:alert(1)" }),
    { action: "deny" },
  );
  assert.equal(opened.length, 2);
});

test("Tabs is content-agnostic and preserves hidden tab state", () => {
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const web = new WebTabsController(tabs, {
    available: true,
    openExternal: (url) => hostEvents.push(`external:${url}`),
  });
  let notifications = 0;
  const unsubscribe = tabs.subscribe(() => {
    notifications += 1;
  });

  const first = web.open("https://example.com/docs", "Docs");
  const terminal = tabs.open({
    kind: "terminal",
    key: "shell-1",
    title: "Terminal",
    payload: { cwd: "/workspace" },
  });
  assert.equal(first, "tab-1");
  assert.equal(terminal, "tab-2");
  assert.equal(tabs.getSnapshot().activeId, terminal);
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.kind),
    ["web", "terminal"],
  );

  assert.equal(
    web.open("https://example.com/docs", "Duplicate"),
    first,
  );
  assert.equal(tabs.getSnapshot().activeId, first);
  assert.equal(tabs.getSnapshot().tabs.length, 2);

  tabs.hide();
  assert.equal(tabs.getSnapshot().visible, false);
  assert.equal(tabs.getSnapshot().tabs.length, 2);
  tabs.show();
  assert.equal(tabs.getSnapshot().visible, true);
  tabs.hide();
  tabs.activate(terminal);
  assert.equal(tabs.getSnapshot().visible, true);

  tabs.close(terminal);
  assert.equal(tabs.getSnapshot().activeId, first);
  tabs.close(first);
  assert.deepEqual(tabs.getSnapshot(), {
    tabs: [],
    activeId: undefined,
    visible: false,
  });
  assert.ok(notifications >= 7);
  assert.equal(hostEvents.at(-1), "hide");

  unsubscribe();
  web.dispose();
  tabs.dispose();
});

test("Session Header uses compact Lucide actions for export and Tabs", () => {
  const sharedActionRule = SESSION_HEADER_ACTION_STYLES.match(
    /\[data-minke-session-log-action\],[\s\S]*?\{([\s\S]*?)\n\}/u,
  )?.[1];
  assert.ok(sharedActionRule);
  assert.match(sharedActionRule, /border:\s*none;/u);

  const exportMarkup = renderToStaticMarkup(
    createElement(SessionLogHeaderAction, {
      sessionId: "session-1",
      exportSession: async () => {},
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(exportMarkup, /data-minke-session-log-action=""/u);
  assert.match(exportMarkup, /aria-label="Export Session log"/u);
  assert.match(exportMarkup, /title="Export Session log"/u);
  assert.match(exportMarkup, /aria-busy="false"/u);
  assert.doesNotMatch(exportMarkup, />Session log</u);

  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  tabs.open({
    kind: "web",
    key: "https://example.com/",
    title: "Example",
    payload: {},
  });
  tabs.hide();
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtime: tabs,
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(markup, /data-minke-tabs-header-action=""/u);
  assert.match(markup, /aria-label="Open Tabs sidebar"/u);
  assert.match(markup, /title="Open Tabs sidebar"/u);
  assert.match(markup, /aria-controls="minke-tabs-panel"/u);
  assert.match(markup, /aria-expanded="false"/u);

  tabs.show();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.equal(hostEvents.at(-1), "show");
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, false);
  assert.equal(hostEvents.at(-1), "hide");
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.deepEqual(Object.keys(tabsEn), Object.keys(tabsZh));
  assert.equal(tabsZh["header.sessionLog"], "导出 Session 日志");

  const decodeIcon = (name) => {
    const dataUrl = SESSION_HEADER_ACTION_STYLES.match(
      new RegExp(
        `--minke-${name}-icon: url\\("(data:image/svg\\+xml;base64,[^"]+)"\\)`,
        "u",
      ),
    )?.[1];
    assert.ok(dataUrl);
    return Buffer.from(
      dataUrl.slice(dataUrl.indexOf(",") + 1),
      "base64",
    ).toString("utf8");
  };
  assert.match(decodeIcon("file-down"), /class="lucide lucide-file-down"/u);
  assert.match(
    decodeIcon("panel-right"),
    /class="lucide lucide-panel-right"/u,
  );
});

test("Tabs toggle stays operable with no open tabs", () => {
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtime: tabs,
      t: (key) => tabsEn[key],
    }),
  );

  assert.doesNotMatch(markup, /\sdisabled(?:=""|(?=\s|>))/u);
  assert.match(markup, /aria-pressed="false"/u);
  tabs.toggle();
  assert.equal(tabs.getSnapshot().visible, true);
  assert.deepEqual(hostEvents, ["show"]);

  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    panelSource,
    /panelRendered\s*=\s*hasTabs\s*\|\|\s*snapshot\.visible/u,
  );
  assert.doesNotMatch(panelSource, /if\s*\(!hasTabs\)\s*return null/u);

  const newSessionMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtime: tabs,
      useSessions: (selector) =>
        selector({ current: undefined, byId: {} }),
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(
    newSessionMarkup,
    /data-minke-new-session-tabs-action=""/u,
  );
  assert.match(
    newSessionMarkup,
    /data-minke-tabs-header-action=""/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-new-session-tabs-action\][\s\S]*?position:\s*absolute;/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /right:\s*calc\(var\(--minke-tabs-panel-width,\s*360px\)\s*\+\s*16px\);/u,
  );
  assert.doesNotMatch(
    SESSION_HEADER_ACTION_STYLES,
    /grid-template-columns:\s*inherit;/u,
  );

  const resizeSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/resize.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    resizeSource,
    /#overlay\?\.style\.setProperty\(\s*"--minke-tabs-panel-width"/u,
  );

  const activeSessionMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtime: tabs,
      useSessions: (selector) =>
        selector({
          current: "session-1",
          byId: { "session-1": { blank: false } },
        }),
      t: (key) => tabsEn[key],
    }),
  );
  assert.equal(activeSessionMarkup, "");
  tabs.dispose();
});

test("Tabs renderer registry notifies the shell about runtime adapters", () => {
  const registry = new TabRendererRegistry();
  const revisions = [];
  const unsubscribe = registry.subscribe(() => {
    revisions.push(registry.getSnapshot());
  });
  const unregister = registry.register({
    kind: "terminal",
    renderView: () => null,
  });

  assert.equal(registry.get("terminal")?.kind, "terminal");
  unregister();
  assert.equal(registry.get("terminal"), undefined);
  assert.deepEqual(revisions, [1, 2]);

  unsubscribe();
});

test("Tabs can be reordered by pointer target or keyboard delta", () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const first = tabs.open({
    kind: "terminal",
    key: "one",
    title: "One",
    payload: {},
  });
  const second = tabs.open({
    kind: "terminal",
    key: "two",
    title: "Two",
    payload: {},
  });
  const third = tabs.open({
    kind: "terminal",
    key: "three",
    title: "Three",
    payload: {},
  });
  assert.ok(first && second && third);

  tabs.place(third, first, "before");
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.title),
    ["Three", "One", "Two"],
  );
  tabs.move(first, 1);
  assert.deepEqual(
    tabs.getSnapshot().tabs.map((tab) => tab.title),
    ["Three", "Two", "One"],
  );
  assert.equal(tabs.getSnapshot().activeId, third);
});

test("Tabs chrome puts tabs above the URL row without a visible scrollbar", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const addressSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/WebAddressBar.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webViewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/WebTabView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webRendererSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/renderer.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const webStylesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/styles.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const webIconsSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/web/icons.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    panelSource.indexOf('className="minke-tabs-tabbar"') <
      panelSource.indexOf('className="minke-tabs-toolbar"'),
  );
  assert.match(addressSource, /className="minke-tabs-location"/u);
  assert.match(addressSource, /type="text"/u);
  assert.match(addressSource, /inputMode="search"/u);
  assert.match(panelSource, /\sdraggable\s/u);
  assert.match(panelSource, /role="separator"/u);
  assert.match(panelSource, /label=\{t\("tab\.new"\)\}/u);
  assert.doesNotMatch(
    panelSource,
    /label=\{t\("panel\.hide"\)\}/u,
  );
  assert.match(webViewSource, /className="minke-tabs-blank"/u);
  assert.match(webViewSource, /<ExternalIcon \/>/u);
  assert.match(
    webIconsSource,
    /SquareArrowOutUpRight/u,
  );
  assert.doesNotMatch(webIconsSource, /external-link/u);
  assert.match(
    webViewSource,
    /tab\.payload\.url === undefined/u,
  );
  assert.match(
    webViewSource,
    /\[canCreateView,\s*controller,\s*tab\.id\]/u,
  );
  assert.doesNotMatch(
    webViewSource,
    /\[controller,\s*tab\.id,\s*tab\.payload\.url\]/u,
  );
  assert.match(
    webRendererSource,
    /className="minke-tab__favicon-preload"/u,
  );
  assert.match(
    webRendererSource,
    /data-loading=\{busy \|\| undefined\}/u,
  );
  assert.match(
    webStylesSource,
    /\.minke-tab__favicon\s*\{[\s\S]*?width:\s*12px;/u,
  );
  assert.match(
    webStylesSource,
    /@keyframes minke-tab-favicon-spin/u,
  );
  assert.match(
    webStylesSource,
    /@media \(prefers-reduced-motion:\s*reduce\)/u,
  );

  assert.match(
    TABS_STYLES,
    /--minke-tabs-chrome-height:\s*74px;/u,
  );
  assert.match(
    TABS_STYLES,
    /--minke-tabs-control-height:\s*24px;/u,
  );
  assert.match(
    TABS_STYLES,
    /--minke-tabs-secondary-control-offset-y:\s*-4px;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tab\s*\{[\s\S]*?height:\s*var\(--minke-tabs-control-height\);/u,
  );
  assert.match(
    webStylesSource,
    /\.minke-tabs-location\s*\{[\s\S]*?height:\s*var\(--minke-tabs-control-height\);/u,
  );
  assert.equal(TABS_CHROME_HEIGHT, 74);
  assert.match(
    TABS_STYLES,
    /max-width:\s*min\(760px,\s*calc\(100% - 320px\)\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-strip::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-strip\s*\{[\s\S]*?padding:\s*0 6px;/u,
  );
  assert.doesNotMatch(
    TABS_STYLES,
    /\.minke-tabs-tabbar__actions\s*\{[^}]*border-left:/u,
  );
  assert.match(TABS_STYLES, /scrollbar-width:\s*none;/u);
  assert.equal(
    clampTabsPanelWidth(1000, 1200),
    TABS_PANEL_MAX_WIDTH,
  );
  assert.equal(clampTabsPanelWidth(700, 900), 580);
  const terminalStylesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/terminal/styles.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    terminalStylesSource,
    /\.minke-terminal-host\s*\{[\s\S]*?padding:\s*4px 8px 8px 12px;/u,
  );
});

test("Tabs new button always opens the type chooser", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const registrySource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/registry.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const typesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/types.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /const \[choosingType, setChoosingType\] = useState\(false\);/u,
  );
  assert.match(
    panelSource,
    /const showCreateChooser = !hasTabs \|\| choosingType;/u,
  );
  assert.match(
    panelSource,
    /onClick=\{\(\) => setChoosingType\(\(open\) => !open\)\}/u,
  );
  assert.match(panelSource, /pressed=\{choosingType\}/u);
  assert.match(
    panelSource,
    /onCreated=\{\(\) => setChoosingType\(false\)\}/u,
  );
  assert.doesNotMatch(
    panelSource,
    /tabCreator|renderers\.creator\s*\(/u,
  );
  assert.doesNotMatch(registrySource, /\bcreator\s*\(/u);
  assert.doesNotMatch(typesSource, /\bcreateTab\??\s*\(/u);
});

test("Tabs resize stays interactive with and without a host details handle", () => {
  class FakeStyle {
    values = new Map();
    priorities = new Map();

    setProperty(name, value, priority = "") {
      this.values.set(name, value);
      this.priorities.set(name, priority);
    }

    removeProperty(name) {
      this.values.delete(name);
      this.priorities.delete(name);
    }

    getPropertyValue(name) {
      return this.values.get(name) ?? "";
    }

    getPropertyPriority(name) {
      return this.priorities.get(name) ?? "";
    }
  }

  class FakeElement {
    attributes = new Map();
    children = [];
    dataset = {};
    listeners = new Map();
    parentElement;
    style = new FakeStyle();
    tabIndex = -1;

    constructor(width = 0) {
      this.width = width;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type) {
      this.listeners.delete(type);
    }

    getBoundingClientRect() {
      return { width: this.width };
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    toggleAttribute(name, force) {
      if (force) this.attributes.set(name, "");
      else this.attributes.delete(name);
    }
  }

  class FakeObserver {
    observe() {}
    disconnect() {}
  }

  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  let panelWidth = "";
  let nativeZIndex = "";
  let restoredZIndex = "";
  let overlayPanelWidth = "";
  let overlayHandleTabIndex = -1;
  try {
    const handle = new FakeElement();
    const nativeHandle = new FakeElement();
    nativeHandle.dataset.side = "details";
    const detailsColumn = new FakeElement(520);
    const detailsSlot = new FakeElement();
    detailsSlot.parentElement = detailsColumn;
    const frame = new FakeElement(1200);
    frame.children.push(nativeHandle);
    const overlay = new FakeElement();
    overlay.parentElement = frame;
    const panel = new FakeElement();
    panel.setAttribute("data-open", "");
    panel.parentElement = overlay;
    panel.closest = (selector) =>
      selector === "[data-shell-overlay]" ? overlay : undefined;
    panel.querySelector = (selector) =>
      selector === ".minke-tabs-resize-handle"
        ? handle
        : undefined;
    panel.ownerDocument = {
      defaultView: {
        ResizeObserver: FakeObserver,
        MutationObserver: FakeObserver,
        addEventListener() {},
        removeEventListener() {},
      },
      querySelector: (selector) =>
        selector === '[data-slot="details"]'
          ? detailsSlot
          : undefined,
    };

    const resize = new TabsPanelResizeController(panel);
    nativeZIndex = nativeHandle.style.getPropertyValue("z-index");
    nativeHandle.listeners.get("pointerdown")({ clientX: 680 });
    nativeHandle.listeners.get("pointermove")({ clientX: 640 });
    panelWidth = panel.style.getPropertyValue(
      "--minke-tabs-panel-width",
    );
    resize.dispose();
    restoredZIndex =
      nativeHandle.style.getPropertyValue("z-index");

    const overlayHandle = new FakeElement();
    const emptyDetailsColumn = new FakeElement(0);
    const emptyDetailsSlot = new FakeElement();
    emptyDetailsSlot.parentElement = emptyDetailsColumn;
    const overlayFrame = new FakeElement(1200);
    const overlayLayer = new FakeElement();
    overlayLayer.parentElement = overlayFrame;
    const overlayPanel = new FakeElement();
    overlayPanel.setAttribute("data-open", "");
    overlayPanel.parentElement = overlayLayer;
    overlayPanel.closest = (selector) =>
      selector === "[data-shell-overlay]"
        ? overlayLayer
        : undefined;
    overlayPanel.querySelector = (selector) =>
      selector === ".minke-tabs-resize-handle"
        ? overlayHandle
        : undefined;
    overlayPanel.ownerDocument = {
      defaultView: {
        ResizeObserver: FakeObserver,
        MutationObserver: FakeObserver,
        addEventListener() {},
        removeEventListener() {},
      },
      querySelector: (selector) =>
        selector === '[data-slot="details"]'
          ? emptyDetailsSlot
          : undefined,
    };

    const overlayResize =
      new TabsPanelResizeController(overlayPanel);
    overlayHandleTabIndex = overlayHandle.tabIndex;
    overlayResize.beginExtendedDrag(680);
    overlayResize.moveExtendedDrag(620);
    overlayPanelWidth =
      overlayPanel.style.getPropertyValue(
        "--minke-tabs-panel-width",
      );
    overlayResize.dispose();
  } finally {
    if (previousHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = previousHTMLElement;
    }
  }

  assert.equal(nativeZIndex, "21");
  assert.equal(panelWidth, "560px");
  assert.equal(restoredZIndex, "");
  assert.equal(overlayHandleTabIndex, 0);
  assert.equal(overlayPanelWidth, "420px");
});

test("Web tab controls delegate to their attached webview", () => {
  const calls = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const web = new WebTabsController(tabs, {
    available: true,
    openExternal: (url) => calls.push(`external:${url}`),
  });
  const id = web.open("https://example.com/") ?? "";
  const view = {
    canGoBack: () => true,
    canGoForward: () => true,
    getTitle: () => "Example",
    getURL: () => "https://example.com/guide",
    goBack: () => calls.push("back"),
    goForward: () => calls.push("forward"),
    loadURL: (url) => calls.push(`load:${url}`),
    reload: () => calls.push("reload"),
    stop: () => calls.push("stop"),
  };
  web.attach(id, view);
  web.syncFromView(id, { loading: false });
  web.updateFavicon(id, [
    "data:image/png;base64,AAAA",
    "https://github.githubassets.com/favicons/favicon.svg",
  ]);
  assert.equal(
    tabs.tab(id)?.payload.faviconUrl,
    "https://github.githubassets.com/favicons/favicon.svg",
  );
  web.goBack(id);
  web.goForward(id);
  web.reloadOrStop(id);
  web.update(id, { loading: true });
  web.reloadOrStop(id);
  web.openExternal(id);
  assert.equal(web.navigate(id, "openai.com/docs"), true);
  assert.equal(tabs.tab(id)?.payload.faviconUrl, undefined);
  const blank = web.createBlank("New tab");
  assert.ok(blank);
  assert.equal(tabs.tab(blank)?.payload.url, undefined);
  assert.equal(web.navigate(blank, "example.com"), true);
  assert.equal(
    tabs.tab(blank)?.payload.url,
    "https://example.com/",
  );
  const search = web.createBlank("New tab");
  assert.ok(search);
  assert.equal(web.navigate(search, "666"), true);
  assert.equal(
    tabs.tab(search)?.payload.url,
    "https://www.google.com/search?q=666",
  );

  assert.deepEqual(calls, [
    "back",
    "forward",
    "reload",
    "stop",
    "external:https://example.com/guide",
    "load:https://openai.com/docs",
  ]);
});
