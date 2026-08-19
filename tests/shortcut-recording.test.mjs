import assert from "node:assert/strict";
import test from "node:test";
import {
  installShortcutRecordingEscapeGuard,
} from "@minke/harness-overlay/client/shortcuts/shortcut-recording.ts";

class KeyboardTarget {
  captureListeners = [];
  bubbleListeners = [];

  addEventListener(type, listener, options) {
    assert.equal(type, "keydown");
    const capture = options === true || options?.capture === true;
    (capture ? this.captureListeners : this.bubbleListeners).push(listener);
  }

  removeEventListener(type, listener, options) {
    assert.equal(type, "keydown");
    const capture = options === true || options?.capture === true;
    const listeners = capture
      ? this.captureListeners
      : this.bubbleListeners;
    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
  }

  dispatch(key) {
    const event = {
      key,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    };

    for (const listener of [...this.captureListeners]) listener(event);
    if (!event.propagationStopped) {
      for (const listener of [...this.bubbleListeners]) listener(event);
    }
    return event;
  }
}

test("recording consumes the first Escape before Settings can close", () => {
  const target = new KeyboardTarget();
  let recording = true;
  let settingsCloseCount = 0;
  let uninstall = () => {};

  target.addEventListener("keydown", (event) => {
    if (event.key === "Escape") settingsCloseCount += 1;
  });
  uninstall = installShortcutRecordingEscapeGuard(target, () => {
    recording = false;
    uninstall();
  });

  const firstEscape = target.dispatch("Escape");
  assert.equal(recording, false);
  assert.equal(firstEscape.defaultPrevented, true);
  assert.equal(settingsCloseCount, 0);

  target.dispatch("Escape");
  assert.equal(settingsCloseCount, 1);
});

test("recording guard leaves non-Escape keys untouched", () => {
  const target = new KeyboardTarget();
  let cancelCount = 0;
  let bubbleCount = 0;

  target.addEventListener("keydown", () => {
    bubbleCount += 1;
  });
  const uninstall = installShortcutRecordingEscapeGuard(target, () => {
    cancelCount += 1;
  });

  const event = target.dispatch("Tab");
  assert.equal(event.defaultPrevented, false);
  assert.equal(cancelCount, 0);
  assert.equal(bubbleCount, 1);

  uninstall();
});
