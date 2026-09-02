import assert from "node:assert/strict";
import test from "node:test";
import {
  formatShortcutBinding,
  formatShortcutBindingAria,
  formatShortcutBindingParts,
  shortcutBindingFromEvent,
} from "@minke/harness-overlay/client/shortcuts/binding.ts";
import {
  TAB_CREATE_SHORTCUT_DESCRIPTORS,
} from "@minke/harness-overlay/shortcut-contract.ts";

function keyEvent(overrides = {}) {
  return {
    key: "n",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    getModifierState: () => false,
    ...overrides,
  };
}

test("logical Mod follows the current platform", () => {
  assert.equal(
    shortcutBindingFromEvent(
      keyEvent({ metaKey: true }),
      "apple",
    ),
    "Mod+N",
  );
  assert.equal(
    shortcutBindingFromEvent(
      keyEvent({ ctrlKey: true }),
      "other",
    ),
    "Mod+N",
  );
  assert.equal(
    shortcutBindingFromEvent(
      keyEvent({ shiftKey: true }),
      "apple",
    ),
    null,
  );
  assert.equal(
    shortcutBindingFromEvent(
      keyEvent({
        code: "Digit1",
        key: "&",
        metaKey: true,
      }),
      "apple",
    ),
    "Mod+1",
    "number shortcuts must survive AZERTY key labels",
  );
});

test("punctuation bindings normalize and render natively", () => {
  assert.equal(
    shortcutBindingFromEvent(
      keyEvent({ key: ",", metaKey: true }),
      "apple",
    ),
    "Mod+Comma",
  );
  assert.equal(formatShortcutBinding("Mod+Comma", "apple"), "⌘,");
  assert.equal(formatShortcutBinding("Mod+Shift+N", "other"), "Ctrl + Shift + N");
  assert.deepEqual(
    formatShortcutBindingParts("Mod+Comma", "apple"),
    ["⌘", ","],
  );
  assert.deepEqual(
    formatShortcutBindingParts("Mod+Shift+N", "other"),
    ["Ctrl", "Shift", "N"],
  );
  assert.equal(
    formatShortcutBinding("Mod+Alt+Shift+1", "apple"),
    "⌥⇧⌘1",
  );
  assert.equal(
    formatShortcutBindingAria("Mod+Shift+1", "apple"),
    "Meta+Shift+1",
  );
  assert.equal(
    formatShortcutBindingAria("Mod+Shift+1", "other"),
    "Control+Shift+1",
  );
  assert.equal(
    formatShortcutBindingAria("Ctrl+Backquote", "apple"),
    "Control+`",
  );
});

test("bottom tab defaults pair with right-panel shortcuts without OS capture keys", () => {
  const right = TAB_CREATE_SHORTCUT_DESCRIPTORS.filter(
    (descriptor) => descriptor.placement === "right",
  );
  const bottom = TAB_CREATE_SHORTCUT_DESCRIPTORS.filter(
    (descriptor) => descriptor.placement === "bottom",
  );

  assert.equal(right.length, 5);
  assert.equal(bottom.length, 5);
  for (const rightDescriptor of right) {
    const bottomDescriptor = bottom.find(
      (descriptor) =>
        descriptor.creatorId === rightDescriptor.creatorId,
    );
    assert.ok(bottomDescriptor);
    assert.equal(
      bottomDescriptor.defaultBinding,
      rightDescriptor.defaultBinding.replace(
        "Mod+",
        "Mod+Shift+",
      ),
    );
    assert.doesNotMatch(
      bottomDescriptor.defaultBinding,
      /^Mod\+Shift\+[3-6]$/u,
      "macOS reserves these bindings for screen capture",
    );
  }
});
