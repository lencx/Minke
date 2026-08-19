import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  DEVELOPMENT_RESTART_EXIT_CODE,
  requestDesktopRestart,
} from "@minke/desktop/main/app-restart.ts";
import {
  superviseForgeDevelopment,
} from "../scripts/forge/development-supervisor.mjs";

class FakeElectronProcess extends EventEmitter {
  restarted = false;
  kills = [];

  kill(signal) {
    this.kills.push(signal);
  }
}

test("development data-home restarts are handed back to Forge", () => {
  const calls = [];

  requestDesktopRestart(
    {
      isPackaged: false,
      relaunch() {
        calls.push(["relaunch"]);
      },
      quit() {
        calls.push(["quit"]);
      },
    },
    (exitCode) => {
      calls.push(["development", exitCode]);
    },
  );

  assert.deepEqual(calls, [
    ["development", DEVELOPMENT_RESTART_EXIT_CODE],
    ["quit"],
  ]);
});

test("packaged data-home restarts keep Electron relaunch semantics", () => {
  const calls = [];

  requestDesktopRestart(
    {
      isPackaged: true,
      relaunch() {
        calls.push(["relaunch"]);
      },
      quit() {
        calls.push(["quit"]);
      },
    },
    (exitCode) => {
      calls.push(["development", exitCode]);
    },
  );

  assert.deepEqual(calls, [["relaunch"], ["quit"]]);
});

test("Forge keeps Vite alive while replacing a migration-restart child", async () => {
  const children = [];
  const starts = [];
  const supervise = superviseForgeDevelopment({
    restartExitCode: DEVELOPMENT_RESTART_EXIT_CODE,
    async start() {
      const child = new FakeElectronProcess();
      children.push(child);
      starts.push(children.length);
      return child;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children[0]?.restarted, true);
  children[0]?.emit("exit", DEVELOPMENT_RESTART_EXIT_CODE, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, [1, 2]);
  assert.equal(children[1]?.restarted, true);

  children[1]?.emit("exit", 0, null);
  assert.deepEqual(await supervise, { code: 0, signal: null });
});

test("Forge does not restart an ordinary Electron exit", async () => {
  const child = new FakeElectronProcess();
  let starts = 0;
  const supervise = superviseForgeDevelopment({
    restartExitCode: DEVELOPMENT_RESTART_EXIT_CODE,
    async start() {
      starts += 1;
      return child;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 1, null);

  assert.deepEqual(await supervise, { code: 1, signal: null });
  assert.equal(starts, 1);
});

test("Forge keeps its interactive rs restart while supervising migration restarts", async () => {
  const input = new EventEmitter();
  const children = [];
  const supervise = superviseForgeDevelopment({
    input,
    restartExitCode: DEVELOPMENT_RESTART_EXIT_CODE,
    async start() {
      const child = new FakeElectronProcess();
      children.push(child);
      return child;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("data", Buffer.from("rs\n"));
  assert.deepEqual(children[0]?.kills, ["SIGTERM"]);
  children[0]?.emit("exit", null, "SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);

  children[1]?.emit("exit", 0, null);
  assert.deepEqual(await supervise, { code: 0, signal: null });
  assert.equal(input.listenerCount("data"), 0);
});
