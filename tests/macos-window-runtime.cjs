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
      .sidebar { width: 280px; padding: 6px 12px; box-sizing: border-box; }
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
        width: 252px;
        height: 38px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 12px;
        background: var(--dsw-alias-button-elevated-fill);
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
        <div class="centerColumn">
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
      </div>
    </div>
    <script>
      globalThis.toggleClicks = 0;
      document.querySelector('.toggle').addEventListener('click', () => {
        globalThis.toggleClicks += 1;
      });
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

  const before = await window.webContents.executeJavaScript(`
    (() => {
      const toggle = document.querySelector('.toggle').getBoundingClientRect();
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
        primaryBackground,
        point: {
          x: Math.round(toggle.x + toggle.width / 2),
          y: Math.round(toggle.y + toggle.height / 2),
        },
      };
    })()
  `);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: before.point.x,
    y: before.point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: before.point.x,
    y: before.point.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const clicks = await window.webContents.executeJavaScript(
    'globalThis.toggleClicks',
  );
  const disposedSurface = await window.webContents.executeJavaScript(`
    (() => {
      globalThis.disposeDesktopSurface();
      return {
        composerMarker: document.querySelector(
          '[data-dsh-desktop-composer-add],'
            + '[data-dsh-desktop-composer-primary]',
        ) !== null,
        marker: document.querySelector(
          '[data-dsh-desktop-new-session]',
        ) !== null,
        style: document.querySelector(
          'style[data-minke-desktop-surface]',
        ) !== null,
      };
    })()
  `);
  const result = {
    addBackground: before.addBackground,
    addBackgroundAlpha: alphaOf(before.addBackground),
    background: before.background,
    backgroundAlpha: alphaOf(before.background),
    disposedSurface,
    initialThemeBeforeDomReady,
    initialThemeSource,
    invalidLocaleError,
    localeMessages,
    messagesAfterAuthoritativeDomChange,
    primaryBackground: before.primaryBackground,
    primaryBackgroundAlpha: alphaOf(before.primaryBackground),
    systemThemeSource,
    surfaceKind,
    themeMessages,
    toggleClicks: clicks,
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
  if (
    !(result.addBackgroundAlpha > 0.25 && result.addBackgroundAlpha < 0.8)
  ) {
    failures.push('composer add background is not visibly translucent');
  }
  if (
    !(
      result.primaryBackgroundAlpha > result.addBackgroundAlpha &&
      result.primaryBackgroundAlpha < 0.95
    )
  ) {
    failures.push('composer primary background lost its translucent emphasis');
  }
  if (result.toggleClicks !== 1) {
    failures.push('sidebar toggle click was intercepted by the drag region');
  }
  if (result.surfaceKind !== 'macos') {
    failures.push('preload did not advertise the native macOS surface');
  }
  if (
    result.disposedSurface.composerMarker ||
    result.disposedSurface.marker ||
    result.disposedSurface.style
  ) {
    failures.push('desktop surface lifecycle did not release markers and styles');
  }
  if (failures.length > 0) throw new Error(failures.join('; '));
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
