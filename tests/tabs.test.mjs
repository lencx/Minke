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
import { join, parse, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import * as react from "react";
import * as reactJsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorState } from "@codemirror/state";
import {
  evaluateHarnessClientModule,
  stagePatchedHarnessClientModule,
} from "./support/harness-client-module.mjs";
import {
  inspectJavaScriptContract,
} from "./support/javascript-contract.mjs";
import {
  normalizeWebTabUrl,
  parseTabsLayoutState,
  parseTabsLayoutStateUpdate,
  TABS_WEB_PARTITION,
} from "@minke/harness-overlay/tabs/contract.ts";
import {
  FILES_IMAGE_PREVIEW_MAX_BYTES,
  FILES_TEXT_PREVIEW_MAX_BYTES,
  parseFileManagerViewState,
  parseFileManagerViewStateUpdate,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  NewSessionTabsHeaderAction,
  SessionLogHeaderAction,
  TabsHeaderAction,
} from "@minke/harness-overlay/client/tabs/HeaderActions.ts";
import {
  SESSION_HEADER_ACTION_STYLES,
} from "@minke/harness-overlay/client/tabs/HeaderActions.styles.ts";
import {
  tabsEn,
  tabsZh,
} from "@minke/harness-overlay/client/tabs/locales.ts";
import {
  TabRendererRegistry,
} from "@minke/harness-overlay/client/tabs/registry.ts";
import {
  TABS_BOTTOM_PANEL_ID,
  TABS_PANEL_ID,
} from "@minke/harness-overlay/client/tabs/constants.ts";
import {
  clampTabsPanelHeight,
  clampTabsPanelWidth,
  tabsPanelReflowMaxWidth,
  TabsPanelResizeController,
  TABS_PANEL_DEFAULT_HEIGHT,
  TABS_PANEL_MAX_HEIGHT,
  TABS_PANEL_MIN_HEIGHT,
} from "@minke/harness-overlay/client/tabs/resize.ts";
import {
  TabsLayoutStateRuntime,
} from "@minke/harness-overlay/client/tabs/layout-state.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  desktopTabsPort,
} from "@minke/harness-overlay/client/desktop/workspace.ts";
import {
  MOBILE_TABS_MEDIA_QUERY,
  ResponsiveRightTabsHost,
} from "@minke/harness-overlay/client/tabs/responsive-right-host.ts";
import {
  DetailsTabsController,
} from "@minke/harness-overlay/client/tabs/details/controller.ts";
import {
  parseDshDetailsState,
} from "@minke/harness-overlay/client/tabs/details/contract.ts";
import {
  DetailsPresentationRuntime,
} from "@minke/harness-overlay/client/tabs/details/presentation-runtime.ts";
import {
  DetailsPresentationAdapter,
} from "@minke/harness-overlay/client/tabs/details/presentation.tsx";
import {
  createDetailsTabRenderer,
} from "@minke/harness-overlay/client/tabs/details/renderer.tsx";
import {
  installDetailsTabs,
} from "@minke/harness-overlay/client/tabs/details/integration.ts";
import {
  DETAILS_TAB_STYLES,
} from "@minke/harness-overlay/client/tabs/details/styles.ts";
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
  installConversationFileRouter,
} from "@minke/harness-overlay/client/tabs/files/conversation-router.ts";
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
  CODE_THEME_GROUPS,
  CODE_THEMES,
  codeThemePalette,
} from "@minke/harness-overlay/client/tabs/files/code-themes.ts";
import {
  CodeThemeSettingsRuntime,
} from "@minke/harness-overlay/client/tabs/files/code-theme-runtime.ts";
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
  FileManagerRuntime,
} from "@minke/desktop/main/tabs/files.ts";
import {
  FileWatchRuntime,
} from "@minke/desktop/main/tabs/file-watch.ts";
import {
  canGrantTabWebPermission,
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

test("Files view state contract keeps panel settings isolated", () => {
  assert.deepEqual(
    parseFileManagerViewState({
      right: { previewWidth: 420 },
    }),
    {
      right: { previewWidth: 420 },
    },
  );
  assert.deepEqual(
    parseFileManagerViewState({
      codeThemes: {
        light: "catppuccin-mocha",
        dark: "rose-pine-moon",
      },
      right: {
        explorerPosition: "right",
        previewWidth: 420,
        viewMode: "tree",
      },
      bottom: {
        explorerPosition: "left",
        previewWidth: 680,
        viewMode: "list",
      },
    }),
    {
      codeThemes: {
        light: "catppuccin-mocha",
        dark: "rose-pine-moon",
      },
      right: {
        explorerPosition: "right",
        previewWidth: 420,
        viewMode: "tree",
      },
      bottom: {
        explorerPosition: "left",
        previewWidth: 680,
        viewMode: "list",
      },
    },
  );
  assert.deepEqual(
    parseFileManagerViewStateUpdate({
      explorerPosition: "right",
      placement: "right",
      viewMode: "tree",
    }),
    {
      explorerPosition: "right",
      placement: "right",
      viewMode: "tree",
    },
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        placement: "left",
        viewMode: "tree",
      }),
    /placement/u,
  );
  assert.throws(
    () =>
      parseFileManagerViewState({
        right: { previewWidth: Number.POSITIVE_INFINITY },
      }),
    /preview width/u,
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        explorerPosition: "top",
        placement: "right",
      }),
    /explorer position/u,
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        placement: "right",
        viewMode: "grid",
      }),
    /view mode/u,
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        colorScheme: "dark",
        codeTheme: "unknown",
      }),
    /code theme/u,
  );
  assert.deepEqual(
    parseFileManagerViewStateUpdate({
      colorScheme: "light",
      codeTheme: "rose-pine-dawn",
    }),
    {
      colorScheme: "light",
      codeTheme: "rose-pine-dawn",
    },
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        codeTheme: "rose-pine-dawn",
      }),
    /color scheme/u,
  );
  assert.throws(
    () =>
      parseFileManagerViewStateUpdate({
        placement: "right",
      }),
    /view setting/u,
  );
});

test("Tabs layout state hydrates both panels without overwriting interaction", async () => {
  assert.deepEqual(
    parseTabsLayoutState({
      rightWidth: 720,
      bottomHeight: 372,
    }),
    {
      rightWidth: 720,
      bottomHeight: 372,
    },
  );
  assert.deepEqual(
    parseTabsLayoutStateUpdate({
      placement: "right",
      size: 640,
    }),
    {
      placement: "right",
      size: 640,
    },
  );
  assert.throws(
    () =>
      parseTabsLayoutState({
        rightWidth: Number.POSITIVE_INFINITY,
      }),
    /finite positive size/u,
  );
  assert.throws(
    () =>
      parseTabsLayoutStateUpdate({
        placement: "left",
        size: 320,
      }),
    /placement/u,
  );

  let hydrate;
  const writes = [];
  const layout = new TabsLayoutStateRuntime({
    readLayoutState: () =>
      new Promise((resolve) => {
        hydrate = resolve;
      }),
    async writeLayoutState(update) {
      writes.push(update);
    },
  });
  const rightSize = layout.size("right");
  layout.setSize("right", 940);
  hydrate({
    rightWidth: 520,
    bottomHeight: 372,
  });
  assert.equal(await rightSize, 940);
  assert.equal(await layout.size("bottom"), 372);
  layout.setSize("bottom", 432);
  await settleAsyncWork();
  assert.deepEqual(writes, [
    { placement: "right", size: 940 },
    { placement: "bottom", size: 432 },
  ]);
  layout.dispose();
});

test("the patched Harness Layout exposes a behavioral Details Interface", async () => {
  const projectRoot = realpathSync(
    new URL("..", import.meta.url),
  );
  const staged = await stagePatchedHarnessClientModule({
    projectRoot,
    fixture:
      "vendor/deepseek-harness/packages/client/ui-layout/lib/client.js",
    packageName: "dsh-client-ui-layout",
    patches: [
      "patches/deepseek-harness/tabs-details-layout.patch",
    ],
  });
  try {
    const harnessLayout = evaluateHarnessClientModule(
      staged.source,
      {
        "@deepseek-ai/dsh-client-runtime/client": {
          defineStore: (specification) => specification,
        },
        react,
        "react/jsx-runtime": reactJsxRuntime,
      },
      { window: { innerWidth: 1_200 } },
    );
    const layout = new harnessLayout.LayoutController();
    const physical = [];
    layout.attachPanels({
      closeDetails: () => physical.push("close"),
      openDetails: () => physical.push("open"),
      setDetails: (width) => physical.push(`width:${String(width)}`),
      toggleSidebar() {},
    });

    const snapshots = [];
    const unsubscribe = layout.details.subscribe(() => {
      snapshots.push(layout.details.getSnapshot());
    });
    assert.equal(layout.details.getSnapshot(), false);
    layout.details.open();
    layout.details.open();
    layout.setDetails(768);
    const releaseHost = layout.details.registerHost();
    releaseHost();
    releaseHost();
    layout.details.close();
    assert.deepEqual(snapshots, [true, false]);
    assert.deepEqual(physical, [
      "close",
      "open",
      "width:768",
      "close",
      "open",
      "close",
    ]);

    unsubscribe();
    layout.details.open();
    assert.deepEqual(snapshots, [true, false]);

    let rootRegistration;
    let providedLayout;
    harnessLayout.apply({
      effect(callback, label) {
        if (label !== "ui-layout: service + root registration") {
          return;
        }
        return callback();
      },
      reflect: {
        provide(name, service) {
          assert.equal(name, "layout");
          providedLayout = service;
          return () => {};
        },
      },
      slots: {
        register(options, component) {
          rootRegistration = { component, options };
          return () => {};
        },
      },
    });
    assert.ok(rootRegistration);
    assert.ok(providedLayout);
    const actions = {
      closeDetails() {},
      openDetails() {},
      setDetails() {},
      setNarrow() {},
      setSidebar() {},
      toggleSidebar() {},
    };
    assert.equal(
      rootRegistration.options.inject(actions).detailsController,
      providedLayout.details,
    );
    const store = rootRegistration.options.store();
    const panelState = {
      details: 0,
      narrow: false,
      narrowExpanded: false,
      sidebar: 280,
    };
    store.actions.setDetails(panelState, 2_000);
    assert.equal(panelState.details, 2_000);

    const markup = renderToStaticMarkup(
      createElement(rootRegistration.component, {
        actions,
        detailsController: providedLayout.details,
        renderSlot: () => null,
        useSessions: (select) =>
          select({
            byId: { session: { blank: false } },
            current: "session",
          }),
        useStore: (select) => select(panelState),
      }),
    );
    assert.equal(
      markup.includes(
        "grid-template-columns:280px minmax(0, 1fr) 613px",
      ),
      true,
    );
  } finally {
    await staged.dispose();
  }
});

