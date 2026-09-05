'use strict';

const assert = require('node:assert/strict');
const { rmSync } = require('node:fs');
const {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} = require('node:fs/promises');
const http = require('node:http');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const {
  basename,
  dirname,
  join,
  parse,
  resolve,
} = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  webContents,
} = require('electron');
const { buildSync } = require('esbuild');

const projectRoot = join(__dirname, '..');
const runtimeRoot = join(projectRoot, 'runtime', 'host');
const preloadPath = join(
  projectRoot,
  '.vite',
  'build',
  'desktop-preload.js',
);
const BOOTSTRAP_PROMPT = 'Minke composer bootstrap e2e';
const OPEN_PROMPT = 'Minke browser open e2e';
const CLOSE_PROMPT = 'Minke browser close e2e';
const BOOTSTRAP_MARKER = 'MINKE_COMPOSER_READY';
const OPENED_MARKER = 'MINKE_BROWSER_OPENED_AND_CLICKED';
const CLOSED_MARKER = 'MINKE_BROWSER_CLOSED';
const TEMP_ROOT_ENV = 'MINKE_AGENT_BROWSER_E2E_ROOT';
const TEMP_ROOT_PREFIX = 'minke-agent-browser-conversation-';
const SCREENSHOT_ENV = 'MINKE_AGENT_BROWSER_E2E_SCREENSHOT';
const FOCUSED_SCREENSHOT_ENV =
  'MINKE_AGENT_BROWSER_E2E_FOCUSED_SCREENSHOT';

// Keep failure cleanup alive after destroying the one test window. The normal
// Electron default would otherwise terminate before temp files are reaped and
// before the rejected run promise can set the process exit code.
app.on('window-all-closed', () => {});

function trace(message) {
  process.stdout.write(`[agent-browser-e2e] ${message}\n`);
}

