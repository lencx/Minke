import assert from "node:assert/strict";
import test from "node:test";
import { DIRECTORY_PICK_CHANNEL } from "@minke/desktop/directory-picker-contract.ts";
import { bindDirectoryPickerIpc } from "@minke/desktop/main/directory-picker.ts";
import { apply as applyNativeDirectoryPicker } from "@vendor/deepseek-harness/packages/client/ui-directory-picker-native/src/client/index.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture() {
  const handlers = new Map();
  const removed = [];
  const actions = [];
  const dialogs = [];
  let minimized = true;
  let destroyed = false;
  let contentsDestroyed = false;
  const webContents = { mainFrame: { url: "http://127.0.0.1:1234/" }, isDestroyed: () => contentsDestroyed };
  const window = {
    webContents,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore() { actions.push("restore"); minimized = false; },
    show() { actions.push("show"); },
    focus() { actions.push("focus"); },
  };
  let currentWindow = window;
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const binding = bindDirectoryPickerIpc({
    handle: (channel, callback) => handlers.set(channel, callback),
    removeHandler: channel => { removed.push(channel); handlers.delete(channel); },
  }, {
    currentWindow: () => currentWindow,
    authorize: candidate => candidate.senderFrame.url === "http://127.0.0.1:1234/",
    showOpenDialog(owner, options) {
      const selection = deferred();
      dialogs.push({ owner, options, selection });
      return selection.promise;
    },
  });
  const handler = handlers.get(DIRECTORY_PICK_CHANNEL);
  return {
    window, event, handlers, binding, removed, actions, dialogs,
    pick: (candidate = event) => handler(candidate),
    replaceWindow: value => { currentWindow = value; },
    destroyWindow: () => { destroyed = true; },
    destroyContents: () => { contentsDestroyed = true; },
  };
}

test("the owning local main frame gets one window-bound directory dialog", async () => {
  const f = fixture();
  const selection = f.pick();
  await Promise.resolve();
  assert.deepEqual(f.actions, ["restore", "show", "focus"]);
  assert.equal(f.dialogs[0].owner, f.window);
  assert.deepEqual(f.dialogs[0].options, { properties: ["openDirectory", "createDirectory"] });
  f.dialogs[0].selection.resolve({ canceled: false, filePaths: ["/工作区/project", "/ignored"] });
  assert.equal(await selection, "/工作区/project");
  f.binding.dispose();
});

test("unauthorized origins, guest windows, same-origin child frames and dead owners cannot pick", async () => {
  const f = fixture();
  for (const event of [
    { sender: {}, senderFrame: f.event.senderFrame },
    { sender: f.event.sender, senderFrame: null },
    { sender: f.event.sender, senderFrame: { url: f.event.senderFrame.url } },
  ]) {
    await assert.rejects(f.pick(event), /unauthorized directory picker/);
  }
  f.event.senderFrame.url = "https://remote.example/";
  await assert.rejects(f.pick(), /unauthorized directory picker/);
  f.event.senderFrame.url = "http://127.0.0.1:1234/";
  f.destroyContents();
  await assert.rejects(f.pick(), /unauthorized directory picker/);
  f.replaceWindow(undefined);
  await assert.rejects(f.pick(), /unauthorized directory picker/);
  assert.equal(f.dialogs.length, 0);
  assert.deepEqual(f.actions, []);
  f.binding.dispose();
});

test("concurrent requests share cancellation and a later request can open again", async () => {
  const f = fixture();
  const first = f.pick();
  const concurrent = f.pick();
  await Promise.resolve();
  assert.equal(f.dialogs.length, 1);
  await assert.rejects(f.pick({ sender: {}, senderFrame: f.event.senderFrame }), /unauthorized/);
  f.dialogs[0].selection.resolve({ canceled: true, filePaths: ["/discarded"] });
  assert.deepEqual(await Promise.all([first, concurrent]), [null, null]);
  const next = f.pick();
  await Promise.resolve();
  assert.equal(f.dialogs.length, 2);
  assert.deepEqual(f.actions, ["restore", "show", "focus", "show", "focus"]);
  f.dialogs[1].selection.resolve({ canceled: false, filePaths: [] });
  assert.equal(await next, null);
  f.binding.dispose();
});

