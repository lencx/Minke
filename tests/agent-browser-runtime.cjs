'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { join } = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
} = require('electron');
const { buildSync } = require('esbuild');

const projectRoot = join(__dirname, '..');

function loadAgentBrowserSource() {
  const source = `
    export {
      AgentBrowserRuntime,
    } from "./desktop/main/agent-browser/index.ts";
    export {
      createAgentBrowserRequest,
      parseAgentBrowserProjection,
    } from "./packages/harness-overlay/src/agent-browser-contract.ts";
    export {
      AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
      parseAgentBrowserAnnotationEvent,
    } from "./packages/harness-overlay/src/agent-browser-annotation-contract.ts";
    export {
      defaultChromeUserAgent,
    } from "./packages/harness-overlay/src/browser-settings-contract.ts";
  `;
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
      contents: source,
      loader: 'ts',
      resolveDir: projectRoot,
    },
    target: 'node22',
    write: false,
  }).outputFiles[0].text;
  const filename = join(
    projectRoot,
    '.agent-browser-runtime-smoke.cjs',
  );
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(projectRoot);
  compiled._compile(bundled, filename);
  return compiled.exports;
}

function interceptAnnotationEvents(
  webContents,
  eventChannel,
  parseEvent,
) {
  const events = [];
  const waiters = new Set();
  const ownSendDescriptor = Object.getOwnPropertyDescriptor(
    webContents,
    'send',
  );
  const originalSend = webContents.send;
  let failure;

  Object.defineProperty(webContents, 'send', {
    configurable: true,
    writable: true,
    value(channel, ...args) {
      if (channel === eventChannel) {
        try {
          const event = parseEvent(args[0]);
          events.push(event);
          for (const waiter of [...waiters]) {
            if (!waiter.predicate(event)) continue;
            waiters.delete(waiter);
            clearTimeout(waiter.timeout);
            waiter.resolve(event);
          }
        } catch (error) {
          failure = error;
          for (const waiter of [...waiters]) {
            waiters.delete(waiter);
            clearTimeout(waiter.timeout);
            waiter.reject(error);
          }
        }
      }
      return Reflect.apply(originalSend, this, [channel, ...args]);
    },
  });

  return {
    waitFor(predicate, timeoutMs = 5_000) {
      if (failure !== undefined) return Promise.reject(failure);
      const existing = events.find(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timeout: undefined,
        };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for annotation event'));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    restore() {
      for (const waiter of [...waiters]) {
        waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.reject(
          new Error('Annotation event interception was restored'),
        );
      }
      if (ownSendDescriptor === undefined) {
        delete webContents.send;
      } else {
        Object.defineProperty(
          webContents,
          'send',
          ownSendDescriptor,
        );
      }
    },
  };
}

