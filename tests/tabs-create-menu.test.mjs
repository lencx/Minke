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
  TabsCreateMenu,
} from "@minke/harness-overlay/client/tabs/TabsCreateMenu.tsx";

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

test("the new-tab menu is anchored, keyboard navigable, and creates a tab", async () => {
  const dom = new JSDOM(
    '<!doctype html><button id="anchor">+</button><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const anchor = dom.window.document.getElementById("anchor");
      const container = dom.window.document.getElementById("root");
      assert.ok(anchor instanceof dom.window.HTMLButtonElement);
      assert.ok(container);
      anchor.getBoundingClientRect = () => ({
        bottom: 44,
        height: 28,
        left: 260,
        right: 288,
        top: 16,
        width: 28,
        x: 260,
        y: 16,
        toJSON() {},
      });
      const created = [];
      let closes = 0;
      let createdFocuses = 0;
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(TabsCreateMenu, {
              anchor,
              context: { cwd: "/workspace" },
              label: "New tab",
              onClose() {
                closes += 1;
              },
              onCreated() {
                createdFocuses += 1;
              },
              open: true,
              options: [
                {
                  id: "terminal",
                  label: "Terminal",
                  icon: createElement("span", null, "T"),
                  create(context) {
                    created.push(["terminal", context]);
                  },
                },
                {
                  id: "browser",
                  label: "Browser",
                  icon: createElement("span", null, "B"),
                  create(context) {
                    created.push(["browser", context]);
                  },
                },
              ],
              placement: "right",
            }),
          );
          await new Promise((resolve) => setImmediate(resolve));
        });
        const menu = dom.window.document.querySelector('[role="menu"]');
        assert.ok(menu instanceof dom.window.HTMLElement);
        assert.equal(menu.getAttribute("aria-label"), "New tab");
        assert.equal(menu.getAttribute("data-side"), "below");
        assert.equal(menu.style.left, "64px");
        assert.equal(menu.style.top, "50px");
        const items = [
          ...menu.querySelectorAll('[role="menuitem"]'),
        ];
        assert.equal(items.length, 2);
        assert.equal(dom.window.document.activeElement, items[0]);

        await act(async () => {
          items[0].dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              bubbles: true,
              key: "ArrowDown",
            }),
          );
        });
        assert.equal(dom.window.document.activeElement, items[1]);

        await act(async () => {
          menu.dispatchEvent(
            new dom.window.Event("scroll", {
              bubbles: false,
            }),
          );
        });
        assert.equal(
          dom.window.document.activeElement,
          items[1],
          "repositioning must not reset keyboard focus",
        );

        await act(async () => {
          items[1].dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              bubbles: true,
              key: "Escape",
            }),
          );
        });
        assert.equal(dom.window.document.activeElement, anchor);
        assert.equal(closes, 1);

        await act(async () => {
          items[1].click();
        });
        assert.deepEqual(created, [
          ["browser", { cwd: "/workspace" }],
        ]);
        assert.equal(closes, 2);
        assert.equal(createdFocuses, 1);
      } finally {
        await act(async () => {
          root.unmount();
        });
      }
    });
  } finally {
    dom.window.close();
  }
});

test("the new-tab menu flips above a near-bottom anchor", async () => {
  const dom = new JSDOM(
    '<!doctype html><button id="anchor">+</button><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      Object.defineProperty(dom.window, "innerHeight", {
        configurable: true,
        value: 300,
      });
      const { createRoot } = await import("react-dom/client");
      const anchor = dom.window.document.getElementById("anchor");
      const container = dom.window.document.getElementById("root");
      assert.ok(anchor instanceof dom.window.HTMLButtonElement);
      assert.ok(container);
      anchor.getBoundingClientRect = () => ({
        bottom: 278,
        height: 28,
        left: 260,
        right: 288,
        top: 250,
        width: 28,
        x: 260,
        y: 250,
        toJSON() {},
      });
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(TabsCreateMenu, {
              anchor,
              context: {},
              label: "New tab",
              onClose() {},
              open: true,
              options: [
                {
                  id: "terminal",
                  label: "Terminal",
                  icon: null,
                  create() {},
                },
                {
                  id: "browser",
                  label: "Browser",
                  icon: null,
                  create() {},
                },
                {
                  id: "files",
                  label: "Files",
                  icon: null,
                  create() {},
                },
              ],
              placement: "bottom",
            }),
          );
          await new Promise((resolve) => setImmediate(resolve));
        });
        const menu = dom.window.document.querySelector('[role="menu"]');
        assert.ok(menu instanceof dom.window.HTMLElement);
        assert.equal(menu.getAttribute("data-side"), "above");
        assert.equal(menu.style.top, "");
        assert.equal(menu.style.bottom, "56px");
        assert.equal(menu.style.maxHeight, "236px");
      } finally {
        await act(async () => {
          root.unmount();
        });
      }
    });
  } finally {
    dom.window.close();
  }
});

test("Tab leaves a portaled drawer menu within its focus boundary", async () => {
  const dom = new JSDOM(
    [
      "<!doctype html>",
      '<aside id="boundary">',
      '<button id="before">Before</button>',
      '<button id="anchor">+</button>',
      '<button id="after">After</button>',
      "</aside>",
      '<div id="root"></div>',
    ].join(""),
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const boundary =
        dom.window.document.getElementById("boundary");
      const anchor = dom.window.document.getElementById("anchor");
      const after = dom.window.document.getElementById("after");
      const container = dom.window.document.getElementById("root");
      assert.ok(boundary instanceof dom.window.HTMLElement);
      assert.ok(anchor instanceof dom.window.HTMLButtonElement);
      assert.ok(after instanceof dom.window.HTMLButtonElement);
      assert.ok(container);
      anchor.getBoundingClientRect = () => ({
        bottom: 44,
        height: 28,
        left: 260,
        right: 288,
        top: 16,
        width: 28,
        x: 260,
        y: 16,
        toJSON() {},
      });
      let closes = 0;
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(TabsCreateMenu, {
              anchor,
              context: {},
              focusBoundary: boundary,
              id: "drawer-create-menu",
              label: "New tab",
              onClose() {
                closes += 1;
              },
              open: true,
              options: [{
                id: "terminal",
                label: "Terminal",
                icon: null,
                create() {},
              }],
              placement: "right",
            }),
          );
          await new Promise((resolve) => setImmediate(resolve));
        });
        const menu = dom.window.document.getElementById(
          "drawer-create-menu",
        );
        assert.ok(menu instanceof dom.window.HTMLElement);
        assert.equal(boundary.contains(menu), false);
        const item = menu.querySelector('[role="menuitem"]');
        assert.ok(item instanceof dom.window.HTMLButtonElement);

        await act(async () => {
          item.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              bubbles: true,
              key: "Tab",
            }),
          );
        });
        assert.equal(closes, 1);
        assert.equal(dom.window.document.activeElement, after);
      } finally {
        await act(async () => {
          root.unmount();
        });
      }
    });
  } finally {
    dom.window.close();
  }
});
