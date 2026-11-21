import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SessionLogDownloadController } from "@vendor/deepseek-harness/packages/session-query/session-log-export/src/client/controller.ts";
import { ShortcutRegistry } from "@vendor/deepseek-harness/packages/client/shortcuts/src/client/registry.ts";
import { bindSessionLogExport } from "@minke/desktop/main/session-export/index.ts";
import { installSessionExport } from "@minke/harness-overlay/client/shortcuts/session-export.ts";
import { ShortcutRuntime } from "@minke/harness-overlay/client/shortcuts/runtime.ts";

const origin = "http://127.0.0.1:4317";
const exportUrl = sessionId => origin + "/api/session.export?" + new URLSearchParams({
  sessionId, includeDescendants: "true",
});

class FakeDownloadItem extends EventEmitter {
  saveDialogOptions;
  savePath = "";
  constructor(url) { super(); this.url = url; }
  getSavePath() { return this.savePath; }
  getURL() { return this.url; }
  setSaveDialogOptions(options) { this.saveDialogOptions = options; }
}

function createFixture(t, overrides = {}) {
  const downloadSession = new EventEmitter();
  const webContents = {};
  const revealed = [], reported = [], downloads = [];
  const binding = bindSessionLogExport(downloadSession, webContents, {
    showItemInFolder(path) { revealed.push(path); },
  }, {
    harnessUrl: () => origin,
    reportError: error => reported.push(error),
    saveDialogOptions: filename => ({
      title: "Export Session log",
      defaultPath: "/Downloads/" + filename,
      filters: [{ name: "ZIP archives", extensions: ["zip"] }],
    }),
    ...overrides,
  });
  t.after(() => binding.dispose());
  return {
    binding, downloadSession, webContents, revealed, reported, downloads,
    start(url = exportUrl("session/name"), source = webContents) {
      const item = new FakeDownloadItem(url);
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      downloadSession.emit("will-download", event, item, source);
      downloads.push(item);
      return { item, prevented };
    },
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("Session export did not reach the expected state");
}

async function paletteFixture(t) {
  const ctx = new Context();
  const runtime = new ShortcutRuntime(new ShortcutRegistry("web", "windows"));
  let sessions = { byId: {} };
  ctx.provide("sessions", { list: { getSnapshot: () => sessions } });
  const overlay = ctx.plugin(scope => installSessionExport(scope, runtime, key => key));
  await overlay.await();
  const providers = [];
  t.after(async () => {
    await overlay.dispose();
    for (const provider of providers) await provider.dispose();
    runtime.dispose();
  });
  return {
    runtime,
    select(sessionId) {
      sessions = { byId: {
        sidebar: { retainedBy: { sidebar: 1 } },
        ...(sessionId === undefined ? {} : { [sessionId]: { retainedBy: { mainView: 1 } } }),
      } };
    },
    async provide(controller) {
      const provider = ctx.plugin(scope => {
        scope.provide("sessionLogDownload", controller);
        scope.effect(() => () => controller.dispose(), "test: native export service");
      });
      providers.push(provider);
      await provider.await();
      await waitFor(() => runtime.listPaletteActions().length === 1);
      return provider;
    },
  };
}

test("palette and native Header share DSH preflight, deduplication and desktop save/reveal", async t => {
  const desktop = createFixture(t);
  const palette = await paletteFixture(t);
  const response = Promise.withResolvers();
  const requests = [];
  const controller = new SessionLogDownloadController((route, init) => {
    requests.push({ route, init });
    return response.promise;
  }, route => desktop.start(new URL(route, origin + "/").href));
  await palette.provide(controller);
  assert.equal(palette.runtime.listPaletteActions()[0].disabledReason, "disabled.activeSession");
  assert.equal(palette.runtime.invoke("session.export"), false);
  assert.equal(requests.length, 0);
  palette.select("session/name");
  assert.equal(palette.runtime.listActions().length, 0, "export stays a palette-only action");
  assert.equal(palette.runtime.invoke("session.export"), true);
  assert.equal(palette.runtime.invoke("session.export"), true);
  assert.equal(requests.length, 1, "the palette starts the native download without another entry point");
  const headerRequest = controller.download("session/name");
  assert.equal(requests.length, 1, "all gestures share the native controller's request");
  assert.equal(requests[0].init.method, "HEAD");
  assert.equal(new URL(requests[0].route, origin + "/").href, exportUrl("session/name"));
  assert.equal(controller.store.getSnapshot().bySession["session/name"].status, "downloading");
  response.resolve(new Response(null, { status: 200 }));
  await headerRequest;
  assert.equal(desktop.downloads.length, 1);
  const item = desktop.downloads[0];
  assert.deepEqual(item.saveDialogOptions, {
    title: "Export Session log",
    defaultPath: "/Downloads/dsh-session-session_name.zip",
    filters: [{ name: "ZIP archives", extensions: ["zip"] }],
  });
  item.savePath = "/chosen/session.zip";
  item.emit("done", {}, "completed");
  assert.deepEqual(desktop.revealed, ["/chosen/session.zip"]);
  assert.deepEqual(desktop.reported, []);
});

test("palette export follows native service availability and replacement without a desktop bridge", async t => {
  const palette = await paletteFixture(t);
  palette.select("first");
  assert.deepEqual(palette.runtime.listPaletteActions(), []);
  const saved = [];
  const controller = () => new SessionLogDownloadController(
    async () => new Response(null, { status: 200 }), route => saved.push(route),
  );
  const first = await palette.provide(controller());
  assert.equal(palette.runtime.invoke("session.export"), true);
  await waitFor(() => saved.length === 1);
  await first.dispose();
  await waitFor(() => palette.runtime.listPaletteActions().length === 0);
  assert.equal(palette.runtime.invoke("session.export"), false);
  await palette.provide(controller());
  palette.select("second");
  assert.equal(palette.runtime.invoke("session.export"), true);
  await waitFor(() => saved.length === 2);
  assert.deepEqual(saved.map(route => new URL(route, origin).searchParams.get("sessionId")), ["first", "second"]);
});

test("failed native preflight exposes shared error state without a desktop download", async t => {
  const desktop = createFixture(t);
  const palette = await paletteFixture(t);
  const controller = new SessionLogDownloadController(
    async () => new Response("backend unavailable", { status: 503 }),
    route => desktop.start(new URL(route, origin + "/").href),
  );
  await palette.provide(controller);
  palette.select("unavailable");
  palette.runtime.invoke("session.export");
  await waitFor(() => controller.store.getSnapshot().bySession.unavailable?.status === "error");
  assert.deepEqual(controller.store.getSnapshot().bySession.unavailable, {
    order: 0, open: true, status: "error", error: "Export failed: HTTP 503 backend unavailable",
  });
  assert.deepEqual(desktop.downloads, []);
  assert.deepEqual(desktop.reported, [], "the native client owns preflight error UI");
});

test("native download cancellation stays quiet and interruption reports once", t => {
  const fixture = createFixture(t);
  const cancelled = fixture.start().item;
  cancelled.emit("done", {}, "cancelled");
  assert.deepEqual(fixture.reported, []);
  assert.deepEqual(fixture.revealed, []);
  const interrupted = fixture.start().item;
  interrupted.emit("done", {}, "interrupted");
  interrupted.emit("done", {}, "interrupted");
  assert.equal(fixture.reported.length, 1);
  assert.match(fixture.reported[0].message, /interrupted/u);
  assert.deepEqual(fixture.revealed, []);
});

test("only the owning window's valid current-Host exports get native save/reveal handling", t => {
  const fixture = createFixture(t);
  const unrelated = [
    ["https://example.com/api/session.export?sessionId=foreign"],
    [origin + "/api/other?sessionId=other"],
    ["not-a-url"],
    [exportUrl("other-window"), {}],
    ...["", "bad\u0000id", "x".repeat(513)].map(id => [exportUrl(id)]),
    [origin + "/api/session.export"],
  ];
  for (const args of unrelated) {
    const { item, prevented } = fixture.start(...args);
    assert.equal(prevented, false);
    assert.equal(item.saveDialogOptions, undefined, item.getURL());
    assert.equal(item.listenerCount("done"), 0);
    item.savePath = "/unrelated.zip";
    item.emit("done", {}, "completed");
  }
  assert.deepEqual(fixture.revealed, []);
  assert.deepEqual(fixture.reported, []);
  const long = fixture.start(exportUrl("x".repeat(200))).item;
  assert.equal(long.saveDialogOptions.defaultPath, "/Downloads/dsh-session-" + "x".repeat(96) + ".zip");
  for (const harnessUrl of [undefined, "not-a-url", "file:///app", "http://127.0.0.1:9999"]) {
    const unavailable = createFixture(t, { harnessUrl: () => harnessUrl });
    assert.equal(unavailable.start().item.saveDialogOptions, undefined);
  }
});

test("save-dialog setup failure cancels the download and missing save paths are reported", t => {
  const invalidDialog = createFixture(t, {
    saveDialogOptions() { throw new Error("dialog unavailable"); },
  });
  const { item, prevented } = invalidDialog.start();
  assert.equal(prevented, true);
  assert.equal(item.listenerCount("done"), 0);
  assert.equal(invalidDialog.reported[0].message, "dialog unavailable");
  const missingPath = createFixture(t);
  missingPath.start().item.emit("done", {}, "completed");
  assert.equal(missingPath.reported.length, 1);
  assert.match(missingPath.reported[0].message, /without a save path/u);
  assert.deepEqual(missingPath.revealed, []);
});

test("window disposal releases pending download listeners and ignores late completion", t => {
  const fixture = createFixture(t);
  const item = fixture.start().item;
  assert.equal(item.listenerCount("done"), 1);
  fixture.binding.dispose();
  fixture.binding.dispose();
  assert.equal(fixture.downloadSession.listenerCount("will-download"), 0);
  assert.equal(item.listenerCount("done"), 0);
  item.savePath = "/late.zip";
  item.emit("done", {}, "completed");
  assert.equal(fixture.start().item.saveDialogOptions, undefined);
  assert.deepEqual(fixture.revealed, []);
  assert.deepEqual(fixture.reported, []);
});
