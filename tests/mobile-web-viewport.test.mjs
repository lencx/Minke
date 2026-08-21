import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MOBILE_WEB_ROOT_ATTRIBUTE,
  MOBILE_WEB_VIEWPORT_STYLES,
  MobileWebViewportRuntime,
} from "@minke/harness-overlay/client/host/mobile-web-viewport.ts";
import {
  TABS_STYLES,
} from "@minke/harness-overlay/client/tabs/styles.ts";
import {
  observeTerminalVisualViewport,
} from "@minke/harness-overlay/client/tabs/terminal/visual-viewport.ts";

test("mobile drawer follows the visible viewport above the keyboard", () => {
  assert.match(
    MOBILE_WEB_VIEWPORT_STYLES,
    /html\[data-minke-mobile-web\][\s\S]*overflow:\s*hidden/u,
  );
  assert.match(
    MOBILE_WEB_VIEWPORT_STYLES,
    /html\[data-minke-mobile-web\]\s+body\s*\{[\s\S]*position:\s*fixed;[\s\S]*height:\s*var\(--minke-visual-viewport-height[\s\S]*overflow:\s*hidden/u,
  );
  assert.match(
    TABS_STYLES,
    /data-presentation="drawer"\]\s*\{[\s\S]*position:\s*fixed;[\s\S]*top:\s*var\(--minke-visual-viewport-offset-top[\s\S]*bottom:\s*auto;[\s\S]*height:\s*var\(--minke-visual-viewport-height/u,
  );
});

test("mobile viewport runtime tracks keyboard height and cleans up", () => {
  const styleValues = new Map();
  const rootAttributes = new Map();
  const root = {
    style: {
      setProperty: (name, value) => styleValues.set(name, value),
      removeProperty: (name) => styleValues.delete(name),
    },
    setAttribute: (name, value) => rootAttributes.set(name, value),
    removeAttribute: (name) => rootAttributes.delete(name),
  };
  const visualViewport = new EventTarget();
  visualViewport.height = 512;
  visualViewport.offsetTop = 20;
  const runtime = new MobileWebViewportRuntime(root, {
    innerHeight: 800,
    visualViewport,
  });

  runtime.start();
  assert.equal(rootAttributes.get(MOBILE_WEB_ROOT_ATTRIBUTE), "");
  assert.equal(
    styleValues.get("--minke-visual-viewport-height"),
    "512px",
  );
  assert.equal(
    styleValues.get("--minke-visual-viewport-offset-top"),
    "20px",
  );

  visualViewport.height = 344;
  visualViewport.offsetTop = 7;
  visualViewport.dispatchEvent(new Event("resize"));
  assert.equal(
    styleValues.get("--minke-visual-viewport-height"),
    "344px",
  );
  assert.equal(
    styleValues.get("--minke-visual-viewport-offset-top"),
    "7px",
  );

  runtime.dispose();
  assert.equal(rootAttributes.has(MOBILE_WEB_ROOT_ATTRIBUTE), false);
  assert.equal(
    styleValues.has("--minke-visual-viewport-height"),
    false,
  );
});

test("terminal observes keyboard-driven visual viewport changes", () => {
  const terminalViewSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/terminal/TerminalView.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    terminalViewSource,
    /observeTerminalVisualViewport\(view,\s*scheduleFit\)/u,
  );
  const visualViewport = new EventTarget();
  const calls = [];
  const dispose = observeTerminalVisualViewport(
    { visualViewport },
    () => calls.push("fit"),
  );

  visualViewport.dispatchEvent(new Event("resize"));
  visualViewport.dispatchEvent(new Event("scroll"));
  assert.deepEqual(calls, ["fit", "fit"]);

  dispose();
  visualViewport.dispatchEvent(new Event("resize"));
  assert.deepEqual(calls, ["fit", "fit"]);
});
