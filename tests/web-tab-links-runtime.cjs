'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  ipcMain,
} = require('electron');
const { buildSync } = require('esbuild');

const projectRoot = join(__dirname, '..');

function loadTabSources() {
  const bundled = buildSync({
    alias: {
      '@minke/harness-overlay': join(
        projectRoot,
        'packages',
        'harness-overlay',
        'src',
      ),
    },
    bundle: true,
    external: ['electron'],
    format: 'cjs',
    platform: 'node',
    stdin: {
      contents: `
        export {
          openUserGestureTabLinkExternally,
          protectTabWebviewGuest,
          secureTabWebview,
        } from "./desktop/main/tabs/security.ts";
        export {
          TABS_WEB_EXTERNAL_LINK_CHANNEL,
          TABS_WEB_LOCAL_PATH_CHANNEL,
        } from "./packages/harness-overlay/src/tabs/web-link-contract.ts";
      `,
      loader: 'ts',
      resolveDir: projectRoot,
    },
    target: 'node22',
    write: false,
  }).outputFiles[0].text;
  const filename = join(projectRoot, '.web-tab-links-runtime.cjs');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(projectRoot);
  compiled._compile(bundled, filename);
  return compiled.exports;
}

async function startFixtureServer(localFileUrl) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    });
    if (request.url !== '/launcher') {
      response.end(`<!doctype html><title>${request.url}</title>`);
      return;
    }
    response.end(`<!doctype html>
      <style>
        a { display: block; font-size: 24px; margin: 12px; }
      </style>
      <a id="blank-http" href="/viewer" target="_blank">Viewer</a>
      <a id="local-file" href="${localFileUrl}">Local file</a>
      <a
        id="custom"
        href="vscode://file/workspace/main.ts"
        target="_blank"
      >Editor</a>
      <a id="same-frame" href="/same-frame">Same frame</a>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const origin = `http://127.0.0.1:${String(address.port)}`;
  return {
    close: () =>
      new Promise((resolve) => server.close(resolve)),
    launcherUrl: `${origin}/launcher`,
    programmaticUrl: `${origin}/programmatic`,
    sameFrameUrl: `${origin}/same-frame`,
    viewerUrl: `${origin}/viewer`,
  };
}

function waitForGuest(window) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Web Tab guest'));
    }, 5_000);
    window.webContents.once(
      'did-attach-webview',
      (_event, guest) => {
        clearTimeout(timeout);
        resolve(guest);
      },
    );
  });
}

function waitForLoad(guest) {
  if (!guest.isLoading()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Web Tab load'));
    }, 5_000);
    guest.once('did-finish-load', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitFor(check, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function click(guest, selector) {
  const point = await guest.executeJavaScript(`
    (() => {
      const rect = document.querySelector(
        ${JSON.stringify(selector)}
      ).getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()
  `);
  await guest.debugger.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
  );
  await guest.debugger.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
  );
}

