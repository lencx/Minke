import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as cordis from '@deepseek-ai/cordis';
import * as store from '../vendor/deepseek-harness/packages/client/store/lib/index.js';
import { parse } from 'acorn';
import { applyHarnessRuntimePatches, resolveHarnessRuntimePatches } from '../scripts/harness/runtime-patches.mjs';
import { TabsRuntime } from '@minke/harness-overlay/client/tabs/runtime.ts';
import { TerminalTabsController } from '@minke/harness-overlay/client/tabs/terminal/controller.ts';
import { connectTerminalAppearance } from '@minke/harness-overlay/client/tabs/terminal/appearance.ts';
import { TerminalSettingsRuntime } from '@minke/harness-overlay/client/tabs/terminal/settings/runtime.ts';
import { CodeThemeSettingsRuntime } from '@minke/harness-overlay/client/tabs/files/code-theme-runtime.ts';

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'minke-shared-terminal-'));
const targets = [
  ['dsh-api-terminal-controller', 'api/terminal-controller', 'client.js'],
  ['dsh-client-ui-sidebar-terminal', 'client/ui-sidebar-terminal', 'client.js'],
  ['dsh-client-ui-sidebar-terminal', 'client/ui-sidebar-terminal', 'client.terminal.js'],
];
const original = new Map();
for (const [name, source, file] of targets) {
  const path = join(scratch, 'node_modules/@deepseek-ai', name, 'lib', file);
  const text = await readFile(join(root, 'vendor/deepseek-harness/packages', source, 'lib', file), 'utf8');
  original.set(name + '/' + file, text);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
}
await applyHarnessRuntimePatches(scratch, await resolveHarnessRuntimePatches(root, ['patches/deepseek-harness/shared-terminal-view.patch']));
const sources = new Map();
for (const [name, , file] of targets) sources.set(name + '/' + file, await readFile(join(scratch, 'node_modules/@deepseek-ai', name, 'lib', file), 'utf8'));
await rm(scratch, { recursive: true, force: true });

function load(name, dependencies) {
  let plugin;
  const source = (process.env.MINKE_TERMINAL_NEGATIVE === '1' ? original : sources).get(name + '/client.js');
  new Function('window', source)({ __ModuleLoader__: { load({ factory }) {
    plugin = factory(name => { assert.ok(name in dependencies, name); return dependencies[name]; });
  } } });
  return plugin;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function observable(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of listeners) fn(); } };
}

function uiFixture() {
  const slots = [];
  const ctx = {
    webTerminals: { retainTabs() {}, view() {} },
    sidebarRight: { openTabs: observable([]), registerCloseHandler: () => () => {} },
    sidebarRightTabs: { register: () => () => {} },
    shortcuts: { register: () => () => {} },
    locale: { bind: () => key => key, register: () => () => {} },
    theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) },
    on: () => () => {},
    effect: callback => callback(),
    slots: { inject: (_name, callback) => callback(), register: (options, component) => { slots.push({ ...options, component }); return () => {}; } },
  };
  ctx.reflect = { provide(name, value) { ctx[name] = value; return () => {}; } };
  load('dsh-client-ui-sidebar-terminal', {
    react: { ...React, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-ui-primitives': {},
  }).apply(ctx);
  return { ctx, slots };
}

test('both terminal placements use the provider screen and the same live appearance', () => {
  const { ctx, slots } = uiFixture();
  assert.ok(ctx.terminalUI, 'DSH must expose its screen to the bottom placement');
  const model = {};
  const native = slots.find(slot => slot.name === 'sidebar.right.pane.tab').component({
    useTabInfo: () => ({ tab: { id: 'native', visible: true, actions: { openTab() {} } } }), view: () => model,
  });
  assert.equal(native.type, ctx.terminalUI.View);
  ctx.terminalUI.setAppearance({ lineHeight: 1.4, theme: { background: '#123456' } });
  const left = ctx.terminalUI.View(native.props);
  const bottom = ctx.terminalUI.View({ model, visible: true, onNewTerminal() {} });
  assert.equal(left.type, bottom.type);
  assert.deepEqual(left.props.appearance, bottom.props.appearance);
  assert.equal(bottom.props.appearance.lineHeight, 1.4);
  ctx.terminalUI.setAppearance({ lineHeight: 1.6 });
  assert.equal(ctx.terminalUI.View(native.props).props.appearance.lineHeight, 1.6);
});

