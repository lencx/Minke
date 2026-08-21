import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBootManifest,
} from "../scripts/harness/boot-manifest.mjs";

test("parses the structured DSH boot manifest injection", () => {
  const manifest = {
    entries: [
      {
        id: "@lencx/minke-harness-overlay",
        rev: "fixture-revision",
        url: "/modules/fixture.js",
      },
    ],
  };
  const html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(manifest)}</script>`,
    "</head>",
    "</html>",
  ].join("");

  assert.deepEqual(parseBootManifest(html), manifest);
});
