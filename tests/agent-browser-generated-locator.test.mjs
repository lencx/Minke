import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_LOCATOR_RESOLVER_FUNCTION,
  MAX_GENERATED_LOCATOR_STEPS,
  parseGeneratedLocatorCode,
} from "@minke/desktop/main/agent-browser/experimental-generated-locator.ts";
import { runInNewContext } from "node:vm";

test("generated browser locator parses one bounded Playwright-like relation chain", () => {
  assert.deepEqual(
    parseGeneratedLocatorCode(
      'page.locator("tr.athing").nth(11).next("tr").getByRole("link", {name:/comments?|discuss/i})',
    ),
    [
      { kind: "locator", selector: "tr.athing" },
      { kind: "nth", index: 11 },
      { kind: "next", selector: "tr" },
      {
        kind: "getByRole",
        role: "link",
        name: {
          kind: "regex",
          value: "comments?|discuss",
          flags: "i",
        },
        exact: false,
      },
    ],
  );
  assert.deepEqual(
    parseGeneratedLocatorCode(
      'await page.getByText("Account", {exact:true}).closest("section").getByRole("button", {name:"Save", exact:true})',
    ),
    [
      {
        kind: "getByText",
        text: { kind: "text", value: "Account" },
        exact: true,
      },
      { kind: "closest", selector: "section" },
      {
        kind: "getByRole",
        role: "button",
        name: { kind: "text", value: "Save" },
        exact: true,
      },
    ],
  );
});

test("generated browser locator rejects executable JavaScript and ambient authority", () => {
  for (const code of [
    'document.querySelector("button")',
    'page.locator("button"); fetch("/exfiltrate")',
    'const target = page.locator("button"); target.first()',
    'page["locator"]("button")',
    'page.locator(`button`)',
    'page.locator(window.name)',
    'page.constructor.constructor("return process")()',
    'page.locator("button").evaluate(() => location.href = "/")',
  ]) {
    assert.throws(
      () => parseGeneratedLocatorCode(code),
      /generated locator|page method|unsupported|literal/iu,
      code,
    );
  }
});

test("generated browser locator enforces step, source, option, and ordinal budgets", () => {
  assert.throws(
    () =>
      parseGeneratedLocatorCode(
        `page${".first()".repeat(MAX_GENERATED_LOCATOR_STEPS + 1)}`,
      ),
    /steps/u,
  );
  assert.throws(
    () =>
      parseGeneratedLocatorCode(
        `page.locator(${JSON.stringify("x".repeat(1_001))})`,
      ),
    /string literal/u,
  );
  assert.throws(
    () =>
      parseGeneratedLocatorCode(
        'page.getByRole("link", {name:"Comments", timeout:5000})',
      ),
    /unsupported.*timeout/iu,
  );
  assert.throws(
    () => parseGeneratedLocatorCode("page.locator(\"a\").nth(-1)"),
    /non-negative integer/u,
  );
});

test("generated browser locator requires terminal semantic action evidence", () => {
  for (const code of [
    'page.locator("a").nth(7)',
    'page.getByRole("link", {name:"Comments"}).nth(0)',
    'page.getByText("Account").closest("section")',
    'page.locator("button").first()',
  ]) {
    assert.throws(
      () => parseGeneratedLocatorCode(code),
      /terminal semantic action|end with getByRole|getByText/iu,
      code,
    );
  }

  assert.deepEqual(
    parseGeneratedLocatorCode(
      'page.locator("section").getByRole("button", {name:"Save"}).filter({hasText:"Save"})',
    ).map((step) => step.kind),
    ["locator", "getByRole", "filter"],
  );
});

test("generated browser locator rejects regular expressions with unsafe backtracking features", () => {
  for (const code of [
    'page.getByText(/(a+)+$/)',
    'page.getByText(/a*a*a*b/)',
    'page.getByText(/(cancel|continue)+/i)',
    'page.getByText(/a?a?a?a?a?/)',
    'page.getByText(/(.)\\1/)',
  ]) {
    assert.throws(
      () => parseGeneratedLocatorCode(code),
      /safe regular-expression literal/iu,
      code,
    );
  }

  assert.deepEqual(
    parseGeneratedLocatorCode(
      'page.getByRole("link", {name:/comments?|discuss/i})',
    )[0]?.name,
    {
      kind: "regex",
      value: "comments?|discuss",
      flags: "i",
    },
  );
});

test("generated browser locator marks an incomplete candidate traversal unusable", () => {
  const resolveGeneratedLocator = runInNewContext(
    `(${GENERATED_LOCATOR_RESOLVER_FUNCTION})`,
  );
  const nodes = Array.from({ length: 50_001 }, (_value, index) => ({
    nodeType: 1,
    localName: "button",
    innerText:
      index === 49_999 || index === 50_000 ? "TARGET" : "other",
    textContent: "",
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    querySelectorAll() {
      return [this];
    },
  }));
  const document = {
    nodeType: 9,
    querySelectorAll() {
      return nodes;
    },
  };

  const binding = resolveGeneratedLocator.call(
    document,
    [
      { kind: "locator", selector: "*" },
      {
        kind: "getByText",
        text: { kind: "text", value: "TARGET" },
        exact: true,
      },
    ],
  );

  assert.equal(binding.truncated, true);
  assert.equal(binding.element, null);
});
