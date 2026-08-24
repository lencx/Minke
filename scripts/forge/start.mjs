import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import process from "node:process";
import { api } from "@electron-forge/core";
import {
  DEVELOPMENT_RESTART_EXIT_CODE,
} from "../../desktop/main/app-restart.ts";
import {
  resolvePnpmInvocation,
} from "../harness/pnpm-invocation.mjs";
import {
  acquireForgeDevelopmentLease,
  FORGE_DEVELOPMENT_LEASE_PORT,
  FORGE_DEVELOPMENT_RENDERER_PORT,
  finishOwnedForgeDevelopment,
  inspectForgeDevelopmentRenderer,
  runOwnedForgeDevelopment,
} from "./development-owner.mjs";
import {
  superviseForgeDevelopment,
} from "./development-supervisor.mjs";

async function prepareHarnessRuntime() {
  const invocation = resolvePnpmInvocation([
    "run",
    "harness:stage:ensure",
  ]);
  const child = spawn(
    invocation.command,
    invocation.args,
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  const [code, signal] = await once(child, "exit");
  if (code === 0) return;
  throw new Error(
    signal === null
      ? `Harness staging exited with code ${String(code)}`
      : `Harness staging exited on ${signal}`,
  );
}

const outcome = await runOwnedForgeDevelopment({
  acquireLease: async () =>
    await acquireForgeDevelopmentLease(),
  inspectRenderer: async () =>
    await inspectForgeDevelopmentRenderer(),
  prepare: prepareHarnessRuntime,
  launch: async () =>
    await superviseForgeDevelopment({
      input: process.stdin.isTTY ? process.stdin : undefined,
      restartExitCode: DEVELOPMENT_RESTART_EXIT_CODE,
      start: async () =>
        await api.start({
          dir: process.cwd(),
          interactive: false,
        }),
    }),
});

switch (outcome.kind) {
  case "lease-held": {
    if (
      outcome.owner !== undefined &&
      resolve(outcome.owner.workspace) === resolve(process.cwd())
    ) {
      console.log(
        `Minke development is already running for this workspace (PID ${String(outcome.owner.pid)}).`,
      );
      process.exitCode = 0;
      break;
    }
    throw new Error(
      outcome.owner === undefined
        ? `Minke development control port ${String(FORGE_DEVELOPMENT_LEASE_PORT)} is already in use`
        : `Minke development is already running from ${outcome.owner.workspace} (PID ${String(outcome.owner.pid)})`,
    );
  }
  case "renderer-running":
    console.log(
      `Minke development is already running on renderer port ${String(FORGE_DEVELOPMENT_RENDERER_PORT)}.`,
    );
    process.exitCode = 0;
    break;
  case "renderer-port-held":
    throw new Error(
      `Renderer port ${String(FORGE_DEVELOPMENT_RENDERER_PORT)} is owned by another application`,
    );
  case "completed":
    finishOwnedForgeDevelopment(outcome.result);
    break;
}
