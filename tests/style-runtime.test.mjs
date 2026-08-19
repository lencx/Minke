import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCssVars,
  defineOverlayStyle,
} from "@minke/harness-overlay/client/shared/style-runtime.ts";

function styleDeclaration(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([name, value]) => [
      name,
      { value, priority: "" },
    ]),
  );
  return {
    getPropertyPriority(name) {
      return values.get(name)?.priority ?? "";
    },
    getPropertyValue(name) {
      return values.get(name)?.value ?? "";
    },
    removeProperty(name) {
      const previous = values.get(name)?.value ?? "";
      values.delete(name);
      return previous;
    },
    setProperty(name, value, priority = "") {
      values.set(name, { value, priority });
    },
  };
}

function documentFixture() {
  const nodes = [];
  const parent = {
    append(node) {
      nodes.push(node);
      node.parentElement = parent;
    },
  };
  return {
    nodes,
    root: {
      createElement(name) {
        assert.equal(name, "style");
        return {
          dataset: {},
          parentElement: null,
          textContent: "",
          remove() {
            const index = nodes.indexOf(this);
            if (index >= 0) nodes.splice(index, 1);
            this.parentElement = null;
          },
        };
      },
      documentElement: parent,
      head: parent,
    },
  };
}

test("overlay styles share one lifecycle-managed node per document and id", () => {
  const fixture = documentFixture();
  const install = defineOverlayStyle(
    "tabs-terminal",
    [".xterm {}", ".minke-terminal-view {}"],
  );

  const disposeFirst = install(fixture.root);
  const disposeSecond = install(fixture.root);

  assert.equal(fixture.nodes.length, 1);
  assert.equal(
    fixture.nodes[0].dataset.plugin,
    "@lencx/minke-harness-overlay",
  );
  assert.equal(
    fixture.nodes[0].dataset.minkeStyle,
    "tabs-terminal",
  );
  assert.equal(
    fixture.nodes[0].textContent,
    ".xterm {}\n.minke-terminal-view {}",
  );

  disposeFirst();
  assert.equal(fixture.nodes.length, 1);
  disposeFirst();
  assert.equal(
    fixture.nodes.length,
    1,
    "a disposer must be idempotent",
  );
  disposeSecond();
  assert.equal(fixture.nodes.length, 0);
});

test("overlay style ids reject conflicting sources in one document", () => {
  const fixture = documentFixture();
  const dispose = defineOverlayStyle(
    "tabs",
    ".minke-tabs-panel {}",
  )(fixture.root);

  assert.throws(
    () =>
      defineOverlayStyle(
        "tabs",
        ".minke-tabs-panel { display: none; }",
      )(fixture.root),
    /tabs/u,
  );
  dispose();
});

test("bound CSS variables restore the target's previous declaration", () => {
  const style = styleDeclaration({
    "--minke-tabs-panel-width": "360px",
  });
  style.setProperty(
    "--minke-tabs-panel-height",
    "300px",
    "important",
  );
  const target = { style };

  const dispose = bindCssVars(target, {
    "--minke-tabs-panel-width": "520px",
    "--minke-tabs-panel-height": "420px",
    "--minke-tabs-panel-left": "24px",
  });

  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-width"),
    "520px",
  );
  assert.equal(
    style.getPropertyPriority("--minke-tabs-panel-height"),
    "",
  );
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-left"),
    "24px",
  );

  dispose();
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-width"),
    "360px",
  );
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-height"),
    "300px",
  );
  assert.equal(
    style.getPropertyPriority("--minke-tabs-panel-height"),
    "important",
  );
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-left"),
    "",
  );
  dispose();
});

test("CSS variable bindings can be released out of order", () => {
  const style = styleDeclaration({
    "--minke-tabs-panel-width": "360px",
  });
  const target = { style };
  const disposeFirst = bindCssVars(target, {
    "--minke-tabs-panel-width": "520px",
  });
  const disposeSecond = bindCssVars(target, {
    "--minke-tabs-panel-width": "640px",
  });

  disposeFirst();
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-width"),
    "640px",
  );
  disposeSecond();
  assert.equal(
    style.getPropertyValue("--minke-tabs-panel-width"),
    "360px",
  );
});