function loadDesktopSource() {
  const source = `
    export {
      AgentBrowserRuntime,
      SqliteAgentBrowserHistory,
    } from "./desktop/main/agent-browser/index.ts";
    export {
      HarnessRuntime,
    } from "./desktop/main/harness-runtime.ts";
    export {
      bindTabs,
    } from "./desktop/main/tabs/index.ts";
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
    '.agent-browser-conversation-runtime.cjs',
  );
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(projectRoot);
  compiled._compile(bundled, filename);
  return compiled.exports;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${String(address.port)}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function startBrowserFixture() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`<!doctype html>
      <html>
        <head><title>Minke Agent Browser E2E</title></head>
        <body>
          <p id="state">Ready</p>
          <label>
            Human note
            <input id="human-note" aria-label="Human note" />
          </label>
          <button
            type="button"
            aria-label="Continue"
            onclick="document.getElementById('state').textContent = 'Done'"
          >Continue</button>
        </body>
      </html>`);
  });
  const baseUrl = await listen(server);
  return {
    server,
    url: `${baseUrl}/`,
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => contentText(entry)).join('\n');
  }
  if (value === null || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return contentText(value.content);
  return '';
}

function messagesOf(body) {
  return Array.isArray(body?.messages) ? body.messages : [];
}

function lastMessageText(body, role) {
  const messages = messagesOf(body);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return contentText(message.content);
  }
  return '';
}

function allMessageText(body, role) {
  return messagesOf(body)
    .filter((message) => message?.role === role)
    .map((message) => contentText(message.content))
    .join('\n');
}

function allToolResultText(body) {
  return messagesOf(body)
    .filter((message) => message?.role === 'tool')
    .map((message) => contentText(message.content))
    .join('\n');
}

function toolNames(body) {
  if (!Array.isArray(body?.tools)) return [];
  return body.tools.flatMap((entry) => {
    const name = entry?.function?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

function continueRefFrom(text) {
  const match = /\[([a-zA-Z0-9][a-zA-Z0-9._:-]*)\]\s+button\s+"Continue"/u
    .exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`model fixture could not recover Continue ref:\n${text}`);
  }
  return match[1];
}

function openSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  response.flushHeaders();
}

function writeSse(response, value) {
  response.write(
    `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`,
  );
}

function terminalChunk(reason, outputTokens) {
  return {
    choices: [{
      index: 0,
      delta: { content: '' },
      finish_reason: reason,
    }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: outputTokens,
    },
  };
}

function sendText(response, text) {
  openSse(response);
  writeSse(response, {
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: null },
      finish_reason: null,
    }],
  });
  writeSse(response, {
    choices: [{
      index: 0,
      delta: { content: text },
      finish_reason: null,
    }],
  });
  writeSse(response, terminalChunk('stop', text.length));
  writeSse(response, '[DONE]');
  response.end();
}

function sendToolCall(response, callId, name, args) {
  const serialized = JSON.stringify(args);
  const midpoint = Math.max(1, Math.floor(serialized.length / 2));
  openSse(response);
  writeSse(response, {
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: serialized.slice(0, midpoint),
          },
        }],
      },
      finish_reason: null,
    }],
  });
  writeSse(response, {
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          function: {
            arguments: serialized.slice(midpoint),
          },
        }],
      },
      finish_reason: null,
    }],
  });
  writeSse(response, terminalChunk('tool_calls', 2));
  writeSse(response, '[DONE]');
  response.end();
}

async function startDynamicModelServer(browserUrl) {
  const requests = [];
  const requestHeaders = [];
  const issuedTools = [];
  let nextCallId = 0;
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (
        request.method !== 'POST' ||
        !url.pathname.endsWith('/chat/completions')
      ) {
        response.writeHead(404).end('not found');
        return;
      }
      const body = await readJson(request);
      requests.push(body);
      requestHeaders.push({ ...request.headers });
      const availableTools = toolNames(body);
      const userText = allMessageText(body, 'user');
      const latestTool = lastMessageText(body, 'tool');
      const toolHistory = allToolResultText(body);
      trace(
        `model request: tools=${String(availableTools.length)} ` +
          `user=${JSON.stringify(userText.slice(0, 80))} ` +
          `lastTool=${JSON.stringify(latestTool.slice(0, 80))}`,
      );
      const call = (name, args) => {
        issuedTools.push(name);
        nextCallId += 1;
        sendToolCall(
          response,
          `minke-e2e-call-${String(nextCallId)}`,
          name,
          args,
        );
      };

      // The Harness keeps prior user turns in context, so the close prompt
      // request also contains OPEN_PROMPT. Resolve the newest workflow first.
      if (
        userText.includes(CLOSE_PROMPT) &&
        availableTools.includes('browser_close')
      ) {
        if (latestTool.includes('Closed browser session')) {
          sendText(response, CLOSED_MARKER);
          return;
        }
        call('browser_close', {});
        return;
      }

      if (
        userText.includes(OPEN_PROMPT) &&
        availableTools.includes('browser_open')
      ) {
        if (latestTool.includes('Observed requested text')) {
          sendText(response, OPENED_MARKER);
          return;
        }
        if (latestTool.includes('Clicked in browser session')) {
          call('browser_wait', {
            text: 'Done',
            timeout_ms: 5_000,
          });
          return;
        }
        if (latestTool.includes('Captured snapshot')) {
          call('browser_click', {
            target: {
              ref: continueRefFrom(latestTool),
            },
          });
          return;
        }
        if (latestTool.includes('Opened browser session')) {
          call('browser_snapshot', {});
          return;
        }
        call('browser_open', { url: browserUrl });
        return;
      }

      if (
        userText.includes(BOOTSTRAP_PROMPT) &&
        availableTools.length > 0
      ) {
        sendText(response, BOOTSTRAP_MARKER);
        return;
      }

      sendText(response, 'Minke Agent Browser E2E');
    })().catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, {
          'content-type': 'application/json',
        });
      }
      response.end(JSON.stringify({
        error: {
          message: String(error?.stack ?? error),
          type: 'minke_e2e_error',
          code: 'minke_e2e_error',
        },
      }));
    });
  });
  const baseUrl = await listen(server);
  return {
    baseUrl,
    issuedTools,
    requestHeaders,
    requests,
    server,
  };
}

let nextRpcId = 0;
async function rpc(
  baseUrl,
  method,
  payload,
  cookie,
  parameterName = 'request',
) {
  nextRpcId += 1;
  const headers = {
    'content-type': 'application/json',
    ...(cookie === undefined ? {} : { cookie }),
  };
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `minke-agent-browser-${String(nextRpcId)}`,
      method,
      payload: { args: { [parameterName]: payload } },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `${method} failed over HTTP ${String(response.status)}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  if (body?.result?.ok !== true) {
    throw new Error(
      `${method} failed: ${String(body?.result?.error?.code)}: ` +
        String(body?.result?.error?.message),
    );
  }
  return body.result.value;
}

