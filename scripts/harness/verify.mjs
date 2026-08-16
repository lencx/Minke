#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHarnessContract } from "./contract.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

try {
  const result = await verifyHarnessContract(projectRoot);
  console.log(
    [
      `Harness contract verified: ${result.contract.packageName}@${result.contract.packageVersion}`,
      `  submodule: ${relative(projectRoot, result.harnessRoot)}`,
      `  commit:    ${result.actualCommit}`,
      `  pnpm:      ${result.contract.pnpmVersion}`,
    ].join("\n"),
  );
} catch (error) {
  console.error(
    `harness:verify: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
}
