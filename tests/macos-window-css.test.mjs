import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const macOSWindowSource = readFileSync(
  new URL("../desktop/main/macos-window.ts", import.meta.url),
  "utf8",
);
const macOSWindowControlsSource = readFileSync(
  new URL("../desktop/main/macos-window-controls.ts", import.meta.url),
  "utf8",
);
const desktopMainSource = readFileSync(
  new URL("../desktop/main/main.ts", import.meta.url),
  "utf8",
);
const forgeSource = readFileSync(
  new URL("../forge.config.ts", import.meta.url),
  "utf8",
);
const desktopPreloadSource = readFileSync(
  new URL("../desktop/preload/desktop-preload.ts", import.meta.url),
  "utf8",
);
const earlyCss = readFileSync(
  new URL(
    "../resources/desktop-style-extension/early.css",
    import.meta.url,
  ),
  "utf8",
);
const desktopSurfaceSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/desktop-surface.ts",
    import.meta.url,
  ),
  "utf8",
);
const overlayBridgeSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/bridge.ts",
    import.meta.url,
  ),
  "utf8",
);
const overlayClientSource = readFileSync(
  new URL(
    "../packages/harness-overlay/src/client/index.tsx",
    import.meta.url,
  ),
  "utf8",
);
const harnessColumnsSource = readFileSync(
  new URL(
    "../vendor/deepseek-harness/packages/client/ui-layout/src/client/columns.ts",
    import.meta.url,
  ),
  "utf8",
);
const harnessSidebarCss = readFileSync(
  new URL(
    "../vendor/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.module.css",
    import.meta.url,
  ),
  "utf8",
);
const harnessSidebarSource = readFileSync(
  new URL(
    "../vendor/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx",
    import.meta.url,
  ),
  "utf8",
);
const harnessDesktopSurfaceSources = [
  "packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx",
  "packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx",
  "packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx",
].map((path) =>
  readFileSync(
    new URL(`../vendor/deepseek-harness/${path}`, import.meta.url),
    "utf8",
  ),
);
const extensionManifest = JSON.parse(
  readFileSync(
    new URL(
      "../resources/desktop-style-extension/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("Electron loads only the native surface bootstrap at document start", () => {
  assert.doesNotMatch(
    `${macOSWindowSource}\n${desktopMainSource}`,
    /insertCSS|did-finish-load|MACOS_GLASS_CSS/,
  );
  assert.match(
    desktopMainSource,
    /session\.defaultSession\.extensions\.loadExtension/,
  );
  assert.ok(
    desktopMainSource.indexOf("await installMacOSSurfaceBootstrap();") <
      desktopMainSource.indexOf("installPermissionPolicy();"),
    "the native bootstrap must load before the first Harness document",
  );
  assert.match(forgeSource, /resources", "desktop-style-extension"/);
  assert.equal(extensionManifest.manifest_version, 3);
  assert.deepEqual(extensionManifest.content_scripts, [
    {
      matches: ["http://127.0.0.1/*", "http://localhost/*"],
      css: ["early.css"],
      run_at: "document_start",
    },
  ]);
  assert.equal(
    extensionManifest.permissions,
    undefined,
    "the bootstrap extension must not request browser capabilities",
  );
  assert.doesNotMatch(
    earlyCss,
    /data-dsh-desktop-|MutationObserver|requestAnimationFrame/,
    "post-boot DOM adaptation belongs to the Harness overlay",
  );
});

test("Electron wires native desktop capabilities through preload", () => {
  assert.match(
    forgeSource,
    /entry:\s*"desktop\/preload\/desktop-preload\.ts"[\s\S]*target:\s*"preload"/,
  );
  assert.match(
    desktopMainSource,
    /preload:\s*join\(__dirname,\s*"desktop-preload\.js"\)/,
  );
  assert.match(desktopMainSource, /bindWindowTheme\(window,\s*nativeTheme\)/);
  assert.match(desktopPreloadSource, /new MutationObserver/);
  assert.match(
    desktopPreloadSource,
    /attributeFilter:\s*\["style"\]/,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.send\(WINDOW_THEME_CHANNEL,\s*message\)/,
  );
  assert.doesNotMatch(desktopPreloadSource, /data-ds-theme-preference/);
  assert.match(
    desktopPreloadSource,
    /const surface = Object\.freeze\([\s\S]*kind:[\s\S]*"macos"/,
  );
  assert.match(
    desktopPreloadSource,
    /Object\.freeze\(\{\s*files,\s*locale,\s*sessionLogs,\s*tabs,\s*terminal,\s*shortcuts,\s*surface,\s*windowTheme,\s*\}\)/,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.on\(SHORTCUT_INVOKE_CHANNEL,\s*wrapped\)/,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.off\(SHORTCUT_INVOKE_CHANNEL,\s*wrapped\)/,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*SESSION_LOG_EXPORT_CHANNEL/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*TABS_TERMINAL_CREATE_CHANNEL/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*TABS_FILES_LIST_CHANNEL/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*TABS_FILES_PREVIEW_CHANNEL/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*TABS_FILES_WRITE_CHANNEL/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(TERMINAL_SETTINGS_READ_CHANNEL\)/u,
  );
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.invoke\(\s*TERMINAL_SETTINGS_WRITE_CHANNEL/u,
  );
  assert.match(desktopMainSource, /bindTerminalSettingsIpc\(/u);
  assert.match(
    desktopPreloadSource,
    /ipcRenderer\.on\(TABS_TERMINAL_EVENT_CHANNEL,\s*wrapped\)/u,
  );
  assert.match(
    desktopMainSource,
    /fileSystemRoot:\s*parse\(app\.getPath\("home"\)\)\.root/u,
  );
  assert.match(overlayBridgeSource, /hasMacOSDesktopSurface/);
});

test("the product overlay owns post-boot desktop adaptation", () => {
  assert.doesNotMatch(
    [harnessSidebarSource, ...harnessDesktopSurfaceSources].join("\n"),
    /data-dsh-desktop-/,
  );
  assert.match(
    desktopSurfaceSource,
    /querySelector\(":scope > button:last-of-type"\)/,
  );
  assert.match(
    desktopSurfaceSource,
    /querySelector\(\s*':scope > \[data-slot="sidebar"\]'\s*,?\s*\)/,
  );
  assert.match(
    desktopSurfaceSource,
    /querySelector\(\s*':scope > \[data-slot="details"\]'\s*,?\s*\)/,
  );
  assert.doesNotMatch(
    desktopSurfaceSource,
    /sidebarColumn\?\.firstElementChild/,
    "the sidebar slot wrapper must be unwrapped before locating its root",
  );
  assert.match(desktopSurfaceSource, /nextElementSibling/);
  assert.match(desktopSurfaceSource, /\[data-shell-overlay\]/);
  assert.match(desktopSurfaceSource, /children\.item\(2\)/);
  assert.match(desktopSurfaceSource, /linear-gradient/);
  assert.match(desktopSurfaceSource, /1051 468/);
  assert.match(
    desktopSurfaceSource,
    /setAttribute\("data-dsh-desktop-sidebar-toggle"/,
  );
  assert.match(
    desktopSurfaceSource,
    /setAttribute\("data-dsh-desktop-new-session"/,
  );
  assert.match(desktopSurfaceSource, /new view\.MutationObserver/);
  assert.match(desktopSurfaceSource, /observer\.disconnect\(\)/);
  assert.match(desktopSurfaceSource, /cancelAnimationFrame/);
  assert.match(desktopSurfaceSource, /style\.remove\(\)/);
  assert.match(
    overlayClientSource,
    /hasMacOSDesktopSurface\(\)[\s\S]*ctx\.effect\([\s\S]*installDesktopSurface\(\)/,
  );
  assert.match(
    overlayClientSource,
    /minke-overlay: macOS desktop surface/,
  );
});

test("the overlay composes around upstream slots instead of replacing shells", () => {
  assert.doesNotMatch(
    overlayClientSource,
    /ctx\.slots\.(?:inject|register)\(\s*["'](?:sidebar|conversation|details)["']/,
  );
});

test("macOS glass leaves shared Harness component tokens untouched", () => {
  assert.doesNotMatch(desktopSurfaceSource, /--dsw-[\w-]+\s*:/);
  assert.doesNotMatch(earlyCss, /--dsw-[\w-]+\s*:/);
});

test("macOS glass keeps the conversation column on its upstream theme surface", () => {
  assert.match(earlyCss, /html,\s*body,\s*#root/);
  assert.match(earlyCss, /\[data-shell-overlay\]/);
  assert.doesNotMatch(
    earlyCss,
    /#root :has\(> \[data-conversation-scroll\]\)/,
    "the main content column and its scrollbar gutter must keep one background",
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-titlebar-anchor\]/,
  );
  assert.doesNotMatch(`${earlyCss}\n${desktopSurfaceSource}`, /rgb\(/);
});

test("the smaller traffic lights are centered in the default rail", () => {
  const trafficLightPosition = macOSWindowSource.match(
    /trafficLightPosition:\s*\{\s*x:\s*(\d+),\s*y:\s*(\d+)\s*\}/,
  );
  const buttonSize = macOSWindowControlsSource.match(
    /MACOS_WINDOW_BUTTON_SIZE\s*=\s*(\d+)/,
  );
  const buttonCenterPitch = macOSWindowControlsSource.match(
    /MACOS_WINDOW_BUTTON_CENTER_PITCH\s*=\s*(\d+)/,
  );
  const sidebarWidth = harnessColumnsSource.match(
    /SIDEBAR_COLLAPSED\s*=\s*(\d+)/,
  );
  assert.ok(trafficLightPosition, "traffic-light position must remain explicit");
  assert.ok(buttonSize, "traffic-light size must remain explicit");
  assert.ok(buttonCenterPitch, "traffic-light pitch must remain explicit");
  assert.ok(sidebarWidth, "collapsed sidebar width must remain explicit");
  assert.equal(Number(trafficLightPosition[2]), 10);
  assert.equal(Number(buttonSize[1]), 10);
  assert.equal(Number(buttonCenterPitch[1]), 14);
  assert.equal(
    Number(trafficLightPosition[1]),
    (Number(sidebarWidth[1]) -
      (Number(buttonSize[1]) + Number(buttonCenterPitch[1]) * 2)) /
      2,
    "the traffic-light frames must be centered in the collapsed sidebar",
  );
});

test("the native titlebar hides only the expanded web brand", () => {
  const titlebarRule = desktopSurfaceSource.match(
    /\[data-dsh-desktop-titlebar-anchor\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  const collapsedRule = desktopSurfaceSource.match(
    /\[data-sidebar-collapsed\] \[data-dsh-desktop-titlebar-anchor\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  const sidebarWidth = harnessColumnsSource.match(
    /SIDEBAR_COLLAPSED\s*=\s*(\d+)/,
  );
  assert.ok(sidebarWidth, "collapsed sidebar width must remain explicit");
  assert.match(
    macOSWindowControlsSource,
    /adapter\.setSize\(/,
  );
  assert.match(
    macOSWindowControlsSource,
    /join\(app\.getAppPath\(\), "node_modules", "sys", "index\.js"\)/,
  );
  assert.match(
    macOSWindowControlsSource,
    /nativeRequire\(\s*sysEntryPath\(\)/,
  );
  assert.match(
    macOSWindowControlsSource,
    /candidate\.enable\("sys\.lencx\.me"\)/,
  );
  assert.match(
    desktopMainSource,
    /bindMacOSWindowButtonSpacing\(window/,
  );
  assert.equal(Number(sidebarWidth[1]), 56);
  assert.ok(titlebarRule, "titlebar anchor rule must remain present");
  assert.ok(collapsedRule, "collapsed titlebar rule must remain present");
  assert.match(titlebarRule, /height:\s*28px\s*!important/);
  assert.match(titlebarRule, /margin-top:\s*-4px\s*!important/);
  assert.match(titlebarRule, /padding-left:\s*56px\s*!important/);
  assert.match(collapsedRule, /height:\s*36px\s*!important/);
  assert.match(
    collapsedRule,
    /margin-top:\s*12px\s*!important/,
    "the rail toggle must clear the traffic lights without a second titlebar-height gap",
  );
  assert.match(collapsedRule, /padding-left:\s*0\s*!important/);
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-titlebar-anchor\]\s*>\s*button:first-child:not\(:last-child\)\s*\{[^}]*display:\s*none/,
    "the web wordmark must not duplicate the native titlebar",
  );
  assert.doesNotMatch(
    desktopSurfaceSource,
    /\[data-dsh-desktop-titlebar-anchor\]\s*>\s*button:first-child\s*\{/,
    "the collapsed titlebar's only button must remain visible",
  );
  assert.doesNotMatch(
    desktopSurfaceSource,
    /\[data-sidebar-collapsed\]\s+:has\(> \[data-dsh-desktop-titlebar-anchor\]\)/,
  );
  assert.match(
    harnessSidebarCss,
    /\.root\.collapsed\s*\{[\s\S]*padding:\s*18px 10px 6px;/,
  );
  assert.match(
    harnessSidebarCss,
    /\.collapsed \.iconButton\s*\{[\s\S]*width:\s*36px;[\s\S]*height:\s*36px;/,
  );
});

test("the desktop sidebar toggle keeps one stable glyph across hover", () => {
  assert.match(
    desktopSurfaceSource,
    /data-dsh-desktop-sidebar-toggle/,
  );
  assert.doesNotMatch(
    desktopSurfaceSource,
    /\[data-dsh-desktop-titlebar-anchor\][\s\S]*button:only-child/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-sidebar-toggle\]\s*>\s*svg:first-child:not\(:last-child\)[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-sidebar-toggle\]\s*>\s*svg:last-child[\s\S]*display:\s*inline\s*!important/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-sidebar-collapsed\] \[data-dsh-desktop-sidebar-toggle\]\s*\{[^}]*animation:\s*none\s*!important;[^}]*transform:\s*none\s*!important;/,
    "hover-driven rerenders must not restart Harness's rail-in slide",
  );
});

test("the desktop New Session button uses a restrained translucent fill", () => {
  const baseFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-new-session\]\s*\{[\s\S]*?var\(--dsw-alias-button-elevated-fill\)\s*(\d+)%/,
  );
  const hoverFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-new-session\]:hover\s*\{[\s\S]*?var\(--dsw-alias-button-floating-hover\)\s*(\d+)%/,
  );
  assert.match(
    desktopSurfaceSource,
    /data-dsh-desktop-new-session/,
  );
  assert.ok(baseFill, "the desktop New Session fill must remain explicit");
  assert.ok(hoverFill, "the desktop New Session hover fill must remain explicit");
  assert.ok(Number(baseFill[1]) < 50);
  assert.ok(Number(hoverFill[1]) > Number(baseFill[1]));
  assert.ok(Number(hoverFill[1]) < 80);
  assert.match(
    desktopSurfaceSource,
    /\[data-sidebar-collapsed\] \[data-dsh-desktop-new-session\]\s*\{\s*background:\s*transparent\s*!important;/,
  );
});

test("the desktop surface leaves composer action buttons to Harness", () => {
  assert.doesNotMatch(
    desktopSurfaceSource,
    /data-dsh-desktop-composer-(?:add|primary)/,
    "the overlay must not mark or restyle composer action buttons",
  );
  assert.doesNotMatch(desktopSurfaceSource, /markComposerActions/);
  assert.doesNotMatch(earlyCss, /data-dsh-desktop-composer-/);
});

test("the conversation header slot is the full-height drag target without claiming controls or text", () => {
  const conversationRoot = earlyCss.match(
    /\[data-phase\]:has\(> \[data-slot="conversation\.session\.header"\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  const sessionHeaderSlot = earlyCss.match(
    /\[data-slot="conversation\.session\.header"\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  const blankSessionHeaderSlot = earlyCss.match(
    /\[data-phase="hero"\] > \[data-slot="conversation\.session\.header"\],\s*\n\[data-phase="settling"\] > \[data-slot="conversation\.session\.header"\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  const selectableHeaderText = earlyCss.match(
    /\[data-slot="conversation\.session\.header"\] nav,\s*\n\[data-slot="conversation\.session\.header"\] nav \*,\s*\n\[data-slot="conversation\.session\.header"\] span\s*\{([\s\S]*?)\}/,
  )?.[1];
  const gatedDragRule = desktopSurfaceSource.match(
    /:root\[\$\{DESKTOP_DRAG_ENABLED_ATTRIBUTE\}\]\s*\n\s*\[data-dsh-desktop-titlebar-anchor\],\s*\n:root\[\$\{DESKTOP_DRAG_ENABLED_ATTRIBUTE\}\]\s*\n\s*\[data-slot="conversation\.session\.header"\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(conversationRoot, "the conversation root must anchor blank chrome");
  assert.ok(
    sessionHeaderSlot,
    "conversation.session.header must own the drag region",
  );
  assert.ok(
    blankSessionHeaderSlot,
    "blank and settling header slots must stay out of hero layout",
  );
  assert.ok(
    selectableHeaderText,
    "header text must remain selectable outside the drag region",
  );
  assert.match(conversationRoot, /position:\s*relative/);
  assert.match(sessionHeaderSlot, /display:\s*block\s*!important/);
  assert.match(sessionHeaderSlot, /flex:\s*none/);
  assert.match(sessionHeaderSlot, /min-height:\s*75px/);
  assert.match(sessionHeaderSlot, /-webkit-app-region:\s*no-drag/);
  assert.ok(
    gatedDragRule,
    "desktop drag must require the runtime safety gate",
  );
  assert.match(gatedDragRule, /-webkit-app-region:\s*drag/);
  assert.match(blankSessionHeaderSlot, /position:\s*absolute/);
  assert.match(blankSessionHeaderSlot, /inset:\s*0 0 auto/);
  assert.match(selectableHeaderText, /-webkit-app-region:\s*no-drag/);
  assert.match(selectableHeaderText, /user-select:\s*text/);
  assert.match(
    earlyCss,
    /button,[\s\S]*\[contenteditable="true"\]\s*\{[\s\S]*-webkit-app-region:\s*no-drag/,
  );
  assert.doesNotMatch(
    earlyCss,
    /user-select:\s*none/,
    "desktop drag rules must not disable text selection",
  );
  assert.doesNotMatch(
    earlyCss,
    /body(?::has\([^)]*\))?::before/,
    "obsolete document-wide pseudo drag strips must be removed",
  );
  assert.equal(
    [...earlyCss.matchAll(/-webkit-app-region:\s*drag/g)].length,
    0,
    "document-start CSS must fail safe before interaction-layer detection",
  );
  assert.equal(
    [
      ...desktopSurfaceSource.matchAll(
        /-webkit-app-region:\s*drag/g,
      ),
    ].length,
    1,
    "runtime-gated targets must share one drag declaration",
  );
  assert.doesNotMatch(
    earlyCss,
    /\[data-phase="(?:active|hero|settling)"\]:has\(> \[data-conversation-scroll\]\)/,
    "obsolete phase/header drag selectors must be removed",
  );
});

test("interactive layers synchronously revoke the desktop drag gate", () => {
  assert.match(
    desktopSurfaceSource,
    /INTERACTION_LAYER_SELECTOR[\s\S]*aria-modal[\s\S]*role="dialog"[\s\S]*role="listbox"[\s\S]*role="menu"/,
  );
  assert.match(desktopSurfaceSource, /querySelector\(":popover-open"\)/);
  assert.match(desktopSurfaceSource, /appRoot\.inert/);
  assert.match(desktopSurfaceSource, /root\.fullscreenElement/);
  assert.match(
    desktopSurfaceSource,
    /style\.position === "fixed"[\s\S]*style\.pointerEvents !== "none"/,
  );
  assert.match(desktopSurfaceSource, /elementFromPoint/);
  assert.match(
    desktopSurfaceSource,
    /new view\.MutationObserver\(\(\) => \{[\s\S]*hasDeclaredInteractionLayer[\s\S]*suspendDesktopDrag/,
  );
  assert.match(
    desktopSurfaceSource,
    /attributeFilter:\s*\[[\s\S]*"aria-modal"[\s\S]*"inert"[\s\S]*"open"[\s\S]*"style"/,
  );
  assert.match(desktopSurfaceSource, /"beforetoggle"/);
  assert.match(desktopSurfaceSource, /removeAttribute\(\s*DESKTOP_DRAG_ENABLED_ATTRIBUTE/);
  assert.match(
    desktopSurfaceSource,
    /clearDesktopMarkers\(root\)[\s\S]*style\.remove\(\)/,
    "lifecycle cleanup must remove both the gate and its stylesheet",
  );
});

test("the active composer restores its upstream theme surfaces", () => {
  assert.match(earlyCss, /\[data-conversation-composer-overlay\]/);
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-base-surface\]/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-sidebar-fade\]/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-hero-glow\]/,
  );
  assert.doesNotMatch(
    earlyCss,
    /\[data-composer-(?:seat|card)\]/,
    "document-start CSS must not erase the upstream composer materials",
  );
  const activeCard = desktopSurfaceSource.match(
    /\[data-phase="active"\] \[data-composer-card\]\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(activeCard, "the active input card must restore its theme surface");
  assert.match(
    activeCard,
    /background:\s*var\(--dsw-specific-input-major\)\s*!important/,
  );
  assert.doesNotMatch(activeCard, /backdrop-filter|color-mix/);
  assert.doesNotMatch(
    desktopSurfaceSource,
    /conversation\.composer\.dock/,
    "the stats row must inherit the continuous conversation surface",
  );
  assert.doesNotMatch(
    desktopSurfaceSource,
    /composer-material|height:\s*200%|mask-image/,
    "the composer must not inject or emulate a second material tree",
  );
});
