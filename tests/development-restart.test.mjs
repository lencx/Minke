import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { connect as connectTcp } from "node:net";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEVELOPMENT_RESTART_EXIT_CODE,
  requestDesktopRestart,
} from "@minke/desktop/main/app-restart.ts";
import {
  superviseForgeDevelopment,
} from "../scripts/forge/development-supervisor.mjs";
import {
  acquireForgeDevelopmentLease,
  finishOwnedForgeDevelopment,
  runOwnedForgeDevelopment,
} from "../scripts/forge/development-owner.mjs";
import rendererViteConfig from "../vite.renderer.config.mts";

class FakeElectronProcess extends EventEmitter {
  restarted = false;
  kills = [];

  kill(signal) {
    this.kills.push(signal);
  }
}

test("the renderer keeps its preferred development port without requiring it", () => {
  assert.equal(rendererViteConfig.server?.port, 41783);
  assert.equal(rendererViteConfig.server?.strictPort, false);
});

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

test("a development owner blocks duplicate staging and Forge startup", async () => {
  const calls = [];
  const result = await runOwnedForgeDevelopment({
    async acquireLease() {
      return {
        acquired: false,
        owner: {
          pid: 42,
          workspace: "/workspace/minke",
        },
      };
    },
    async inspectRenderer() {
      calls.push("inspect");
      return "absent";
    },
    async prepare() {
      calls.push("prepare");
    },
    async launch() {
      calls.push("launch");
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(result, {
    kind: "lease-held",
    owner: {
      pid: 42,
      workspace: "/workspace/minke",
    },
  });
  assert.deepEqual(calls, []);
});

for (const [renderer, expectedKind] of [
  ["minke", "renderer-running"],
  ["foreign", "renderer-port-held"],
]) {
  test(`a ${renderer} renderer blocks staging and releases the development lease`, async () => {
    const calls = [];
    const result = await runOwnedForgeDevelopment({
      async acquireLease() {
        return {
          acquired: true,
          async release() {
            calls.push("release");
          },
        };
      },
      async inspectRenderer() {
        calls.push("inspect");
        return renderer;
      },
      async prepare() {
        calls.push("prepare");
      },
      async launch() {
        calls.push("launch");
        return { code: 0, signal: null };
      },
    });

    assert.deepEqual(result, { kind: expectedKind });
    assert.deepEqual(calls, ["inspect", "release"]);
  });
}

test("the development lease is exclusive and reusable after release", async () => {
  const first = await acquireForgeDevelopmentLease({
    port: 0,
    workspace: "/workspace/first",
  });
  assert.equal(first.acquired, true);
  const second = await acquireForgeDevelopmentLease({
    port: first.port,
    workspace: "/workspace/second",
  });
  assert.deepEqual(second, {
    acquired: false,
    owner: {
      pid: process.pid,
      workspace: resolve("/workspace/first"),
    },
  });

  await first.release();
  const replacement = await acquireForgeDevelopmentLease({
    port: first.port,
    workspace: "/workspace/replacement",
  });
  assert.equal(replacement.acquired, true);
  await replacement.release();
});

test("development lease release closes a half-open control client", async () => {
  const lease = await acquireForgeDevelopmentLease({
    port: 0,
    workspace: "/workspace/half-open",
  });
  assert.equal(lease.acquired, true);
  const peer = connectTcp({
    allowHalfOpen: true,
    host: "127.0.0.1",
    port: lease.port,
  });
  const ended = once(peer, "end");
  await once(peer, "data");
  await ended;

  const release = lease.release();
  try {
    await Promise.race([
      release,
      delay(250, undefined, { ref: false }).then(() => {
        throw new Error("development lease release timed out");
      }),
    ]);
  } finally {
    peer.destroy();
    await release;
  }
});

test("development ownership releases after preparation fails", async () => {
  let releases = 0;
  await assert.rejects(
    runOwnedForgeDevelopment({
      async acquireLease() {
        return {
          acquired: true,
          async release() {
            releases += 1;
          },
        };
      },
      async inspectRenderer() {
        return "absent";
      },
      async prepare() {
        throw new Error("stage failed");
      },
      async launch() {
        throw new Error("must not launch");
      },
    }),
    /stage failed/u,
  );
  assert.equal(releases, 1);
});

test("development ownership releases after Forge exits", async () => {
  let releases = 0;
  const result = await runOwnedForgeDevelopment({
    async acquireLease() {
      return {
        acquired: true,
        async release() {
          releases += 1;
        },
      };
    },
    async inspectRenderer() {
      return "absent";
    },
    async prepare() {},
    async launch() {
      return { code: 0, signal: null };
    },
  });

  assert.deepEqual(result, {
    kind: "completed",
    result: { code: 0, signal: null },
  });
  assert.equal(releases, 1);
});

test("Forge completion explicitly exits despite retained Vite handles", () => {
  const calls = [];
  finishOwnedForgeDevelopment(
    { code: 0, signal: null },
    {
      exit(code) {
        calls.push(["exit", code]);
      },
      signal(value) {
        calls.push(["signal", value]);
      },
    },
  );
  finishOwnedForgeDevelopment(
    { code: null, signal: "SIGTERM" },
    {
      exit(code) {
        calls.push(["exit", code]);
      },
      signal(value) {
        calls.push(["signal", value]);
      },
    },
  );

  assert.deepEqual(calls, [
    ["exit", 0],
    ["signal", "SIGTERM"],
  ]);
});