test("Harness Details exposes a presentation slot without replacing its plugin chain", async () => {
  const projectRoot = realpathSync(
    new URL("..", import.meta.url),
  );
  const fixture =
    "vendor/deepseek-harness/packages/client/ui-conversation/lib/client.js";
  const upstreamContract = inspectJavaScriptContract(
    await readFile(join(projectRoot, fixture), "utf8"),
  );
  const staged = await stagePatchedHarnessClientModule({
    projectRoot,
    fixture,
    packageName: "dsh-client-ui-conversation",
    patches: [
      "patches/deepseek-harness/details-presentation-slot.patch",
    ],
  });
  try {
    const contract = inspectJavaScriptContract(staged.source);
    assert.equal(
      contract.callWithStringArgumentCount(
        "renderSlot",
        0,
        "conversation.details.presentation",
      ),
      1,
    );
    assert.equal(
      contract.callWithStringArgumentCount(
        "renderSlot",
        0,
        "conversation.details.tool",
      ),
      upstreamContract.callWithStringArgumentCount(
        "renderSlot",
        0,
        "conversation.details.tool",
      ),
    );
    assert.equal(
      contract.callCount("react.useSyncExternalStore"),
      upstreamContract.callCount("react.useSyncExternalStore") + 1,
    );
    assert.equal(
      contract.callCount("layout.details.open"),
      upstreamContract.callCount("layout.details.open") + 1,
    );
    assert.equal(
      contract.callCount("details.close"),
      upstreamContract.callCount("details.close") + 1,
    );
    assert.equal(
      contract.stringCount("data-dsh-details-panel"),
      upstreamContract.stringCount("data-dsh-details-panel") + 1,
    );
    assert.equal(
      contract.stringCount("data-dsh-details-tool"),
      upstreamContract.stringCount("data-dsh-details-tool") + 1,
    );
    assert.equal(
      contract.stringCount("minke:dsh-details-state"),
      0,
    );
    assert.equal(
      contract.stringCount("minke:details-portal-change"),
      0,
    );
  } finally {
    await staged.dispose();
  }
});

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
  const repositoryRequests = [];
  const entry = (name, kind) => ({
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
  const runtime = new FileManagerRuntime({
    rootPath: root,
    canonicalizePath: async (path) => path,
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
    readRepository: async (path) => {
      repositoryRequests.push(path);
      return {
        root,
        branch: "feature/compact-files",
      };
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
  assert.equal(listing.repository, undefined);
  assert.deepEqual(repositoryRequests, []);

  const repositoryListing = await runtime.list({
    includeRepository: true,
  });
  assert.deepEqual(repositoryListing.repository, {
    root,
    branch: "feature/compact-files",
  });
  assert.deepEqual(repositoryRequests, [root]);

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
  await assert.rejects(
    runtime.list({ includeRepository: "yes" }),
    /include repository must be boolean/u,
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
    canonicalizePath: async (path) => path,
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

test("Files runtime returns a bounded source diff baseline", async () => {
  const root = parse(process.cwd()).root;
  const path = join(root, "workspace", "main.ts");
  const requests = [];
  const runtime = new FileManagerRuntime({
    rootPath: root,
    canonicalizePath: async (candidate) => candidate,
    readOriginal: async (candidate) => {
      requests.push(candidate);
      return {
        kind: "text",
        original: "export const before = true;\n",
      };
    },
    openPath: async () => "",
  });

  assert.deepEqual(await runtime.diff({ path }), {
    kind: "text",
    path,
    original: "export const before = true;\n",
  });
  assert.deepEqual(requests, [path]);
  await assert.rejects(
    runtime.diff({ path: "relative.ts" }),
    /must be absolute/u,
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

test("Files watcher batches changes and releases host watchers", () => {
  const hostWatchers = new Map();
  const events = [];
  const workspacePath = resolve("/workspace");
  const sourcePath = join(workspacePath, "main.ts");
  let scheduled;
  const runtime = new FileWatchRuntime({
    send(event) {
      events.push(event);
    },
    watchPath(path, onChange, onError) {
      const watcher = {
        closed: false,
        close() {
          this.closed = true;
        },
        onChange,
        onError,
      };
      hostWatchers.set(path, watcher);
      return watcher;
    },
    schedule(callback) {
      scheduled = callback;
      return 1;
    },
    cancelSchedule() {
      scheduled = undefined;
    },
  });

  runtime.watch({
    id: "files:test",
    paths: [workspacePath, workspacePath],
  });
  assert.deepEqual([...hostWatchers.keys()], [workspacePath]);
  hostWatchers.get(workspacePath).onChange(sourcePath);
  hostWatchers.get(workspacePath).onChange(sourcePath);
  assert.deepEqual(events, []);
  scheduled();
  assert.deepEqual(events, [
    {
      id: "files:test",
      paths: [sourcePath],
    },
  ]);

  runtime.unwatch({ id: "files:test" });
  assert.equal(hostWatchers.get(workspacePath).closed, true);
  assert.throws(
    () =>
      runtime.watch({
        id: "files:relative",
        paths: ["relative"],
      }),
    /must be absolute/u,
  );
  runtime.dispose();
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

test("Files code themes expose independent light and dark palettes", async () => {
  assert.deepEqual(
    CODE_THEME_GROUPS.map(({ name, themes }) => ({
      name,
      themes: themes.map(({ id, variantName }) => ({
        id,
        variantName,
      })),
    })),
    [
      {
        name: "GitHub",
        themes: [
          {
            id: "github-light-default",
            variantName: "Light Default",
          },
          {
            id: "github-dark-default",
            variantName: "Dark Default",
          },
        ],
      },
      {
        name: "Catppuccin",
        themes: [
          { id: "catppuccin-latte", variantName: "Latte" },
          { id: "catppuccin-mocha", variantName: "Mocha" },
        ],
      },
      {
        name: "Gruvbox",
        themes: [
          {
            id: "gruvbox-light-medium",
            variantName: "Light Medium",
          },
          {
            id: "gruvbox-dark-medium",
            variantName: "Dark Medium",
          },
        ],
      },
      {
        name: "Solarized",
        themes: [
          { id: "solarized-light", variantName: "Light" },
          { id: "solarized-dark", variantName: "Dark" },
        ],
      },
      {
        name: "Rosé Pine",
        themes: [
          { id: "rose-pine-dawn", variantName: "Dawn" },
          { id: "rose-pine-moon", variantName: "Moon" },
        ],
      },
    ],
  );
  assert.deepEqual(
    CODE_THEMES.map(({ id, name }) => ({
      id,
      name,
    })),
    [
      {
        id: "github-light-default",
        name: "GitHub Light Default",
      },
      {
        id: "github-dark-default",
        name: "GitHub Dark Default",
      },
      {
        id: "catppuccin-latte",
        name: "Catppuccin Latte",
      },
      {
        id: "catppuccin-mocha",
        name: "Catppuccin Mocha",
      },
      {
        id: "gruvbox-light-medium",
        name: "Gruvbox Light Medium",
      },
      {
        id: "gruvbox-dark-medium",
        name: "Gruvbox Dark Medium",
      },
      {
        id: "solarized-light",
        name: "Solarized Light",
      },
      {
        id: "solarized-dark",
        name: "Solarized Dark",
      },
      {
        id: "rose-pine-dawn",
        name: "Rosé Pine Dawn",
      },
      {
        id: "rose-pine-moon",
        name: "Rosé Pine Moon",
      },
    ],
  );

  for (const theme of CODE_THEMES) {
    const palette = codeThemePalette(theme.id);
    assert.equal(palette.colorScheme, theme.colorScheme);
    assert.match(palette.background, /^#[a-f0-9]{6,8}$/iu);
    assert.match(palette.foreground, /^#[a-f0-9]{6,8}$/iu);
    const highlighted = await highlightFileCode(
      "catalog.ts",
      "const catalog = 'ready';",
      theme.id,
    );
    assert.ok(highlighted);
    assert.equal(highlighted.theme, theme.id);
    assert.equal(
      highlighted.background.toLowerCase(),
      palette.background,
    );
    assert.equal(
      highlighted.foreground.toLowerCase(),
      palette.foreground,
    );
  }

  const source = "const greeting = 'hello';";
  const light = await highlightFileCode(
    "theme.ts",
    source,
    "github-light-default",
  );
  const dark = await highlightFileCode(
    "theme.ts",
    source,
    "github-dark-default",
  );
  assert.ok(light);
  assert.ok(dark);
  assert.equal(light.theme, "github-light-default");
  assert.equal(light.background, "#ffffff");
  assert.equal(dark.theme, "github-dark-default");
  assert.equal(dark.background, "#0d1117");
  assert.notDeepEqual(light.lines, dark.lines);
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

test("Files preview keeps editing state compact and preserves save errors", () => {
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
  const iconsSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/icons.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const headerStart = previewSource.indexOf(
    '<header className="minke-files-preview__header">',
  );
  const headerEnd = previewSource.indexOf("</header>", headerStart);
  const headerSource = previewSource.slice(headerStart, headerEnd);
  const dirtyIndex = headerSource.indexOf(
    'className="minke-files-preview__dirty"',
  );
  const fileIconIndex = headerSource.indexOf("<FileIcon");
  assert.ok(headerStart >= 0);
  assert.ok(headerEnd > headerStart);
  assert.ok(dirtyIndex >= 0);
  assert.ok(fileIconIndex > dirtyIndex);
  assert.match(headerSource, /SourcePreviewIcon/u);
  assert.match(headerSource, /DiffPreviewIcon/u);
  assert.doesNotMatch(headerSource, /SavePreviewIcon/u);
  assert.doesNotMatch(headerSource, /SavingPreviewIcon/u);
  assert.doesNotMatch(headerSource, /SavedPreviewIcon/u);
  assert.doesNotMatch(
    headerSource,
    /minke-files-preview__save-status/u,
  );
  assert.doesNotMatch(headerSource, /data-saving=/u);
  assert.match(
    previewSource,
    /className="minke-files-preview__save-error"[\s\S]*role="alert"/u,
  );
  assert.match(
    previewSource,
    /className="minke-files-preview__size"/u,
  );
  assert.match(
    previewSource,
    /className="minke-files-preview__mode"/u,
  );
  assert.match(
    previewSource,
    /controller\.setPreviewMode\(tabId,\s*"diff"\)/u,
  );
  assert.doesNotMatch(
    previewSource,
    /minke-files-preview__meta/u,
  );
  assert.doesNotMatch(previewSource, /<figcaption>/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__file-mark/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__dirty/u,
  );
  assert.doesNotMatch(
    FILES_TAB_STYLES,
    /\.minke-files-preview__save-status/u,
  );
  assert.doesNotMatch(
    FILES_TAB_STYLES,
    /@keyframes minke-files-spin/u,
  );
  assert.doesNotMatch(localeSource, /"files\.preview\.saving"/u);
  assert.doesNotMatch(localeSource, /"files\.preview\.saved"/u);
  assert.doesNotMatch(localeSource, /"files\.preview\.save":/u);
  assert.match(localeSource, /"files\.preview\.saveError"/u);
  assert.match(
    iconsSource,
    /OpenSystemIcon[\s\S]*?icon=\{FileSymlink\}/u,
  );
  assert.doesNotMatch(iconsSource, /\bExternalLink\b/u);
});

test("Files toolbar focus and explorer density stay compact", () => {
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-mode-select:focus-within\s*\{[\s\S]*?outline:\s*none/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\s+\.minke-tabs-toolbar__button:focus-visible\s*\{[\s\S]*?outline:\s*none/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-row\s*\{[\s\S]*?min-height:\s*26px/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-tree-row\s*\{[\s\S]*?min-height:\s*24px/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /var\(--minke-files-depth,\s*0\)\s*\*\s*11px/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-tree\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?scrollbar-gutter:\s*stable;/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-tree-row__name\s*\{[\s\S]*?flex:\s*1;[\s\S]*?text-overflow:\s*ellipsis;/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-(?:row|tree-row):focus-visible[\s\S]*?outline:\s*none;/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-tree:hover::?-webkit-scrollbar-thumb[\s\S]*?background-color:/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-tree::?-webkit-scrollbar\s*\{[\s\S]*?width:\s*4px;/u,
  );
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
  const repository = {
    root: "/workspace",
    branch: "feature/compact-files",
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
        ...(request.includeRepository === true &&
        path.startsWith("/workspace")
          ? { repository }
          : {}),
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
    watch() {
      return () => {};
    },
  });

  const projectTab = files.create("/workspace", "Files");
  assert.ok(projectTab);
  await settleAsyncWork();
  assert.deepEqual(requests, [{
    path: "/workspace",
    includeRepository: true,
  }]);
  assert.equal(tabs.tab(projectTab).payload.path, "/workspace");
  assert.deepEqual(
    tabs.tab(projectTab).payload.repository,
    repository,
  );
  assert.equal(tabs.tab(projectTab).title, "workspace");
  assert.equal(tabs.tab(projectTab).payload.viewMode, "list");
  const addressSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FileAddressBar.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    addressSource,
    /minke-files-location__branch/u,
  );
  assert.match(addressSource, /tab\.payload\.repository/u);
  assert.match(addressSource, /GitBranchIcon/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-location__branch\s*\{/u,
  );

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
  assert.deepEqual(requests.at(-1), {
    includeRepository: true,
  });
  assert.equal(tabs.tab(rootTab).payload.path, "/");
  assert.equal(tabs.tab(rootTab).payload.repository, undefined);

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
  const modeSelectIndex = rendererSource.indexOf(
    'className="minke-files-mode-select"',
  );
  const backActionIndex = rendererSource.indexOf(
    'label={t("files.nav.back")}',
  );
  assert.ok(modeSelectIndex >= 0);
  assert.ok(modeSelectIndex < backActionIndex);
  assert.match(
    rendererSource,
    /<select[\s\S]*?tab\.payload\.viewMode[\s\S]*?tab\.payload\.explorerPosition[\s\S]*?controller\.setViewLayout\(/u,
  );
  assert.equal(
    (rendererSource.match(/<select/gu) ?? []).length,
    1,
  );
  for (const layout of [
    "list-left",
    "list-right",
    "tree-left",
    "tree-right",
  ]) {
    assert.match(rendererSource, new RegExp(`value="${layout}"`, "u"));
  }
  assert.doesNotMatch(
    rendererSource,
    /minke-files-position-select/u,
  );
  assert.doesNotMatch(
    rendererSource,
    /className="minke-files-mode"/u,
  );
  assert.doesNotMatch(rendererSource, /files\.nav\.refresh/u);
  assert.doesNotMatch(rendererSource, /RefreshIcon/u);
  const viewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FileManagerView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const previewPaneSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/files/FilePreviewPane.tsx",
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
  assert.match(
    viewSource,
    /data-explorer-position=\{tab\.payload\.explorerPosition\}/u,
  );
  assert.match(
    viewSource,
    /tab\.payload\.explorerPosition === "right"/u,
  );
  assert.match(
    previewPaneSource,
    /className="minke-files-preview__actions"/u,
  );
  assert.match(FILES_TAB_STYLES, /\.minke-files-row\s*\{/u);
  assert.match(FILES_TAB_STYLES, /\.minke-files-tree\s*\{/u);
  assert.match(FILES_TAB_STYLES, /\.minke-files-preview\s*\{/u);
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview-resize\s*\{[\s\S]*cursor:\s*col-resize/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-mode-select\s*\{[\s\S]*height:\s*var\(--minke-tabs-control-height\)/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-browser\[data-explorer-position="right"\]\s*\{[\s\S]*?flex-direction:\s*row-reverse/u,
  );
  assert.match(FILES_TAB_STYLES, /\.minke-files-preview__editor/u);
  assert.match(editorSource, /new EditorView/u);
  assert.match(editorSource, /basicSetup/u);
  assert.match(editorSource, /unifiedMergeView/u);
  assert.match(editorSource, /mergeControls:\s*false/u);
  assert.match(editorSource, /collapseUnchanged:/u);
  assert.doesNotMatch(
    editorSource,
    /\b(?:lineNumbers|foldGutter)\(\)|\bfoldKeymap\b/u,
  );
  assert.match(editorSource, /indentationFolding/u);
  assert.match(editorSource, /key:\s*"Mod-s"/u);
  assert.match(editorSource, /data-highlighter="shiki"/u);
  assert.match(editorSource, /data-code-theme=/u);
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
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__mode/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__actions\s*\{[^}]*gap:\s*2px/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__mode\s*\{[^}]*gap:\s*2px/u,
  );
  assert.match(
    FILES_TAB_STYLES,
    /\.minke-files-preview__editor\s*\{[\s\S]*?background:\s*var\(--minke-code-background\)/u,
  );
  assert.match(FILES_TAB_STYLES, /\.cm-deletedChunk/u);
  assert.match(FILES_TAB_STYLES, /\.cm-changedText/u);
  assert.doesNotMatch(treeSource, /role="tree(?:item)?"/u);
  assert.match(treeSource, /aria-expanded=/u);
  assert.doesNotMatch(treeSource, /files\.tree\.loading/u);
  assert.match(rendererSource, /beforeClose:/u);
  assert.match(tabsPanelSource, /\.beforeClose\?\.\(tab\)/u);
  assert.match(
    tabsPanelSource,
    /event\.key === "Delete"[\s\S]*closeTab\(tab\.id\)/u,
  );
  for (const handler of [
    "handleFilesDiff",
    "handleFilesList",
    "handleFilesOpen",
    "handleFilesPreview",
    "handleFilesViewStateRead",
    "handleFilesViewStateWrite",
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

test("Files view preferences persist across new tabs", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const stateWrites = [];
  const files = new FilesTabsController(
    tabs,
    {
      available: true,
      async readViewState() {
        return {
          right: {
            explorerPosition: "right",
            previewWidth: 412,
            viewMode: "tree",
          },
          bottom: {
            explorerPosition: "left",
            previewWidth: 688,
            viewMode: "list",
          },
        };
      },
      async writeViewState(update) {
        stateWrites.push(update);
      },
      async list(request) {
        return {
          path: request.path ?? "/",
          entries: [],
          truncated: false,
        };
      },
      async open() {},
      async preview() {
        throw new Error("not used");
      },
      async write() {
        throw new Error("not used");
      },
      watch() {
        return () => {};
      },
    },
    { placement: "right" },
  );

  await settleAsyncWork();
  const firstTab = files.create("/workspace", "Files");
  assert.ok(firstTab);
  await settleAsyncWork();
  assert.equal(
    tabs.tab(firstTab).payload.previewWidth,
    412,
  );
  assert.equal(tabs.tab(firstTab).payload.viewMode, "tree");
  assert.equal(
    tabs.tab(firstTab).payload.explorerPosition,
    "right",
  );
  const siblingTab = files.create(
    "/workspace/sibling",
    "Files",
  );
  assert.ok(siblingTab);
  await settleAsyncWork();
  assert.equal(
    tabs.tab(siblingTab).payload.previewWidth,
    412,
  );
  assert.equal(tabs.tab(siblingTab).payload.viewMode, "tree");
  assert.equal(
    tabs.tab(siblingTab).payload.explorerPosition,
    "right",
  );

  files.setViewLayout(firstTab, "list", "left");
  assert.equal(tabs.tab(firstTab).payload.viewMode, "list");
  assert.equal(tabs.tab(siblingTab).payload.viewMode, "list");
  assert.equal(
    tabs.tab(firstTab).payload.explorerPosition,
    "left",
  );
  assert.equal(
    tabs.tab(siblingTab).payload.explorerPosition,
    "left",
  );
  files.setPreviewWidth(firstTab, 468);
  assert.equal(
    tabs.tab(siblingTab).payload.previewWidth,
    468,
  );
  files.persistPreviewWidth(firstTab);
  await settleAsyncWork();
  assert.deepEqual(stateWrites, [
    {
      explorerPosition: "left",
      placement: "right",
      viewMode: "list",
    },
    {
      placement: "right",
      previewWidth: 468,
    },
  ]);

  const secondTab = files.create("/workspace/next", "Files");
  assert.ok(secondTab);
  await settleAsyncWork();
  assert.equal(
    tabs.tab(secondTab).payload.previewWidth,
    468,
  );
  assert.equal(tabs.tab(secondTab).payload.viewMode, "list");
  assert.equal(
    tabs.tab(secondTab).payload.explorerPosition,
    "left",
  );

  files.dispose();
  tabs.dispose();
});

test("Code theme preferences persist one arbitrary theme per app appearance", async () => {
  const writes = [];
  const runtime = new CodeThemeSettingsRuntime(
    {
      available: true,
      async readViewState() {
        return {
          codeThemes: {
            light: "catppuccin-mocha",
            dark: "rose-pine-moon",
          },
        };
      },
      async writeViewState(update) {
        writes.push(update);
      },
    },
    "light",
  );
  await runtime.initialize();
  assert.deepEqual(
    {
      theme: runtime.getSnapshot().theme,
      themes: runtime.getSnapshot().themes,
      colorScheme: runtime.getSnapshot().colorScheme,
      editable: runtime.getSnapshot().editable,
    },
    {
      theme: "catppuccin-mocha",
      themes: {
        light: "catppuccin-mocha",
        dark: "rose-pine-moon",
      },
      colorScheme: "light",
      editable: true,
    },
  );

  let notifications = 0;
  const unsubscribe = runtime.subscribe(() => {
    notifications += 1;
  });
  runtime.update("dark", "solarized-light");
  await runtime.flush();
  assert.deepEqual(writes, [
    {
      colorScheme: "dark",
      codeTheme: "solarized-light",
    },
  ]);
  assert.equal(runtime.getSnapshot().theme, "catppuccin-mocha");
  assert.deepEqual(runtime.getSnapshot().themes, {
    light: "catppuccin-mocha",
    dark: "solarized-light",
  });

  runtime.setColorScheme("dark");
  assert.equal(runtime.getSnapshot().colorScheme, "dark");
  assert.equal(runtime.getSnapshot().theme, "solarized-light");
  assert.equal(notifications, 2);
  unsubscribe();
  runtime.dispose();
});

test("Files keeps the settled directory visible while navigating", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const firstEntry = {
    name: "src",
    path: "/workspace/src",
    kind: "directory",
  };
  let resolveNavigation;
  const files = new FilesTabsController(tabs, {
    available: true,
    async list(request) {
      if (request.path === "/workspace") {
        return {
          path: "/workspace",
          entries: [firstEntry],
          truncated: false,
        };
      }
      return await new Promise((resolve) => {
        resolveNavigation = resolve;
      });
    },
    async open() {},
    async preview() {
      throw new Error("not used");
    },
    async write() {
      throw new Error("not used");
    },
    watch() {
      return () => {};
    },
  });

  const tabId = files.create("/workspace", "Files");
  assert.ok(tabId);
  await settleAsyncWork();
  assert.equal(tabs.tab(tabId).payload.loading, false);
  assert.deepEqual(tabs.tab(tabId).payload.entries, [firstEntry]);

  files.navigate(tabId, "/workspace/src");
  assert.equal(tabs.tab(tabId).payload.loading, false);
  assert.deepEqual(tabs.tab(tabId).payload.entries, [firstEntry]);

  resolveNavigation({
    path: "/workspace/src",
    parent: "/workspace",
    entries: [],
    truncated: false,
  });
  await settleAsyncWork();
  assert.equal(tabs.tab(tabId).payload.path, "/workspace/src");
  assert.deepEqual(tabs.tab(tabId).payload.entries, []);

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
    watch() {
      return () => {};
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

test("Files keeps editor state after its own save event", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const entry = {
    name: "main.ts",
    path: "/workspace/main.ts",
    kind: "file",
  };
  const initial = "export const value = 1;\n";
  const edited = "export const value = 2;\n";
  const initialVersion = fileVersion(Buffer.from(initial));
  const editedVersion = fileVersion(Buffer.from(edited));
  const previewRequests = [];
  let content = initial;
  let version = initialVersion;
  let watchListener;
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
    async preview(request) {
      previewRequests.push(request);
      return {
        kind: "text",
        path: request.path,
        name: entry.name,
        size: Buffer.byteLength(content),
        content,
        truncated: false,
        version,
      };
    },
    async write(request) {
      content = request.content;
      version = editedVersion;
      return {
        path: request.path,
        size: Buffer.byteLength(request.content),
        version: editedVersion,
      };
    },
    watch(_paths, listener) {
      watchListener = listener;
      return () => {
        watchListener = undefined;
      };
    },
  });

  const tabId = files.create("/workspace", "Files");
  assert.ok(tabId);
  await settleAsyncWork();
  files.preview(tabId, entry);
  await settleAsyncWork();
  files.updatePreviewDraft(tabId, entry.path, edited);
  files.savePreview(tabId);
  await settleAsyncWork();
  assert.equal(tabs.tab(tabId).payload.preview.dirty, false);
  assert.equal(
    tabs.tab(tabId).payload.preview.result.version,
    editedVersion,
  );
  const savedPreview = tabs.tab(tabId).payload.preview;

  watchListener({
    id: "files:test",
    paths: [entry.path],
  });
  assert.equal(
    tabs.tab(tabId).payload.preview.loading,
    false,
  );
  await settleAsyncWork();
  assert.equal(previewRequests.length, 2);
  assert.equal(tabs.tab(tabId).payload.preview, savedPreview);
  assert.equal(
    tabs.tab(tabId).payload.preview.result.content,
    edited,
  );

  files.dispose();
  tabs.dispose();
});

test("Files skips disk subscriptions when the port cannot watch", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  let watchCalls = 0;
  const files = new FilesTabsController(tabs, {
    available: true,
    nativeOpenAvailable: false,
    watchAvailable: false,
    async list(request) {
      return {
        path: request.path ?? "/",
        entries: [],
        truncated: false,
      };
    },
    async open() {},
    async preview() {
      throw new Error("not used");
    },
    async write() {
      throw new Error("not used");
    },
    watch() {
      watchCalls += 1;
      throw new Error("watch must remain capability-gated");
    },
  });

  assert.ok(files.create("/workspace", "Files"));
  await settleAsyncWork();
  assert.equal(watchCalls, 0);
  files.dispose();
  tabs.dispose();
});

test("Files refreshes the directory and clean preview after disk changes", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const entry = {
    name: "main.ts",
    path: "/workspace/main.ts",
    kind: "file",
  };
  const addedEntry = {
    name: "added.ts",
    path: "/workspace/added.ts",
    kind: "file",
  };
  let directoryEntries = [entry];
  let content = "export const value = 1;\n";
  let watchListener;
  const listRequests = [];
  const previewRequests = [];
  const files = new FilesTabsController(tabs, {
    available: true,
    async list(request) {
      listRequests.push(request);
      return {
        path: request.path ?? "/",
        entries: directoryEntries,
        truncated: false,
      };
    },
    async open() {},
    async preview(request) {
      previewRequests.push(request);
      return {
        kind: "text",
        path: request.path,
        name: entry.name,
        size: Buffer.byteLength(content),
        content,
        truncated: false,
        version: fileVersion(Buffer.from(content)),
      };
    },
    async write() {
      throw new Error("not used");
    },
    watch(paths, listener) {
      assert.deepEqual(paths, ["/workspace"]);
      watchListener = listener;
      return () => {
        watchListener = undefined;
      };
    },
  });

  const tabId = files.create("/workspace", "Files");
  assert.ok(tabId);
  await settleAsyncWork();
  files.preview(tabId, entry);
  await settleAsyncWork();
  assert.equal(typeof watchListener, "function");

  directoryEntries = [entry, addedEntry];
  content = "export const value = 2;\n";
  watchListener({ paths: [entry.path] });
  await settleAsyncWork();

  assert.deepEqual(
    tabs.tab(tabId).payload.entries.map(({ name }) => name),
    ["main.ts", "added.ts"],
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.result.content,
    content,
  );
  assert.equal(listRequests.length, 2);
  assert.equal(previewRequests.length, 2);

  files.updatePreviewDraft(
    tabId,
    entry.path,
    "export const local = true;\n",
  );
  content = "export const value = 3;\n";
  watchListener({ paths: [entry.path] });
  await settleAsyncWork();
  assert.equal(
    tabs.tab(tabId).payload.preview.result.content,
    "export const value = 2;\n",
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.draft,
    "export const local = true;\n",
  );
  assert.equal(
    tabs.tab(tabId).payload.preview.diskChanged,
    true,
  );
  assert.equal(listRequests.length, 3);
  assert.equal(previewRequests.length, 2);

  tabs.close(tabId);
  assert.equal(watchListener, undefined);
  files.dispose();
  tabs.dispose();
});

test("conversation files open in the Files source reader with on-demand diff", async () => {
  let shown = 0;
  const tabs = new TabsRuntime({
    showPanel() {
      shown += 1;
    },
    hidePanel() {},
  });
  const listRequests = [];
  const previewRequests = [];
  const diffRequests = [];
  const content = "export const current = true;\n";
  const files = new FilesTabsController(tabs, {
    available: true,
    async list(request) {
      listRequests.push(request);
      return {
        path: request.path ?? "/",
        entries: [
          {
            name: "main.ts",
            path: "/workspace/src/main.ts",
            kind: "file",
          },
        ],
        truncated: false,
      };
    },
    async open() {},
    async preview(request) {
      previewRequests.push(request);
      return {
        kind: "text",
        path: request.path,
        name: "main.ts",
        size: Buffer.byteLength(content),
        content,
        truncated: false,
        version: fileVersion(Buffer.from(content)),
      };
    },
    async diff(request) {
      diffRequests.push(request);
      return {
        kind: "text",
        path: request.path,
        original: "export const current = false;\n",
      };
    },
    async write() {
      throw new Error("not used");
    },
    watch() {
      return () => {};
    },
  });

  const tabId = files.openFile(
    "/workspace/src/main.ts",
    "Files",
  );
  assert.ok(tabId);
  await settleAsyncWork();
  assert.deepEqual(listRequests, [{
    path: "/workspace/src",
    includeRepository: true,
  }]);
  assert.deepEqual(previewRequests, [
    { path: "/workspace/src/main.ts" },
  ]);
  assert.equal(tabs.getSnapshot().activeId, tabId);
  assert.equal(tabs.tab(tabId).payload.preview.mode, "source");
  assert.equal(shown > 0, true);

  files.setPreviewMode(tabId, "diff");
  await settleAsyncWork();
  assert.deepEqual(diffRequests, [
    { path: "/workspace/src/main.ts" },
  ]);
  assert.equal(tabs.tab(tabId).payload.preview.mode, "diff");
  assert.equal(
    tabs.tab(tabId).payload.preview.comparison.result.original,
    "export const current = false;\n",
  );

  files.dispose();
  tabs.dispose();
});

test("conversation file routing falls back and restores safely", async () => {
  const systemOpened = [];
  const routed = [];
  const workspaces = {
    async openPath(path) {
      systemOpened.push(path);
    },
  };
  const originalOpenPath = workspaces.openPath;
  const dispose = installConversationFileRouter(
    workspaces,
    {
      openFile(path, title) {
        routed.push([path, title]);
        return path.startsWith("/") ? "files-1" : undefined;
      },
    },
    () => "Files",
  );

  await workspaces.openPath("/workspace/src/main.ts");
  await workspaces.openPath("relative.ts");
  assert.deepEqual(routed, [
    ["/workspace/src/main.ts", "Files"],
    ["relative.ts", "Files"],
  ]);
  assert.deepEqual(systemOpened, ["relative.ts"]);

  dispose();
  assert.equal(workspaces.openPath, originalOpenPath);
  await workspaces.openPath("/workspace/README.md");
  assert.deepEqual(systemOpened, [
    "relative.ts",
    "/workspace/README.md",
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

test("tab web guests allow only sanitized clipboard writes from secure pages", () => {
  assert.equal(
    canGrantTabWebPermission(
      "clipboard-sanitized-write",
      "https://github.com/minke/example-plugin",
    ),
    true,
  );
  assert.equal(
    canGrantTabWebPermission(
      "clipboard-read",
      "https://github.com/minke/example-plugin",
    ),
    false,
  );
  assert.equal(
    canGrantTabWebPermission(
      "geolocation",
      "https://github.com/minke/example-plugin",
    ),
    false,
  );
  assert.equal(
    canGrantTabWebPermission(
      "clipboard-sanitized-write",
      "http://example.com/",
    ),
    false,
  );
  assert.equal(
    canGrantTabWebPermission(
      "clipboard-sanitized-write",
      "https://user:secret@example.com/",
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

test("Tabs disposal releases an open host panel", () => {
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });

  tabs.show();
  assert.equal(tabs.getSnapshot().visible, true);
  tabs.dispose();

  assert.equal(tabs.getSnapshot().visible, false);
  assert.deepEqual(hostEvents, ["show", "hide"]);
});

test("mobile right Tabs use a drawer without opening the desktop Details track", () => {
  const layoutEvents = [];
  const listeners = new Set();
  const media = {
    matches: true,
    addEventListener(type, listener) {
      assert.equal(type, "change");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "change");
      listeners.delete(listener);
    },
  };
  const host = new ResponsiveRightTabsHost(
    {
      openDetails: () => layoutEvents.push("open"),
      closeDetails: () => layoutEvents.push("close"),
    },
    {
      view: {
        matchMedia(query) {
          assert.equal(query, MOBILE_TABS_MEDIA_QUERY);
          return media;
        },
      },
    },
  );
  const presentations = [];
  const unsubscribe = host.subscribe(() => {
    presentations.push(host.getSnapshot());
  });

  assert.equal(host.getSnapshot(), "drawer");
  host.showPanel();
  assert.deepEqual(
    layoutEvents,
    ["close"],
    "mobile open must collapse the desktop grid track",
  );

  media.matches = false;
  for (const listener of listeners) {
    listener({ matches: false });
  }
  assert.equal(host.getSnapshot(), "docked");
  assert.deepEqual(layoutEvents, ["close", "open"]);
  assert.deepEqual(presentations, ["docked"]);

  host.hidePanel();
  assert.deepEqual(layoutEvents, ["close", "open", "close"]);
  unsubscribe();
  host.dispose();
  assert.equal(listeners.size, 0);
});

test("Electron right Tabs remain docked at a compact width", () => {
  const layoutEvents = [];
  const media = new EventTarget();
  media.matches = true;
  const host = new ResponsiveRightTabsHost(
    {
      openDetails: () => layoutEvents.push("open"),
      closeDetails: () => layoutEvents.push("close"),
    },
    {
      drawerEnabled: false,
      view: {
        matchMedia: () => media,
      },
    },
  );

  assert.equal(host.getSnapshot(), "docked");
  host.showPanel();
  assert.deepEqual(layoutEvents, ["open"]);
  host.hidePanel();
  assert.deepEqual(layoutEvents, ["open", "close"]);
  host.dispose();
});

test("desktop presentation is selected by preload capability, not user-agent", () => {
  const browserWithElectronUa = desktopTabsPort({
    navigator: { userAgent: "Electron/99" },
  });
  const preloadWithBrowserUa = desktopTabsPort({
    navigator: { userAgent: "Mobile Safari" },
    minkeDesktop: {
      tabs: {
        openExternal() {},
      },
    },
  });

  assert.equal(browserWithElectronUa.embeddedWebAvailable, false);
  assert.equal(preloadWithBrowserUa.embeddedWebAvailable, true);
});

test("mobile drawer presentation stays isolated from bottom Tabs", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const installSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/install.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /const drawer\s*=\s*placement === "right"\s*&&\s*responsivePresentation === "drawer"/u,
  );
  assert.match(panelSource, /className="minke-tabs-mobile-scrim"/u);
  assert.match(panelSource, /role=\{drawer \? "dialog"/u);
  assert.match(panelSource, /event\.key === "Escape"/u);
  assert.match(
    installSource,
    /presentation:\s*rightHost,[\s\S]*setRightTrackWidth/u,
  );
  assert.match(
    installSource,
    /drawerEnabled:\s*!tabsPort\.embeddedWebAvailable/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\[data-presentation="drawer"\]\s*\{[\s\S]*env\(safe-area-inset-top\)[\s\S]*box-shadow:/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-mobile-scrim\[data-open\]\s*\{[\s\S]*pointer-events:\s*auto/u,
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-tab__close\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/u,
  );
  assert.doesNotMatch(
    TABS_STYLES,
    /data-placement="bottom"\]\[data-presentation="drawer"/u,
    "bottom Tabs must keep reserving space for the conversation input",
  );
});

test("mobile drawer Tabs expose a panel close action", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /drawer\s*&&\s*\([\s\S]*className="minke-tabs-panel__close"[\s\S]*runtime\.hide\(\)/u,
    "the mobile dialog needs its own visible close action",
  );
});

test("mobile drawer Tabs reflow chrome instead of overlapping it", () => {
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-tabs-chrome\s*\{[\s\S]*height:\s*auto;/u,
    "mobile chrome must size from its tab and toolbar rows",
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-tabs-tabbar\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*auto;/u,
    "mobile tabs must participate in layout instead of overlaying the toolbar",
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-tabs-toolbar\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*auto;/u,
    "mobile toolbars must follow the tab row in normal flow",
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-tabs-progress\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*auto;/u,
    "mobile progress must follow the variable-height chrome",
  );
});

test("mobile drawer Tabs own their top actions", () => {
  assert.match(
    TABS_STYLES,
    /:has\([\s\S]*data-presentation="drawer"[\s\S]*data-open[\s\S]*\)[\s\S]*\[data-minke-tabs-layout-actions\]\s*\{[\s\S]*visibility:\s*hidden;/u,
    "desktop placement controls must not sit above the mobile dialog",
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"\][\s\S]*\.minke-tabs-tabbar__actions[\s\S]*\.minke-tabs-toolbar__button[\s\S]*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/u,
    "mobile new-tab actions need a full touch target",
  );
  assert.match(
    FILES_TAB_STYLES,
    /data-presentation="drawer"[\s\S]*\.minke-files-mode-select\s*\{[\s\S]*width:\s*44px;/u,
    "mobile Files layout selection needs a full touch target",
  );
});

test("mobile right Tabs use a right-edge drawer presentation", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    panelSource,
    /responsivePresentation === "drawer"/u,
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"\]\s*\{[\s\S]*right:\s*0;[\s\S]*left:\s*auto;[\s\S]*transform:\s*translateX\(100%\);/u,
    "the mobile Details surface must enter from the right edge",
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"\]\[data-open\]\s*\{[\s\S]*transform:\s*translateX\(0\);/u,
  );
});

test("Details state contract rejects incomplete plugin bridge payloads", () => {
  assert.equal(parseDshDetailsState(null), undefined);
  assert.equal(
    parseDshDetailsState({
      open: true,
      sessionId: "session-1",
      label: "Details",
      title: "Read",
    }),
    undefined,
  );
  assert.deepEqual(
    parseDshDetailsState({
      open: true,
      sessionId: " session-1 ",
      callId: " call-1 ",
      label: " Details ",
      title: " Read ",
      ownerId: "ignored-upstream-owner",
    }),
    {
      open: true,
      sessionId: "session-1",
      callId: "call-1",
      label: "Details",
      title: "Read",
    },
  );
});

test("Details follows one managed tab across create, update, and close", () => {
  const hostEvents = [];
  const tasks = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const controller = new DetailsTabsController(tabs, {
    releaseHost: () => hostEvents.push("release"),
    schedule: (task) => tasks.push(task),
  });
  const flush = () => {
    const task = tasks.shift();
    assert.ok(task);
    task();
  };

  controller.accept({
    open: true,
    sessionId: "session-1",
    callId: "call-1",
    label: "Details",
    title: "Read",
  });
  flush();
  const first = tabs.getSnapshot();
  assert.equal(first.tabs.length, 1);
  assert.equal(first.visible, true);
  assert.equal(first.tabs[0].kind, "details");
  assert.equal(first.tabs[0].key, "dsh-details");
  assert.equal(first.tabs[0].title, "Details · Read");
  assert.deepEqual(first.tabs[0].payload, {
    sessionId: "session-1",
    callId: "call-1",
    label: "Details",
    title: "Read",
  });

  controller.accept({
    open: false,
    sessionId: "session-1",
    callId: "call-1",
    label: "Details",
    title: "Read",
  });
  controller.accept({
    open: true,
    sessionId: "session-2",
    callId: "call-2",
    label: "Details",
    title: "Terminal",
  });
  assert.equal(tasks.length, 1, "React cleanup/setup must coalesce");
  flush();
  const updated = tabs.getSnapshot();
  assert.equal(updated.tabs.length, 1);
  assert.equal(updated.tabs[0].id, first.tabs[0].id);
  assert.equal(updated.tabs[0].title, "Details · Terminal");
  assert.equal(updated.tabs[0].payload.sessionId, "session-2");
  assert.equal(updated.tabs[0].payload.callId, "call-2");

  controller.accept({
    open: false,
    sessionId: "session-2",
    callId: "call-2",
    label: "Details",
    title: "Terminal",
  });
  flush();
  assert.equal(tabs.getSnapshot().tabs.length, 0);
  assert.equal(tabs.getSnapshot().visible, false);
  assert.deepEqual(hostEvents, ["show", "show", "hide"]);
  controller.dispose();
  tabs.dispose();
});

test("Details invokes browser scheduler callbacks without a receiver", () => {
  const tasks = [];
  const receivers = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new DetailsTabsController(tabs, {
    releaseHost() {},
    schedule: function schedule(task) {
      receivers.push(this);
      tasks.push(task);
    },
  });

  controller.accept({
    open: true,
    sessionId: "session-1",
    callId: "call-1",
    label: "Details",
    title: "Read",
  });

  assert.deepEqual(
    receivers,
    [undefined],
    "browser host schedulers reject an arbitrary class receiver",
  );
  tasks.shift()();
  controller.dispose();
  tabs.dispose();
});

test("Details presentation target is an in-memory observable", () => {
  const presentation = new DetailsPresentationRuntime();
  const notifications = [];
  const unsubscribe = presentation.subscribe(() => {
    notifications.push(presentation.getSnapshot());
  });
  const target = {};

  presentation.setTarget(target);
  presentation.setTarget(target);
  presentation.setTarget(null);

  assert.deepEqual(notifications, [target, null]);
  assert.equal(presentation.getSnapshot(), null);
  unsubscribe();
});

test("Details integration registers one semantic host and presentation Adapter", () => {
  const events = [];
  const registered = [];
  const slotComponents = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const renderers = {
    register(renderer) {
      registered.push(renderer);
      events.push("renderer:add");
      return () => events.push("renderer:remove");
    },
  };
  const slots = {
    inject(name, callback) {
      events.push(`inject:${name}`);
      const unregister = callback();
      return () => {
        unregister();
        events.push(`inject:remove:${name}`);
      };
    },
    register(options, component) {
      events.push(`slot:add:${options.name}`);
      slotComponents.push(component);
      return () => events.push(`slot:remove:${options.name}`);
    },
  };
  const layout = {
    details: {
      open() {
        events.push("details:open");
      },
      close() {
        events.push("details:close");
      },
      getSnapshot() {
        return false;
      },
      subscribe() {
        return () => {};
      },
      registerHost() {
        events.push("host:add");
        return () => events.push("host:remove");
      },
    },
  };

  const dispose = installDetailsTabs({
    runtime: tabs,
    renderers,
    slots,
    layout,
  });
  assert.equal(registered.length, 1);
  assert.equal(slotComponents.length, 1);
  const panel = createElement("div", null, "tool output");
  const adapter = slotComponents[0]({
    panel,
    state: {
      callId: "call-1",
      label: "Details",
      open: true,
      sessionId: "session-1",
      title: "Read",
    },
  });
  assert.equal(adapter.type, DetailsPresentationAdapter);
  assert.equal(adapter.props.panel, panel);
  assert.deepEqual(events.slice(0, 4), [
    "renderer:add",
    "inject:conversation.details.presentation",
    "host:add",
    "slot:add:conversation.details.presentation",
  ]);
  assert.equal(
    registered[0].beforeClose({
      id: "details-1",
      kind: "details",
      key: "dsh-details",
      title: "Details",
      payload: {
        sessionId: "session-1",
        callId: "call-1",
        label: "Details",
        title: "Read",
      },
    }),
    true,
  );
  assert.equal(events.at(-1), "details:close");

  dispose();
  assert.deepEqual(events.slice(-4), [
    "slot:remove:conversation.details.presentation",
    "host:remove",
    "inject:remove:conversation.details.presentation",
    "renderer:remove",
  ]);
  tabs.dispose();
});

test("Details integration preserves the native fallback when slot registration fails", () => {
  const events = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  assert.throws(
    () =>
      installDetailsTabs({
        runtime: tabs,
        renderers: {
          register() {
            events.push("renderer:add");
            return () => events.push("renderer:remove");
          },
        },
        slots: {
          inject(_name, callback) {
            callback();
            return () => {};
          },
          register() {
            throw new Error("presentation slot unavailable");
          },
        },
        layout: {
          details: {
            open() {},
            close() {},
            getSnapshot: () => false,
            subscribe: () => () => {},
            registerHost() {
              events.push("host:add");
              return () => events.push("host:remove");
            },
          },
        },
      }),
    /presentation slot unavailable/u,
  );
  assert.deepEqual(events, [
    "renderer:add",
    "host:add",
    "host:remove",
    "renderer:remove",
  ]);
  tabs.dispose();
});

test("Closing Details preserves sibling tabs and a later call reopens it", () => {
  const tasks = [];
  const hostEvents = [];
  const tabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show"),
    hidePanel: () => hostEvents.push("hide"),
  });
  const controller = new DetailsTabsController(tabs, {
    releaseHost: () => hostEvents.push("release"),
    schedule: (task) => tasks.push(task),
  });
  tabs.open({
    kind: "web",
    key: "docs",
    title: "Docs",
    payload: { url: "https://example.com" },
  });
  controller.accept({
    open: true,
    sessionId: "session-1",
    callId: "running-call",
    label: "Details",
    title: "Terminal",
  });
  tasks.shift()();
  const opened = tabs.getSnapshot();
  const details = opened.tabs.find((tab) => tab.kind === "details");
  assert.ok(details);
  assert.equal(opened.tabs.length, 2);
  assert.equal(opened.activeId, details.id);

  tabs.close(details.id);
  const afterManualClose = tabs.getSnapshot();
  assert.equal(afterManualClose.tabs.length, 1);
  assert.equal(afterManualClose.tabs[0].kind, "web");
  assert.equal(afterManualClose.visible, true);
  assert.doesNotMatch(hostEvents.join(","), /hide|release/u);

  controller.accept({
    open: true,
    sessionId: "session-1",
    callId: "settled-call",
    label: "Details",
    title: "Read",
  });
  tasks.shift()();
  const reopened = tabs.getSnapshot();
  assert.equal(reopened.tabs.length, 2);
  assert.equal(reopened.tabs.at(-1).kind, "details");
  assert.notEqual(reopened.tabs.at(-1).id, details.id);
  controller.dispose();
  tabs.dispose();
});

test("Details state subscription resynchronizes an existing tab without duplication", () => {
  const tasks = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const initialState = {
    open: true,
    sessionId: "session-1",
    callId: "call-1",
    label: "Details",
    title: "Custom Plugin Tool",
  };
  const first = new DetailsTabsController(tabs, {
    releaseHost() {},
    schedule: (task) => tasks.push(task),
  });
  first.accept(initialState);
  tasks.shift()();
  const originalId = tabs.getSnapshot().tabs[0].id;
  first.dispose();

  const refreshed = new DetailsTabsController(tabs, {
    releaseHost() {},
    schedule: (task) => tasks.push(task),
  });
  refreshed.accept({
    ...initialState,
    callId: "call-2",
    title: "Read",
  });
  tasks.shift()();
  assert.equal(tabs.getSnapshot().tabs.length, 1);
  assert.equal(tabs.getSnapshot().tabs[0].id, originalId);
  assert.equal(
    tabs.getSnapshot().tabs[0].title,
    "Details · Read",
  );
  assert.equal(tabs.getSnapshot().tabs[0].payload.callId, "call-2");
  refreshed.dispose();
  tabs.dispose();
});

test("Details renderer exposes one local presentation target", () => {
  const presentation = new DetailsPresentationRuntime();
  let closed = 0;
  const renderer = createDetailsTabRenderer(
    presentation,
    () => {
      closed += 1;
    },
  );
  const tab = {
    id: "details-1",
    key: "dsh-details",
    kind: "details",
    payload: {
      callId: "call-1",
      label: "Details",
      sessionId: "session-1",
      title: "Read",
    },
    title: "Details · Read",
  };

  assert.equal(renderer.kind, "details");
  assert.equal(Object.hasOwn(renderer, "createOptions"), false);
  assert.equal(renderer.beforeClose(tab), true);
  assert.equal(closed, 1);
  const markup = renderToStaticMarkup(
    renderer.renderView(tab, true),
  );
  assert.equal(markup.includes('role="tabpanel"'), true);
  assert.equal(
    markup.includes('data-session-id="session-1"'),
    true,
  );
  assert.equal(markup.includes('data-call-id="call-1"'), true);
  assert.equal(
    markup.includes('class="minke-details-tab__portal"'),
    true,
  );
  assert.match(DETAILS_TAB_STYLES, /data-dsh-details-panel/u);
  assert.match(DETAILS_TAB_STYLES, /data-dsh-details-header/u);
});

test("Session export and window layout actions stay semantically separate", () => {
  const sharedActionRule = SESSION_HEADER_ACTION_STYLES.match(
    /\[data-minke-session-log-action\],[\s\S]*?\{([\s\S]*?)\n\}/u,
  )?.[1];
  const idleTabsActionRule = [
    ...SESSION_HEADER_ACTION_STYLES.matchAll(
      /\[data-minke-tabs-header-action\]\s*\{([^}]*)\}/gu,
    ),
  ].at(-1)?.[1];
  const expandedTabsActionRule =
    SESSION_HEADER_ACTION_STYLES.match(
      /\[data-minke-tabs-header-action\]\[aria-expanded="true"\]\s*\{([^}]*)\}/u,
    )?.[1];
  assert.ok(sharedActionRule);
  assert.match(sharedActionRule, /border:\s*none;/u);
  assert.match(sharedActionRule, /appearance:\s*none;/u);
  assert.ok(idleTabsActionRule);
  assert.match(
    idleTabsActionRule,
    /color:\s*var\(--dsw-alias-label-tertiary\);/u,
  );
  assert.ok(expandedTabsActionRule);
  assert.match(
    expandedTabsActionRule,
    /color:\s*var\(--dsw-alias-label-primary\);/u,
  );
  assert.match(expandedTabsActionRule, /background:\s*transparent;/u);
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-tabs-header-action\]:hover:not\(:disabled\):not\(\s*\[aria-expanded="true"\]\s*\)/u,
  );

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
  assert.match(exportMarkup, /<svg[^>]*aria-hidden="true"/u);
  assert.doesNotMatch(exportMarkup, />Session log</u);

  const hostEvents = [];
  const rightTabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show:right"),
    hidePanel: () => hostEvents.push("hide:right"),
  });
  const bottomTabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show:bottom"),
    hidePanel: () => hostEvents.push("hide:bottom"),
  }, {
    idPrefix: "bottom-",
  });
  rightTabs.open({
    kind: "web",
    key: "https://example.com/",
    title: "Example",
    payload: {},
  });
  rightTabs.hide();
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtimes: {
        bottom: bottomTabs,
        right: rightTabs,
      },
      t: (key) => tabsEn[key],
    }),
  );
  assert.match(markup, /data-minke-tabs-layout-actions=""/u);
  assert.match(
    markup,
    /data-minke-tabs-layout-actions=""[\s\S]*data-minke-tabs-placement="bottom"[\s\S]*data-minke-tabs-placement="right"/u,
    "the window-level layout controls keep their stable order",
  );
  assert.doesNotMatch(markup, /data-minke-session-log-action/u);
  assert.equal(
    (markup.match(/data-minke-tabs-header-action=""/gu) ?? [])
      .length,
    2,
  );
  assert.match(
    markup,
    /data-minke-tabs-placement="bottom"[^>]*aria-label="Open Tabs panel at bottom"/u,
  );
  assert.match(
    markup,
    /data-minke-tabs-placement="right"[^>]*aria-label="Open Tabs panel on right"/u,
  );
  assert.match(
    markup,
    new RegExp(`aria-controls="${TABS_BOTTOM_PANEL_ID}"`, "u"),
  );
  assert.match(
    markup,
    new RegExp(`aria-controls="${TABS_PANEL_ID}"`, "u"),
  );
  assert.match(markup, /aria-expanded="false"/u);
  assert.equal((markup.match(/<svg/gu) ?? []).length, 2);
  assert.equal(
    (markup.match(/viewBox="0 0 21 21"/gu) ?? []).length,
    2,
  );
  assert.equal(
    (markup.match(/stroke-width="1.5"/gu) ?? []).length,
    2,
  );
  assert.match(
    markup,
    /d="M5\.5 3\.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2m1 12h8"/u,
  );
  assert.match(
    markup,
    /d="M5\.5 3\.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2m10 11v-8"/u,
  );
  const blankMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtimes: {
        bottom: bottomTabs,
        right: rightTabs,
      },
      t: (key) => tabsEn[key],
      useSessions: (selector) =>
        selector({
          current: "blank-session",
          byId: {
            "blank-session": { blank: true },
          },
        }),
    }),
  );
  assert.match(
    blankMarkup,
    /data-minke-new-session-tabs-action=""/u,
  );
  assert.match(
    blankMarkup,
    /data-minke-tabs-layout-actions=""/u,
  );
  const activeMarkup = renderToStaticMarkup(
    createElement(NewSessionTabsHeaderAction, {
      runtimes: {
        bottom: bottomTabs,
        right: rightTabs,
      },
      t: (key) => tabsEn[key],
      useSessions: (selector) =>
        selector({
          current: "active-session",
          byId: {
            "active-session": { blank: false },
          },
        }),
    }),
  );
  assert.equal(activeMarkup, "");

  rightTabs.show();
  assert.equal(rightTabs.getSnapshot().visible, true);
  assert.equal(hostEvents.at(-1), "show:right");
  rightTabs.toggle();
  assert.equal(rightTabs.getSnapshot().visible, false);
  assert.equal(hostEvents.at(-1), "hide:right");
  rightTabs.toggle();
  assert.equal(rightTabs.getSnapshot().visible, true);
  assert.deepEqual(Object.keys(tabsEn), Object.keys(tabsZh));
  assert.equal(tabsZh["header.sessionLog"], "导出 Session 日志");

  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-session-log-action\] > svg,[\s\S]*?\[data-minke-tabs-header-action\] > svg/u,
  );
  assert.doesNotMatch(
    SESSION_HEADER_ACTION_STYLES,
    /data:image|::before/u,
  );
});

test("Tabs placement controls keep independent panels open", () => {
  const hostEvents = [];
  const rightTabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show:right"),
    hidePanel: () => hostEvents.push("hide:right"),
  });
  const bottomTabs = new TabsRuntime({
    showPanel: () => hostEvents.push("show:bottom"),
    hidePanel: () => hostEvents.push("hide:bottom"),
  }, {
    idPrefix: "bottom-",
  });
  const markup = renderToStaticMarkup(
    createElement(TabsHeaderAction, {
      runtimes: {
        bottom: bottomTabs,
        right: rightTabs,
      },
      t: (key) => tabsEn[key],
    }),
  );

  assert.doesNotMatch(markup, /\sdisabled(?:=""|(?=\s|>))/u);
  assert.match(markup, /aria-pressed="false"/u);
  const rightId = rightTabs.open({
    kind: "files",
    key: "/workspace",
    title: "Files",
    payload: {},
  });
  const bottomId = bottomTabs.open({
    kind: "files",
    key: "/workspace",
    title: "Files",
    payload: {},
  });
  assert.equal(rightId, "tab-1");
  assert.equal(bottomId, "bottom-tab-1");
  rightTabs.hide();
  bottomTabs.hide();
  hostEvents.length = 0;
  bottomTabs.toggle();
  assert.equal(bottomTabs.getSnapshot().visible, true);
  assert.equal(rightTabs.getSnapshot().visible, false);
  assert.deepEqual(hostEvents, ["show:bottom"]);
  rightTabs.toggle();
  assert.equal(bottomTabs.getSnapshot().visible, true);
  assert.equal(rightTabs.getSnapshot().visible, true);
  assert.deepEqual(hostEvents, [
    "show:bottom",
    "show:right",
  ]);
  bottomTabs.toggle();
  assert.equal(bottomTabs.getSnapshot().visible, false);
  assert.equal(rightTabs.getSnapshot().visible, true);
  assert.equal(hostEvents.at(-1), "hide:bottom");

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

  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-shell-overlay\]\s*\{[\s\S]*?--minke-tabs-layout-actions-clearance:\s*88px;[\s\S]*?--minke-tabs-primary-row-top:\s*6px;/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-tabs-layout-actions\]\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?height:\s*32px;[\s\S]*?-webkit-app-region:\s*no-drag;[\s\S]*?app-region:\s*no-drag;/u,
  );
  const sessionActionGroupRule =
    SESSION_HEADER_ACTION_STYLES.match(
      /\[data-minke-tabs-layout-actions\]\s*\{([^}]*)\}/u,
    )?.[1];
  assert.ok(sessionActionGroupRule);
  assert.match(
    sessionActionGroupRule,
    /position:\s*static;/u,
    "layout controls must participate in the Session Header flow while the right panel is closed",
  );
  assert.doesNotMatch(
    sessionActionGroupRule,
    /(?:top|right|z-index):/u,
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-tabs-right-open\][\s\S]*?\[data-minke-tabs-layout-actions\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(\s*--minke-tabs-primary-row-top,\s*6px\s*\);[\s\S]*?right:\s*8px;[\s\S]*?z-index:\s*22;/u,
    "opening the right panel moves only the layout controls to its top-right chrome",
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-new-session-tabs-action\]\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*var\(\s*--minke-tabs-primary-row-top,\s*6px\s*\);[\s\S]*?right:\s*8px;/u,
    "a blank Session without Header chrome keeps one overlay fallback",
  );
  assert.match(
    SESSION_HEADER_ACTION_STYLES,
    /header:has\(\[data-minke-tabs-layout-actions\]\)\s*\{[\s\S]*?padding-right:\s*8px;/u,
    "closed-panel controls share the same compact right edge in normal Header flow",
  );
  assert.doesNotMatch(
    SESSION_HEADER_ACTION_STYLES,
    /\[data-minke-session-log-action\]\s*\{[^}]*margin-right:/u,
  );
  assert.doesNotMatch(
    SESSION_HEADER_ACTION_STYLES,
    /minke-tabs-panel-width/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\s+\.minke-tabs-tabbar\s*\{[\s\S]*?top:\s*var\(\s*--minke-tabs-primary-row-top,\s*6px\s*\);[\s\S]*?right:\s*var\(\s*--minke-tabs-layout-actions-clearance,\s*88px\s*\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\s+\.minke-tabs-tabbar__actions\s*\{[\s\S]*?padding-right:\s*0;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\s+\.minke-tabs-tabbar__actions\s+\.minke-tabs-toolbar__button\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;[\s\S]*?border-radius:\s*8px;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\s+\.minke-tabs-chrome\[data-single-row\]\s*\{[\s\S]*?height:\s*44px;[\s\S]*?min-height:\s*44px;/u,
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

  bottomTabs.dispose();
  rightTabs.dispose();
});

test("Tabs bottom placement has independent height and resize affordances", () => {
  assert.equal(
    clampTabsPanelHeight(1_000, 900),
    TABS_PANEL_MAX_HEIGHT,
  );
  assert.equal(clampTabsPanelHeight(700, 520), 320);
  assert.equal(
    clampTabsPanelHeight(10, 900),
    TABS_PANEL_MIN_HEIGHT,
  );
  assert.equal(TABS_PANEL_DEFAULT_HEIGHT, 320);

  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    panelSource,
    /data-placement=\{placement\}/u,
  );
  assert.match(panelSource, /event\.clientY/u);
  assert.match(panelSource, /"ArrowUp"/u);
  assert.match(panelSource, /placement === "bottom"[\s\S]*?"horizontal"/u);

  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="bottom"\][\s\S]*?height:\s*var\(--minke-tabs-panel-height\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\[data-minke-tabs-bottom-open\][\s\S]*?padding-bottom:\s*var\(--minke-tabs-panel-height\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\[data-minke-tabs-bottom-open\][\s\S]*?\.minke-tabs-panel\[data-placement="right"\][\s\S]*?bottom:\s*var\(--minke-tabs-panel-height\);/u,
  );
  assert.doesNotMatch(
    TABS_STYLES,
    /\.minke-tabs-panel\s*\{[^}]*--minke-tabs-panel-height:/u,
    "the right panel must inherit the live bottom height from the frame",
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s*\{[^}]*--minke-tabs-panel-height:\s*320px;/u,
  );
  assert.doesNotMatch(
    TABS_STYLES,
    /\[data-minke-tabs-right-open\][\s\S]*?\.minke-tabs-panel\[data-placement="bottom"\][\s\S]*?right:\s*var\(--minke-tabs-panel-width\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\[data-minke-tabs-bottom-open\][\s\S]*?>\s*\[data-side="details"\][\s\S]*?bottom:\s*calc\(var\(--minke-tabs-panel-height\) \+ 5px\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\[data-placement="bottom"\]\s*\.minke-tabs-resize-handle[\s\S]*?cursor:\s*row-resize;/u,
  );
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
      "../packages/harness-overlay/src/client/tabs/web/styles.css",
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
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-tabs-chrome\[data-single-row\]\s*\{[\s\S]*?height:\s*36px;[\s\S]*?min-height:\s*36px;/u,
    "the bottom single-row chrome should keep both vertical margins compact",
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-tabs-chrome\[data-single-row\]\s+\.minke-tabs-tabbar\s*\{[\s\S]*?top:\s*4px;/u,
    "the bottom single-row tabs should keep a smaller top inset",
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
    TABS_STYLES,
    /\.minke-tab\s*\{[\s\S]*?min-width:\s*60px;[\s\S]*?max-width:\s*160px;[\s\S]*?width:\s*max-content;[\s\S]*?flex:\s*0 0 auto;/u,
  );
  assert.match(
    webStylesSource,
    /\.minke-tabs-location\s*\{[\s\S]*?height:\s*var\(--minke-tabs-control-height\);/u,
  );
  assert.match(
    TABS_STYLES,
    /max-width:\s*calc\(100% - 20px\);/u,
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
  assert.equal(tabsPanelReflowMaxWidth(1200, 240), 640);
  assert.equal(clampTabsPanelWidth(1000, 1200, 240), 940);
  assert.equal(clampTabsPanelWidth(700, 900, 240), 640);
  const terminalStylesSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/terminal/styles.css",
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

test("bottom Tabs chooser uses a height-efficient grid", () => {
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-empty\s*\{[\s\S]*?align-items:\s*safe center;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-tabs-empty__options\s*\{[\s\S]*?max-width:\s*420px;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="bottom"\]\s+\.minke-tabs-empty__option\s*\{[\s\S]*?min-height:\s*68px;[\s\S]*?flex-direction:\s*column;[\s\S]*?justify-content:\s*center;/u,
  );
});

test("right Tabs window dragging covers populated and empty panels without claiming controls", () => {
  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const emptyStateSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsEmptyState.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const stripIndex = panelSource.indexOf(
    'className="minke-tabs-strip"',
  );
  const dragRegionIndex = panelSource.indexOf(
    'data-minke-tabs-window-drag=""',
  );
  const actionsIndex = panelSource.indexOf(
    'className="minke-tabs-tabbar__actions"',
  );

  assert.match(
    panelSource,
    /\{placement === "right" && \([\s\S]*?data-minke-tabs-window-drag=""/u,
  );
  assert.match(
    panelSource,
    /className="minke-tabs-resize-handle"\s+data-minke-tabs-resize-handle=""/u,
    "the resize interaction must expose a semantic marker independent of styling",
  );
  assert.ok(
    stripIndex >= 0 &&
      stripIndex < dragRegionIndex &&
      dragRegionIndex < actionsIndex,
    "the inert window-drag spacer must be a sibling after the sortable strip",
  );
  assert.match(
    panelSource,
    /onClick=\{\(\) => \{[\s\S]*?runtime\.activate\(tab\.id\);/u,
  );
  assert.match(
    panelSource,
    /onDragStart=\{\(event\) => \{[\s\S]*?onDrop=\{\(event\) => \{[\s\S]*?runtime\.place\(/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-panel\[data-placement="right"\]\s+\.minke-tabs-strip\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?flex:\s*0 1 auto;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-tabbar__window-drag\s*\{[\s\S]*?min-width:\s*12px;[\s\S]*?flex:\s*1 0 12px;/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-resize-handle\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;[\s\S]*?app-region:\s*no-drag;/u,
    "the overhanging resize hit strip must remain interactive above native drag regions",
  );

  assert.match(
    emptyStateSource,
    /readonly windowDrag\?: boolean;[\s\S]*\{windowDrag && \([\s\S]*className="minke-tabs-empty__window-drag"[\s\S]*data-minke-tabs-window-drag=""/u,
  );
  assert.doesNotMatch(
    emptyStateSource,
    /className="minke-tabs-empty"\s+data-minke-tabs-window-drag=/u,
    "the empty panel container must not turn the action corner into a native drag region",
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-empty__window-drag\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0\s+var\(\s*--minke-tabs-layout-actions-clearance,\s*88px\s*\)\s+0\s+0;/u,
    "the empty-panel drag surface must stop before the fixed layout actions",
  );
  assert.match(
    emptyStateSource,
    /className="minke-tabs-empty__option"/u,
  );
  assert.match(
    panelSource,
    /windowDrag=\{placement === "right"\}/u,
  );
  assert.match(
    TABS_STYLES,
    /\.minke-tabs-empty__option\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/u,
  );
});

test("Tabs resize stays interactive with and without a host details handle", async () => {
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

    constructor(width = 0, height = 0) {
      this.width = width;
      this.height = height;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type) {
      this.listeners.delete(type);
    }

    getBoundingClientRect() {
      return { width: this.width, height: this.height };
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
  let extendedPanelWidth = "";
  let nativeZIndex = "";
  let restoredZIndex = "";
  let overlayPanelWidth = "";
  let overlayHandleTabIndex = -1;
  let bottomPanelHeight = "";
  let bottomFrameHeight = "";
  let bottomPanelLeft = "";
  let bottomFrameReserved = false;
  let bottomHandleTabIndex = -1;
  const appliedTrackWidths = [];
  const committedRightWidths = [];
  const committedBottomHeights = [];
  try {
    const handle = new FakeElement();
    const nativeHandle = new FakeElement();
    nativeHandle.dataset.side = "details";
    const detailsColumn = new FakeElement(360);
    const detailsSlot = new FakeElement();
    detailsSlot.parentElement = detailsColumn;
    const sidebar = new FakeElement(240);
    const frame = new FakeElement(1200);
    frame.children.push(sidebar, nativeHandle);
    const overlay = new FakeElement();
    overlay.parentElement = frame;
    const panel = new FakeElement();
    panel.setAttribute("data-open", "");
    panel.parentElement = overlay;
    panel.closest = (selector) =>
      selector === "[data-shell-overlay]" ? overlay : undefined;
    panel.querySelector = (selector) =>
      selector === "[data-minke-tabs-resize-handle]"
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

    const resize = new TabsPanelResizeController(panel, {
      applyRightTrackWidth(width) {
        appliedTrackWidths.push(width);
        detailsColumn.width = width;
      },
      onSizeCommit(width) {
        committedRightWidths.push(width);
      },
    });
    resize.restoreSize(600);
    nativeZIndex = nativeHandle.style.getPropertyValue("z-index");
    nativeHandle.listeners.get("pointerdown")({ clientX: 600 });
    detailsColumn.width = 640;
    nativeHandle.listeners.get("pointermove")({ clientX: 480 });
    nativeHandle.listeners.get("pointerup")({ clientX: 480 });
    await Promise.resolve();
    extendedPanelWidth = panel.style.getPropertyValue(
      "--minke-tabs-panel-width",
    );
    resize.beginExtendedDrag(480);
    resize.moveExtendedDrag(600);
    resize.endExtendedDrag();
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
    const overlaySidebar = new FakeElement(240);
    const overlayFrame = new FakeElement(1200);
    overlayFrame.children.push(overlaySidebar);
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
      selector === "[data-minke-tabs-resize-handle]"
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
      new TabsPanelResizeController(overlayPanel, {
        onSizeCommit(width) {
          committedRightWidths.push(width);
        },
      });
    overlayHandleTabIndex = overlayHandle.tabIndex;
    overlayResize.beginExtendedDrag(680);
    overlayResize.moveExtendedDrag(0);
    overlayResize.endExtendedDrag();
    overlayPanelWidth =
      overlayPanel.style.getPropertyValue(
        "--minke-tabs-panel-width",
      );
    overlayResize.dispose();

    const bottomHandle = new FakeElement();
    const bottomSidebar = new FakeElement(240, 800);
    const bottomFrame = new FakeElement(1200, 800);
    bottomFrame.children.push(bottomSidebar);
    const bottomOverlay = new FakeElement();
    bottomOverlay.parentElement = bottomFrame;
    const bottomPanel = new FakeElement();
    bottomPanel.dataset.placement = "bottom";
    bottomPanel.setAttribute("data-open", "");
    bottomPanel.parentElement = bottomOverlay;
    bottomPanel.closest = (selector) =>
      selector === "[data-shell-overlay]"
        ? bottomOverlay
        : undefined;
    bottomPanel.querySelector = (selector) =>
      selector === "[data-minke-tabs-resize-handle]"
        ? bottomHandle
        : undefined;
    bottomPanel.ownerDocument = {
      defaultView: {
        ResizeObserver: FakeObserver,
        MutationObserver: FakeObserver,
        addEventListener() {},
        removeEventListener() {},
        innerHeight: 800,
      },
      querySelector: () => undefined,
    };

    const bottomResize =
      new TabsPanelResizeController(bottomPanel, {
        onSizeCommit(height) {
          committedBottomHeights.push(height);
        },
      });
    bottomResize.restoreSize(372);
    bottomResize.beginDrag(480);
    bottomResize.moveDrag(420);
    bottomResize.endDrag();
    bottomPanelHeight = bottomPanel.style.getPropertyValue(
      "--minke-tabs-panel-height",
    );
    bottomFrameHeight = bottomFrame.style.getPropertyValue(
      "--minke-tabs-panel-height",
    );
    bottomPanelLeft = bottomPanel.style.getPropertyValue(
      "--minke-tabs-panel-left",
    );
    bottomFrameReserved = bottomFrame.hasAttribute(
      "data-minke-tabs-bottom-open",
    );
    bottomHandleTabIndex = bottomHandle.tabIndex;
    bottomResize.dispose();
    assert.equal(
      bottomFrame.hasAttribute("data-minke-tabs-bottom-open"),
      false,
    );
  } finally {
    if (previousHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = previousHTMLElement;
    }
  }

  assert.equal(nativeZIndex, "21");
  assert.deepEqual(appliedTrackWidths, [600, 640, 600]);
  assert.equal(extendedPanelWidth, "720px");
  assert.equal(panelWidth, "600px");
  assert.equal(restoredZIndex, "");
  assert.equal(overlayHandleTabIndex, 0);
  assert.equal(overlayPanelWidth, "940px");
  assert.deepEqual(committedRightWidths, [720, 600, 940]);
  assert.equal(bottomPanelHeight, "432px");
  assert.equal(bottomFrameHeight, "432px");
  assert.equal(bottomPanelLeft, "240px");
  assert.equal(bottomFrameReserved, true);
  assert.equal(bottomHandleTabIndex, 0);
  assert.deepEqual(committedBottomHeights, [432]);
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
