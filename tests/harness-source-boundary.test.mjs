import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("..", import.meta.url);
const contract = JSON.parse(
  readFileSync(new URL("config/harness-runtime.json", projectRoot), "utf8"),
);
const harnessRoot = new URL(
  `${contract.submodulePath.replace(/\/?$/u, "/")}`,
  projectRoot,
);

test("Minke never carries source patches for DeepSeek Harness", () => {
  assert.equal(
    Object.hasOwn(contract, "patches"),
    false,
    "move product behavior to a Harness bundle or desktop adapter",
  );
  assert.equal(
    existsSync(new URL("patches/deepseek-harness", projectRoot)),
    false,
    "the retired Harness patch directory must not return",
  );
  assert.equal(
    existsSync(new URL("scripts/harness/patch.mjs", projectRoot)),
    false,
    "the retired source patch applicator must not return",
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
