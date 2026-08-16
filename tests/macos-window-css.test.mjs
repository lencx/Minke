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

test("Electron wires theme, locale, shortcuts, and surface capability through preload", () => {
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
    /Object\.freeze\(\{\s*locale,\s*shortcuts,\s*surface,\s*windowTheme\s*\}\)/,
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

test("macOS glass targets only document and shell background surfaces", () => {
  assert.match(earlyCss, /html,\s*body,\s*#root/);
  assert.match(earlyCss, /\[data-shell-overlay\]/);
  assert.match(earlyCss, /\[data-conversation-scroll\]/);
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
  assert.ok(Number(buttonSize[1]) > 0);
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
    /adapter\.setWindowButtonSize\(/,
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
  assert.match(collapsedRule, /margin-top:\s*34px\s*!important/);
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

test("macOS composer action buttons use translucent role-specific fills", () => {
  const addFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-composer-add\]\s*\{[\s\S]*?var\(--dsw-specific-selector\)\s*(\d+)%/,
  );
  const addHoverFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-composer-add\]:hover:not\(:disabled\)\s*\{[\s\S]*?var\(--dsw-alias-interactive-bg-hover-solid\)\s*(\d+)%/,
  );
  const primaryFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-composer-primary\]\s*\{[\s\S]*?var\(--dsw-alias-button-info-fill\)\s*(\d+)%/,
  );
  const primaryHoverFill = desktopSurfaceSource.match(
    /\[data-dsh-desktop-composer-primary\]:hover:not\(:disabled\)\s*\{[\s\S]*?var\(--dsw-alias-button-info-hover\)\s*(\d+)%/,
  );
  assert.match(
    desktopSurfaceSource,
    /setAttribute\("data-dsh-desktop-composer-add"/,
  );
  assert.match(
    desktopSurfaceSource,
    /setAttribute\("data-dsh-desktop-composer-primary"/,
  );
  assert.match(desktopSurfaceSource, /\[data-input-scroll\]/);
  assert.ok(addFill, "the composer add fill must remain explicit");
  assert.ok(addHoverFill, "the composer add hover fill must remain explicit");
  assert.ok(primaryFill, "the composer primary fill must remain explicit");
  assert.ok(
    primaryHoverFill,
    "the composer primary hover fill must remain explicit",
  );
  assert.ok(Number(addFill[1]) > 25 && Number(addFill[1]) < 80);
  assert.ok(Number(addHoverFill[1]) > Number(addFill[1]));
  assert.ok(Number(primaryFill[1]) > Number(addFill[1]));
  assert.ok(Number(primaryFill[1]) < 95);
  assert.ok(Number(primaryHoverFill[1]) > Number(primaryFill[1]));
  assert.ok(Number(primaryHoverFill[1]) <= 95);
  assert.doesNotMatch(
    earlyCss,
    /data-dsh-desktop-composer-/,
    "composer translucency must stay inside the macOS-gated overlay surface",
  );
});

test("the bootstrap exposes a usable top drag strip without claiming controls", () => {
  const dragStrip = earlyCss.match(
    /body::before\s*\{([\s\S]*?)\}/,
  )?.[1];
  const collapsedDragStrip = earlyCss.match(
    /body:has\(\[data-sidebar-collapsed\]\)::before\s*\{([\s\S]*?)\}/,
  )?.[1];
  const sidebarMax = harnessColumnsSource.match(
    /SIDEBAR_MAX\s*=\s*(\d+)/,
  );
  const sidebarCollapsed = harnessColumnsSource.match(
    /SIDEBAR_COLLAPSED\s*=\s*(\d+)/,
  );
  assert.ok(dragStrip, "the top drag strip must remain present");
  assert.ok(collapsedDragStrip, "the collapsed drag strip must remain present");
  assert.ok(sidebarMax, "the maximum sidebar width must remain explicit");
  assert.ok(sidebarCollapsed, "the collapsed sidebar width must remain explicit");
  assert.match(
    dragStrip,
    new RegExp(`inset:\\s*0 0 auto ${sidebarMax[1]}px`),
  );
  assert.match(
    collapsedDragStrip,
    new RegExp(`left:\\s*${sidebarCollapsed[1]}px`),
  );
  assert.match(dragStrip, /height:\s*28px/);
  assert.match(dragStrip, /-webkit-app-region:\s*drag/);
  assert.match(
    earlyCss,
    /button,[\s\S]*\[contenteditable="true"\]\s*\{[\s\S]*-webkit-app-region:\s*no-drag/,
  );
});

test("desktop-only decorative and composer surfaces do not paint white", () => {
  assert.match(earlyCss, /\[data-conversation-composer-overlay\]/);
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-base-surface\]/,
  );
  assert.match(earlyCss, /\[data-composer-seat\]/);
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-sidebar-fade\]/,
  );
  assert.match(
    desktopSurfaceSource,
    /\[data-dsh-desktop-hero-glow\]/,
  );
  assert.match(
    earlyCss,
    /\[data-composer-card\][\s\S]*background-color:\s*transparent[\s\S]*box-shadow:\s*none/,
  );
  assert.match(
    earlyCss,
    /\[data-composer-seat\]\s*\{\s*background:\s*transparent\s*!important;/,
  );
});
