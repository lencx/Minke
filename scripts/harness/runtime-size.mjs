#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
} from "./runtime-prune.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contract = JSON.parse(
  await readFile(join(projectRoot, "config", "harness-runtime.json"), "utf8"),
);
const runtimeRoot = join(projectRoot, "runtime", "host");
const inspection = await inspectRuntimeArtifacts(runtimeRoot);

if (inspection.prunable.files > 0) {
  throw new Error(
    `Harness runtime still contains ${String(inspection.prunable.files)} prunable build artifacts`,
  );
}
assertRuntimeSizeBudget(
  inspection.bytes,
  contract.runtimeSizeBudgetBytes,
);
console.log(
  `Harness runtime: ${(inspection.bytes / 1024 / 1024).toFixed(1)} MiB across ${String(inspection.files)} files`,
);
