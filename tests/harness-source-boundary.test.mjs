import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("..", import.meta.url);
const contract = JSON.parse(
  readFileSync(new URL("config/harness-runtime.json", projectRoot), "utf8"),
);
const harnessRoot = new URL(
  `${contract.submodulePath.replace(/\/?$/u, "/")}`,
  projectRoot,
);

test("Minke declares every local Harness runtime patch", () => {
  const patchDirectory = new URL("patches/deepseek-harness/", projectRoot);
  const files = readdirSync(patchDirectory)
    .filter((name) => name.endsWith(".patch"))
    .map((name) => `patches/deepseek-harness/${name}`)
    .sort();
  assert.deepEqual([...contract.patches].sort(), files);
  for (const patch of contract.patches) {
    assert.equal(existsSync(new URL(patch, projectRoot)), true);
  }
  assert.equal(
    existsSync(new URL("scripts/harness/patch.mjs", projectRoot)),
    false,
    "source-worktree patching must not return",
  );
});

test("the pinned DeepSeek Harness checkout is pristine", () => {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    {
      cwd: harnessRoot,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "",
    `vendor/deepseek-harness must stay clean:\n${result.stdout}`,
  );
});
