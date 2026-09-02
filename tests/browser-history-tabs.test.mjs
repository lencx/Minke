import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  createElement,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  JSDOM,
} from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  BrowserHistoryTabsController,
} from "@minke/harness-overlay/client/tabs/browser-history/controller.ts";
import {
  agentBrowserTabsEn,
} from "@minke/harness-overlay/client/tabs/agent-browser/locales.ts";
import {
  createAgentBrowserTabRenderer,
} from "@minke/harness-overlay/client/tabs/agent-browser/renderer.tsx";
import {
  browserHistoryEn,
} from "@minke/harness-overlay/client/tabs/browser-history/locales.ts";
import {
  createBrowserHistoryTabRenderer,
} from "@minke/harness-overlay/client/tabs/browser-history/renderer.tsx";
import {
  computeBrowserHistoryVirtualRange,
} from "@minke/harness-overlay/client/tabs/browser-history/BrowserHistoryView.tsx";
import {
  BROWSER_HISTORY_STYLES,
} from "@minke/harness-overlay/client/tabs/browser-history/styles.ts";
import {
  BROWSER_HISTORY_TAB_KIND,
} from "@minke/harness-overlay/client/tabs/browser-history/types.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  inspectCssContract,
} from "./support/css-contract.mjs";

function fixture() {
  const opened = [];
  const reads = [];
  const clears = [];
  const deletes = [];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const history = {
    async readHistory(request) {
      reads.push(request);
      return {
        agentVisits: 1,
        humanVisits: 0,
        retainedVisits: 1,
        totalVisits: 1,
        uniquePaths: 1,
        visits: [{
          actor: "agent",
          navigationKind: "document",
          origin: "https://example.com",
          pathAgentVisits: 1,
          pathHumanVisits: 0,
          pathKey: "https://example.com/docs",
          pathname: "/docs",
          pathVisitCount: 1,
          title: "Example documentation",
          url: "https://example.com/docs",
          visitId: 1,
          visitedAt: 1_000,
        }],
      };
    },
    async clearHistory(request) {
      clears.push(request);
      return {
        agentVisits: 0,
        humanVisits: 0,
        retainedVisits: 0,
        totalVisits: 0,
        uniquePaths: 0,
        visits: [],
      };
    },
    async deleteHistory(request) {
      deletes.push(request);
    },
  };
  const webTabs = {
    open(url, title) {
      opened.push({ title, url });
      return "web-tab";
    },
  };
  return {
    controller: new BrowserHistoryTabsController(
      tabs,
      history,
      webTabs,
    ),
    clears,
    deletes,
    opened,
    reads,
    tabs,
  };
}

