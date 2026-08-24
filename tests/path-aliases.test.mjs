import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  EXACT_PATH_ALIASES,
  PATH_ALIASES,
  resolvePathAlias,
} from "@@/config/path-aliases.mts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("project aliases share one TypeScript, Vite, and Node contract", () => {
  assert.deepEqual(
    PATH_ALIASES,
    [
      { prefix: "@@/", target: "." },
      { prefix: "@/", target: "src" },
      { prefix: "@minke/desktop/", target: "desktop" },
      {
        prefix: "@minke/harness-overlay/",
        target: "packages/harness-overlay/src",
      },
      { prefix: "@minke/resources/", target: "resources" },
      {
        prefix: "@vendor/deepseek-harness/",
        target: "vendor/deepseek-harness",
      },
    ],
  );

  const tsconfig = JSON.parse(
    readFileSync(resolve(projectRoot, "tsconfig.json"), "utf8"),
  );
  assert.deepEqual(tsconfig.compilerOptions.paths, {
    "@/*": ["./src/*"],
    "@@/*": ["./*"],
    "@minke/desktop/*": ["./desktop/*"],
    "@minke/harness-overlay/*": [
      "./packages/harness-overlay/src/*",
    ],
    "@minke/resources/*": ["./resources/*"],
    "@vendor/deepseek-harness/*": [
      "./vendor/deepseek-harness/*",
    ],
  });

  for (const { prefix, target } of PATH_ALIASES) {
    const marker = `${prefix}contract-marker.ts`;
    const resolvedUrl = resolvePathAlias(marker, projectRoot);
    assert.notEqual(resolvedUrl, undefined);
    assert.equal(
      fileURLToPath(resolvedUrl),
      resolve(projectRoot, target, "contract-marker.ts"),
    );
  }
});

test("project aliases reject unknown and escaping specifiers", () => {
  assert.equal(
    resolvePathAlias("@unknown/module.ts", projectRoot),
    undefined,
  );
  assert.equal(
    resolvePathAlias("@@/../outside.ts", projectRoot),
    undefined,
  );
});

test("the pinned HarnessError runtime alias matches only dsh-llm", () => {
  assert.deepEqual(EXACT_PATH_ALIASES, [{
    specifier: "@deepseek-ai/dsh-llm",
    target:
      "vendor/deepseek-harness/packages/llm/llm/lib/index.js",
  }]);
  assert.equal(
    fileURLToPath(
      resolvePathAlias("@deepseek-ai/dsh-llm", projectRoot),
    ),
    resolve(
      projectRoot,
      "vendor/deepseek-harness/packages/llm/llm/lib/index.js",
    ),
  );
  assert.equal(
    resolvePathAlias("@deepseek-ai/dsh-llm-pi-ai", projectRoot),
    undefined,
  );
  assert.equal(
    resolvePathAlias("@deepseek-ai/dsh-llm/types", projectRoot),
    undefined,
  );
});

test("Node resolves extensionless project aliases", async () => {
  const module = await import("@minke/desktop/i18n");
  assert.equal(typeof module.DesktopLocaleRuntime, "function");
});
