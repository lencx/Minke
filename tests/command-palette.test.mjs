import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandPaletteRuntime,
} from "@minke/harness-overlay/client/palette/runtime.ts";
import {
  searchPaletteActions,
} from "@minke/harness-overlay/client/palette/search.ts";
import {
  paletteEn,
  paletteZh,
} from "@minke/harness-overlay/client/palette/locales.ts";

function action(id, label, options = {}) {
  return {
    id,
    label,
    group: options.group ?? "session",
    keywords: options.keywords ?? [],
    binding: options.binding ?? null,
    order: options.order ?? 0,
    disabledReason: options.disabledReason,
  };
}

test("palette dictionaries have the same complete key set", () => {
  assert.deepEqual(
    Object.keys(paletteEn).sort(),
    Object.keys(paletteZh).sort(),
  );
  for (const dictionary of [paletteEn, paletteZh]) {
    for (const value of Object.values(dictionary)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value.trim(), "");
    }
  }
});

test("palette search ranks labels and localized keywords deterministically", () => {
  const actions = [
    action("open.plugins", "Browse Plugins", {
      keywords: ["extensions"],
      order: 30,
    }),
    action("open.browser", "Open Browser", { order: 20 }),
    action("session.export", "Export Current Session", {
      keywords: ["download logs"],
      order: 10,
    }),
  ];

  assert.deepEqual(searchPaletteActions(actions, ""), actions);
  assert.deepEqual(
    searchPaletteActions(actions, "open").map(({ id }) => id),
    ["open.browser"],
  );
  assert.deepEqual(
    searchPaletteActions(actions, "plug").map(({ id }) => id),
    ["open.plugins"],
  );
  assert.deepEqual(
    searchPaletteActions(actions, "logs").map(({ id }) => id),
    ["session.export"],
  );
  assert.deepEqual(
    searchPaletteActions(actions, "obr").map(({ id }) => id),
    ["open.browser"],
  );
  assert.deepEqual(searchPaletteActions(actions, "missing"), []);
});

test("palette runtime navigates enabled actions and closes before invocation", () => {
  const events = [];
  const actions = [
    action("session.back", "Back", {
      disabledReason: "No previous session",
    }),
    action("session.new", "New Session"),
    action("settings.open", "Open Settings"),
  ];
  let runtime;
  runtime = new CommandPaletteRuntime(
    () => actions,
    (id) => {
      events.push({ id, open: runtime.getSnapshot().open });
      return true;
    },
  );

  runtime.open();
  assert.equal(runtime.getSnapshot().activeId, "session.new");
  runtime.moveSelection(-1);
  assert.equal(runtime.getSnapshot().activeId, "settings.open");
  runtime.moveSelection(1);
  assert.equal(runtime.getSnapshot().activeId, "session.new");
  assert.equal(runtime.execute("session.back"), false);
  assert.equal(runtime.getSnapshot().open, true);
  assert.equal(runtime.execute(), true);
  assert.deepEqual(events, [{ id: "session.new", open: false }]);
  assert.deepEqual(runtime.getSnapshot(), {
    open: false,
    query: "",
    results: [],
    activeId: undefined,
  });
});

test("palette refresh preserves a valid selection and replaces a disabled one", () => {
  let actions = [
    action("a", "Alpha"),
    action("b", "Beta"),
  ];
  const runtime = new CommandPaletteRuntime(() => actions, () => true);
  runtime.open();
  runtime.select("b");

  actions = [
    action("a", "Alpha"),
    action("b", "Beta", { disabledReason: "Unavailable" }),
  ];
  runtime.refresh();
  assert.equal(runtime.getSnapshot().activeId, "a");

  runtime.setQuery("beta");
  assert.equal(runtime.getSnapshot().activeId, undefined);
  assert.equal(runtime.getSnapshot().results[0]?.disabledReason, "Unavailable");
});

test("palette opening is suppressed while another modal owns focus", () => {
  let canOpen = false;
  const runtime = new CommandPaletteRuntime(
    () => [action("session.new", "New Session")],
    () => true,
    () => canOpen,
  );

  runtime.open();
  assert.equal(runtime.getSnapshot().open, false);

  canOpen = true;
  runtime.toggle();
  assert.equal(runtime.getSnapshot().open, true);

  canOpen = false;
  runtime.toggle();
  assert.equal(runtime.getSnapshot().open, false);
});