test('shared native palettes preserve application OSC overrides and reset to current preferences', () => {
  // Exercise the class in the patched screen chunk, including its real OSC handlers.
  const source = (process.env.MINKE_TERMINAL_NEGATIVE === '1' ? original : sources).get('dsh-client-ui-sidebar-terminal/client.terminal.js');
  const registration = parse(source, { ecmaVersion: 'latest' }).body[0].expression.arguments[0];
  const body = registration.properties.find(property => property.key.name === 'factory').value.body.body;
  const names = new Set(['ansiKeys', 'specialKeys', 'TerminalTheme', 'colorIndex', 'oscColor']);
  const declarations = body.filter(node => names.has(node.id?.name ?? node.declarations?.[0]?.id?.name));
  assert.equal(declarations.length, names.size);
  const TerminalTheme = new Function(declarations.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn TerminalTheme;')();
  const handlers = new Map();
  const terminal = { options: {}, parser: { registerOscHandler(code, callback) {
    handlers.set(code, callback);
    return { dispose: () => handlers.delete(code) };
  } } };
  const theme = new TerminalTheme(terminal);
  theme.update('#111111', '#eeeeee', { red: '#aa0000', cursor: '#eeeeee' });
  assert.equal(terminal.options.theme.red, '#aa0000');
  handlers.get(4)('1;#123456');
  handlers.get(12)('#abcdef');
  theme.update('#111111', '#eeeeee', { red: '#bb0000', cursor: '#00ff00' });
  assert.equal(terminal.options.theme.red, '#123456');
  assert.equal(terminal.options.theme.cursor, '#abcdef');
  handlers.get(104)('1');
  handlers.get(112)('');
  assert.equal(terminal.options.theme.red, '#bb0000');
  assert.equal(terminal.options.theme.cursor, '#00ff00');
  theme.dispose();
  assert.equal(handlers.size, 0);
});

test('DSH retains Sidebar and bottom window holds independently', async () => {
  const streams = [];
  const ctx = new cordis.Context();
  ctx.provide('connection', { generation: observable(1) });
  ctx.provide('remote', { $stream(options) {
    const end = Promise.withResolvers();
    const stream = { id: options.open(new AbortController().signal), disposed: false, async dispose() { this.disposed = true; end.resolve(); }, async *[Symbol.asyncIterator]() { await end.promise; } };
    streams.push(stream);
    return stream;
  } });
  const { ClientTerminals } = load('dsh-api-terminal-controller', {
    '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-api-gateway/client': { RemoteStreamCarrierError: class extends Error {} },
  });
  const service = new ClientTerminals(ctx, {
    environment: async () => ({ ok: true, value: {} }),
    list: async () => ({ ok: true, value: ['terminal-a', 'terminal-b'].map(id => ({ id, state: 'running', title: id })) }),
    retain: (_session, id) => id,
    close: async () => ({ ok: true, value: undefined }),
  });
  const a = { sessionId: 'a', tabId: 'side', contentId: 'side-content' };
  const b = { sessionId: 'a', tabId: 'bottom', contentId: 'bottom-content' };
  service.retainTabs([a]);
  service.retainTabs([b], 'minke.bottom');
  service.view('a', a.tabId, a.contentId, 'terminal-a');
  service.view('a', b.tabId, b.contentId, 'terminal-b');
  await tick();
  service.retainTabs([a]);
  assert.equal(streams.filter(stream => !stream.disposed).length, 2, 'Sidebar updates must not release bottom retention');
  service.retainTabs([]);
  assert.deepEqual(streams.filter(stream => !stream.disposed).map(stream => stream.id), ['terminal-b']);
  service.retainTabs([], 'minke.bottom');
  assert.ok(streams.every(stream => stream.disposed));
  await service.close('a', a.tabId, a.contentId, 'terminal-a');
  await service.close('a', b.tabId, b.contentId, 'terminal-b');
});

function bottomFixture() {
  const calls = [];
  const tabs = new TabsRuntime({ showPanel() {}, hidePanel() {} }, { idPrefix: 'bottom-' });
  const list = observable({ byId: { a: { retainedBy: { mainView: 1 } }, child: { retainedBy: { sidebar: 1 } } } });
  const sessions = { list, retain(id) { calls.push(['retain', id]); return { ready: Promise.resolve(), release() { calls.push(['release', id]); } }; } };
  const controller = new TerminalTabsController(tabs, sessions, () => calls.push(['start']));
  const service = { retainTabs(tabs, owner) { calls.push(['holds', tabs, owner]); },
    view(sessionId, id, contentId, terminalId) { calls.push(['view', sessionId, id, contentId, terminalId]); return { id: terminalId ?? 'host-' + id, state: observable({ title: 'zsh', phase: 'connected' }) }; },
    close(...args) { calls.push(['close', ...args]); } };
  const disconnect = controller.connect(service, { View() {} });
  return { tabs, list, controller, calls, disconnect };
}

test('bottom tabs stay with their owning Session and reuse the saved Host identity', async () => {
  const w = bottomFixture();
  const id = w.controller.create('Terminal');
  await tick();
  assert.equal(w.tabs.tab(id).payload.sessionId, 'a');
  const saved = { ...w.tabs.tab(id), payload: w.controller.save(w.tabs.tab(id)) };
  assert.equal(saved.payload.terminalId, 'host-' + id);
  w.list.set({ byId: { a: { retainedBy: { minkeTerminal: 1 } }, b: { retainedBy: { mainView: 1 } } } });
  assert.equal(w.controller.model(id).id, saved.payload.terminalId);
  w.controller.dispose();
  assert.equal(w.calls.some(call => call[0] === 'close'), false, 'refresh releases the window hold without killing the shell');
  const restored = bottomFixture();
  restored.controller.restore(saved);
  await tick();
  assert.equal(restored.controller.model(id).id, saved.payload.terminalId);
  restored.tabs.close(id);
  assert.deepEqual(restored.calls.find(call => call[0] === 'close').slice(1), ['a', id, saved.payload.contentId, saved.payload.terminalId]);
  restored.controller.dispose();
});

test('closing a bottom tab before Session readiness cannot allocate a late terminal', async () => {
  const w = bottomFixture();
  const id = w.controller.create('Terminal');
  w.tabs.close(id);
  await tick();
  assert.equal(w.calls.some(call => call[0] === 'view'), false);
  w.controller.dispose();
});

test('without a main Session, explicit creation waits for DSH to create one', async () => {
  const w = bottomFixture();
  w.list.set({ byId: {} });
  const id = w.controller.create('Terminal');
  assert.equal(w.calls.filter(call => call[0] === 'start').length, 1);
  assert.equal(w.controller.model(id), undefined);
  w.list.set({ byId: { fresh: { retainedBy: { mainView: 1 } } } });
  await tick();
  assert.equal(w.tabs.tab(id).payload.sessionId, 'fresh');
  w.controller.dispose();
});

test('Minke publishes spacing and palette without overriding DSH typography', async () => {
  const changes = [];
  const settings = new TerminalSettingsRuntime({ available: true, read: async () => ({ fontFamily: 'Monaco', fontSize: 16, lineHeight: 1.3 }), write: async () => {} });
  const themes = new CodeThemeSettingsRuntime({ available: false }, 'dark');
  await settings.initialize();
  const release = connectTerminalAppearance({ setAppearance: value => changes.push(value) }, settings, themes);
  assert.equal(changes.at(-1).fontFamily, undefined);
  assert.equal(changes.at(-1).fontSize, undefined);
  settings.update({ lineHeight: 1.5 });
  assert.equal(changes.at(-1).lineHeight, 1.5);
  assert.ok(changes.at(-1).theme.background);
  settings.reset();
  assert.equal(settings.getSnapshot().settings.fontFamily, 'Monaco', 'reset retains the legacy font backup');
  assert.equal(settings.getSnapshot().settings.fontSize, 16);
  release();
  await tick();
  assert.deepEqual(changes.at(-1), {});
  settings.dispose(); themes.dispose();
});

test('closing a restored tab before its Session catalog arrives still cleans up the saved shell', () => {
  const w = bottomFixture();
  w.controller.restore({ id: 'bottom-tab-17', kind: 'terminal', key: 'saved', title: 'Terminal',
    payload: { sessionId: 'dormant', contentId: 'minke-terminal:saved', terminalId: 'saved-host' } });
  assert.equal(w.controller.model('bottom-tab-17'), undefined);
  w.tabs.close('bottom-tab-17');
  assert.deepEqual(w.calls.find(call => call[0] === 'close').slice(1), ['dormant', 'bottom-tab-17', 'minke-terminal:saved', 'saved-host']);
  w.controller.dispose();
});