async function dispatchCdpClick(webContents, point) {
  await webContents.debugger.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    },
  );
  await webContents.debugger.sendCommand(
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
  await webContents.debugger.sendCommand(
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

async function startFixtureServer() {
  const userAgents = [];
  const server = http.createServer((request, response) => {
    userAgents.push(request.headers['user-agent'] ?? '');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`<!doctype html>
      <html>
        <head><title>Agent Browser Runtime</title></head>
        <body>
          <script>window.__minkeButtonClicks = 0;</script>
          <p id="state">Ready</p>
          <button
            type="button"
            aria-label="Continue"
            onclick="
              window.__minkeButtonClicks += 1;
              document.getElementById('state').textContent =
                'Done ' + String(window.__minkeButtonClicks);
            "
          >Continue</button>
        </body>
      </html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return {
    server,
    userAgents,
    url: `http://127.0.0.1:${String(address.port)}/`,
  };
}

async function run() {
  await app.whenReady();
  const {
    AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
    AgentBrowserRuntime,
    createAgentBrowserRequest,
    defaultChromeUserAgent,
    parseAgentBrowserAnnotationEvent,
    parseAgentBrowserProjection,
  } = loadAgentBrowserSource();
  const fixture = await startFixtureServer();
  const runtime = new AgentBrowserRuntime({
    sessionFromPartition(partition, options) {
      return session.fromPartition(partition, options);
    },
    guestAttachTimeoutMs: 5_000,
    cdpCommandTimeoutMs: 5_000,
  });
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });
  const expectedUserAgent = defaultChromeUserAgent(
    window.webContents.getUserAgent(),
  );
  runtime.setUserAgent(expectedUserAgent);
  const annotationEvents = interceptAnnotationEvents(
    window.webContents,
    AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
    parseAgentBrowserAnnotationEvent,
  );
  const projectionBinding = runtime.bindWindowProjection(
    ipcMain,
    window.webContents,
    () => true,
  );
  window.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      const decision = runtime.secureWebview(
        webPreferences,
        params,
      );
      if (decision !== 'secured') event.preventDefault();
    },
  );
  let agentGuest;
  window.webContents.on(
    'did-attach-webview',
    (_event, guest) => {
      if (!runtime.attachGuest(window.webContents, guest)) {
        guest.close({ waitForBeforeUnload: false });
        return;
      }
      agentGuest = guest;
    },
  );

  let requestId = 0;
  const ownerSessionId = 'runtime-smoke-conversation';
  const call = (
    operation,
    payload,
    signal = new AbortController().signal,
  ) => runtime.handleProcessRequest(
    createAgentBrowserRequest(
      ++requestId,
      ownerSessionId,
      operation,
      payload,
    ),
    signal,
  );

  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`<!doctype html>
          <html>
            <head>
              <style>
                html, body { margin: 0; width: 100%; height: 100%; }
                webview { display: flex; width: 100%; height: 100%; }
              </style>
            </head>
            <body></body>
          </html>`),
    );

    const openedPromise = call('open', { url: fixture.url });
    const pending = runtime.projections().at(-1);
    assert.notEqual(pending, undefined);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.partition.startsWith('persist:'), false);
    assert.doesNotMatch(expectedUserAgent, /\bElectron\//u);
    assert.doesNotMatch(expectedUserAgent, /\bMinke\//u);
    await window.webContents.executeJavaScript(`
      (() => {
        const view = document.createElement("webview");
        view.setAttribute("src", "about:blank");
        view.setAttribute(
          "partition",
          ${JSON.stringify(pending.partition)}
        );
        view.setAttribute(
          "webpreferences",
          "contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes"
        );
        document.body.append(view);
      })()
    `);

    const opened = await openedPromise;
    assert.equal(opened.owner, 'agent');
    assert.equal(opened.url, fixture.url);
    assert.notEqual(agentGuest, undefined);
    assert.equal(agentGuest.isDestroyed(), false);
    await call('wait', {
      sessionId: opened.sessionId,
      text: 'Ready',
      timeoutMs: 5_000,
    });
    assert.ok(fixture.userAgents.length > 0);
    assert.equal(fixture.userAgents[0], expectedUserAgent);
    assert.doesNotMatch(fixture.userAgents[0], /\bElectron\//u);
    const snapshot = await call('snapshot', {
      sessionId: opened.sessionId,
    });
    const button = snapshot.nodes.find(
      (node) => node.name === 'Continue',
    );
    assert.notEqual(button, undefined);
    await call('click', {
      sessionId: opened.sessionId,
      ref: button.ref,
    });
    const clickProjection = parseAgentBrowserProjection(
      runtime.projections()[0],
    );
    assert.equal(clickProjection.cursor?.phase, 'clicking');
    assert.ok(clickProjection.cursor.sequence > 0);
    assert.ok(clickProjection.cursor.durationMs > 0);
    assert.ok(clickProjection.cursor.point.x >= 0);
    assert.ok(clickProjection.cursor.point.y >= 0);
    assert.ok(
      clickProjection.cursor.point.x <=
        clickProjection.cursor.viewport.width,
    );
    assert.ok(
      clickProjection.cursor.point.y <=
        clickProjection.cursor.viewport.height,
    );
    await call('wait', {
      sessionId: opened.sessionId,
      text: 'Done',
      timeoutMs: 5_000,
    });
    const screenshot = await call('screenshot', {
      sessionId: opened.sessionId,
    });
    assert.equal(screenshot.mimeType, 'image/png');
    assert.deepEqual(
      [...Buffer.from(screenshot.data, 'base64').subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );

    const human = await runtime.setControl(
      opened.sessionId,
      'human',
    );
    assert.equal(human.owner, 'human');
    assert.equal(human.status, 'paused');
    assert.equal(human.cursor, undefined);
    await assert.rejects(
      call('snapshot', { sessionId: opened.sessionId }),
      (error) => error.code === 'session_paused',
    );

    const annotation = await runtime.startAnnotation(
      opened.sessionId,
    );
    assert.equal(annotation.sessionId, opened.sessionId);
    assert.equal(annotation.generation, human.generation);
    assert.match(
      annotation.annotationSessionId,
      /^annotation-[a-zA-Z0-9]+$/u,
    );
    assert.equal(annotation.page.url, fixture.url);

    const buttonPoint = await agentGuest.executeJavaScript(`
      (() => {
        const button = document.querySelector("button");
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("fixture button is unavailable");
        }
        const rect = button.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()
    `);
    const selectedPromise = annotationEvents.waitFor(
      (event) =>
        event.type === 'selected' &&
        event.sessionId === opened.sessionId &&
        event.annotationSessionId ===
          annotation.annotationSessionId,
    );
    await dispatchCdpClick(agentGuest, buttonPoint);
    const selected = await selectedPromise;
    assert.equal(selected.generation, annotation.generation);
    assert.equal(selected.target.tag, 'button');
    assert.equal(selected.target.role, 'button');
    assert.equal(selected.target.text, 'Continue');
    assert.equal(selected.target.ariaLabel, 'Continue');
    assert.match(selected.target.selector, /button/u);
    assert.match(selected.target.path, /button/u);
    assert.ok(selected.target.rect.width > 0);
    assert.ok(selected.target.rect.height > 0);
    assert.ok(selected.target.viewport.width > 0);
    assert.ok(selected.target.viewport.height > 0);
    assert.equal(
      await agentGuest.executeJavaScript(
        'window.__minkeButtonClicks',
      ),
      1,
    );

    const committed = await runtime.commitAnnotation({
      sessionId: opened.sessionId,
      annotationSessionId: annotation.annotationSessionId,
      targetIds: [selected.target.targetId],
    });
    assert.equal(committed.sessionId, opened.sessionId);
    assert.equal(
      committed.annotationSessionId,
      annotation.annotationSessionId,
    );
    assert.equal(committed.generation, annotation.generation);
    assert.equal(committed.mimeType, 'image/png');
    assert.deepEqual(
      committed.targets.map((target) => target.targetId),
      [selected.target.targetId],
    );
    assert.equal(committed.targets[0].tag, 'button');
    assert.deepEqual(
      [...Buffer.from(committed.data, 'base64').subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );

    const endedPromise = annotationEvents.waitFor(
      (event) =>
        event.type === 'ended' &&
        event.sessionId === opened.sessionId &&
        event.annotationSessionId ===
          annotation.annotationSessionId &&
        event.reason === 'cancelled',
    );
    await runtime.stopAnnotation(
      opened.sessionId,
      annotation.annotationSessionId,
      'cancelled',
    );
    await endedPromise;
    await dispatchCdpClick(agentGuest, buttonPoint);

    const agent = await runtime.setControl(
      opened.sessionId,
      'agent',
    );
    assert.equal(agent.owner, 'agent');
    assert.equal(agent.status, 'ready');
    await call('wait', {
      sessionId: opened.sessionId,
      text: 'Done 2',
      timeoutMs: 5_000,
    });
    assert.deepEqual(
      await call('close', { sessionId: opened.sessionId }),
      { sessionId: opened.sessionId, closed: true },
    );
    assert.equal(runtime.projections().length, 0);
    process.stdout.write(
      'Agent Browser Electron runtime smoke passed\n',
    );
  } finally {
    annotationEvents.restore();
    projectionBinding.dispose();
    runtime.dispose();
    if (!window.isDestroyed()) window.destroy();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

run()
  .catch((error) => {
    process.stderr.write(
      `${String(error?.stack ?? error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
  });