async function withBrowserGlobals(dom, callback) {
  const values = {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
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
    return await callback();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
}

function translate(key, params = {}) {
  let value = browserHistoryEn[key];
  for (const [name, replacement] of Object.entries(params)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function historyVisit(patch) {
  const url = patch.url;
  const parsed = new URL(url);
  return {
    actor: "human",
    navigationKind: "document",
    origin: parsed.origin,
    pathAgentVisits: 0,
    pathHumanVisits: 1,
    pathKey: `${parsed.origin}${parsed.pathname}`,
    pathname: parsed.pathname,
    pathVisitCount: 1,
    visitId: 1,
    visitedAt: 1_000,
    ...patch,
  };
}

test("Browser History is one reusable tab and opens visits in a Web tab", () => {
  const target = fixture();

  const first = target.controller.create("Browser History");
  const second = target.controller.create("Browser History");

  assert.equal(first, "tab-1");
  assert.equal(second, first);
  assert.deepEqual(
    target.tabs.getSnapshot().tabs.map(
      ({ kind, key, title }) => ({ key, kind, title }),
    ),
    [{
      key: "global",
      kind: BROWSER_HISTORY_TAB_KIND,
      title: "Browser History",
    }],
  );

  assert.equal(
    target.controller.openVisit(
      "https://example.com/docs",
      "Example documentation",
    ),
    "web-tab",
  );
  assert.deepEqual(target.opened, [{
    title: "Example documentation",
    url: "https://example.com/docs",
  }]);
});

test("Browser History reads, deletes one visit, and clears explicitly", async () => {
  const target = fixture();

  const recent = await target.controller.readRecent("agent");
  await target.controller.deleteVisit(1);
  const cleared = await target.controller.clear();

  assert.equal(recent.visits[0].title, "Example documentation");
  assert.equal(cleared.totalVisits, 0);
  assert.deepEqual(target.reads, [{
    actor: "agent",
    limit: 100,
  }]);
  assert.deepEqual(target.deletes, [{ visitId: 1 }]);
  assert.deepEqual(target.clears, [{ confirm: true }]);
});

test("Browser History registers a first-class tab creation mode", () => {
  const target = fixture();
  const renderer = createBrowserHistoryTabRenderer(
    target.controller,
    translate,
  );

  assert.equal(renderer.kind, BROWSER_HISTORY_TAB_KIND);
  const option = renderer.createOptions()[0];
  assert.deepEqual(
    {
      id: option.id,
      label: option.label,
      order: option.order,
    },
    {
      id: "browser-history",
      label: "Browser History",
      order: 21,
    },
  );

  option.create({});
  const tab = target.tabs.getSnapshot().tabs[0];
  const markup = renderToStaticMarkup(
    createElement(
      "div",
      null,
      renderer.renderIcon(tab),
      renderer.renderView(tab, true),
    ),
  );
  assert.match(markup, /role="tabpanel"/u);
  assert.match(markup, /id="minke-tab-view-tab-1"/u);
  assert.match(markup, /aria-label="Search browsing history"/u);
  assert.doesNotMatch(markup, /<h2/u);
});

test("Browser History searches content, filters actors, and opens a result", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  const reads = [];
  const opened = [];
  let resolveAgentRead;
  const visits = [
    historyVisit({
      actor: "human",
      pathHumanVisits: 2,
      pathVisitCount: 2,
      faviconUrl: "https://www.google.com/favicon.ico",
      searchQuery: "release notes",
      title: "Quarterly launch archive",
      url: "https://www.google.com/search?q=release+notes",
      visitId: 2,
      visitedAt: 2_000,
    }),
    historyVisit({
      actor: "agent",
      pathAgentVisits: 1,
      pathHumanVisits: 0,
      title: "Agent orchestration handbook",
      url: "https://example.com/docs",
    }),
    historyVisit({
      actor: "human",
      url: "https://fallback.example/path",
      visitId: 3,
      visitedAt: 500,
    }),
  ];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      readHistory(request) {
        reads.push(request);
        const actorVisits = request.actor === undefined
          ? visits
          : visits.filter((visit) => visit.actor === request.actor);
        const normalizedQuery = request.query?.toLowerCase();
        const selected = normalizedQuery === undefined
          ? actorVisits
          : actorVisits.filter((visit) => {
              const searchable = [
                visit.searchQuery,
                visit.title,
                visit.url,
              ].filter(Boolean).join("\n").toLowerCase();
              return normalizedQuery
                .split(/\s+/u)
                .every((token) => searchable.includes(token));
            });
        const result = {
          agentVisits: 1,
          humanVisits: 2,
          retainedVisits: 3,
          totalVisits: 3,
          uniquePaths: 3,
          visits: selected,
        };
        if (request.actor === "agent") {
          return new Promise((resolve) => {
            resolveAgentRead = () => resolve(result);
          });
        }
        return Promise.resolve(result);
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open(url, title) {
        opened.push({ title, url });
        return "opened-web-tab";
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });

        assert.equal(
          container.querySelector(
            ".minke-browser-history__header",
          ),
          null,
        );
        assert.equal(
          container.querySelector(
            ".minke-browser-history__search-control",
          )?.nextElementSibling,
          container.querySelector(
            ".minke-browser-history__clear",
          ),
        );
        const clearButton = container.querySelector(
          ".minke-browser-history__clear",
        );
        assert.ok(clearButton instanceof dom.window.HTMLButtonElement);
        assert.equal(clearButton.textContent, "");
        assert.equal(
          clearButton.getAttribute("aria-label"),
          "Clear browsing history",
        );
        const filterButtons = [
          ...container.querySelectorAll(
            ".minke-browser-history__filters button",
          ),
        ];
        assert.deepEqual(
          filterButtons.map(
            (button) => button.getAttribute("aria-label"),
          ),
          ["All", "You", "Agent"],
        );
        assert.ok(
          filterButtons.every(
            (button) =>
              button.textContent === "" &&
              button.querySelector("svg") !== null,
          ),
        );
        assert.deepEqual(
          [...container.querySelectorAll(
            ".minke-browser-history__visit-primary",
          )].map((node) => node.textContent),
          [
            "release notes",
            "Agent orchestration handbook",
            "fallback.example/path",
          ],
        );
        assert.deepEqual(
          [...container.querySelectorAll(
            ".minke-browser-history__visit-url",
          )].map((node) => node.textContent),
          [
            "www.google.com/search?q=release+notes",
            "example.com/docs",
            "fallback.example/path",
          ],
        );
        assert.equal(
          container.querySelector(
            ".minke-browser-history__result-count",
          )?.getAttribute("aria-live"),
          "polite",
        );
        const favicon = container.querySelector(
          ".minke-browser-history__visit-kind img",
        );
        assert.ok(favicon instanceof dom.window.HTMLImageElement);
        assert.equal(favicon.getAttribute("loading"), "lazy");
        assert.equal(favicon.getAttribute("decoding"), "async");
        assert.equal(favicon.getAttribute("referrerpolicy"), "no-referrer");
        await act(async () => {
          favicon.dispatchEvent(
            new dom.window.Event("error", { bubbles: false }),
          );
        });
        assert.equal(
          container.querySelector(
            ".minke-browser-history__visit-kind img",
          ),
          null,
        );
        assert.match(
          container.textContent,
          /1 visit/u,
        );
        const metadata = [
          ...container.querySelectorAll(
            ".minke-browser-history__visit-details",
          ),
        ];
        assert.match(
          metadata[0]?.textContent ?? "",
          /2 visits/u,
        );
        assert.match(
          metadata[1]?.textContent ?? "",
          /1 visit/u,
        );
        for (const time of container.querySelectorAll("time")) {
          assert.match(
            time.textContent ?? "",
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u,
          );
        }
        const actorIcons = [
          ...container.querySelectorAll(
            ".minke-browser-history__actor",
          ),
        ];
        assert.deepEqual(
          actorIcons.map((icon) => icon.getAttribute("aria-label")),
          ["You", "Agent", "You"],
        );
        assert.deepEqual(
          actorIcons.map((icon) => icon.getAttribute("title")),
          ["You", "Agent", "You"],
        );
        for (const details of container.querySelectorAll(
          ".minke-browser-history__visit-details",
        )) {
          assert.equal(
            details.firstElementChild?.classList.contains(
              "minke-browser-history__actor",
            ),
            true,
            "the visitor icon precedes the URL",
          );
        }

        const search = container.querySelector('input[type="search"]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        const valueSetter = Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          "value",
        )?.set;
        assert.ok(valueSetter);
        await act(async () => {
          valueSetter.call(search, "release");
          search.dispatchEvent(
            new dom.window.Event("input", { bubbles: true }),
          );
          await new Promise((resolve) => setTimeout(resolve, 220));
        });
        assert.equal(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length,
          1,
        );

        await act(async () => {
          valueSetter.call(search, "quarterly archive");
          search.dispatchEvent(
            new dom.window.Event("input", { bubbles: true }),
          );
          await new Promise((resolve) => setTimeout(resolve, 220));
        });
        assert.equal(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length,
          1,
          "search-query rows must remain discoverable by page title",
        );

        await act(async () => {
          valueSetter.call(search, "agent");
          search.dispatchEvent(
            new dom.window.Event("input", { bubbles: true }),
          );
        });
        await act(async () => {
          [...container.querySelectorAll("button")]
            .find(
              (button) =>
                button.getAttribute("aria-label") === "Agent",
            )
            ?.click();
          await Promise.resolve();
        });
        assert.equal(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length,
          0,
          "a pending actor read must not show stale all-actor visits",
        );
        assert.match(
          container.textContent,
          /Loading browsing history/u,
        );
        assert.ok(resolveAgentRead);
        await act(async () => {
          resolveAgentRead();
          await Promise.resolve();
        });
        assert.deepEqual(reads, [
          { limit: 100 },
          { limit: 100, query: "release" },
          { limit: 100, query: "quarterly archive" },
          { actor: "agent", limit: 100, query: "agent" },
        ]);

        const result = container.querySelector(
          ".minke-browser-history__visit",
        );
        assert.ok(result instanceof dom.window.HTMLElement);
        await act(async () => {
          result.click();
        });
        assert.deepEqual(opened, [{
          title: "Agent orchestration handbook",
          url: "https://example.com/docs",
        }]);

        await act(async () => {
          root.render(renderer.renderView(tab, false));
          await Promise.resolve();
        });
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        assert.deepEqual(reads, [
          { limit: 100 },
          { limit: 100, query: "release" },
          { limit: 100, query: "quarterly archive" },
          { actor: "agent", limit: 100, query: "agent" },
          { actor: "agent", limit: 100, query: "agent" },
        ]);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History deletes one visit without opening it and restores nearby focus", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  const visits = [
    historyVisit({
      title: "Entry one",
      url: "https://example.com/one",
      visitId: 3,
      visitedAt: 3_000,
    }),
    historyVisit({
      title: "Entry two",
      url: "https://example.com/two",
      visitId: 2,
      visitedAt: 2_000,
    }),
    historyVisit({
      title: "Entry three",
      url: "https://example.com/three",
      visitId: 1,
      visitedAt: 1_000,
    }),
  ];
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  let resolveDelete;
  const deleteCalls = [];
  const opened = [];
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        return {
          agentVisits: 0,
          humanVisits: visits.length,
          retainedVisits: visits.length,
          totalVisits: visits.length,
          uniquePaths: visits.length,
          visits,
        };
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open(url) {
        opened.push(url);
        return undefined;
      },
    },
  );
  controller.deleteVisit = (visitId) => {
    deleteCalls.push(visitId);
    return new Promise((resolve) => {
      resolveDelete = resolve;
    });
  };
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        const deleteButton = [...container.querySelectorAll(
          ".minke-browser-history__visit-delete",
        )].find(
          (button) =>
            button.getAttribute("aria-label") ===
              "Delete “Entry two”",
        );
        assert.ok(
          deleteButton instanceof dom.window.HTMLButtonElement,
        );
        assert.equal(
          deleteButton.getAttribute("title"),
          "Delete “Entry two”",
        );
        assert.equal(
          deleteButton.closest("button.minke-browser-history__visit"),
          null,
          "the delete action must not nest inside the visit button",
        );
        await act(async () => {
          deleteButton.focus();
          deleteButton.click();
          await Promise.resolve();
        });

        assert.deepEqual(deleteCalls, [2]);
        assert.deepEqual(opened, []);
        assert.equal(deleteButton.disabled, true);
        assert.equal(deleteButton.getAttribute("data-state"), "loading");
        assert.equal(
          deleteButton.closest("li")?.getAttribute("aria-busy"),
          "true",
        );
        assert.equal(
          deleteButton.closest("li")?.querySelector(
            ".minke-browser-history__visit",
          )?.disabled,
          true,
        );
        assert.equal(
          deleteButton.getAttribute("aria-label"),
          "Deleting “Entry two”",
        );
        assert.equal(
          container.querySelector('input[type="search"]')?.disabled,
          true,
        );
        assert.ok(
          [...container.querySelectorAll(
            ".minke-browser-history__filters button",
          )].every((button) => button.disabled),
          "filters stay fixed while an in-flight deletion resolves",
        );

        assert.ok(resolveDelete);
        await act(async () => {
          resolveDelete();
          await Promise.resolve();
          await new Promise((resolve) => setTimeout(resolve, 30));
        });

        assert.deepEqual(
          [...container.querySelectorAll(
            ".minke-browser-history__visit-primary",
          )].map((node) => node.textContent),
          ["Entry one", "Entry three"],
        );
        assert.match(
          container.querySelector(
            ".minke-browser-history__result-count",
          )?.textContent ?? "",
          /2 loaded/u,
        );
        assert.equal(
          dom.window.document.activeElement?.getAttribute(
            "data-history-index",
          ),
          "1",
          "focus should move to the row that replaced the deletion",
        );
        assert.match(
          dom.window.document.activeElement?.textContent ?? "",
          /Entry three/u,
        );
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History keeps a failed single deletion visible and retryable", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  const visit = historyVisit({
    title: "Do not lose me",
    url: "https://example.com/keep",
    visitId: 9,
    visitedAt: 9_000,
  });
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  let deleteAttempts = 0;
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        return {
          agentVisits: 0,
          humanVisits: 1,
          retainedVisits: 1,
          totalVisits: 1,
          uniquePaths: 1,
          visits: [visit],
        };
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  controller.deleteVisit = async () => {
    deleteAttempts += 1;
    if (deleteAttempts === 1) {
      throw new Error("sqlite path /private/secret.db");
    }
  };
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );
  const warnings = [];
  const previousWarn = console.warn;

  try {
    console.warn = (...args) => warnings.push(args);
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        const deleteButton = container.querySelector(
          ".minke-browser-history__visit-delete",
        );
        assert.ok(
          deleteButton instanceof dom.window.HTMLButtonElement,
        );

        await act(async () => {
          deleteButton.click();
          await Promise.resolve();
        });

        assert.equal(deleteAttempts, 1);
        assert.equal(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length,
          1,
        );
        assert.equal(deleteButton.getAttribute("data-state"), "error");
        assert.equal(
          deleteButton.closest("li")?.getAttribute(
            "data-delete-state",
          ),
          "error",
        );
        assert.equal(
          deleteButton.getAttribute("aria-label"),
          "Could not delete “Do not lose me”. Try again.",
        );
        assert.match(
          container.querySelector("[role='alert']")?.textContent ?? "",
          /Could not delete “Do not lose me”/u,
        );
        assert.doesNotMatch(container.textContent, /secret\.db/u);

        await act(async () => {
          deleteButton.click();
          await Promise.resolve();
          await new Promise((resolve) => setTimeout(resolve, 30));
        });

        assert.equal(deleteAttempts, 2);
        assert.equal(
          container.querySelector(
            ".minke-browser-history__visit",
          ),
          null,
        );
        assert.equal(warnings.length, 1);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    console.warn = previousWarn;
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History requires confirmation before clearing all visits", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  let visits = [
    historyVisit({
      title: "Keep until confirmed",
      url: "https://example.com/keep",
    }),
  ];
  let clears = 0;
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        return {
          agentVisits: 0,
          humanVisits: visits.length,
          retainedVisits: visits.length,
          totalVisits: visits.length,
          uniquePaths: visits.length,
          visits,
        };
      },
      async clearHistory() {
        clears += 1;
        visits = [];
        return {
          agentVisits: 0,
          humanVisits: 0,
          retainedVisits: 0,
          totalVisits: 0,
          uniquePaths: 0,
          visits,
        };
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        const button = (label) =>
          [...container.querySelectorAll("button")]
            .find(
              (candidate) =>
                candidate.textContent === label ||
                candidate.getAttribute("aria-label") === label,
            );

        await act(async () => {
          button("Clear browsing history")?.click();
        });
        assert.equal(clears, 0);
        const confirmation = container.querySelector(
          ".minke-browser-history__clear-confirm[role='alert']",
        );
        assert.ok(confirmation instanceof dom.window.HTMLElement);
        assert.equal(confirmation.getAttribute("aria-modal"), null);
        assert.match(
          container.textContent,
          /Clear all browsing history\?/u,
        );
        assert.equal(
          dom.window.document.activeElement?.textContent,
          "Cancel",
        );

        await act(async () => {
          confirmation.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              bubbles: true,
              key: "Escape",
            }),
          );
        });
        assert.equal(
          container.querySelector(
            ".minke-browser-history__clear-confirm",
          ),
          null,
        );
        assert.equal(
          dom.window.document.activeElement?.getAttribute(
            "aria-label",
          ),
          "Clear browsing history",
        );

        await act(async () => {
          button("Clear browsing history")?.click();
        });
        await act(async () => {
          button("Clear history")?.click();
          await Promise.resolve();
        });
        assert.equal(clears, 1);
        assert.equal(
          container.querySelector(
            ".minke-browser-history__visit",
          ),
          null,
        );
        assert.match(container.textContent, /No browsing history yet/u);
        assert.equal(
          dom.window.document.activeElement,
          container.querySelector('input[type="search"]'),
        );
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History keeps visits visible when clear fails and retries the clear action", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  let clearAttempts = 0;
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const visit = historyVisit({
    title: "Keep after failed clear",
    url: "https://example.com/keep",
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        return {
          agentVisits: 0,
          humanVisits: 1,
          retainedVisits: 1,
          totalVisits: 1,
          uniquePaths: 1,
          visits: [visit],
        };
      },
      async clearHistory() {
        clearAttempts += 1;
        if (clearAttempts === 1) {
          throw new Error("busy");
        }
        return {
          agentVisits: 0,
          humanVisits: 0,
          retainedVisits: 0,
          totalVisits: 0,
          uniquePaths: 0,
          visits: [],
        };
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );
  const warnings = [];
  const previousWarn = console.warn;

  try {
    console.warn = (...args) => warnings.push(args);
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        const button = (label) =>
          [...container.querySelectorAll("button")]
            .find(
              (candidate) =>
                candidate.textContent === label ||
                candidate.getAttribute("aria-label") === label,
            );
        await act(async () => {
          button("Clear browsing history")?.click();
        });
        await act(async () => {
          button("Clear history")?.click();
          await Promise.resolve();
        });

        assert.equal(clearAttempts, 1);
        assert.equal(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length,
          1,
        );
        assert.match(
          container.textContent,
          /Could not clear browsing history/u,
        );
        assert.doesNotMatch(
          container.textContent,
          /Could not load browsing history/u,
        );

        await act(async () => {
          button("Clear history")?.click();
          await Promise.resolve();
        });
        assert.equal(clearAttempts, 2);
        assert.equal(
          container.querySelector(
            ".minke-browser-history__visit",
          ),
          null,
        );
        assert.equal(
          container.querySelector(
            ".minke-browser-history__clear-confirm",
          ),
          null,
        );
        assert.equal(warnings.length, 1);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    console.warn = previousWarn;
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History clear completion survives panel visibility changes", async () => {
  const dom = new JSDOM(
    [
      "<!doctype html>",
      '<button id="outside">Outside</button>',
      '<div id="root"></div>',
    ].join(""),
    { pretendToBeVisual: true },
  );
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  let resolveClear;
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        return {
          agentVisits: 0,
          humanVisits: 1,
          retainedVisits: 1,
          totalVisits: 1,
          uniquePaths: 1,
          visits: [historyVisit({
            title: "Pending clear",
            url: "https://example.com/pending",
          })],
        };
      },
      clearHistory() {
        return new Promise((resolve) => {
          resolveClear = () => resolve({
            agentVisits: 0,
            humanVisits: 0,
            retainedVisits: 0,
            totalVisits: 0,
            uniquePaths: 0,
            visits: [],
          });
        });
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        const button = (label) =>
          [...container.querySelectorAll("button")]
            .find(
              (candidate) =>
                candidate.textContent === label ||
                candidate.getAttribute("aria-label") === label,
            );
        act(() => {
          button("Clear browsing history")?.click();
        });
        act(() => {
          button("Clear history")?.click();
        });
        assert.match(container.textContent, /Clearing…/u);
        assert.ok(resolveClear);
        const confirmation = container.querySelector(
          ".minke-browser-history__clear-confirm[role='alert']",
        );
        assert.ok(confirmation instanceof dom.window.HTMLElement);

        act(() => {
          root.render(renderer.renderView(tab, false, false));
        });
        const outside = dom.window.document.getElementById("outside");
        assert.ok(outside instanceof dom.window.HTMLButtonElement);
        outside.focus();
        act(() => {
          root.render(renderer.renderView(tab, true, true));
        });
        assert.equal(
          dom.window.document.activeElement,
          outside,
          "an inline confirmation must not steal focus on reopen",
        );

        await act(async () => {
          resolveClear();
          await Promise.resolve();
        });

        assert.equal(
          container.querySelector(
            ".minke-browser-history__clear-confirm",
          ),
          null,
        );
        assert.doesNotMatch(container.textContent, /Clearing…/u);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History reloads when its panel becomes visible again", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  let reads = 0;
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        reads += 1;
        return {
          agentVisits: 0,
          humanVisits: 0,
          retainedVisits: 0,
          totalVisits: 0,
          uniquePaths: 0,
          visits: [],
        };
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true, false));
          await Promise.resolve();
        });
        assert.equal(reads, 0);

        await act(async () => {
          root.render(renderer.renderView(tab, true, true));
          await Promise.resolve();
        });
        assert.equal(reads, 1);

        await act(async () => {
          root.render(renderer.renderView(tab, true, false));
          await Promise.resolve();
        });
        await act(async () => {
          root.render(renderer.renderView(tab, true, true));
          await Promise.resolve();
        });
        assert.equal(reads, 2);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History keeps internal failures out of its error message", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  const warnings = [];
  const previousWarn = console.warn;
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      async readHistory() {
        throw new Error("sqlite path /private/secret.db");
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    console.warn = (...args) => warnings.push(args);
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });

        assert.match(
          container.textContent,
          /Could not load browsing history/u,
        );
        assert.doesNotMatch(container.textContent, /secret\.db/u);
        assert.equal(warnings.length, 1);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    console.warn = previousWarn;
    dom.window.close();
    tabs.dispose();
  }
});