async function waitFor(read, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`,
  );
}

async function waitForAssistantMarker(
  baseUrl,
  sessionId,
  marker,
  cookie,
) {
  return await waitFor(
    async () => {
      const sessions = await rpc(
        baseUrl,
        'session/list',
        {},
        cookie,
        '_request',
      );
      const summary = sessions.items.find(
        (item) => item.sessionId === sessionId,
      );
      if (summary === undefined) return undefined;
      const history = await rpc(baseUrl, 'session/page', {
        address: {
          kind: 'session',
          sessionId,
        },
        throughSeq: summary.projections?.asOfSeq ?? -1,
        maxMessages: 50,
      }, cookie);
      return JSON.stringify(history).includes(marker) ? history : undefined;
    },
    `assistant marker ${marker}`,
    45_000,
  );
}

async function rendererValue(window, source) {
  return await window.webContents.executeJavaScript(
    `Promise.resolve((${source})())`,
    true,
  );
}

async function readAgentBrowserLayout(window) {
  return await rendererValue(
    window,
    `() => {
      const selectors = {
        panel: ".minke-tabs-panel:has(.minke-agent-browser__view)",
        chrome:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tabs-chrome",
        tabbar:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tabs-tabbar",
        toolbar:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tabs-toolbar",
        content:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tabs-content",
        view: ".minke-agent-browser__view",
        guest: ".minke-agent-browser__guest",
        activeTab:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tab[data-active]",
        activeTabClose:
          ".minke-tabs-panel:has(.minke-agent-browser__view) " +
          ".minke-tab[data-active] .minke-tab__close",
        layoutActions: "[data-minke-tabs-layout-actions]",
      };
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          throw new Error("Missing layout element: " + selector);
        }
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          bottom: bounds.bottom,
        };
      };
      const view = document.querySelector(selectors.view);
      if (!(view instanceof HTMLElement)) {
        throw new Error("Agent Browser view is missing");
      }
      return {
        rects: Object.fromEntries(
          Object.entries(selectors).map(([name, selector]) => [
            name,
            rect(selector),
          ])
        ),
        viewChildren: [...view.children].map((child) => ({
          tag: child.tagName.toLowerCase(),
          className:
            child instanceof HTMLElement ? child.className : "",
        })),
      };
    }`,
  );
}

function assertAgentBrowserLayout(before, after) {
  const stableNames = [
    'panel',
    'chrome',
    'tabbar',
    'toolbar',
    'content',
    'view',
    'guest',
    'activeTab',
    'activeTabClose',
    'layoutActions',
  ];
  for (const name of stableNames) {
    const earlier = before.rects[name];
    const later = after.rects[name];
    for (const field of [
      'x',
      'y',
      'width',
      'height',
      'right',
      'bottom',
    ]) {
      assert.ok(
        Math.abs(earlier[field] - later[field]) <= 1,
        `${name}.${field} moved after browser takeover: ` +
          `${String(earlier[field])} -> ${String(later[field])}`,
      );
    }
  }
  assert.ok(
    before.rects.chrome.bottom <= before.rects.content.y + 1,
    'Agent Browser content must begin below its chrome',
  );
  assert.ok(
    after.rects.chrome.bottom <= after.rects.content.y + 1,
    'human takeover must not move content over the chrome',
  );
  assert.ok(
    before.rects.activeTab.right <=
      before.rects.layoutActions.x + 1,
    'the active tab must not overlap global placement controls',
  );
  assert.ok(
    after.rects.activeTab.right <=
      after.rects.layoutActions.x + 1,
    'human takeover must not move the active tab under placement controls',
  );
  assert.equal(
    before.viewChildren.some(({ tag }) => tag === 'webview'),
    true,
  );
  assert.equal(
    after.viewChildren.some(({ tag }) => tag === 'webview'),
    true,
  );
}

async function readAgentBrowserPreload(window) {
  return await rendererValue(
    window,
    `async () => {
      const bridge = window.minkeDesktop?.agentBrowser;
      if (typeof bridge?.read !== "function") {
        throw new Error("Agent Browser preload bridge is missing");
      }
      return await bridge.read();
    }`,
  );
}

async function readAgentBrowserHistoryPreload(window) {
  return await rendererValue(
    window,
    `async () => {
      const bridge = window.minkeDesktop?.agentBrowser;
      if (typeof bridge?.readHistory !== "function") {
        throw new Error("Agent Browser history preload bridge is missing");
      }
      return await bridge.readHistory({ limit: 10 });
    }`,
  );
}

async function selectConversation(window, title) {
  await waitFor(
    () => rendererValue(
      window,
      `() => {
        const title = ${JSON.stringify(title)};
        const row = [...document.querySelectorAll('[role="treeitem"]')]
          .find((candidate) => candidate.textContent?.includes(title));
        if (!(row instanceof HTMLElement)) return undefined;
        row.click();
        return true;
      }`,
    ),
    `the ${title} conversation row`,
  );
  await waitFor(
    () => rendererValue(
      window,
      `() => {
        const input = document.querySelector(
          '[data-composer-input][contenteditable="true"]'
        );
        return input instanceof HTMLElement
          ? true
          : undefined;
      }`,
    ),
    'an editable Harness composer',
  );
}

async function promptThroughComposer(window, prompt) {
  await rendererValue(
    window,
    `() => {
      const input = document.querySelector(
        '[data-composer-input][contenteditable="true"]'
      );
      if (!(input instanceof HTMLElement)) {
        throw new Error("Editable Harness composer is missing");
      }
      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    }`,
  );
  await window.webContents.insertText(prompt);
  await waitFor(
    () => rendererValue(
      window,
      `() => {
        const input = document.querySelector(
          '[data-composer-input][contenteditable="true"]'
        );
        return input instanceof HTMLElement &&
            input.textContent === ${JSON.stringify(prompt)}
          ? true
          : undefined;
      }`,
    ),
    `the composer draft ${prompt}`,
  );
  await waitFor(
    () => rendererValue(
      window,
      `() => {
        const card = document.querySelector("[data-composer-card]");
        const button = card?.querySelector(
          'button[aria-label="Send message"],' +
          'button[aria-label="发送消息"]'
        );
        return button instanceof HTMLButtonElement && !button.disabled
          ? true
          : undefined;
      }`,
    ),
    `the enabled composer Send button for ${prompt}`,
  );
  await rendererValue(
    window,
    `() => {
      const card = document.querySelector("[data-composer-card]");
      const button = card?.querySelector(
        'button[aria-label="Send message"],' +
        'button[aria-label="发送消息"]'
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error("Enabled Harness composer Send button is missing");
      }
      button.click();
      return true;
    }`,
  );
  await waitFor(
    () => rendererValue(
      window,
      `() => {
        const input = document.querySelector(
          '[data-composer-input][contenteditable="true"]'
        );
        return input instanceof HTMLElement &&
            input.textContent === ""
          ? true
          : undefined;
      }`,
    ),
    `the cleared composer after ${prompt}`,
  );
}

async function run() {
  trace('preparing isolated runtime');
  const suppliedTemporaryRoot = process.env[TEMP_ROOT_ENV];
  const temporaryRoot = suppliedTemporaryRoot === undefined
    ? await mkdtemp(join(tmpdir(), TEMP_ROOT_PREFIX))
    : resolve(suppliedTemporaryRoot);
  if (suppliedTemporaryRoot !== undefined) {
    assert.equal(dirname(temporaryRoot), resolve(tmpdir()));
    assert.equal(basename(temporaryRoot).startsWith(TEMP_ROOT_PREFIX), true);
    await mkdir(temporaryRoot, { recursive: true });
  }
  // Chromium may flush Preferences after the BrowserWindow is destroyed and
  // recreate userData after the async cleanup below. Reap that narrow temp
  // root again only once Electron has fully exited.
  process.once('exit', () => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });
  const userData = join(temporaryRoot, 'electron-user-data');
  const dshHome = join(temporaryRoot, 'dsh-home');
  const workspace = join(temporaryRoot, 'workspace');
  await Promise.all([
    mkdir(userData, { recursive: true }),
    mkdir(dshHome, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  app.setPath('userData', userData);

  const previousApiKey = process.env.DEEPSEEK_API_KEY;
  const previousBaseUrl = process.env.DEEPSEEK_BASE_URL;
  const fixture = await startBrowserFixture();
  const model = await startDynamicModelServer(fixture.url);
  process.env.DEEPSEEK_API_KEY = 'minke-agent-browser-e2e-key';
  process.env.DEEPSEEK_BASE_URL = model.baseUrl;

  let window;
  let tabsBinding;
  let harness;
  let agentBrowser;
  try {
    await app.whenReady();
    trace('Electron ready');
    const {
      AgentBrowserRuntime,
      HarnessRuntime,
      SqliteAgentBrowserHistory,
      bindTabs,
    } = loadDesktopSource();
    const browserHistory = new SqliteAgentBrowserHistory({
      path: join(
        temporaryRoot,
        'agent-browser-history.sqlite',
      ),
    });
    agentBrowser = new AgentBrowserRuntime({
      sessionFromPartition(partition, options) {
        return session.fromPartition(partition, options);
      },
      guestAttachTimeoutMs: 10_000,
      cdpCommandTimeoutMs: 10_000,
      history: browserHistory,
    });
    harness = new HarnessRuntime({
      runtimeRoot,
      dshHome,
      electronExecutable: process.execPath,
      modelRuntimes: {
        lmStudio: { enabled: false },
        ollama: { enabled: false },
      },
      pluginManagement: {
        safeMode: false,
        disabledPlugins: [],
      },
      agentBrowser,
      onUnexpectedExit(exit) {
        process.stderr.write(
          `Harness exited unexpectedly: ${JSON.stringify(exit)}\n`,
        );
      },
    });
    const harnessEndpoint = await harness.start();
    const harnessUrl = harnessEndpoint.origin;
    trace(`Harness ready at ${harnessUrl}`);

    window = new BrowserWindow({
      width: 1_280,
      height: 800,
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
      },
    });
    const harnessOrigin = harnessEndpoint.origin;
    tabsBinding = bindTabs(
      ipcMain,
      window.webContents,
      {
        async openExternal() {},
        async openPath() {
          return '';
        },
      },
      (event) =>
        event.sender === window.webContents &&
        event.senderFrame !== null &&
        (() => {
          try {
            return new URL(event.senderFrame.url).origin === harnessOrigin;
          } catch {
            return false;
          }
        })(),
      {
        runtimeRoot,
        electronExecutable: process.execPath,
        defaultCwd: workspace,
        fileSystemRoot: parse(workspace).root,
        minkeConfigPath: join(temporaryRoot, 'minke-config.json'),
        environment: { ...process.env },
        agentBrowser,
        prepareWebSession() {},
      },
    );
    await window.loadURL(harnessEndpoint.authenticatedUrl);
    trace('production renderer loaded');
    await waitFor(
      () => rendererValue(
        window,
        `() => Boolean(document.querySelector("#root"))`,
      ),
      'Harness React root',
    );
    trace('Harness React root mounted');
    const harnessCookie = (
      await window.webContents.session.cookies.get({
        url: harnessOrigin,
      })
    )
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    assert.notEqual(harnessCookie, '');

    const registeredWorkspace = await rpc(
      harnessUrl,
      'workspace/create',
      { path: workspace },
      harnessCookie,
    );
    const created = await rpc(harnessUrl, 'session/create', {
      workspaceId: registeredWorkspace.workspace.workspaceId,
      sessionId: 'minke-agent-browser-conversation-e2e',
      agentPreset: 'standard',
    }, harnessCookie);
    assert.equal(
      created.sessionId,
      'minke-agent-browser-conversation-e2e',
    );
    await rpc(harnessUrl, 'session/prompt', {
      requestId: 'minke-agent-browser-bootstrap',
      sessionId: created.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: BOOTSTRAP_PROMPT }],
    }, harnessCookie);
    await waitForAssistantMarker(
      harnessUrl,
      created.sessionId,
      BOOTSTRAP_MARKER,
      harnessCookie,
    );
    const conversationTitle = 'Minke Agent Browser Conversation E2E';
    await rpc(harnessUrl, 'session/rename', {
      sessionId: created.sessionId,
      title: conversationTitle,
    }, harnessCookie);
    await window.loadURL(harnessUrl);
    await waitFor(
      () => rendererValue(
        window,
        `() => Boolean(document.querySelector("#root"))`,
      ),
      'the reloaded Harness React root',
    );
    await selectConversation(window, conversationTitle);
    await promptThroughComposer(window, OPEN_PROMPT);
    trace(`conversation ${created.sessionId} prompted through the composer`);

    const projection = await waitFor(
      () => {
        const current = agentBrowser.projections()[0];
        return current?.owner === 'agent' &&
            current.status === 'ready' &&
            current.url === fixture.url
          ? current
          : undefined;
      },
      'an agent-owned ready browser projection',
      45_000,
    );
    trace(`browser projection ready: ${projection.sessionId}`);
    assert.equal(projection.url, fixture.url);
    const preloadProjection = await waitFor(
      async () => {
        const current = (await readAgentBrowserPreload(window))[0];
        return current?.sessionId === projection.sessionId &&
            current.owner === 'agent' &&
            current.url === fixture.url
          ? current
          : undefined;
      },
      'the production preload bridge projection',
    );
    assert.equal(preloadProjection.status, 'ready');
    const footprint =
      await readAgentBrowserHistoryPreload(window);
    assert.ok(footprint.totalVisits >= 1);
    assert.ok(footprint.retainedVisits >= 1);
    assert.equal(footprint.visits[0]?.actor, 'agent');
    assert.equal(footprint.visits[0]?.url, fixture.url);
    const guest = await waitFor(
      () => webContents
        .getAllWebContents()
        .find((candidate) =>
          candidate.getType() === 'webview' &&
          candidate.getURL() === fixture.url
        ),
      'the embedded Agent Browser WebContents',
    );
    await waitForAssistantMarker(
      harnessUrl,
      created.sessionId,
      OPENED_MARKER,
      harnessCookie,
    );
    assert.equal(
      await guest.executeJavaScript(
        'document.querySelector("#state")?.textContent',
      ),
      'Done',
    );
    trace('model completed open/snapshot/click/wait loop');
    assert.deepEqual(
      model.issuedTools.slice(0, 4),
      [
        'browser_open',
        'browser_snapshot',
        'browser_click',
        'browser_wait',
      ],
    );
    const bootstrapRequestIndex = model.requests.findIndex(
      (request) => {
        const names = toolNames(request);
        return names.includes('browser_open') &&
          !names.includes('browser_click');
      },
    );
    assert.notEqual(bootstrapRequestIndex, -1);
    const bootstrapSurface = toolNames(
      model.requests[bootstrapRequestIndex],
    );
    assert.deepEqual(
      bootstrapSurface
        .filter((name) => name.startsWith('browser_'))
        .sort(),
      [
        'browser_open',
        'browser_navigate',
        'browser_history',
        'browser_snapshot',
        'browser_find',
        'browser_locate',
        'browser_wait',
        'browser_scroll',
        'browser_screenshot',
        'browser_close',
      ].sort(),
    );
    assert.match(
      allMessageText(
        model.requests[bootstrapRequestIndex],
        'system',
      ),
      /capabilities are staged/iu,
    );
    const activeRequestIndex = model.requests.findIndex(
      (request, index) =>
        index > bootstrapRequestIndex &&
        toolNames(request).includes('browser_click'),
    );
    assert.notEqual(activeRequestIndex, -1);
    const activeSurface = toolNames(
      model.requests[activeRequestIndex],
    );
    const browserClickTool =
      model.requests[activeRequestIndex].tools.find(
        (entry) => entry?.function?.name === 'browser_click',
      );
    const targetProperties =
      browserClickTool?.function?.parameters?.properties
        ?.target?.properties;
    assert.notEqual(targetProperties, undefined);
    assert.equal(Object.hasOwn(targetProperties, 'ordinal'), true);
    assert.equal(Object.hasOwn(targetProperties, 'index'), false);
    assert.match(
      allMessageText(
        model.requests[activeRequestIndex],
        'system',
      ),
      /OBSERVE → RESOLVE → ACT → VERIFY/u,
    );
    assert.deepEqual(
      activeSurface
        .filter((name) => name.startsWith('browser_'))
        .sort(),
      [
        'browser_open',
        'browser_navigate',
        'browser_history',
        'browser_snapshot',
        'browser_find',
        'browser_locate',
        'browser_click',
        'browser_fill',
        'browser_press',
        'browser_wait',
        'browser_scroll',
        'browser_screenshot',
        'browser_close',
      ].sort(),
    );
    assert.equal(
      model.requestHeaders[activeRequestIndex]?.authorization,
      'Bearer minke-agent-browser-e2e-key',
    );
    assert.equal(
      model.requestHeaders[activeRequestIndex]?.[
        'x-deepseek-harness-session-id'
      ],
      created.sessionId,
    );

    assert.equal(
      await guest.executeJavaScript(
        'document.querySelector("#state")?.textContent',
      ),
      'Done',
    );
    const agentUi = await waitFor(
      () => rendererValue(
        window,
        `() => {
          const shield = document.querySelector("[data-agent-input-shield]");
          const view = document.querySelector(".minke-agent-browser__guest");
          return shield !== null && view !== null
            ? {
                inert: view.hasAttribute("inert"),
                label: shield.getAttribute("aria-label"),
              }
            : undefined;
        }`,
      ),
      'the agent-owned input shield',
    );
    assert.equal(agentUi.inert, true);
    trace('agent input shield verified');

    const agentControlStyling = await rendererValue(
      window,
      `() => {
        const signal = document.querySelector(
          ".minke-agent-browser__tab-signal[data-agent-active]"
        );
        const tab = signal?.closest(".minke-tab");
        const view = document.querySelector(
          '.minke-agent-browser__view[data-owner="agent"]'
        );
        if (!(tab instanceof HTMLElement) ||
            !(view instanceof HTMLElement)) {
          throw new Error("Agent-controlled browser styling is missing");
        }
        const frameStyle = getComputedStyle(view, "::before");
        const guest = view.querySelector(".minke-agent-browser__guest");
        if (!(guest instanceof HTMLElement)) {
          throw new Error("Agent-controlled browser guest is missing");
        }
        return {
          frameAnimation: frameStyle.animationName,
          frameOffsetPath: frameStyle.offsetPath,
          frameShadow: getComputedStyle(view).boxShadow,
          guestPointerEvents: getComputedStyle(guest).pointerEvents,
          prefersReducedMotion: window.matchMedia(
            "(prefers-reduced-motion: reduce)"
          ).matches,
          tabAnimation:
            getComputedStyle(tab, "::after").animationName,
        };
      }`,
    );
    assert.equal(
      agentControlStyling.tabAnimation,
      agentControlStyling.prefersReducedMotion
        ? 'none'
        : 'minke-agent-browser-tab-flow',
    );
    assert.equal(
      agentControlStyling.frameAnimation,
      'none',
    );
    assert.equal(agentControlStyling.frameOffsetPath, 'none');
    assert.match(agentControlStyling.frameShadow, /\binset\b/u);
    assert.equal(agentControlStyling.guestPointerEvents, 'none');
    const agentLayout = await readAgentBrowserLayout(window);

    const screenshotPath = process.env[SCREENSHOT_ENV];
    if (screenshotPath !== undefined) {
      const image = await window.capturePage();
      await writeFile(resolve(screenshotPath), image.toPNG());
      trace(`agent-control screenshot captured at ${screenshotPath}`);
    }
    const focusedScreenshotPath =
      process.env[FOCUSED_SCREENSHOT_ENV];
    if (focusedScreenshotPath !== undefined) {
      const panelBounds = await rendererValue(
        window,
        `() => {
          const panel = document.querySelector(
            ".minke-tabs-panel:has(.minke-agent-browser__view)"
          );
          if (!(panel instanceof HTMLElement)) {
            throw new Error("Agent Browser panel is missing");
          }
          const bounds = panel.getBoundingClientRect();
          return {
            x: Math.floor(bounds.x),
            y: Math.floor(bounds.y),
            width: Math.ceil(bounds.width),
            height: Math.min(240, Math.ceil(bounds.height)),
          };
        }`,
      );
      const focusedImage = await window.capturePage(panelBounds);
      await writeFile(
        resolve(focusedScreenshotPath),
        focusedImage.toPNG(),
      );
      trace(
        `focused agent-control screenshot captured at ${focusedScreenshotPath}`,
      );
    }

    await rendererValue(
      window,
      `() => {
        const button = document.querySelector(
          "[data-agent-input-shield] button"
        );
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Take control button is missing");
        }
        button.click();
        return true;
      }`,
    );
    await waitFor(
      () => {
        const current = agentBrowser.projections()[0];
        return current?.owner === 'human' &&
            current.status === 'paused'
          ? current
          : undefined;
      },
      'human browser ownership',
    );
    assert.equal(
      (await readAgentBrowserPreload(window))[0]?.owner,
      'human',
    );
    trace('human ownership acquired');
    const humanUi = await waitFor(
      () => rendererValue(
        window,
        `() => {
          const view = document.querySelector(".minke-agent-browser__guest");
          return view !== null &&
              !view.hasAttribute("inert") &&
              document.querySelector("[data-agent-input-shield]") === null
            ? true
            : undefined;
        }`,
      ),
      'an interactive human-owned webview',
    );
    assert.equal(humanUi, true);
    const humanLayout = await readAgentBrowserLayout(window);
    assertAgentBrowserLayout(agentLayout, humanLayout);
    trace('human takeover preserved Agent Browser layout geometry');
    const humanControlStyling = await rendererValue(
      window,
      `() => {
        const signal = document.querySelector(
          ".minke-agent-browser__tab-signal"
        );
        const view = document.querySelector(
          '.minke-agent-browser__view[data-owner="human"]'
        );
        if (!(signal instanceof HTMLElement) ||
            !(view instanceof HTMLElement)) {
          throw new Error("Human-controlled browser styling is missing");
        }
        return {
          agentActive: signal.hasAttribute("data-agent-active"),
          frameAnimation:
            getComputedStyle(view, "::before").animationName,
        };
      }`,
    );
    assert.equal(humanControlStyling.agentActive, false);
    assert.equal(humanControlStyling.frameAnimation, 'none');
    await guest.executeJavaScript(
      'document.querySelector("#human-note")?.focus()',
    );
    await guest.insertText('human-control');
    assert.equal(
      await guest.executeJavaScript(
        'document.querySelector("#human-note")?.value',
      ),
      'human-control',
    );
    trace('human input reached the embedded page');

    trace('submitting the next browser turn without an explicit return-control click');
    await promptThroughComposer(window, CLOSE_PROMPT);
    trace('close prompt submitted through the composer');
    await waitForAssistantMarker(
      harnessUrl,
      created.sessionId,
      CLOSED_MARKER,
      harnessCookie,
    );
    trace('model completed browser_close loop');
    await waitFor(
      () => agentBrowser.projections().length === 0,
      'browser_close to remove the runtime projection',
    );
    assert.deepEqual(await readAgentBrowserPreload(window), []);
    assert.equal(model.issuedTools.at(-1), 'browser_close');
    await waitFor(
      () => rendererValue(
        window,
        `() =>
          document.querySelector(".minke-agent-browser__guest") === null`,
      ),
      'the closed Agent Browser tab to leave the renderer',
    );

  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(
      `[agent-browser-e2e] failed: ${String(error?.stack ?? error)}\n`,
    );
    throw error;
  } finally {
    trace('cleaning up');
    await harness?.stop();
    tabsBinding?.dispose();
    agentBrowser?.dispose();
    if (window !== undefined && !window.isDestroyed()) window.destroy();
    await Promise.allSettled([
      closeServer(model.server),
      closeServer(fixture.server),
    ]);
    if (previousApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previousApiKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.DEEPSEEK_BASE_URL;
    } else {
      process.env.DEEPSEEK_BASE_URL = previousBaseUrl;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    process.stdout.write(
      'Agent Browser real conversation takeover smoke passed\n',
    );
  })
  .catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Let Chromium shut its profile down before the synchronous process-exit
    // cleanup above runs. app.exit() can force native profile writers to race
    // that cleanup and recreate the otherwise-deleted test directory.
    app.quit();
  });
