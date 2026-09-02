import assert from "node:assert/strict";
import test from "node:test";
import {
  TAB_CREATE_SHORTCUT_DESCRIPTORS,
} from "@minke/harness-overlay/shortcut-contract.ts";
import {
  TabCreateShortcutBindings,
} from "@minke/harness-overlay/client/tabs/create-shortcuts.ts";

function source(platform, actions) {
  const listeners = new Set();
  let current = actions;
  return {
    platform,
    listActions() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

test("tab create shortcuts connect and follow effective bindings", () => {
  assert.equal(TAB_CREATE_SHORTCUT_DESCRIPTORS.length, 10);
  const rightFiles = TAB_CREATE_SHORTCUT_DESCRIPTORS.find(
    (descriptor) =>
      descriptor.placement === "right" &&
      descriptor.creatorId === "files",
  );
  const bottomTerminal = TAB_CREATE_SHORTCUT_DESCRIPTORS.find(
    (descriptor) =>
      descriptor.placement === "bottom" &&
      descriptor.creatorId === "terminal",
  );
  assert.ok(rightFiles);
  assert.ok(bottomTerminal);

  const bindings = new TabCreateShortcutBindings();
  const runtime = source("apple", [
    {
      id: rightFiles.actionId,
      binding: "Mod+1",
      conflicts: [],
    },
    { id: bottomTerminal.actionId, binding: null },
    { id: "unrelated.action", binding: "Mod+9" },
  ]);
  let notifications = 0;
  bindings.subscribe(() => {
    notifications += 1;
  });

  const disconnect = bindings.connect(runtime);

  assert.equal(bindings.platform, "apple");
  assert.equal(
    bindings.binding("right", "files"),
    "Mod+1",
  );
  assert.equal(bindings.binding("bottom", "terminal"), null);
  assert.equal(bindings.binding("right", "unknown"), undefined);
  assert.equal(bindings.binding("bottom", "files"), undefined);
  assert.equal(runtime.listenerCount, 1);
  assert.equal(notifications, 1);

  runtime.update([
    {
      id: rightFiles.actionId,
      binding: "Mod+7",
      conflicts: ["legacy.custom"],
    },
    {
      id: bottomTerminal.actionId,
      binding: "Mod+Shift+2",
    },
  ]);

  assert.equal(
    bindings.binding("right", "files"),
    null,
    "conflicted bindings must not be advertised as usable",
  );
  assert.equal(
    bindings.binding("bottom", "terminal"),
    "Mod+Shift+2",
  );
  assert.equal(notifications, 2);

  disconnect();
  assert.equal(runtime.listenerCount, 0);
  assert.equal(bindings.binding("right", "files"), undefined);
  assert.equal(notifications, 3);

  runtime.update([
    { id: rightFiles.actionId, binding: "Mod+8" },
  ]);
  assert.equal(bindings.binding("right", "files"), undefined);
  assert.equal(notifications, 3);
});

test("tab create shortcut reconnect and disposal are idempotent", () => {
  const descriptor = TAB_CREATE_SHORTCUT_DESCRIPTORS[0];
  assert.ok(descriptor);
  const first = source("other", [{
    id: descriptor.actionId,
    binding: descriptor.defaultBinding,
  }]);
  const second = source("apple", [{
    id: descriptor.actionId,
    binding: null,
  }]);
  const bindings = new TabCreateShortcutBindings();

  const disconnectFirst = bindings.connect(first);
  const disconnectSecond = bindings.connect(second);
  assert.equal(first.listenerCount, 0);
  assert.equal(second.listenerCount, 1);
  assert.equal(bindings.platform, "apple");
  assert.equal(
    bindings.binding(
      descriptor.placement,
      descriptor.creatorId,
    ),
    null,
  );

  disconnectFirst();
  assert.equal(second.listenerCount, 1);
  disconnectSecond();
  disconnectSecond();
  bindings.disconnect();
  bindings.dispose();
  bindings.dispose();
  assert.equal(second.listenerCount, 0);

  const afterDispose = source("apple", [{
    id: descriptor.actionId,
    binding: "Mod+9",
  }]);
  bindings.connect(afterDispose);
  assert.equal(afterDispose.listenerCount, 0);
  assert.equal(
    bindings.binding(
      descriptor.placement,
      descriptor.creatorId,
    ),
    undefined,
  );
});