test("Browser History layout remains usable in right and bottom tab panels", async () => {
  const contract = inspectCssContract(BROWSER_HISTORY_STYLES);

  assert.equal(
    contract.declaration(
      ".minke-browser-history",
      "overflow",
    ),
    "hidden",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history",
      "container-type",
    ),
    "inline-size",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__page",
      "width",
    ),
    "100%",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visit",
      "grid-template-columns",
    ),
    "28px minmax(0, 1fr) 18px",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visit-body",
      "flex-direction",
    ),
    "column",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__filter-bar",
      "grid-column",
    ),
    "1 / -1",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__results",
      "overflow",
    ),
    "auto",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__results",
      "border-top",
    ),
    undefined,
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visits",
      "border",
    ),
    undefined,
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visits > li",
      "border-bottom",
    ),
    undefined,
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__skeleton",
      "border",
    ),
    undefined,
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__skeleton-row + .minke-browser-history__skeleton-row",
      "border-top",
    ),
    undefined,
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visit-delete",
      "opacity",
    ),
    "0",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visit-delete",
      "pointer-events",
    ),
    "none",
  );
  assert.equal(
    contract.declaration(
      ".minke-browser-history__visit-delete",
      "visibility",
    ),
    "hidden",
  );
  assert.match(
    BROWSER_HISTORY_STYLES,
    /\.minke-browser-history__visits\s*>\s*li:hover[\s\S]*?\.minke-browser-history__visit-delete,[\s\S]*?li:focus-within[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/u,
  );
  assert.match(
    BROWSER_HISTORY_STYLES,
    /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.minke-browser-history__visit-delete\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;/u,
  );
  assert.match(
    BROWSER_HISTORY_STYLES,
    /@container\s+minke-browser-history\s+\(max-width:\s*520px\)\s*\{[\s\S]*?\.minke-browser-history__controls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/u,
  );
  assert.equal(
    contract.atRuleDeclaration(
      "@container minke-browser-history (max-width: 520px)",
      ".minke-browser-history__separator--count",
      "display",
    ),
    "none",
  );
  assert.equal(
    contract.atRuleDeclaration(
      "@container minke-browser-history (max-width: 520px)",
      ".minke-browser-history__visit-count",
      "display",
    ),
    "none",
  );
  assert.equal(
    contract.atRuleDeclaration(
      "@container minke-browser-history (max-width: 520px)",
      ".minke-browser-history__actor",
      "display",
    ),
    undefined,
  );
  assert.match(
    BROWSER_HISTORY_STYLES,
    /\.minke-browser-history__visits\s*>\s*li\s*\{[\s\S]*?position:\s*absolute;/u,
  );
  assert.doesNotMatch(
    BROWSER_HISTORY_STYLES,
    /minke-browser-history__group/u,
  );
});

test("Browser History computes a bounded virtual window for large timelines", () => {
  assert.deepEqual(
    computeBrowserHistoryVirtualRange({
      count: 10_000,
      overscan: 8,
      rowHeight: 56,
      scrollTop: 280_000,
      viewportHeight: 560,
    }),
    {
      start: 4_992,
      end: 5_018,
    },
  );
  assert.deepEqual(
    computeBrowserHistoryVirtualRange({
      count: 10_000,
      rowHeight: 56,
      scrollTop: 559_900,
      viewportHeight: 560,
    }),
    {
      start: 9_990,
      end: 10_000,
    },
  );
});

test("Browser History appends cursor pages while keeping the DOM window bounded", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  let nextAnimationFrameId = 0;
  const animationFrames = new Map();
  dom.window.requestAnimationFrame = (callback) => {
    nextAnimationFrameId += 1;
    animationFrames.set(nextAnimationFrameId, callback);
    return nextAnimationFrameId;
  };
  dom.window.cancelAnimationFrame = (id) => {
    animationFrames.delete(id);
  };
  const flushAnimationFrames = () => {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    for (const callback of callbacks) callback(0);
  };
  const allVisits = Array.from(
    { length: 150 },
    (_value, index) => {
      const visitId = 150 - index;
      return historyVisit({
        title: `Entry ${String(visitId)}`,
        url: `https://example.com/items/${String(visitId)}`,
        visitId,
        visitedAt: visitId * 1_000,
      });
    },
  );
  const reads = [];
  let resolveSecondPage;
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const controller = new BrowserHistoryTabsController(
    tabs,
    {
      readHistory(request) {
        reads.push(request);
        if (request.before === undefined) {
          return Promise.resolve({
            agentVisits: 0,
            humanVisits: 150,
            retainedVisits: 150,
            totalVisits: 150,
            uniquePaths: 150,
            visits: allVisits.slice(0, 100),
            nextCursor: {
              visitId: 51,
              visitedAt: 51_000,
            },
          });
        }
        return new Promise((resolve) => {
          resolveSecondPage = () => resolve({
            agentVisits: 0,
            humanVisits: 150,
            retainedVisits: 150,
            totalVisits: 150,
            uniquePaths: 150,
            visits: allVisits.slice(100),
          });
        });
      },
      async clearHistory() {
        throw new Error("not used");
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );
  const tabId = controller.create("Browser History");
  const tab = tabs.tab(tabId);
  assert.ok(tab);
  const renderer = createBrowserHistoryTabRenderer(
    controller,
    translate,
  );

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderView(tab, true));
          await Promise.resolve();
        });
        assert.equal(reads.length, 1);
        assert.ok(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length <= 26,
        );
        const firstVisit = container.querySelector(
          '[data-history-index="0"]',
        );
        assert.ok(
          firstVisit instanceof dom.window.HTMLButtonElement,
        );
        assert.equal(firstVisit.tabIndex, 0);
        assert.equal(
          container.querySelector(
            '[data-history-index="1"]',
          )?.getAttribute("tabindex"),
          "-1",
        );
        const results = container.querySelector(
          ".minke-browser-history__results",
        );
        assert.ok(results instanceof dom.window.HTMLElement);
        const tenthVisit = container.querySelector(
          '[data-history-index="10"]',
        );
        const tenthVisitRow = tenthVisit?.closest("li");
        assert.ok(tenthVisitRow instanceof dom.window.HTMLElement);
        Object.defineProperties(results, {
          clientHeight: {
            configurable: true,
            value: 112,
          },
          clientTop: {
            configurable: true,
            value: 1,
          },
        });
        results.getBoundingClientRect = () => ({
          bottom: 213,
          height: 113,
          left: 0,
          right: 400,
          top: 100,
          width: 400,
          x: 0,
          y: 100,
          toJSON() {},
        });
        tenthVisitRow.getBoundingClientRect = () => ({
          bottom: 728,
          height: 56,
          left: 24,
          right: 376,
          top: 672,
          width: 352,
          x: 24,
          y: 672,
          toJSON() {},
        });
        await act(async () => {
          firstVisit.focus();
          firstVisit.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              bubbles: true,
              key: "PageDown",
            }),
          );
          await Promise.resolve();
        });
        await act(async () => {
          flushAnimationFrames();
          await Promise.resolve();
        });
        assert.equal(
          dom.window.document.activeElement?.getAttribute(
            "data-history-index",
          ),
          "10",
        );
        assert.equal(
          results.scrollTop,
          515,
          "keyboard scrolling uses the rendered row geometry",
        );
        assert.equal(
          container.querySelector(
            ".minke-browser-history__group",
          ),
          null,
        );

        await act(async () => {
          results.scrollTop = 56 * 90;
          results.dispatchEvent(
            new dom.window.Event("scroll", { bubbles: false }),
          );
          flushAnimationFrames();
          await Promise.resolve();
        });
        assert.equal(
          container.querySelector(
            '[data-history-index="10"]',
          ),
          dom.window.document.activeElement,
          "the focused row stays mounted outside the virtual window",
        );
        assert.ok(resolveSecondPage);
        await act(async () => {
          resolveSecondPage();
          await Promise.resolve();
        });

        assert.deepEqual(reads, [
          { limit: 100 },
          {
            before: {
              visitId: 51,
              visitedAt: 51_000,
            },
            limit: 100,
          },
        ]);
        assert.ok(
          container.querySelectorAll(
            ".minke-browser-history__visit",
          ).length <= 27,
          "the virtual window adds at most one retained focus row",
        );
        assert.match(container.textContent, /150 loaded/u);
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
    tabs.dispose();
  }
});

