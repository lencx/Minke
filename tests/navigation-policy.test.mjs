import assert from "node:assert/strict";
import test from "node:test";
import {
  isInternalNavigation,
} from "@minke/desktop/main/navigation-policy.ts";

test("development bootstrap and Harness URLs stay inside Electron", () => {
  const internalRoots = [
    "http://localhost:41783/",
    "http://127.0.0.1:56614",
  ];

  assert.equal(
    isInternalNavigation(
      "http://localhost:41783/?locale=en",
      internalRoots,
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      "http://127.0.0.1:56614/session/example",
      internalRoots,
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      "https://example.com/",
      internalRoots,
    ),
    false,
  );
  assert.equal(
    isInternalNavigation(
      "http://localhost.example.com:41783/",
      internalRoots,
    ),
    false,
  );
});
