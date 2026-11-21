import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bundledDesktop, until } from "./support/bundled-desktop.mjs";
const bytes = Buffer.from("verified installer fixture");
const digest = createHash("sha256").update(bytes).digest("hex");
const target = { platform: "linux", architecture: "x64", installer: "deb" };
const name = "Minke-linux-x64.deb";
const url = `https://github.com/lencx/Minke/releases/download/v9.0.0/${name}`;
const release = { tag_name: "v9.0.0", draft: false, prerelease: false, immutable: true,
  assets: [{ name, state: "uploaded", size: bytes.length, digest: `sha256:${digest}`, browser_download_url: url }] };

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "minke-update-flow-"));
  const app = new EventEmitter(), powerMonitor = new EventEmitter(), session = new EventEmitter();
  const calls = { fetches: 0, downloads: 0, dialogs: [], opened: [], states: [] };
  const responses = options.responses ?? [];
  let remainingFailures = options.failDownloads ?? 0;
  session.fetch = async () => { calls.fetches++; return options.fetch ? options.fetch() : Response.json(release); };
  session.downloadURL = () => {
    calls.downloads++;
    const item = new EventEmitter();
    item.getURLChain = () => [url];
    item.getTotalBytes = () => bytes.length;
    item.getReceivedBytes = () => Math.floor(bytes.length / 2);
    item.getState = () => "progressing";
    item.setSavePath = value => { item.path = value; };
    item.cancel = () => item.emit("done", {}, "cancelled");
    queueMicrotask(async () => {
      session.emit("will-download", { preventDefault() {} }, item);
      if (remainingFailures-- > 0) { item.emit("done", {}, "interrupted"); return; }
      item.emit("updated", {}, "progressing");
      await writeFile(item.path, bytes);
      item.emit("done", {}, "completed");
    });
  };
  const { AppUpdateRuntime } = bundledDesktop("desktop/main/app-update-runtime.ts", {
    app, powerMonitor, session: { fromPartition: () => session },
    dialog: { showMessageBox: async settings => {
      calls.dialogs.push(settings);
      return { response: responses.length ? responses.shift() : 1 };
    } },
    shell: { openPath: async path => { calls.opened.push(path); return options.openError ?? ""; }, openExternal: async path => calls.opened.push(path) },
  });
  const makeRuntime = () => new AppUpdateRuntime({ target, autoDownload: options.autoDownload ?? true, currentVersion: "0.8.0", userDataPath: root,
    window: () => undefined, text: key => key, changed: state => { calls.states.push(state); options.changed?.(state); } });
  const runtimes = [];
  const create = () => { const runtime = makeRuntime(); runtimes.push(runtime); return runtime; };
  t.after(async () => { for (const runtime of runtimes) runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, calls, responses, app, powerMonitor, create, cache: join(root, "updates", `ready-${digest}`, name) };
}

async function ready(f, count) {
  await until(() => f.calls.dialogs.filter(value => value.title === "update.readyTitle").length === count);
  await new Promise(resolve => setImmediate(resolve));
}

test("Later retains the verified installer across restart; reopening reuses it", async t => {
  const f = await fixture(t);
  const first = f.create();
  await first.open();
  await ready(f, 1);
  assert.deepEqual(await readFile(f.cache), bytes);
  first.dispose();
  f.responses.push(0);
  const second = f.create();
  await second.open();
  await until(() => f.calls.opened.length === 1);
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.calls.fetches, 2, "restart rechecks trusted release metadata before reusing a package");
  assert.equal(f.calls.opened[0], f.cache);
});

test("Retry repeats a failed download and never opens failed or altered bytes", async t => {
  const f = await fixture(t, { failDownloads: 1, responses: [0, 1] });
  const runtime = f.create();
  await runtime.open();
  await ready(f, 1);
  assert.deepEqual(f.calls.dialogs[0].buttons, ["update.retry", "update.openReleasePage", "update.cancel"]);
  assert.equal(f.calls.downloads, 2);
  assert.deepEqual(f.calls.opened, []);
  await writeFile(f.cache, "tampered");
  await runtime.open();
  await ready(f, 2);
  assert.equal(f.calls.downloads, 3, "corrupt cached data must be downloaded and verified again");
  assert.deepEqual(await readFile(f.cache), bytes);
  assert.deepEqual(f.calls.opened, []);
});

test("simultaneous manual checks join one metadata request", async t => {
  let releaseFetch;
  const pending = new Promise(resolve => { releaseFetch = resolve; });
  const f = await fixture(t, { fetch: () => pending });
  const runtime = f.create();
  const a = runtime.open(), b = runtime.open();
  assert.equal(f.calls.fetches, 1);
  releaseFetch(Response.json(release));
  await Promise.all([a, b]);
  await ready(f, 1);
  assert.equal(f.calls.downloads, 1);
});

