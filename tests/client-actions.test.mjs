import assert from "node:assert/strict";
import test from "node:test";
import {
  openHarnessSettings,
  SETTINGS_TRIGGER_SELECTOR,
} from "@minke/harness-overlay/client/shortcuts/actions.ts";

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