test("dialog failure reaches DSH and does not block a subsequent retry", async () => {
  const f = fixture();
  const selected = f.pick();
  await Promise.resolve();
  f.dialogs[0].selection.reject(new Error("chooser unavailable"));
  await assert.rejects(selected, /chooser unavailable/);
  const retry = f.pick();
  await Promise.resolve();
  assert.equal(f.dialogs.length, 2);
  f.dialogs[1].selection.resolve({ canceled: false, filePaths: ["/recovered"] });
  assert.equal(await retry, "/recovered");
  f.binding.dispose();
});

test("pending picks discard results when the owning renderer changes or closes", async () => {
  for (const invalidate of [
    f => f.destroyWindow(),
    f => f.destroyContents(),
    f => f.replaceWindow({}),
    f => { f.event.senderFrame.url = "https://remote.example/"; },
    f => { f.window.webContents.mainFrame = { url: "http://127.0.0.1:1234/" }; },
  ]) {
    const f = fixture();
    const selected = f.pick();
    await Promise.resolve();
    invalidate(f);
    f.dialogs[0].selection.resolve({ canceled: false, filePaths: ["/private"] });
    assert.equal(await selected, null);
    f.binding.dispose();
  }
});

test("closing before the queued pick and errors after destruction both cancel", async () => {
  const queued = fixture();
  const skipped = queued.pick();
  queued.destroyWindow();
  assert.equal(await skipped, null);
  assert.equal(queued.dialogs.length, 0);
  queued.binding.dispose();

  const opened = fixture();
  const selected = opened.pick();
  await Promise.resolve();
  opened.destroyWindow();
  opened.dialogs[0].selection.reject(new Error("owner was destroyed"));
  assert.equal(await selected, null);
  opened.binding.dispose();
});

test("disposing unregisters once, cancels settlement and rejects stale calls", async () => {
  const f = fixture();
  const selected = f.pick();
  await Promise.resolve();
  f.binding.dispose();
  f.binding.dispose();
  assert.deepEqual(f.removed, [DIRECTORY_PICK_CHANNEL]);
  assert.equal(f.handlers.size, 0);
  await assert.rejects(f.pick(), /unauthorized/);
  f.dialogs[0].selection.resolve({ canceled: false, filePaths: ["/private"] });
  assert.equal(await selected, null);
});

test("pinned DSH uses the desktop bridge locally and keeps the Host fallback without it", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__DSH_DIRECTORY_PICKER__");
  try {
    for (const desktop of [true, false]) {
      let localPicks = 0;
      let hostPicks = 0;
      const entries = [];
      if (desktop) globalThis.__DSH_DIRECTORY_PICKER__ = { pick: async () => { localPicks++; return "/local"; } };
      else delete globalThis.__DSH_DIRECTORY_PICKER__;
      applyNativeDirectoryPicker({
        uiWorkspace: { pickDirectory: async () => { hostPicks++; return "/host"; } },
        remoteAccess: {
          whenAccess(capability, activate) {
            assert.equal(capability, "directoryPicker/pick");
            activate();
          },
        },
        slots: {
          inject(_name, callback) {
            const effect = callback();
            if (effect?.next !== undefined) for (const _ of effect) { /* activate registrations */ }
          },
          register(entry) { entries.push(entry); },
        },
      });
      assert.deepEqual(entries.map(entry => entry.name), [
        "conversation.hero.workspace.directoryFlow", "sidebar.workspaces.directoryFlow", "workspace.picker.directoryFlow",
      ]);
      for (const entry of entries) assert.equal(await entry.inject().pick(), desktop ? "/local" : "/host");
      assert.equal(localPicks, desktop ? 3 : 0);
      assert.equal(hostPicks, desktop ? 0 : 3);
    }
  } finally {
    if (previous === undefined) delete globalThis.__DSH_DIRECTORY_PICKER__;
    else Object.defineProperty(globalThis, "__DSH_DIRECTORY_PICKER__", previous);
  }
});
