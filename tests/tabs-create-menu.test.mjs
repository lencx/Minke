import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  createElement,
  StrictMode,
} from "react";
import {
  JSDOM,
} from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  TabsCreateMenu,
} from "@minke/harness-overlay/client/tabs/TabsCreateMenu.tsx";
import {
  TabsPanel,
} from "@minke/harness-overlay/client/tabs/TabsPanel.tsx";
import {
  TabRendererRegistry,
} from "@minke/harness-overlay/client/tabs/registry.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  TABS_STYLES,
} from "@minke/harness-overlay/client/tabs/styles.ts";
import {
  inspectCssContract,
} from "./support/css-contract.mjs";

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

test("the populated TabsPanel mounts its new-tab menu after the plus button is clicked", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const runtime = new TabsRuntime({
        hidePanel() {},
        showPanel() {},
      });
      const renderers = new TabRendererRegistry();
      renderers.register({
        kind: "terminal",
        createOptions() {
          return [{
            id: "terminal",
            label: "Terminal",
            icon: createElement("span", null, "T"),
            create() {},
          }];
        },
        renderIcon() {
          return createElement("span", null, "T");
        },
        renderView(tab, active) {
          return createElement("div", {
            hidden: !active,
            id: `minke-tab-view-${tab.id}`,
            key: tab.id,
            role: "tabpanel",
          });
        },
      });
      runtime.open({
        kind: "terminal",
        key: "terminal-1",
        title: "Terminal",
        payload: {},
      });
      const createShortcuts = {
        platform: "apple",
        binding() {
          return "Mod+2";
        },
        getSnapshot: () => 0,
        subscribe: () => () => {},
      };
      const layoutState = {
        async size() {
          return undefined;
        },
        setSize() {},
      };
      const container =
        dom.window.document.getElementById("root");
      assert.ok(container);
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        "scrollIntoView",
        {
          configurable: true,
          value() {},
        },
      );
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(
              StrictMode,
              null,
              createElement(TabsPanel, {
                createShortcuts,
                layoutState,
                placement: "right",
                renderers,
                runtime,
                t: (key) => key,
                useSessions(selector) {
                  return selector({
                    byId: {},
                    current: undefined,
                  });
                },
              }),
            ),
          );
          await new Promise((resolve) => setImmediate(resolve));
        });
        const button = container.querySelector(
          '.minke-tabs-toolbar__button[aria-haspopup="menu"]',
        );
        assert.ok(button instanceof dom.window.HTMLButtonElement);
        assert.equal(button.getAttribute("aria-expanded"), "false");

        act(() => {
          button.click();
        });

        assert.equal(button.getAttribute("aria-expanded"), "true");
        const menu =
          dom.window.document.querySelector('[role="menu"]');
        assert.ok(
          menu instanceof dom.window.HTMLElement,
          "an expanded TabsPanel new-tab button must own a mounted menu",
        );
        assert.equal(
          button.getAttribute("aria-controls"),
          menu.id,
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        runtime.dispose();
      }
    });
  } finally {
    dom.window.close();
  }
});

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
        assert.equal(menu.style.width, "224px");
        const items = [
          ...menu.querySelectorAll('[role="menuitem"]'),
        ];
        assert.equal(items.length, 2);
        assert.equal(
          menu.querySelector(".minke-tabs-create-menu__shortcut"),
          null,
        );
        assert.equal(items[0].getAttribute("aria-keyshortcuts"), null);
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

test("the new-tab menu presents real shortcuts for each platform and placement", async () => {
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
      const root = createRoot(container);
      const options = [{
        id: "terminal",
        label: "Terminal",
        icon: createElement("span", null, "T"),
        create() {},
      }];
      const cases = [
        {
          aria: "Meta+T",
          binding: "Mod+T",
          innerWidth: 1_024,
          left: "48px",
          placement: "right",
          platform: "apple",
          text: "⌘T",
          width: "240px",
        },
        {
          aria: "Meta+Shift+T",
          binding: "Mod+Shift+T",
          innerWidth: 1_024,
          left: "48px",
          placement: "bottom",
          platform: "apple",
          text: "⇧⌘T",
          width: "240px",
        },
        {
          aria: "Control+T",
          binding: "Mod+T",
          innerWidth: 1_024,
          left: "8px",
          placement: "right",
          platform: "other",
          text: "Ctrl + T",
          width: "288px",
        },
        {
          aria: "Control+Shift+T",
          binding: "Mod+Shift+T",
          innerWidth: 1_024,
          left: "8px",
          placement: "bottom",
          platform: "other",
          text: "Ctrl + Shift + T",
          width: "288px",
        },
        {
          aria: null,
          binding: null,
          innerWidth: 1_024,
          left: "8px",
          placement: "bottom",
          platform: "other",
          text: null,
          width: "288px",
        },
        {
          aria: "Control+Shift+T",
          binding: "Mod+Shift+T",
          innerWidth: 200,
          left: "8px",
          placement: "bottom",
          platform: "other",
          text: "Ctrl + Shift + T",
          width: "184px",
        },
      ];

      try {
        for (const candidate of cases) {
          Object.defineProperty(dom.window, "innerWidth", {
            configurable: true,
            value: candidate.innerWidth,
          });
          await act(async () => {
            root.render(
              createElement(TabsCreateMenu, {
                anchor,
                context: {},
                label: "New tab",
                onClose() {},
                open: true,
                options,
                placement: candidate.placement,
                shortcutBinding() {
                  return candidate.binding;
                },
                shortcutPlatform: candidate.platform,
              }),
            );
            dom.window.dispatchEvent(
              new dom.window.Event("resize"),
            );
            await new Promise((resolve) => setImmediate(resolve));
          });

          const menu =
            dom.window.document.querySelector('[role="menu"]');
          const item = menu?.querySelector('[role="menuitem"]');
          assert.ok(menu instanceof dom.window.HTMLElement);
          assert.ok(item instanceof dom.window.HTMLButtonElement);
          assert.equal(
            menu.getAttribute("data-placement"),
            candidate.placement,
          );
          assert.equal(menu.style.left, candidate.left);
          assert.equal(menu.style.width, candidate.width);
          assert.equal(
            item.getAttribute("aria-keyshortcuts"),
            candidate.aria,
          );
          const shortcut = item.querySelector(
            ".minke-tabs-create-menu__shortcut",
          );
          if (candidate.text === null) {
            assert.equal(shortcut, null);
          } else {
            assert.equal(shortcut?.textContent, candidate.text);
            assert.equal(shortcut?.getAttribute("aria-hidden"), "true");
          }
        }
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

test("the new-tab shortcut column stays compact and does not wrap", () => {
  const contract = inspectCssContract(TABS_STYLES);
  assert.equal(
    contract.declaration(
      ".minke-tabs-create-menu__item",
      "display",
    ),
    "grid",
  );
  assert.equal(
    contract.declaration(
      ".minke-tabs-create-menu__item",
      "grid-template-columns",
    ),
    "18px minmax(0, 1fr) max-content",
  );
  assert.equal(
    contract.declaration(
      ".minke-tabs-create-menu__shortcut",
      "white-space",
    ),
    "nowrap",
  );
  assert.equal(
    contract.declaration(
      ".minke-tabs-create-menu__shortcut",
      "color",
    ),
    "var(--dsw-alias-label-tertiary)",
  );
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