test("Agent Browser history action opens the canonical History tab", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  let opened = 0;
  const annotationSnapshot = {
    comments: [],
    count: 0,
    phase: "idle",
  };
  const controller = {
    getAnnotationSnapshot() {
      return annotationSnapshot;
    },
    subscribeAnnotation() {
      return () => {};
    },
    setOwner() {
      throw new Error("not used");
    },
  };
  const renderer = createAgentBrowserTabRenderer(
    controller,
    (key) => agentBrowserTabsEn[key],
    {
      openHistory() {
        opened += 1;
      },
    },
  );
  const tab = {
    id: "agent-tab",
    key: "session:session-1",
    kind: "agent-web",
    title: "Agent Browser",
    payload: {
      controlPending: false,
      generation: 1,
      navigation: {
        canGoBack: false,
        canGoForward: false,
        loading: false,
      },
      owner: "agent",
      partition: "persist:agent-session-1",
      sessionId: "session-1",
      status: "ready",
      title: "Example",
      url: "https://example.com/",
    },
  };

  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(renderer.renderTrailingActions(tab));
        });
        const historyButton = container.querySelector(
          '[aria-label="Browser History"]',
        );
        assert.ok(historyButton instanceof dom.window.HTMLElement);
        await act(async () => {
          historyButton.click();
        });
        assert.equal(opened, 1);
        assert.equal(
          container.querySelector('[role="dialog"]'),
          null,
        );
      } finally {
        await act(async () => root.unmount());
      }
    });
  } finally {
    dom.window.close();
  }
});
