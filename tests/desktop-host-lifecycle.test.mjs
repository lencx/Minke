import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { inspectDesktopTasks, runDesktopHost } from "../scripts/harness/desktop-host.mjs";
import { HarnessHostChannel } from "@minke/desktop/main/harness-host-channel.ts";
import { installDesktopQuitInspection } from "../vendor/deepseek-harness/apps/desktop-host/src/quit-inspection.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));
function context({ agents = [], jobs = [], schedule = false } = {}) {
  return {
    get: name => name === "agents" ? { list: () => agents } : { list: () => jobs },
    waterfall: async () => schedule ? [{ kind: "schedule" }] : [],
    effect() {},
    webServer: { port: 31234 },
    emit(target, event, origin, entries) {
      assert.equal(target, this.webServer);
      assert.equal(event, "webserver/entry-url");
      entries.push({ url: `${origin}/?token=${"a".repeat(43)}`, open: true });
    },
  };
}
function channel() {
  const result = new EventEmitter();
  result.connected = true;
  result.sent = [];
  result.send = (message, callback) => { result.sent.push(message); callback?.(null); };
  result.disconnect = () => { result.connected = false; result.emit("disconnect"); };
  return result;
}

test("quit inspection counts agents, both inboxes, global jobs and armed reminders", async () => {
  const agent = { id: "a", status: "idle", inbox: { nextTurn: [], nextStep: [] } };
  assert.deepEqual(await inspectDesktopTasks(context()), { activeTasks: false, scheduledTasks: false });
  for (const changed of [
    { ...agent, status: "running" },
    { ...agent, inbox: { nextTurn: ["queued"], nextStep: [] } },
    { ...agent, inbox: { nextTurn: [], nextStep: ["queued"] } },
  ]) assert.equal((await inspectDesktopTasks(context({ agents: [changed] }))).activeTasks, true);
  for (const status of ["running", "stopping"]) {
    assert.equal((await inspectDesktopTasks(context({ jobs: [{ status }] }))).activeTasks, true);
  }
  assert.equal((await inspectDesktopTasks(context({ jobs: [{ status: "completed" }] }))).activeTasks, false);
  assert.deepEqual(await inspectDesktopTasks(context({ agents: [agent], schedule: true })), {
    activeTasks: false, scheduledTasks: true,
  });
  await assert.rejects(inspectDesktopTasks({ get: () => undefined }), /unavailable/u);
});

test("Minke task inspection agrees with the pinned DSH Desktop implementation", async () => {
  const agent = { id: "a", status: "idle", inbox: { nextTurn: [], nextStep: [] } };
  for (const options of [
    {}, { agents: [agent] }, { agents: [agent], schedule: true },
    { agents: [{ ...agent, status: "running" }] },
    { agents: [{ ...agent, inbox: { nextTurn: [1], nextStep: [] } }] },
    { agents: [{ ...agent, inbox: { nextTurn: [], nextStep: [1] } }] },
    { jobs: [{ status: "stopping" }] }, { jobs: [{ status: "completed" }] },
  ]) {
    const ctx = context(options);
    assert.deepEqual(await inspectDesktopTasks(ctx), await installDesktopQuitInspection(ctx)());
  }
});

test("Host reports ready after boot and acknowledges shutdown only after disposal", async () => {
  const pipe = channel();
  const boot = Promise.withResolvers();
  const teardown = Promise.withResolvers();
  let stops = 0;
  const started = runDesktopHost(() => boot.promise, pipe);
  assert.equal(pipe.sent.length, 0);
  boot.resolve({ ctx: context(), shutdown: { shutdown: () => { stops++; return teardown.promise; } } });
  await started;
  assert.deepEqual(pipe.sent[0], { type: "ready", url: `http://127.0.0.1:31234/?token=${"a".repeat(43)}` });
  pipe.emit("message", { type: "quit-inspection", requestId: 7 });
  await flush();
  assert.deepEqual(pipe.sent[1], { type: "quit-inspection", requestId: 7, activeTasks: false, scheduledTasks: false });
  pipe.emit("message", { type: "shutdown" });
  pipe.emit("message", { type: "shutdown" });
  await flush();
  assert.equal(stops, 1);
  assert.equal(pipe.sent.some(message => message.type === "shutdown-complete"), false);
  teardown.resolve();
  await flush();
  assert.equal(pipe.sent.filter(message => message.type === "shutdown-complete").length, 1);
  assert.equal(pipe.connected, false);
});

test("a disconnect during boot disposes the eventual profile without publishing readiness", async () => {
  const pipe = channel();
  const boot = Promise.withResolvers();
  let stopped = false;
  const started = runDesktopHost(() => boot.promise, pipe);
  pipe.disconnect();
  boot.resolve({ ctx: context(), shutdown: { shutdown: async () => { stopped = true; } } });
  await started;
  assert.equal(stopped, true);
  assert.deepEqual(pipe.sent, []);
});

test("Host never boots after its parent has already disconnected", async () => {
  const pipe = channel();
  pipe.connected = false;
  await runDesktopHost(() => { throw new Error("must not boot without a parent"); }, pipe);
  assert.deepEqual(pipe.sent, []);
});

test("lifecycle IPC ignores malformed messages and correlates inspection responses", async () => {
  const pipe = channel();
  const host = new HarnessHostChannel(pipe, 1_000, () => "output");
  try {
    let ready = false;
    void host.ready.then(() => { ready = true; });
    pipe.emit("message", { type: "ready", url: 42 });
    await flush();
    assert.equal(ready, false);
    pipe.emit("message", { type: "ready", url: "http://127.0.0.1:31234" });
    assert.equal(await host.ready, "http://127.0.0.1:31234");
    const inspection = host.inspectQuit();
    const { requestId } = pipe.sent.at(-1);
    pipe.emit("message", { type: "quit-inspection", requestId: requestId + 1, activeTasks: false, scheduledTasks: false });
    pipe.emit("message", { type: "quit-inspection", requestId, activeTasks: true, scheduledTasks: false });
    assert.deepEqual(await inspection, { activeTasks: true, scheduledTasks: false });
    host.requestShutdown();
    assert.deepEqual(pipe.sent.at(-1), { type: "shutdown" });
    assert.equal(host.shutdownCompleted, false);
    pipe.emit("message", { type: "shutdown-complete" });
    assert.equal(host.shutdownCompleted, true);
  } finally { host.dispose(); }
  assert.equal(pipe.listenerCount("message"), 0);
});

test("fatal diagnostics reject startup promptly and redact capability URLs", async () => {
  const pipe = channel();
  const host = new HarnessHostChannel(pipe, 1_000, () => "");
  const failure = assert.rejects(host.ready, error => {
    assert.match(error.message, /cause: broken/u);
    assert.doesNotMatch(error.message, /secret-token/u);
    return true;
  });
  pipe.emit("message", { type: "fatal", message: "failed", diagnostic: "cause: broken http://127.0.0.1/?token=secret-token" });
  await failure;
  host.dispose();
});

test("task inspection is bounded and rejects on channel loss", async () => {
  const pipe = channel();
  const host = new HarnessHostChannel(pipe, 1_000, () => "");
  pipe.emit("message", { type: "ready", url: "ready" });
  await host.ready;
  await assert.rejects(host.inspectQuit(10), /timed out/u);
  const pending = assert.rejects(host.inspectQuit(), /disconnected/u);
  pipe.disconnect();
  await pending;
  host.dispose();
});
