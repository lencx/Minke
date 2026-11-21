'use strict';

const assert = require('node:assert/strict');
const {
  mkdir,
  readFile,
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
  nativeTheme,
  session,
  webContents,
} = require('electron');
const { buildSync } = require('esbuild');
const { closeServer } = require('./support/http-server.cjs');
const { subagentScenario, verifySubagentSidebarUI } = require('./subagent-sidebar-ui.cjs');

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
    export { DesktopBrowserGuests } from "./desktop/main/browser-guests.ts";
    export { macOSWindowOptions } from "./desktop/main/macos-window.ts";
    export { bindPluginRecoveryIpc } from "./desktop/main/plugin-recovery-ipc.ts";
    export { PluginRecoveryRuntime } from "./desktop/main/plugin-recovery.ts";
    export { bindDirectoryPickerIpc } from "./desktop/main/directory-picker.ts";
    export { bindTerminalSettingsIpc } from "./desktop/main/terminal-settings.ts";
    export { bindAppUpdateSettingsIpc } from "./desktop/main/app-update-settings.ts";
    export { bindWebSearchSettingsIpc } from "./desktop/main/web-search-settings.ts";
    export { installDesktopShortcuts } from "./desktop/main/desktop-shortcuts.ts";
    export { migrateTerminalFontProfile } from "./desktop/main/profile-migration.ts";
    export { MinkeConfigStore } from "./desktop/main/minke-config.ts";
    export { bindWindowLocale, readHarnessLocaleBootstrap } from "./desktop/main/window-locale.ts";
    export { bindWindowTheme } from "./desktop/main/window-theme.ts";
    export { bindDesktopUpdates } from "./desktop/main/desktop-updates.ts";
    export { DESKTOP_UPDATE_IPC } from "./packages/harness-overlay/src/shared-updates-contract.ts";
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

