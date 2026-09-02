import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  createElement,
} from "react";
import {
  JSDOM,
} from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  TabsHeaderAction,
} from "@minke/harness-overlay/client/tabs/HeaderActions.ts";
import {
  createBottomTabsToggle,
} from "@minke/harness-overlay/client/tabs/bottom-toggle.ts";
import {
  tabsEn,
} from "@minke/harness-overlay/client/tabs/locales.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";

async function withBrowserGlobals(dom, callback) {
  const values = {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    window: dom.window,
  };
  const descriptors = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    }
    await callback();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) {
        delete globalThis[key];
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
}

test("the empty bottom Tabs action opens a Terminal directly", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const bottom = new TabsRuntime({
        showPanel() {},
        hidePanel() {},
      }, {
        idPrefix: "bottom-",
      });
      const right = new TabsRuntime({
        showPanel() {},
        hidePanel() {},
      });
      let defaultOpens = 0;
      let cwd = "/workspace/one";
      const toggleBottom = createBottomTabsToggle({
        runtime: bottom,
        currentCwd: () => cwd,
        defaultTitle: () => "Terminal",
        terminal: {
          create(currentCwd, title) {
            defaultOpens += 1;
            return bottom.open({
              kind: "terminal",
              key: `terminal-${String(defaultOpens)}`,
              title,
              payload: { cwd: currentCwd },
            });
          },
        },
      });
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(TabsHeaderAction, {
              runtimes: { bottom, right, toggleBottom },
              t: (key) => tabsEn[key],
            }),
          );
        });
        const button = container.querySelector(
          '[data-minke-tabs-placement="bottom"]',
        );
        assert.ok(button instanceof dom.window.HTMLButtonElement);

        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 1);
        assert.equal(bottom.getSnapshot().visible, true);
        assert.deepEqual(
          bottom.getSnapshot().tabs.map(({ kind, payload }) => ({
            kind,
            cwd: payload.cwd,
          })),
          [{ kind: "terminal", cwd: "/workspace/one" }],
        );

        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 1);
        assert.equal(bottom.getSnapshot().visible, false);

        await act(async () => {
          bottom.close(bottom.getSnapshot().tabs[0].id);
        });
        cwd = "/workspace/two";
        await act(async () => {
          button.click();
        });
        assert.equal(defaultOpens, 2);
        assert.equal(bottom.getSnapshot().visible, true);
        assert.equal(
          bottom.getSnapshot().tabs[0].payload.cwd,
          "/workspace/two",
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        bottom.dispose();
        right.dispose();
      }
    });
  } finally {
    dom.window.close();
  }
});
