import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditRepositorySourceTextAssertions,
  auditSourceTextAssertions,
  compareSourceAssertionBaseline,
} from "../scripts/tests/source-assertions.mjs";

test("source assertion audit follows file reads through derived values", () => {
  const findings = auditSourceTextAssertions(`
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    const source = readFileSync("module.ts", "utf8");
    const derived = source.replaceAll("\\r\\n", "\\n");
    assert.match(source, /implementation/u);
    assert.doesNotMatch(derived, /legacy/u);
    assert.match(error.message, /public failure/u);
  `);
  assert.deepEqual(
    findings.map(({ line, method }) => ({ line, method })),
    [
      { line: 6, method: "match" },
      { line: 7, method: "doesNotMatch" },
    ],
  );
});

test("source-text assertion debt matches the ratcheted baseline", async () => {
  const baseline = JSON.parse(
    await readFile(
      new URL(
        "../config/source-assertion-baseline.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const audit = await auditRepositorySourceTextAssertions();
  assert.deepEqual(
    compareSourceAssertionBaseline(audit.counts, baseline),
    [],
    [
      "Source-text assertion debt must not grow.",
      "Replace them with behavior, rendered output, parsed data, or an applied-artifact contract.",
      "When debt is removed, lower config/source-assertion-baseline.json in the same change.",
    ].join(" "),
  );
});