async function startBrowserFixture() {
  const server = http.createServer((request, response) => {
    if (request.url === '/missing-icon.png') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.url === '/site-icon.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#3964fe"/><path d="M4 12V4l4 5 4-5v8" fill="none" stroke="white" stroke-width="2"/></svg>');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`<!doctype html>
      <html>
        <head><title>Minke Agent Browser E2E</title><link rel="icon" href="/site-icon.svg" /></head>
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
  if (role === 'tool') return toolResults(body).at(-1) ?? '';
  const messages = messagesOf(body);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return contentText(message.content);
  }
  return '';
}

function allMessageText(body, role) {
  const historyText = messagesOf(body)
    .filter((message) => message?.role === role)
    .map((message) => contentText(message.content))
    .join('\n');
  // Native in-history prompt updates preserve the initial system prefix.
  return role === 'system'
    ? [contentText(body.system), historyText].join('\n')
    : historyText;
}

function toolResults(body) {
  return messagesOf(body)
    .flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === 'tool_result')
    .map(block => contentText(block.content));
}

function toolNames(body) {
  if (!Array.isArray(body?.tools)) return [];
  return body.tools.flatMap((entry) => {
    const name = entry?.name;
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
  writeSse(response, {
    type: 'message_start',
    message: {
      id: 'minke-e2e-message', type: 'message', role: 'assistant',
      model: 'deepseek-v4-flash', content: [], stop_reason: null,
      usage: { input_tokens: 8, output_tokens: 0 },
    },
  });
}

function writeSse(response, value) {
  response.write(
    `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`,
  );
}

function finishSse(response, reason, outputTokens) {
  writeSse(response, { type: 'content_block_stop', index: 0 });
  writeSse(response, {
    type: 'message_delta', delta: { stop_reason: reason },
    usage: { output_tokens: outputTokens },
  });
  writeSse(response, { type: 'message_stop' });
  response.end();
}

function sendText(response, text) {
  openSse(response);
  writeSse(response, {
    type: 'content_block_start', index: 0,
    content_block: { type: 'text', text: '' },
  });
  writeSse(response, {
    type: 'content_block_delta', index: 0,
    delta: { type: 'text_delta', text },
  });
  finishSse(response, 'end_turn', text.length);
}

function sendToolCall(response, callId, name, args) {
  const serialized = JSON.stringify(args);
  const midpoint = Math.max(1, Math.floor(serialized.length / 2));
  openSse(response);
  writeSse(response, {
    type: 'content_block_start', index: 0,
    content_block: { type: 'tool_use', id: callId, name, input: {} },
  });
  for (const partial_json of [serialized.slice(0, midpoint), serialized.slice(midpoint)]) {
    writeSse(response, { type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json } });
  }
  finishSse(response, 'tool_use', 2);
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
        !url.pathname.endsWith('/v1/messages')
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

      if (userText.includes(subagentScenario.childPrompt) && !userText.includes(subagentScenario.parentPrompt)) {
        sendText(response, userText.includes(subagentScenario.followupPrompt)
          ? subagentScenario.followupReply : subagentScenario.childReply);
        return;
      }
      if (userText.includes(subagentScenario.parentPrompt) && availableTools.includes('subagent')) {
        if (latestTool !== '') sendText(response, subagentScenario.parentReply);
        else call('subagent', {
          description: subagentScenario.childTitle,
          prompt: subagentScenario.childPrompt,
          run_in_background: true,
        });
        return;
      }

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
  const result = await window.webContents.executeJavaScript(
    `(async () => { try { return { value: await (${source})() }; }
      catch (error) { return { error: String(error?.stack ?? error) }; } })()`,
    true,
  );
  if (result.error) throw new Error(result.error);
  return result.value;
}

async function readAgentBrowserLayout(window) {
  return await rendererValue(
    window,
    `() => {
      const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
      if (!host) throw new Error('Agent Browser native content host is missing');
      const title = document.querySelector('[data-minke-tab-title="' + host.dataset.minkeTabInstance + '"]');
      const chip = title?.closest('[data-dockkit-tab]');
      if (!chip) throw new Error('Agent Browser must appear in the DSH tab strip');
      const chipSelector = '[data-dockkit-tab="' + chip.dataset.dockkitTab + '"]';
      const hostSelector = '.minke-tabs-native-host:has(.minke-agent-browser__view)';
      const selectors = {
        panel: '[data-sidebar-right-panel]',
        chrome: hostSelector + ' .minke-tabs-native-toolbar',
        tabbar: '[data-dockkit-strip]:has(' + chipSelector + ')',
        toolbar: hostSelector + ' .minke-tabs-native-toolbar',
        content: hostSelector + ' .minke-tabs-content',
        view: '.minke-agent-browser__view',
        guest: '.minke-agent-browser__guest',
        activeTab: chipSelector,
        activeTabClose: chipSelector + ' [data-dockkit-tab-close]',
        layoutActions: '[data-dockkit-strip]:has(' + chipSelector + ') [data-dockkit-strip-chrome]',
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

async function assertRetainedBrowserPosition(window, label) {
  await waitFor(() => rendererValue(window, `() => {
    const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
    const seat = [...document.querySelectorAll('[data-minke-tab-viewport]')].find(element =>
      element.dataset.minkeTabViewport === host?.dataset.minkeTabInstance && element.dataset.visible === 'true');
    if (!host || !seat || host.inert) return false;
    const expected = seat.getBoundingClientRect();
    const actual = host.getBoundingClientRect();
    return ['left', 'top', 'width', 'height'].every(key => Math.abs(expected[key] - actual[key]) < 1);
  }`), label + ' aligns the retained browser with its native seat');
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

async function promptThroughComposer(window, prompt, scopeSelector = 'body') {
  await rendererValue(
    window,
    `() => {
      const input = document.querySelector(${JSON.stringify(scopeSelector)})?.querySelector(
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
        const input = document.querySelector(${JSON.stringify(scopeSelector)})?.querySelector(
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
        const card = document.querySelector(${JSON.stringify(scopeSelector)})?.querySelector("[data-composer-card]");
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
      const card = document.querySelector(${JSON.stringify(scopeSelector)})?.querySelector("[data-composer-card]");
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
        const input = document.querySelector(${JSON.stringify(scopeSelector)})?.querySelector(
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

async function verifyComposerFocus(window) {
  const script = buildSync({
    entryPoints: [join(projectRoot, 'packages/harness-overlay/src/client/shortcuts/actions.ts')],
    bundle: true, format: 'iife', globalName: 'MinkeComposerActions',
    platform: 'browser', write: false,
  }).outputFiles[0].text;
  const result = await rendererValue(window, `() => {
    ${script}
    const input = document.querySelector('[data-composer-input][contenteditable="true"]');
    if (!input) throw new Error('DSH composer missing');
    input.blur();
    const focused = MinkeComposerActions.focusComposerInput() && document.activeElement === input;
    input.blur();
    input.contentEditable = 'false';
    const readonlyRefused = !MinkeComposerActions.focusComposerInput();
    input.contentEditable = 'true';
    input.setAttribute('aria-disabled', 'true');
    const disabledRefused = !MinkeComposerActions.focusComposerInput();
    input.removeAttribute('aria-disabled');
    return { focused, readonlyRefused, disabledRefused };
  }`);
  assert.deepEqual(result, { focused: true, readonlyRefused: true, disabledRefused: true });
  trace('composer focus adapter respects the real editable, read-only and disabled DOM');
}

async function run() {
  trace('preparing isolated runtime');
  const suppliedTemporaryRoot = process.env[TEMP_ROOT_ENV];
  assert.equal(typeof suppliedTemporaryRoot, 'string', 'Run this test through scripts/tests/agent-browser-conversation.mjs');
  const temporaryRoot = resolve(suppliedTemporaryRoot);
  assert.equal(dirname(temporaryRoot), resolve(tmpdir()));
  assert.equal(basename(temporaryRoot).startsWith(TEMP_ROOT_PREFIX), true);
  // The Node runner owns this directory. Chromium can keep profile databases
  // locked until the Electron process exits, even after its windows close.
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
  let browserBinding;
  let pluginRecoveryBinding;
  let directoryPickerBinding;
  let terminalSettingsBinding;
  const preferenceBindings = [];
  let localeBinding;
  let themeBinding;
  let updatesBinding;
  let disposeInputDiagnostics;
  let desktopShortcuts;
  const inputDiagnostics = { scriptedKeyDowns: 0, otherNativeKeyDowns: 0 };
  let harness;
  let agentBrowser;
  try {
    await app.whenReady();
    trace('Electron ready');
    const {
      DesktopBrowserGuests,
      AgentBrowserRuntime,
      HarnessRuntime,
      SqliteAgentBrowserHistory,
      bindTabs,
      macOSWindowOptions,
      bindPluginRecoveryIpc,
      PluginRecoveryRuntime,
      bindDirectoryPickerIpc,
      bindTerminalSettingsIpc,
      bindAppUpdateSettingsIpc,
      bindWebSearchSettingsIpc,
      MinkeConfigStore,
      migrateTerminalFontProfile,
      installDesktopShortcuts,
      bindWindowLocale,
      readHarnessLocaleBootstrap,
      bindWindowTheme,
      bindDesktopUpdates,
      DESKTOP_UPDATE_IPC,
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
    const nativePathFixture = join(dshHome, 'native-path-fixture.mjs');
    await writeFile(nativePathFixture, await readFile(join(__dirname, 'support', 'native-path-fixture.mjs')));
    await writeFile(join(dshHome, 'cordis.patch.yml'), JSON.stringify([
      { insert: [{ id: 'test-native-paths', name: nativePathFixture }] },
    ]));
    const config = new MinkeConfigStore(temporaryRoot);
    await config.terminal.write({ fontFamily: 'monospace', fontSize: 16, lineHeight: 1.3 });
    await migrateTerminalFontProfile({ runtimeRoot, dshHome, electronExecutable: process.execPath }, await config.terminal.read());
    const harnessEndpoint = await harness.start();
    const harnessUrl = harnessEndpoint.origin;
    trace(`Harness ready at ${harnessUrl}`);

    window = new BrowserWindow({
      ...macOSWindowOptions(),
      width: 1_280,
      height: 800,
      // Hosted macOS runners can have a work area shorter than the desktop
      // viewport used by the UI suite. Keep explicit test sizes deterministic.
      enableLargerThanScreen: true,
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
    const nativeLocales = [];
    const authorizeWindow = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
      && new URL(event.senderFrame.url).origin === harnessOrigin;
    localeBinding = bindWindowLocale(window, { setLocale: value => nativeLocales.push(value) }, authorizeWindow,
      () => readHarnessLocaleBootstrap(harnessOrigin, ['en-US'], (url, init) => window.webContents.session.fetch(url, init)));
    themeBinding = bindWindowTheme(window, nativeTheme, authorizeWindow);
    let updateState = { phase: 'idle' }, updateOpens = 0;
    updatesBinding = bindDesktopUpdates(ipcMain, {
      status: () => updateState, open: async () => { updateOpens++; },
    }, authorizeWindow);
    const publishUpdate = state => { updateState = state; window.webContents.send(DESKTOP_UPDATE_IPC.changed, state); };
    // Native before-input-event is synchronous for sendInputEvent. Count other
    // native key presses without recording what the user typed or suppressing it.
    const contents = window.webContents;
    const sendInput = contents.sendInputEvent;
    let injectingInput = 0;
    contents.sendInputEvent = event => {
      injectingInput++;
      try { sendInput.call(contents, event); }
      finally { injectingInput--; }
    };
    const recordInput = (_event, input) => {
      if (input.type === 'keyDown') inputDiagnostics[injectingInput ? 'scriptedKeyDowns' : 'otherNativeKeyDowns']++;
    };
    contents.on('before-input-event', recordInput);
    disposeInputDiagnostics = () => {
      contents.off('before-input-event', recordInput);
      contents.sendInputEvent = sendInput;
    };
    const readOpenedFilePaths = async () => {
      const response = await window.webContents.session.fetch(new URL('/smoke/opened-paths', harnessOrigin).href);
      assert.equal(response.ok, true);
      return response.json();
    };
    const openedExternalUrls = [];
    desktopShortcuts = installDesktopShortcuts(() => window, temporaryRoot,
      process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', () => {},
      event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame,
      async () => ({}));
    desktopShortcuts.attach(window);
    terminalSettingsBinding = bindTerminalSettingsIpc(ipcMain, config.terminal,
      event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
    preferenceBindings.push(
      bindAppUpdateSettingsIpc(ipcMain, config.appUpdate, () => {}, authorizeWindow),
      bindWebSearchSettingsIpc(ipcMain, config.webSearch, authorizeWindow),
    );
    tabsBinding = bindTabs(
      ipcMain,
      window.webContents,
      {
        async openExternal(url) { openedExternalUrls.push(url); },
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
        fileSystemRoot: parse(workspace).root,
        minkeConfigPath: config.path,
        agentBrowser,
      },
    );
    browserBinding = new DesktopBrowserGuests({
      harnessUrl: () => harnessOrigin,
      preload: join(projectRoot, '.vite', 'build', 'tabs-web-preload.js'),
      external: { openExternal: async url => { openedExternalUrls.push(url); } },
      agentBrowser,
    }).bind(ipcMain, window.webContents,
      event => event.sender === window.webContents && new URL(event.senderFrame.url).origin === harnessOrigin,
      (guest, name) => desktopShortcuts.attachGuest(window, guest, name));
    pluginRecoveryBinding = bindPluginRecoveryIpc(ipcMain, new PluginRecoveryRuntime({
      runtimeRoot, dshHome, electronExecutable: process.execPath,
    }), event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame,
    () => { throw new Error('The UI regression must not restart the test desktop'); });
    let pickedDirectory = workspace;
    let directoryPickCalls = 0;
    directoryPickerBinding = bindDirectoryPickerIpc(ipcMain, {
      currentWindow: () => window,
      authorize: event => event.sender === window.webContents && new URL(event.senderFrame.url).origin === harnessOrigin,
      showOpenDialog: async (owner, options) => {
        assert.equal(owner, window);
        assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
        directoryPickCalls++;
        return pickedDirectory === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pickedDirectory] };
      },
    });
    // Seed the isolated workspace before any client can initialize rc.2's
    // default Documents workspace. Use the same cookie bootstrap as the app,
    // without rendering the response or exposing its launch capability.
    const bootstrap = await window.webContents.session.fetch(harnessEndpoint.authenticatedUrl);
    assert.equal(bootstrap.ok, true);
    await bootstrap.arrayBuffer();
    const harnessCookie = (
      await window.webContents.session.cookies.get({ url: harnessOrigin })
    ).map(({ name, value }) => `${name}=${value}`).join('; ');
    assert.notEqual(harnessCookie, '');
    const registeredWorkspace = await rpc(harnessUrl, 'workspace/create', { path: workspace }, harnessCookie);
    const created = await rpc(harnessUrl, 'session/create', {
      workspaceId: registeredWorkspace.workspace.workspaceId,
      sessionId: 'minke-agent-browser-conversation-e2e',
      agentPreset: 'standard',
    }, harnessCookie);
    assert.equal(created.sessionId, 'minke-agent-browser-conversation-e2e');
    await window.loadURL(harnessUrl);
    // Electron's input injection requires focus, including hover/click targets.
    // A displayed but inactive macOS window can route events to stale targets.
    window.show();
    window.focus();
    await waitFor(
      () => rendererValue(window, `() => document.visibilityState === 'visible'`),
      'the displayed Harness window',
    );
    trace('production renderer loaded');
    assert.equal(await rendererValue(window, `() => window.__DSH_DIRECTORY_PICKER__.pick()`), workspace);
    pickedDirectory = null;
    assert.equal(await rendererValue(window, `() => window.__DSH_DIRECTORY_PICKER__.pick()`), null);
    assert.equal(directoryPickCalls, 2);
    trace('native directory picker preload and IPC selected and canceled');
    await waitFor(
      () => rendererValue(
        window,
        `() => Boolean(document.querySelector("#root"))`,
      ),
      'Harness React root',
    );
    trace('Harness React root mounted');
    await waitFor(() => nativeLocales.includes('en'), 'DSH locale bridge initializes the native window');
    assert.deepEqual(await rendererValue(window, '() => window.__DSH_LOCALE__.read()'), { languages: ['en-US'], preference: null });
    await writeFile(join(workspace, 'native-reference.txt'), 'Referenced through DSH Desktop host paths.');
    // DSH keeps the file input mounted while the workspace/session binding is
    // still loading. Intake is ignored until the real editor becomes editable.
    await waitFor(() => rendererValue(window, `() =>
      document.querySelector('[data-composer-input]')?.isContentEditable === true &&
      document.querySelector('input[type=file]')?.disabled === false
    `), 'editable native file picker');
    window.webContents.debugger.attach('1.3');
    try {
      const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
      await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [join(workspace, 'native-reference.txt')] });
      await waitFor(() => rendererValue(window, `() => document.querySelector('[data-composer-chip="reference"]')?.textContent.includes('native-reference.txt')`), 'disk file becomes a native DSH reference');
    } finally {
      window.webContents.debugger.detach();
    }
    await rendererValue(window, `() => { document.querySelector('[data-composer-input]').focus(); return true; }`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-composer-input]')?.textContent === ''`), 'file reference draft cleared');
    trace('standard desktop locale bootstrap and native file reference passed');
    await require('./desktop-updates-ui.cjs').verifyDesktopUpdatesUI({ window, rendererValue, waitFor,
      publish: publishUpdate, opens: () => updateOpens });
    // Exercise real link interception on the initial blank Session.
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-new-session-tabs-action]') !== null`), 'start-page tab controls');
    await rendererValue(window, `() => {
      const link = document.createElement('a');
      link.href = ${JSON.stringify(fixture.url)};
      link.textContent = 'Blank Session browser fixture';
      document.body.append(link);
      link.click();
      link.remove();
      return true;
    }`);
    await waitFor(() => rendererValue(window, `() => {
      const host = document.querySelector('.minke-tabs-native-host[data-kind="web"]');
      const guest = host?.querySelector('webview');
      if (!host?.checkVisibility({ checkVisibilityCSS: true }) || host.inert || !guest?.getWebContentsId) return false;
      const rect = host.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit?.closest('[data-minke-tab-instance]') !== host) return false;
      try { return guest.getURL() === ${JSON.stringify(fixture.url)} && guest.getWebContentsId(); }
      catch { return false; }
    }`), 'start-page browser to paint above the initial Sidebar');
    trace('start-page Web content painted above the initial Sidebar');
    if (process.env.MINKE_SIDEBAR_UI_E2E === '1') {
      await require('./native-sidebar-ui.cjs').verifyNativeSidebarUI({ window, harnessUrl, fixtureUrl: fixture.url, rendererValue, waitFor, workspace, readOpenedFilePaths });
      await verifySubagentSidebarUI({ window, harnessUrl, harnessCookie, parentSessionId: created.sessionId,
        rpc, rendererValue, waitFor, waitForAssistantMarker, promptThroughComposer, openedExternalUrls });
      return;
    }
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
    await verifyComposerFocus(window);
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
        (entry) => entry?.name === 'browser_click',
      );
    const targetProperties =
      browserClickTool?.input_schema?.properties
        ?.target?.properties;
    assert.notEqual(targetProperties, undefined);
    assert.equal(Object.hasOwn(targetProperties, 'ordinal'), true);
    assert.equal(Object.hasOwn(targetProperties, 'index'), false);
    assert.match(
      // Tool additions also use system messages, but carry no prompt text.
      messagesOf(model.requests[activeRequestIndex])
        .filter((message) => message?.role === 'system')
        .map((message) => contentText(message.content))
        .filter((text) => text.trim().length > 0)
        .at(-1) ?? '',
      /OBSERVE → RESOLVE → ACT → VERIFY/u,
    );
    assert.deepEqual(
      model.requests[activeRequestIndex].system,
      model.requests[bootstrapRequestIndex].system,
      'native prompt updates retain the cacheable initial system prefix',
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
      model.requestHeaders[activeRequestIndex]?.['x-api-key'],
      'minke-agent-browser-e2e-key',
    );
    assert.equal(model.requestHeaders[activeRequestIndex]?.['anthropic-version'], '2023-06-01');
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
        const tab = signal?.closest("[data-dockkit-tab]");
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
            getComputedStyle(tab).animationName,
          tabRadius: getComputedStyle(tab).borderRadius,
          nativeTabRadius: getComputedStyle(tab).getPropertyValue('--dsw-radius-sm').trim(),
          tabCornerShape: getComputedStyle(tab).getPropertyValue('corner-shape'),
          tabShadow: getComputedStyle(tab).boxShadow,
          tabBackground: getComputedStyle(tab).backgroundImage,
          highlightContent: getComputedStyle(tab, '::after').content,
        };
      }`,
    );
    assert.notEqual(agentControlStyling.nativeTabRadius, '');
    assert.equal(agentControlStyling.tabRadius, agentControlStyling.nativeTabRadius,
      'the Agent control signal retains the native tab silhouette');
    assert.equal(agentControlStyling.tabShadow, 'none');
    assert.equal(agentControlStyling.highlightContent, 'none');
    assert.match(agentControlStyling.tabBackground, /repeating-linear-gradient/);
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

    const iconLoaded = () => rendererValue(window, `() => {
      const icon = document.querySelector('.minke-agent-browser__tab-signal img.minke-tab__favicon');
      return icon?.complete && icon.naturalWidth > 0 && icon.src === ${JSON.stringify(new URL('/site-icon.svg', fixture.url).href)};
    }`);
    await waitFor(iconLoaded, 'the Agent tab website favicon');
    await guest.executeJavaScript(`document.querySelector('link[rel="icon"]').href = '/missing-icon.png'; true;`);
    await waitFor(() => rendererValue(window, `() =>
      document.querySelector('.minke-agent-browser__tab-signal .minke-tab__favicon-fallback') !== null &&
      document.querySelector('.minke-agent-browser__tab-signal img') === null
    `), 'a failed favicon to fall back to the browser icon');
    await guest.executeJavaScript(`document.querySelector('link[rel="icon"]').href = '/site-icon.svg'; true;`);
    await waitFor(iconLoaded, 'a replacement favicon to recover after failure');
    trace('Agent tab favicon loading, failure fallback and recovery verified');

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
            "[data-sidebar-right-panel]"
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
      const wasDark = await rendererValue(window, `() => document.body.hasAttribute('data-ds-dark-theme')`);
      await rendererValue(window, `() => { document.body.toggleAttribute('data-ds-dark-theme', !${wasDark}); return true; }`);
      await rendererValue(window, '() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      await writeFile(`${resolve(focusedScreenshotPath)}.alternate-theme.png`, (await window.capturePage(panelBounds)).toPNG());
      await rendererValue(window, `() => { document.body.toggleAttribute('data-ds-dark-theme', ${wasDark}); return true; }`);
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
    await require('./browser-comments-composer-runtime.cjs').verifyBrowserCommentDraft({
      window, guest, model, rendererValue, waitFor,
    });
    const originalGuestId = guest.id;
    await rendererValue(window, `() => {
      window.__minkeTestGuest = document.querySelector('.minke-agent-browser__guest');
      document.querySelector('[data-dockkit-add-tab]').click();
      return true;
    }`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-guide-entry="files"]')?.checkVisibility({ checkVisibilityCSS: true })`), 'DSH Files entry in the native Start tab');
    await waitFor(() => rendererValue(window, `() =>
      document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)')?.inert === true
    `), 'the native Start tab hides the retained browser');
    await rendererValue(window, `() => {
      document.querySelector('[data-sidebar-right-guide-entry="files"]').click();
      return true;
    }`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-files-state="tree"]') !== null`), 'native Workspace files content');
    await waitFor(() => rendererValue(window, `() =>
      document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)')?.inert === true
    `), 'native tab switch to hide the retained browser');
    const retained = await rendererValue(window, `() => {
      const node = document.querySelector('.minke-agent-browser__guest');
      return { same: node === window.__minkeTestGuest, id: node.getWebContentsId() };
    }`);
    assert.equal(retained.same, true);
    assert.equal(retained.id, originalGuestId);
    assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'human-control');
    await rendererValue(window, `() => {
      const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
      document.querySelector('[data-minke-tab-title="' + host.dataset.minkeTabInstance + '"]').closest('[data-dockkit-tab]').click();
      return true;
    }`);
    await waitFor(() => rendererValue(window, `() =>
      document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)')?.inert === false
    `), 'native tab to restore the same browser instance');
    assert.equal(guest.isDestroyed(), false);
    trace('native tab switching retained the same DOM node, WebContents and human input');

    await assertRetainedBrowserPosition(window, 'tab switching');
    await waitFor(() => rendererValue(window, `() =>
      !document.getAnimations().some(animation =>
        (animation.playState === 'running' || animation.pending) &&
        animation.effect?.getComputedTiming().endTime !== Infinity)
    `), 'native tab transitions to finish before measuring idle layout work');
    const idleGeometryReads = await rendererValue(window, `async () => {
      const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
      const seat = [...document.querySelectorAll('[data-minke-tab-viewport]')].find(element =>
        element.dataset.minkeTabViewport === host.dataset.minkeTabInstance && element.dataset.visible === 'true');
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      // Flush observer callbacks queued by the completed transition.
      await frame(); await frame();
      const original = seat.getBoundingClientRect;
      let reads = 0;
      seat.getBoundingClientRect = function () { reads++; return original.call(this); };
      try { for (let index = 0; index < 12; index++) await frame(); }
      finally { seat.getBoundingClientRect = original; }
      return reads;
    }`);
    assert.equal(idleGeometryReads, 0, 'static visible browser tabs must not poll their geometry');
    trace('visible browser tab performed no geometry polling over 12 idle frames');

    await rendererValue(window, `() => { document.querySelector('[data-sidebar-right-mode="fullscreen"]').click(); return true; }`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="fullscreen"]') !== null`), 'native fullscreen');
    await assertRetainedBrowserPosition(window, 'fullscreen');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-split-button]:not([disabled])') !== null`), 'room for a native split');
    await rendererValue(window, `() => { document.querySelector('[data-dockkit-split-button]:not([disabled])').click(); return true; }`);
    await waitFor(() => rendererValue(window, `() => document.querySelectorAll('[data-dockkit-pane]').length === 2`), 'two native split panes');
    await assertRetainedBrowserPosition(window, 'split panes');
    if (process.platform === 'darwin') {
      const insets = await rendererValue(window, `() =>
        [...document.querySelectorAll('[data-sidebar-right-panel="fullscreen"] [data-dockkit-strip]')]
          .map(strip => ({
            column: strip.closest('[data-dockkit-pane]').dataset.dockkitColumn,
            padding: getComputedStyle(strip).paddingLeft,
          }))
      `);
      assert.deepEqual(insets, [
        { column: '0', padding: '88px' },
        { column: '1', padding: '10px' },
      ], 'only the first fullscreen column reserves space for the macOS window controls');
    }
    await rendererValue(window, `() => { document.querySelector('[data-sidebar-right-mode="push"]').click(); return true; }`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-right-panel="push"]') !== null`), 'native docked presentation');
    await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-sidebar-right-panel]').getAnimations().some(animation => animation.playState === 'running')`), 'native presentation transition to settle');
    assert.equal(await rendererValue(window, `() => [...document.querySelectorAll('[data-sidebar-right-panel] [data-dockkit-strip]')].every(strip => getComputedStyle(strip).paddingLeft === '10px')`), true, 'docked panes recover their usual tab inset');
    const drag = await rendererValue(window, `() => {
      const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
      const title = document.querySelector('[data-minke-tab-title="' + host.dataset.minkeTabInstance + '"]');
      title.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const rect = title.getBoundingClientRect();
      const surface = title.closest('[data-dockkit-surface]').getBoundingClientRect();
      return {
        start: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
        end: { x: Math.round(surface.left / 2), y: Math.round(innerHeight / 3) },
        tabId: title.closest('[data-dockkit-tab]').dataset.dockkitTab,
      };
    }`);
    assert.ok(drag.end.x > 0, 'docked layout must leave room outside its surface to float a tab');
    // Await Chromium input dispatch and DockKit pointer ownership. Fixed sleeps
    // after unacknowledged native events can miss the press on CI displays.
    const input = window.webContents.debugger;
    input.attach('1.3');
    try {
      await input.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...drag.start });
      await waitFor(() => rendererValue(window, `() => {
        const tab = document.querySelector('[data-dockkit-tab="${drag.tabId}"]');
        const hit = document.elementFromPoint(${drag.start.x}, ${drag.start.y});
        return tab?.matches(':hover') && tab.contains(hit) && !hit.closest('[data-dockkit-tab-close]');
      }`), 'hovered native tab before dragging');
      await input.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...drag.start, button: 'left', buttons: 1, clickCount: 1 });
      await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-tab="${drag.tabId}"][data-dockkit-pointer]') !== null`), 'native tab owns the drag pointer');
      await input.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...drag.end, button: 'left', buttons: 1 });
      await input.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...drag.end, button: 'left', buttons: 0, clickCount: 1 });
    } finally {
      input.detach();
    }
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-float]') !== null`), 'native drag to floating panel');
    await assertRetainedBrowserPosition(window, 'floating panel');
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-agent-browser__guest') === window.__minkeTestGuest`), true);
    assert.equal(await guest.executeJavaScript('document.querySelector("#human-note").value'), 'human-control');
    await rendererValue(window, `() => { document.querySelector('[data-dockkit-float-dock]').click(); return true; }`);
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-dockkit-float]') === null`), 'floating browser to dock');
    await assertRetainedBrowserPosition(window, 'docking');
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-agent-browser__guest').getWebContentsId()`), originalGuestId);
    trace('native fullscreen, split, drag-to-float and dock retained the same browser instance');

    // DSH's native shortcut works with the left navigation collapsed after
    // fullscreen/docking, where its Settings button is not mounted.
    if (process.platform === 'darwin') app.focus({ steal: true });
    window.focus();
    await waitFor(() => window.isFocused(), 'native Settings shortcut window focus');
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await waitFor(() => rendererValue(window, `() => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]');
      const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
      if (!panel || !host || host.inert) return false;
      const rect = host.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit?.closest('[data-minke-tab-instance]') !== host;
    }`), 'Settings dialog to cover the retained browser').catch(async error => {
      const state = await rendererValue(window, `() => {
        const panel = document.querySelector('[role="dialog"][aria-modal="true"]');
        const host = document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view)');
        const rect = host?.getBoundingClientRect();
        const hit = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { focused: document.hasFocus(), active: document.activeElement?.outerHTML.slice(0, 300),
          dialog: Boolean(panel), hostInert: host?.inert, hostRect: rect?.toJSON(),
          hit: hit?.outerHTML.slice(0, 300) };
      }`);
      throw new Error(error.message + '; Settings state=' + JSON.stringify({ windowFocused: window.isFocused(), ...state }), { cause: error });
    });
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-agent-browser__guest') === window.__minkeTestGuest`), true);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(() => rendererValue(window, `() => document.querySelector('[role="dialog"][aria-modal="true"]') === null`), 'Settings dialog to close');
    assert.equal(await rendererValue(window, `() => document.querySelector('.minke-agent-browser__guest').getWebContentsId()`), originalGuestId);
    trace('Settings dialog layered above the browser without replacing its instance');

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
    trace('native keyboard diagnostics: ' + JSON.stringify(inputDiagnostics));
    if (process.env.MINKE_SIDEBAR_UI_E2E === '1' && window && !window.isDestroyed()) {
      if (process.env.MINKE_SIDEBAR_SCREENSHOT) await writeFile(`${process.env.MINKE_SIDEBAR_SCREENSHOT}.failed.png`, (await window.webContents.capturePage()).toPNG());
    }
    process.exitCode = 1;
    process.stderr.write(
      `[agent-browser-e2e] failed: ${String(error?.stack ?? error)}\n`,
    );
    throw error;
  } finally {
    trace('cleaning up');
    await harness?.stop();
    browserBinding?.dispose();
    tabsBinding?.dispose();
    pluginRecoveryBinding?.dispose();
    directoryPickerBinding?.dispose();
    terminalSettingsBinding?.dispose();
    preferenceBindings.forEach(binding => binding.dispose());
    localeBinding?.dispose();
    themeBinding?.dispose();
    updatesBinding?.dispose();
    nativeTheme.themeSource = 'system';
    desktopShortcuts?.dispose();
    disposeInputDiagnostics?.();
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
  }
}

run()
  .then(() => {
    process.stdout.write(
      process.env.MINKE_SIDEBAR_UI_E2E === '1'
        ? 'Native Sidebar UI regression passed\n'
        : 'Agent Browser real conversation takeover smoke passed\n',
    );
  })
  .catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // The parent reaps the profile only after Chromium has fully shut down.
    app.quit();
  });
