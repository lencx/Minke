'use strict';

const { app, BrowserWindow, nativeTheme } = require('electron');
const { buildSync } = require('esbuild');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const projectRoot = join(__dirname, '..');
const windowThemeChannel = 'minke:window-theme';
const windowLocaleChannel = 'minke:window-locale';

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function alphaOf(value) {
  if (value.startsWith('rgb(')) return 1;
  const rgba = value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/u);
  if (rgba) return Number(rgba[1]);
  const color = value.match(/color\([^/]+\/\s*([\d.]+)\s*\)/u);
  return color ? Number(color[1]) : 1;
}

async function run() {
  await app.whenReady();
  if (process.platform !== 'darwin') {
    process.stdout.write('macOS window runtime regression skipped\n');
    app.quit();
    return;
  }

  const earlyCss = readFileSync(
    join(projectRoot, 'resources', 'desktop-style-extension', 'early.css'),
    'utf8',
  );
  const desktopSurfaceBundle = buildSync({
    bundle: true,
    entryPoints: [
      join(
        projectRoot,
        'packages',
        'harness-overlay',
        'src',
        'client',
        'desktop-surface.ts',
      ),
    ],
    format: 'iife',
    globalName: 'MinkeDesktopSurface',
    platform: 'browser',
    target: 'chrome120',
    write: false,
  }).outputFiles[0].text.replaceAll('</script>', '<\\/script>');
  const window = new BrowserWindow({
    x: 420,
    y: 260,
    width: 420,
    height: 220,
    show: true,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(
        projectRoot,
        '.vite',
        'build',
        'desktop-preload.js',
      ),
      sandbox: true,
    },
  });
  const themeMessages = [];
  const localeMessages = [];
  let domReady = false;
  let initialThemeBeforeDomReady;
  window.webContents.once('dom-ready', () => {
    domReady = true;
  });
  window.webContents.ipc.on(windowThemeChannel, (_event, message) => {
    if (initialThemeBeforeDomReady === undefined) {
      initialThemeBeforeDomReady = !domReady;
    }
    themeMessages.push(message);
    nativeTheme.themeSource = message.preference ?? message.colorScheme;
  });
  window.webContents.ipc.on(windowLocaleChannel, (_event, locale) => {
    localeMessages.push(locale);
  });
  const html = `
    <html style="color-scheme: dark">
    <head>
    <style>
      :root {
        --dsw-alias-button-elevated-fill: rgb(255, 255, 255);
        --dsw-alias-button-floating-hover: rgb(244, 246, 248);
        --dsw-alias-button-info-fill: rgb(57, 100, 254);
        --dsw-alias-button-info-hover: rgb(74, 116, 255);
        --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
        --dsw-alias-interactive-bg-hover-solid: rgb(238, 240, 244);
        --dsw-specific-selector: rgb(255, 255, 255);
      }
      html, body { margin: 0; width: 100%; height: 100%; }
      .frame {
        position: relative;
        display: grid;
        grid-template-columns: 120px minmax(0, 1fr) 120px;
        grid-template-rows: 100%;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .sidebarColumn, .centerColumn, .detailsColumn {
        min-width: 0;
      }
      .sidebarColumn, .detailsColumn {
        overflow: hidden;
      }
      .centerColumn {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      [data-shell-overlay] {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
      }
      .detailsHandle {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 300px;
        z-index: 2;
        width: 8px;
        margin-left: -4px;
        cursor: col-resize;
      }
      .sidebar {
        width: 100%;
        padding: 6px 12px;
        box-sizing: border-box;
      }
      .logoRow {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        height: 60px;
        padding: 8px 0 8px 4px;
        box-sizing: border-box;
      }
      .toggle {
        width: 28px;
        height: 28px;
        border: 0;
        background: transparent;
      }
      .newSession {
        width: 100%;
        height: 38px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 12px;
        background: var(--dsw-alias-button-elevated-fill);
      }
      .sessionHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
        height: 75px;
        padding: 0 16px;
      }
      .composerRow, .composerTools, .composerTrailing {
        display: flex;
        align-items: center;
      }
      .composerRow { justify-content: space-between; }
      .composerAdd, .composerPrimary {
        border: 0;
        border-radius: 999px;
      }
      .composerAdd {
        width: 28px;
        height: 28px;
        background: var(--dsw-specific-selector);
      }
      .composerPrimary {
        width: 34px;
        height: 34px;
        background: var(--dsw-alias-button-info-fill);
      }
      ${earlyCss}
    </style>
    <script>${desktopSurfaceBundle}</script>
    </head>
    <body>
    <div id="root">
      <div class="frame">
        <div class="sidebarColumn">
          <div data-slot="sidebar">
            <div class="sidebar">
              <div class="logoRow">
                <button class="toggle" aria-label="Collapse sidebar">Toggle</button>
              </div>
              <button class="newSession" aria-label="New Session">New Session</button>
            </div>
          </div>
        </div>
        <div class="centerColumn" data-phase="active">
          <div data-slot="conversation.session.header">
            <header class="sessionHeader">
              <span class="sessionTitle">Session title</span>
              <button class="sessionAction" aria-label="Session action">
                Action
              </button>
            </header>
          </div>
          <div data-composer-card>
            <div data-input-scroll></div>
            <div class="composerRow">
              <div class="composerTools">
                <button class="composerAdd" aria-label="Commands">+</button>
              </div>
              <div class="composerTrailing">
                <button class="composerPrimary" aria-label="Send message">↑</button>
              </div>
            </div>
          </div>
        </div>
        <div class="detailsColumn">
          <div data-slot="details">
            <div class="details"></div>
          </div>
        </div>
        <div data-shell-overlay></div>
        <div class="detailsHandle" data-side="details"></div>
      </div>
    </div>
    <script>
      globalThis.toggleClicks = 0;
      document.querySelector('.toggle').addEventListener('click', () => {
        globalThis.toggleClicks += 1;
      });
      globalThis.sessionActionClicks = 0;
      document.querySelector('.sessionAction').addEventListener('click', () => {
        globalThis.sessionActionClicks += 1;
      });
      globalThis.detailsHandleMouseDowns = 0;
      document.querySelector('.detailsHandle').addEventListener(
        'mousedown',
        () => {
          globalThis.detailsHandleMouseDowns += 1;
        },
      );
      globalThis.disposeDesktopSurface =
        MinkeDesktopSurface.installDesktopSurface();
    </script>
    </body>
    </html>
  `;
  await window.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  window.focus();
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        "document.querySelector('.newSession')?.hasAttribute('data-dsh-desktop-new-session') === true",
      ),
    "desktop structural markers",
  );
  await waitFor(() => themeMessages.length >= 1, 'initial window theme');
  await window.webContents.executeJavaScript(`
    (() => {
      window.minkeDesktop.locale.publish('zh');
    })()
  `);
  await waitFor(() => localeMessages.length >= 1, 'Harness window locale');
  const invalidLocaleError = await window.webContents.executeJavaScript(`
    (() => {
      try {
        window.minkeDesktop.locale.publish('fr');
        return '';
      } catch (error) {
        return String(error);
      }
    })()
  `);
  const initialThemeSource = nativeTheme.themeSource;
  await window.webContents.executeJavaScript(`
    (() => {
      window.minkeDesktop.windowTheme.publish('system', 'dark');
    })()
  `);
  await waitFor(() => themeMessages.length >= 2, 'system window preference');
  const systemThemeSource = nativeTheme.themeSource;
  await window.webContents.executeJavaScript(`
    (() => {
      document.documentElement.style.colorScheme = 'light';
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const messagesAfterAuthoritativeDomChange = themeMessages.length;
  await window.webContents.executeJavaScript(`
    (() => {
      window.minkeDesktop.windowTheme.publish('system', 'light');
    })()
  `);
  await waitFor(() => themeMessages.length >= 3, 'updated system window theme');
  const updatedSystemThemeSource = nativeTheme.themeSource;
  const surfaceKind = await window.webContents.executeJavaScript(
    'window.minkeDesktop.surface.kind',
  );
  const dialogOpenState = await window.webContents.executeJavaScript(`
    (async () => {
      const appRegion = (selector) =>
        getComputedStyle(document.querySelector(selector))
          .getPropertyValue('-webkit-app-region')
          .trim();
      const snapshot = () => ({
        conversationHeader: appRegion(
          '[data-slot="conversation.session.header"]',
        ),
        sidebarTitlebar: appRegion(
          '[data-dsh-desktop-titlebar-anchor]',
        ),
      });
      const beforeDialog = snapshot();
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5)';
      const dialog = document.createElement('section');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const action = document.createElement('button');
      action.setAttribute('aria-label', 'Modal action');
      action.textContent = 'Modal action';
      const header = document.querySelector(
        '[data-slot="conversation.session.header"]',
      ).getBoundingClientRect();
      action.style.cssText =
        'position:fixed;left:' + (header.left + 16) + 'px;'
          + 'top:' + (header.top + 16) + 'px;width:100px;height:32px';
      globalThis.modalActionClicks = 0;
      action.addEventListener('click', () => {
        globalThis.modalActionClicks += 1;
      });
      dialog.append(action);
      overlay.append(dialog);
      document.body.append(overlay);
      globalThis.dragSafetyOverlay = overlay;
      await Promise.resolve();
      const rect = action.getBoundingClientRect();
      return {
        beforeDialog,
        duringDialog: snapshot(),
        point: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        },
      };
    })()
  `);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: dialogOpenState.point.x,
    y: dialogOpenState.point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: dialogOpenState.point.x,
    y: dialogOpenState.point.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const dialogClosedState = await window.webContents.executeJavaScript(`
    (async () => {
      const snapshot = () => {
        const appRegion = (selector) =>
          getComputedStyle(document.querySelector(selector))
            .getPropertyValue('-webkit-app-region')
            .trim();
        return {
          conversationHeader: appRegion(
            '[data-slot="conversation.session.header"]',
          ),
          sidebarTitlebar: appRegion(
            '[data-dsh-desktop-titlebar-anchor]',
          ),
        };
      };
      const modalActionClicks = globalThis.modalActionClicks;
      globalThis.dragSafetyOverlay.remove();
      delete globalThis.dragSafetyOverlay;
      await Promise.resolve();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { afterDialog: snapshot(), modalActionClicks };
    })()
  `);
  const additionalDragSafety = await window.webContents.executeJavaScript(`
    (async () => {
      const appRegion = (selector) =>
        getComputedStyle(document.querySelector(selector))
          .getPropertyValue('-webkit-app-region')
          .trim();
      const snapshot = () => ({
        conversationHeader: appRegion(
          '[data-slot="conversation.session.header"]',
        ),
        sidebarTitlebar: appRegion(
          '[data-dsh-desktop-titlebar-anchor]',
        ),
      });
      const nextFrame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));

      const fixedPortal = document.createElement('div');
      fixedPortal.style.cssText =
        'position:fixed;inset:0;z-index:900;background:transparent';
      document.body.append(fixedPortal);
      await Promise.resolve();
      const duringFixedPortal = snapshot();
      fixedPortal.remove();
      await Promise.resolve();
      await nextFrame();
      const afterFixedPortal = snapshot();

      const hiddenDialog = document.createElement('section');
      hiddenDialog.setAttribute('role', 'dialog');
      hiddenDialog.hidden = true;
      document.body.append(hiddenDialog);
      await Promise.resolve();
      await nextFrame();
      const whileDialogHidden = snapshot();
      hiddenDialog.hidden = false;
      await Promise.resolve();
      const afterDialogShown = snapshot();
      hiddenDialog.hidden = true;
      await Promise.resolve();
      await nextFrame();
      const afterDialogHiddenAgain = snapshot();
      hiddenDialog.remove();

      const popover = document.createElement('div');
      popover.setAttribute('popover', 'manual');
      document.body.append(popover);
      await Promise.resolve();
      await nextFrame();
      const beforePopover = snapshot();
      popover.showPopover();
      const duringPopover = snapshot();
      popover.hidePopover();
      await nextFrame();
      const afterPopover = snapshot();
      popover.remove();

      const inertRoot = document.getElementById('root');
      inertRoot.inert = true;
      await Promise.resolve();
      const duringInertRoot = snapshot();
      inertRoot.inert = false;
      await Promise.resolve();
      await nextFrame();
      const afterInertRoot = snapshot();

      const occludingBanner = document.createElement('div');
      occludingBanner.style.cssText =
        'position:fixed;inset:0 0 auto;height:40px;z-index:500';
      inertRoot.append(occludingBanner);
      await Promise.resolve();
      await nextFrame();
      const duringOcclusion = snapshot();
      occludingBanner.remove();
      await Promise.resolve();
      await nextFrame();
      const afterOcclusion = snapshot();

      return {
        afterDialogHiddenAgain,
        afterDialogShown,
        afterFixedPortal,
        afterInertRoot,
        afterOcclusion,
        afterPopover,
        beforePopover,
        duringFixedPortal,
        duringInertRoot,
        duringOcclusion,
        duringPopover,
        whileDialogHidden,
      };
    })()
  `);
  const dragSafety = {
    ...dialogOpenState,
    ...dialogClosedState,
    ...additionalDragSafety,
  };

  const before = await window.webContents.executeJavaScript(`
    (() => {
      const toggle = document.querySelector('.toggle').getBoundingClientRect();
      const sessionAction =
        document.querySelector('.sessionAction').getBoundingClientRect();
      const detailsHandle =
        document.querySelector('.detailsHandle').getBoundingClientRect();
      const sessionTitle = document.querySelector('.sessionTitle');
      const sessionTitleStyle = getComputedStyle(sessionTitle);
      const detailsHandleStyle = getComputedStyle(
        document.querySelector('.detailsHandle'),
      );
      const range = document.createRange();
      range.selectNodeContents(sessionTitle);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedSessionTitle = selection.toString();
      selection.removeAllRanges();
      const background = getComputedStyle(
        document.querySelector('.newSession'),
      ).backgroundColor;
      const addBackground = getComputedStyle(
        document.querySelector('.composerAdd'),
      ).backgroundColor;
      const primaryBackground = getComputedStyle(
        document.querySelector('.composerPrimary'),
      ).backgroundColor;
      return {
        addBackground,
        background,
        composerMarker: document.querySelector(
          '[data-dsh-desktop-composer-add],'
            + '[data-dsh-desktop-composer-primary]',
        ) !== null,
        detailsHandleAppRegion: detailsHandleStyle
          .getPropertyValue('-webkit-app-region')
          .trim(),
        detailsHandleMarker: document.querySelector(
          '.detailsHandle[data-dsh-desktop-resize-handle]',
        ) !== null,
        detailsHandlePoint: {
          x: Math.round(detailsHandle.x + 2),
          y: 32,
        },
        primaryBackground,
        selectedSessionTitle,
        sessionActionPoint: {
          x: Math.round(sessionAction.x + sessionAction.width / 2),
          y: Math.round(sessionAction.y + sessionAction.height / 2),
        },
        sessionTitleAppRegion: sessionTitleStyle
          .getPropertyValue('-webkit-app-region')
          .trim(),
        sessionTitleUserSelect: sessionTitleStyle.userSelect,
        togglePoint: {
          x: Math.round(toggle.x + toggle.width / 2),
          y: Math.round(toggle.y + toggle.height / 2),
        },
      };
    })()
  `);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: before.togglePoint.x,
    y: before.togglePoint.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: before.togglePoint.x,
    y: before.togglePoint.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: before.sessionActionPoint.x,
    y: before.sessionActionPoint.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: before.sessionActionPoint.x,
    y: before.sessionActionPoint.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: before.detailsHandlePoint.x,
    y: before.detailsHandlePoint.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: before.detailsHandlePoint.x,
    y: before.detailsHandlePoint.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const clicks = await window.webContents.executeJavaScript(`({
    detailsHandle: globalThis.detailsHandleMouseDowns,
    sessionAction: globalThis.sessionActionClicks,
    toggle: globalThis.toggleClicks,
  })`);
  const disposedSurface = await window.webContents.executeJavaScript(`
    (() => {
      globalThis.disposeDesktopSurface();
      return {
        conversationHeaderRegion: getComputedStyle(
          document.querySelector(
            '[data-slot="conversation.session.header"]',
          ),
        ).getPropertyValue('-webkit-app-region').trim(),
        dragEnabled: document.documentElement.hasAttribute(
          'data-dsh-desktop-drag-enabled',
        ),
        marker: document.querySelector(
          '[data-dsh-desktop-new-session]',
        ) !== null,
        resizeHandleMarker: document.querySelector(
          '[data-dsh-desktop-resize-handle]',
        ) !== null,
        style: document.querySelector(
          'style[data-minke-desktop-surface]',
        ) !== null,
      };
    })()
  `);
  const result = {
    addBackground: before.addBackground,
    background: before.background,
    backgroundAlpha: alphaOf(before.background),
    composerMarker: before.composerMarker,
    detailsHandleAppRegion: before.detailsHandleAppRegion,
    detailsHandleMarker: before.detailsHandleMarker,
    detailsHandleMouseDowns: clicks.detailsHandle,
    disposedSurface,
    dragSafety,
    initialThemeBeforeDomReady,
    initialThemeSource,
    invalidLocaleError,
    localeMessages,
    messagesAfterAuthoritativeDomChange,
    primaryBackground: before.primaryBackground,
    selectedSessionTitle: before.selectedSessionTitle,
    sessionActionClicks: clicks.sessionAction,
    sessionTitleAppRegion: before.sessionTitleAppRegion,
    sessionTitleUserSelect: before.sessionTitleUserSelect,
    systemThemeSource,
    surfaceKind,
    themeMessages,
    toggleClicks: clicks.toggle,
    updatedSystemThemeSource,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  window.destroy();
  nativeTheme.themeSource = 'system';
  app.quit();

  const failures = [];
  if (result.initialThemeBeforeDomReady !== true) {
    failures.push('initial theme did not reach the native window before DOM ready');
  }
  if (
    JSON.stringify(result.themeMessages) !==
    JSON.stringify([
      { colorScheme: 'dark' },
      { preference: 'system', colorScheme: 'dark' },
      { preference: 'system', colorScheme: 'light' },
    ])
  ) {
    failures.push('theme preload did not publish the expected state sequence');
  }
  if (JSON.stringify(result.localeMessages) !== JSON.stringify(['zh'])) {
    failures.push('locale preload did not publish the Harness locale');
  }
  if (!result.invalidLocaleError.includes('invalid Harness locale snapshot')) {
    failures.push('locale preload accepted an unsupported locale');
  }
  if (result.messagesAfterAuthoritativeDomChange !== 2) {
    failures.push('DOM observer overrode the authoritative Harness theme');
  }
  if (
    result.initialThemeSource !== 'dark' ||
    result.systemThemeSource !== 'system' ||
    result.updatedSystemThemeSource !== 'system'
  ) {
    failures.push('nativeTheme did not preserve the Harness system preference');
  }
  if (!(result.backgroundAlpha > 0 && result.backgroundAlpha < 0.8)) {
    failures.push('New Session background is not visibly translucent');
  }
  if (result.composerMarker) {
    failures.push('desktop surface marked a Harness-owned composer action');
  }
  if (result.addBackground !== 'rgb(255, 255, 255)') {
    failures.push('desktop surface changed the Harness composer add background');
  }
  if (result.primaryBackground !== 'rgb(57, 100, 254)') {
    failures.push('desktop surface changed the Harness composer primary background');
  }
  if (result.toggleClicks !== 1) {
    failures.push('sidebar toggle click was intercepted by the drag region');
  }
  if (result.sessionActionClicks !== 1) {
    failures.push('conversation header action was intercepted by the drag region');
  }
  if (
    !result.detailsHandleMarker ||
    result.detailsHandleAppRegion !== 'no-drag' ||
    result.detailsHandleMouseDowns !== 1
  ) {
    failures.push('details resize handle was intercepted by the drag region');
  }
  if (
    result.sessionTitleAppRegion !== 'no-drag' ||
    result.sessionTitleUserSelect !== 'text' ||
    result.selectedSessionTitle !== 'Session title'
  ) {
    failures.push('conversation header text is not safely selectable');
  }
  if (
    result.dragSafety.beforeDialog.conversationHeader !== 'drag' ||
    result.dragSafety.beforeDialog.sidebarTitlebar !== 'drag'
  ) {
    failures.push('desktop drag regions were not enabled before the dialog');
  }
  if (
    result.dragSafety.duringDialog.conversationHeader !== 'no-drag' ||
    result.dragSafety.duringDialog.sidebarTitlebar !== 'no-drag'
  ) {
    failures.push('dialog did not synchronously suspend desktop drag regions');
  }
  if (result.dragSafety.modalActionClicks !== 1) {
    failures.push('dialog action was intercepted by a stale drag region');
  }
  if (
    result.dragSafety.afterDialog.conversationHeader !== 'drag' ||
    result.dragSafety.afterDialog.sidebarTitlebar !== 'drag'
  ) {
    failures.push('desktop drag regions did not recover after the dialog closed');
  }
  for (const [label, state] of Object.entries({
    'fixed portal': result.dragSafety.duringFixedPortal,
    'dialog attribute activation': result.dragSafety.afterDialogShown,
    'inert application root': result.dragSafety.duringInertRoot,
    'fixed occlusion': result.dragSafety.duringOcclusion,
    'native popover': result.dragSafety.duringPopover,
  })) {
    if (
      state.conversationHeader !== 'no-drag' ||
      state.sidebarTitlebar !== 'no-drag'
    ) {
      failures.push(`${label} did not suspend desktop drag regions`);
    }
  }
  for (const [label, state] of Object.entries({
    'closed native popover': result.dragSafety.beforePopover,
    'fixed portal removal': result.dragSafety.afterFixedPortal,
    'hidden dialog': result.dragSafety.whileDialogHidden,
    'dialog re-hide': result.dragSafety.afterDialogHiddenAgain,
    'inert root release': result.dragSafety.afterInertRoot,
    'fixed occlusion removal': result.dragSafety.afterOcclusion,
    'native popover close': result.dragSafety.afterPopover,
  })) {
    if (
      state.conversationHeader !== 'drag' ||
      state.sidebarTitlebar !== 'drag'
    ) {
      failures.push(`${label} did not leave desktop drag regions usable`);
    }
  }
  if (result.surfaceKind !== 'macos') {
    failures.push('preload did not advertise the native macOS surface');
  }
  if (
    result.disposedSurface.dragEnabled ||
    result.disposedSurface.marker ||
    result.disposedSurface.resizeHandleMarker ||
    result.disposedSurface.style
  ) {
    failures.push('desktop surface lifecycle did not release markers and styles');
  }
  if (result.disposedSurface.conversationHeaderRegion !== 'no-drag') {
    failures.push('desktop surface disposal did not restore the fail-safe no-drag state');
  }
  if (failures.length > 0) throw new Error(failures.join('; '));
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