test("prepared installers do not prevent later release checks", async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  t.mock.method(Math, "random", () => 0.5);
  const runtime = f.create();
  runtime.start();
  t.mock.timers.tick(10_000);
  await ready(f, 1);
  t.mock.timers.tick(24 * 60 * 60 * 1_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetches, 2, "daily checks must still discover releases after Later");
  assert.equal(f.calls.dialogs.length, 1, "the same version is not offered automatically again");
  await runtime.open();
  await ready(f, 2);
  assert.equal(f.calls.fetches, 3, "an explicit check also refreshes release metadata");
  assert.equal(f.calls.downloads, 1, "verified bytes remain reusable");
});

test("automatic failure backs off, resume shares the deadline, disposal removes wake handlers", async t => {
  const f = await fixture(t, { fetch: async () => { throw new Error("offline fixture"); } });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  t.mock.method(Math, "random", () => 0.5);
  const runtime = f.create();
  runtime.start();
  t.mock.timers.tick(10_000);
  await until(() => f.calls.fetches === 1);
  await new Promise(resolve => setImmediate(resolve));
  f.powerMonitor.emit("resume"); f.app.emit("browser-window-focus");
  assert.equal(f.calls.fetches, 1);
  t.mock.timers.tick(300_000);
  await until(() => f.calls.fetches === 2);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(300_000); f.powerMonitor.emit("resume");
  assert.equal(f.calls.fetches, 2, "second failure doubles the delay");
  runtime.dispose();
  assert.equal(f.powerMonitor.listenerCount("resume"), 0);
  assert.equal(f.app.listenerCount("browser-window-focus"), 0);
  t.mock.timers.tick(3_600_000);
  assert.equal(f.calls.fetches, 2);
});


test("standard presentation reports checking, progress and verification while an OS installer remains an available update", async t => {
  let progressAction;
  const f = await fixture(t, { changed(state) {
    if (state.phase === "downloading" && state.percent > 0) progressAction = runtime.open();
  } });
  const runtime = f.create();
  assert.deepEqual(runtime.status(), { phase: "idle" });
  await runtime.open();
  await ready(f, 1);
  assert.ok(progressAction);
  await progressAction;
  assert.equal(f.calls.fetches, 1);
  assert.equal(f.calls.downloads, 1);
  assert.deepEqual(f.calls.states, [
    { phase: "checking" },
    { phase: "available", version: "9.0.0" },
    { phase: "downloading", version: "9.0.0", percent: 0 },
    { phase: "downloading", version: "9.0.0", percent: Math.floor(Math.floor(bytes.length / 2) / bytes.length * 100) },
    { phase: "verifying", version: "9.0.0" },
    { phase: "available", version: "9.0.0" },
  ]);
  assert.deepEqual(runtime.status(), { phase: "available", version: "9.0.0" });
  assert.deepEqual(f.calls.opened, [], "download completion cannot authorize installation");
  assert.ok(f.calls.states.every(state => Object.isFrozen(state)));
  // DSH's ready/installing labels promise an automatic install/restart, which this updater does not own.
  assert.equal(f.calls.states.some(state => ["ready", "installing"].includes(state.phase)), false);
});

test("disabled automatic download remains available after Later and a manual retry still asks before downloading", async t => {
  const f = await fixture(t, { autoDownload: false, responses: [1] });
  const runtime = f.create();
  await runtime.open();
  await until(() => f.calls.dialogs.length === 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.status(), { phase: "available", version: "9.0.0" });
  assert.equal(f.calls.downloads, 0);
  f.responses.push(0, 1);
  await runtime.open();
  await ready(f, 1);
  assert.equal(f.calls.dialogs.filter(value => value.title === "update.availableTitle").length, 2);
  assert.equal(f.calls.downloads, 1);
  assert.deepEqual(f.calls.opened, []);
});

test("check, download and installer failures publish standard retry states", async t => {
  const offline = await fixture(t, { fetch: async () => { throw new Error("offline fixture"); } });
  const check = offline.create();
  await assert.rejects(check.open(), /offline fixture/u);
  assert.deepEqual(check.status(), { phase: "error", failure: "check" });
  const broken = await fixture(t, { failDownloads: 1, responses: [2] });
  const download = broken.create();
  await download.open();
  await until(() => broken.calls.dialogs.length === 1);
  assert.deepEqual(download.status(), { phase: "error", failure: "download", version: "9.0.0" });
  assert.deepEqual(broken.calls.opened, []);
  const denied = await fixture(t, { openError: "OS refused installer", responses: [0, 2] });
  const install = denied.create();
  await install.open();
  await until(() => denied.calls.dialogs.length === 2);
  assert.deepEqual(install.status(), { phase: "error", failure: "install", version: "9.0.0" });
});

test("an explicit up-to-date check shows native feedback, automatic checks stay quiet", async t => {
  const f = await fixture(t, { fetch: async () => Response.json({ ...release, tag_name: "v0.8.0" }) });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const runtime = f.create();
  runtime.start();
  t.mock.timers.tick(10_000);
  await until(() => f.calls.fetches === 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.status(), { phase: "idle" });
  assert.equal(f.calls.dialogs.length, 0);
  await runtime.open();
  assert.equal(f.calls.dialogs.length, 1);
  assert.equal(f.calls.dialogs[0].message, "update.upToDate");
  assert.equal(f.calls.downloads, 0);
});
