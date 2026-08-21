import assert from "node:assert/strict";
import test from "node:test";
import { ShortcutRuntime } from "@minke/harness-overlay/client/shortcuts/runtime.ts";

class KeyboardTarget {
  listener;

  addEventListener(_type, listener) {
    this.listener = listener;
  }

  removeEventListener(_type, listener) {
    if (this.listener === listener) this.listener = undefined;
  }

  dispatch(event) {
    this.listener?.(event);
  }
}

function keyboardEvent(overrides = {}) {
  const event = {
    key: "n",
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    getModifierState: () => false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...overrides,
  };
  return event;
}

function store(initial = {}) {
  const writes = [];
  return {
    available: true,
    writes,
    async read() {
      return { ...initial };
    },
    async write(bindings) {
      writes.push({ ...bindings });
    },
  };
}

test("shortcuts hydrate, dispatch, and preserve unknown durable actions", async () => {
  const target = new KeyboardTarget();
  const persistence = store({ "future.action": "Mod+K" });
  const runtime = new ShortcutRuntime(persistence, target, "apple");
  let newSessions = 0;
  let settingsOpens = 0;
  runtime.register({
    id: "settings.open",
    label: () => "Settings",
    defaultBinding: "Mod+Comma",
    run: () => {
      settingsOpens += 1;
    },
  });
  runtime.register({
    id: "session.new",
    label: () => "New Session",
    defaultBinding: "Mod+N",
    run: () => {
      newSessions += 1;
    },
  });

  await runtime.initialize();
  assert.equal(runtime.editable, true);
  target.dispatch(keyboardEvent());
  assert.equal(newSessions, 1);
  assert.equal(settingsOpens, 0);

  assert.deepEqual(runtime.setBinding("session.new", null), { ok: true });
  await runtime.flush();
  assert.deepEqual(persistence.writes.at(-1), {
    "future.action": "Mod+K",
    "session.new": "",
  });

  target.dispatch(keyboardEvent());
  assert.equal(newSessions, 1);
  assert.equal(runtime.invoke("session.new"), true);
  assert.equal(newSessions, 2);
  assert.equal(runtime.invoke("missing.action"), false);
  runtime.dispose();
  assert.equal(target.listener, undefined);
});

test("shortcut actions notify observers before they run", () => {
  const runtime = new ShortcutRuntime(
    { available: false },
    new KeyboardTarget(),
    "apple",
  );
  const events = [];
  runtime.register({
    id: "settings.open",
    label: () => "Settings",
    defaultBinding: "Mod+Comma",
    run() {
      events.push("run");
    },
  });
  const unsubscribe = runtime.onBeforeInvoke((id) => {
    events.push(`before:${id}`);
  });

  assert.equal(runtime.invoke("settings.open"), true);
  assert.deepEqual(events, ["before:settings.open", "run"]);

  unsubscribe();
  assert.equal(runtime.invoke("settings.open"), true);
  assert.deepEqual(events, ["before:settings.open", "run", "run"]);
  runtime.dispose();
});

test("a conflicting assignment is rejected without persistence", async () => {
  const persistence = store();
  const runtime = new ShortcutRuntime(
    persistence,
    new KeyboardTarget(),
    "apple",
  );
  runtime.register({
    id: "settings.open",
    label: () => "Settings",
    defaultBinding: "Mod+Comma",
    run() {},
  });
  runtime.register({
    id: "session.new",
    label: () => "New Session",
    defaultBinding: "Mod+N",
    run() {},
  });
  await runtime.initialize();

  assert.deepEqual(
    runtime.setBinding("settings.open", "Mod+N"),
    { ok: false, conflictActionId: "session.new" },
  );
  await runtime.flush();
  assert.equal(persistence.writes.length, 0);
  runtime.dispose();
});

test("persistence failures become observable without unhandled rejection", async () => {
  const runtime = new ShortcutRuntime(
    {
      available: true,
      async read() {
        return {};
      },
      async write() {
        throw new Error("disk full");
      },
    },
    new KeyboardTarget(),
    "apple",
  );
  runtime.register({
    id: "session.new",
    label: () => "New Session",
    defaultBinding: "Mod+N",
    run() {},
  });
  await runtime.initialize();

  runtime.setBinding("session.new", "Mod+Shift+N");
  await runtime.flush();
  assert.equal(runtime.error, "write");
  runtime.dispose();
});

test("palette actions expose metadata without cluttering shortcut settings", async () => {
  const target = new KeyboardTarget();
  const runtime = new ShortcutRuntime(
    store({ "session.export": "Mod+E" }),
    target,
    "apple",
  );
  let runs = 0;
  let unavailable = true;
  runtime.register({
    id: "session.export",
    label: () => "Export Current Session",
    defaultBinding: null,
    order: 20,
    shortcutConfigurable: false,
    palette: {
      group: "session",
      keywords: () => ["download", "log"],
      disabledReason: () => unavailable ? "No active session" : undefined,
    },
    run() {
      runs += 1;
    },
  });
  await runtime.initialize();

  assert.deepEqual(runtime.listActions(), []);
  assert.deepEqual(runtime.listPaletteActions(), [{
    id: "session.export",
    label: "Export Current Session",
    group: "session",
    keywords: ["download", "log"],
    binding: null,
    order: 20,
    disabledReason: "No active session",
  }]);
  assert.equal(runtime.invoke("session.export"), false);
  assert.equal(runs, 0);
  assert.throws(
    () => runtime.setBinding("session.export", "Mod+E"),
    /not configurable/u,
  );

  unavailable = false;
  target.dispatch(keyboardEvent({ key: "e" }));
  assert.equal(runs, 0);
  assert.equal(runtime.invoke("session.export"), true);
  assert.equal(runs, 1);
  runtime.dispose();
});
