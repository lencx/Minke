import assert from "node:assert/strict";
import test from "node:test";
import {
  formatShortcutBinding,
  shortcutBindingFromEvent,
} from "../packages/harness-overlay/src/client/binding.ts";

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
});