async function run() {
  await app.whenReady();
  const {
    openUserGestureTabLinkExternally,
    protectTabWebviewGuest,
    secureTabWebview,
    TABS_WEB_EXTERNAL_LINK_CHANNEL,
    TABS_WEB_LOCAL_PATH_CHANNEL,
  } = loadTabSources();
  const localPath = join(
    tmpdir(),
    'minke-webview-viewer.html',
  );
  const fixture = await startFixtureServer(
    pathToFileURL(localPath).toString(),
  );
  const preload = join(
    projectRoot,
    '.vite',
    'build',
    'tabs-web-preload.js',
  );
  const externallyOpened = [];
  const guestExternalRequests = [];
  const allGuestExternalRequests = [];
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });
  let attachedGuest;
  const handleGuestExternal = (event, candidate) => {
    allGuestExternalRequests.push({
      candidate,
      senderId: event.sender.id,
    });
    if (event.sender !== attachedGuest) return;
    guestExternalRequests.push(candidate);
    openUserGestureTabLinkExternally(
      {
        openExternal(url) {
          externallyOpened.push(url);
          return Promise.resolve();
        },
      },
      candidate,
    );
  };
  ipcMain.on(
    TABS_WEB_EXTERNAL_LINK_CHANNEL,
    handleGuestExternal,
  );
  window.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      if (!secureTabWebview(webPreferences, params, preload)) {
        event.preventDefault();
      }
    },
  );
  const guestPromise = waitForGuest(window);
  window.webContents.on(
    'did-attach-webview',
    (_event, guest) => {
      attachedGuest = guest;
      protectTabWebviewGuest(guest, {
        openExternal(url) {
          externallyOpened.push(url);
          return Promise.resolve();
        },
      });
    },
  );

  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`<!doctype html>
          <script>
            window.__guestMessages = [];
            addEventListener('DOMContentLoaded', () => {
              document.querySelector('webview').addEventListener(
                'ipc-message',
                (event) => {
                  window.__guestMessages.push({
                    channel: event.channel,
                    args: event.args,
                  });
                },
              );
            });
          </script>
          <webview
            allowpopups
            src="${fixture.launcherUrl}"
            style="display:flex;width:800px;height:600px"
          ></webview>`),
    );
    const guest = await guestPromise;
    await waitForLoad(guest);
    await guest.debugger.attach('1.3');

    await guest.executeJavaScript(`
      window.__trustedClicks = [];
      addEventListener('click', (event) => {
        window.__trustedClicks.push({
          id: event.target?.id,
          trusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
        });
      }, true);
    `);
    await click(guest, '#blank-http');
    try {
      await waitFor(
        () =>
          guestExternalRequests.includes(fixture.viewerUrl)
            ? true
            : undefined,
        'trusted target=_blank link',
      );
    } catch (error) {
      const trustedClicks = await guest.executeJavaScript(
        'window.__trustedClicks',
      );
      throw new Error(
        `${error.message}; clicks=${JSON.stringify(trustedClicks)}; ` +
          `allIpc=${JSON.stringify(allGuestExternalRequests)}; ` +
          `attached=${String(attachedGuest?.id)} guest=${String(guest.id)}`,
      );
    }

    await click(guest, '#local-file');
    const localMessage = await waitFor(
      async () => {
        const messages = await window.webContents.executeJavaScript(
          'window.__guestMessages',
        );
        return messages.find(
          (message) =>
            message.channel === TABS_WEB_LOCAL_PATH_CHANNEL,
        );
      },
      'local file link message',
    );
    assert.deepEqual(localMessage.args, [{
      path: localPath,
      title: 'Local file',
    }]);

    await guest.executeJavaScript(
      `document.querySelector('#custom').click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      guestExternalRequests.includes(
        'vscode://file/workspace/main.ts',
      ),
      false,
    );
    await click(guest, '#custom');
    await waitFor(
      () =>
        guestExternalRequests.includes(
          'vscode://file/workspace/main.ts',
        )
          ? true
          : undefined,
      'trusted custom-protocol link',
    );

    await guest.executeJavaScript(
      `window.open('/programmatic', '_blank')`,
    );
    await waitFor(
      () =>
        externallyOpened.includes(fixture.programmaticUrl)
          ? true
          : undefined,
      'programmatic window.open handler',
    );

    await click(guest, '#same-frame');
    await waitFor(
      () =>
        guest.getURL() === fixture.sameFrameUrl
          ? true
          : undefined,
      'same-frame navigation',
    );

    assert.deepEqual(externallyOpened, [
      fixture.viewerUrl,
      'vscode://file/workspace/main.ts',
      fixture.programmaticUrl,
    ]);
    process.stdout.write(
      'Web Tab Electron link runtime passed\n',
    );
  } finally {
    ipcMain.removeListener(
      TABS_WEB_EXTERNAL_LINK_CHANNEL,
      handleGuestExternal,
    );
    if (
      attachedGuest !== undefined &&
      !attachedGuest.isDestroyed() &&
      attachedGuest.debugger.isAttached()
    ) {
      attachedGuest.debugger.detach();
    }
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (!candidate.isDestroyed()) candidate.destroy();
    }
    await fixture.close();
  }
}

run()
  .catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
  });
