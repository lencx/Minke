#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "minke-agent-browser-conversation-"),
);
const environment = {
  ...process.env,
  MINKE_AGENT_BROWSER_E2E_ROOT: temporaryRoot,
};
delete environment.ELECTRON_RUN_AS_NODE;

try {
  const code = await new Promise((resolveExit, reject) => {
    const successMarker =
      "Agent Browser real conversation takeover smoke passed\n";
    let outputTail = "";
    let passed = false;
    const child = spawn(
      require("electron"),
      [join(projectRoot, "tests", "agent-browser-conversation-runtime.cjs")],
      {
        cwd: projectRoot,
        env: environment,
        stdio: ["inherit", "pipe", "inherit"],
      },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (output) => {
      process.stdout.write(output);
      outputTail += output;
      passed ||= outputTail.includes(successMarker);
      outputTail = outputTail.slice(-successMarker.length);
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (signal !== null) {
        reject(new Error(`Agent Browser conversation E2E exited on ${signal}`));
        return;
      }
      if (exitCode === 0 && !passed) {
        process.stderr.write("Agent Browser conversation E2E ended without completing its assertions\n");
        resolveExit(1);
        return;
      }
      resolveExit(exitCode ?? 1);
    });
  });
  process.exitCode = code;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
