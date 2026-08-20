import assert from "node:assert/strict";
import test from "node:test";
import {
  hasOpenModalSurface,
  MODAL_SURFACE_SELECTOR,
  openHarnessSettings,
  SETTINGS_TRIGGER_SELECTOR,
} from "@minke/harness-overlay/client/actions.ts";

test("modal detection follows the accessible dialog contract", () => {
  const selectors = [];
  const root = {
    querySelector(selector) {
      selectors.push(selector);
      return { role: "dialog" };
    },
  };

  assert.equal(hasOpenModalSurface(root), true);
  assert.deepEqual(selectors, [MODAL_SURFACE_SELECTOR]);
  assert.match(MODAL_SURFACE_SELECTOR, /aria-modal="true"/u);
  assert.equal(
    hasOpenModalSurface({ querySelector: () => null }),
    false,
  );
});

test("the Settings shortcut ignores the adjacent About dialog trigger", () => {
  const clicks = [];
  const about = {
    click() {
      clicks.push("about");
    },
  };
  const settings = {
    click() {
      clicks.push("settings");
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('[data-slot="sidebar.settings"]')) {
        return [settings];
      }
      return [about, settings];
    },
  };

  assert.equal(openHarnessSettings(root), true);
  assert.deepEqual(clicks, ["settings"]);
  assert.match(
    SETTINGS_TRIGGER_SELECTOR,
    /\[data-slot="sidebar\.settings"\]/u,
  );
});
