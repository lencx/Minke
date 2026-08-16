import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  SESSION_LOG_EXPORT_CHANNEL,
} from "@minke/harness-overlay/session-export-contract.ts";
import {
  bindSessionLogExport,
} from "@minke/desktop/main/session-export/index.ts";

class FakeIpcMain {
  handlers = new Map();

  handle(channel, listener) {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

class FakeDownloadItem extends EventEmitter {
  saveDialogOptions;
  savePath = "";

  constructor(url) {
    super();
    this.url = url;
  }

  getSavePath() {
    return this.savePath;
  }

  getURL() {
    return this.url;
  }

  setSaveDialogOptions(options) {
    this.saveDialogOptions = options;
  }

  setSavePath(path) {
    this.savePath = path;
  }
}

class FakeDownloadSession extends EventEmitter {
  fetchCalls = [];
  response = { ok: true, status: 200 };

  async fetch(url, init) {
    this.fetchCalls.push({ url, init });
    return this.response;
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("condition was not reached");
}

function createFixture(overrides = {}) {
  const ipc = new FakeIpcMain();
  const downloadSession = new FakeDownloadSession();
  const downloads = [];
  const revealed = [];
  const reported = [];
  const chosen = [];
  let nextDestination = "/chosen/session-export.zip";
  const webContents = {
    downloadURL(url) {
      const item = new FakeDownloadItem(url);
      downloads.push(item);
      downloadSession.emit(
        "will-download",
        {},
        item,
        webContents,
      );
    },
  };
  const binding = bindSessionLogExport(
    ipc,
    downloadSession,
    webContents,
    {
      showItemInFolder(path) {
        revealed.push(path);
      },
    },
    {
      authorize: (event) => event === "allowed",
      harnessUrl: () => "http://127.0.0.1:4317",
      async chooseDestination(filename) {
        chosen.push(filename);
        return nextDestination;
      },
      reportError(error) {
        reported.push(error);
      },
      saveDialogOptions(filename) {
        return {
          title: "Export Session log",
          defaultPath: `/Downloads/${filename}`,
          filters: [{ name: "ZIP archives", extensions: ["zip"] }],
        };
      },
      ...overrides,
    },
  );
  const invoke = (event, sessionId) => {
    const handler = ipc.handlers.get(SESSION_LOG_EXPORT_CHANNEL);
    assert.equal(typeof handler, "function");
    return handler(event, sessionId);
  };

  return {
    binding,
    chosen,
    downloadSession,
    downloads,
    ipc,
    invoke,
    reported,
    revealed,
    setNextDestination(value) {
      nextDestination = value;
    },
    webContents,
  };
}

test("desktop Session export lets the user choose a path and reveals the ZIP", async () => {
  const fixture = createFixture();
  const operation = fixture.invoke("allowed", "session/name");
  await waitFor(() => fixture.downloads.length === 1);

  assert.deepEqual(fixture.chosen, [
    "dsh-session-session_name.zip",
  ]);
  assert.equal(fixture.downloadSession.fetchCalls.length, 1);
  const preflight = fixture.downloadSession.fetchCalls[0];
  assert.equal(preflight.init.method, "HEAD");
  const url = new URL(preflight.url);
  assert.equal(url.origin, "http://127.0.0.1:4317");
  assert.equal(url.pathname, "/api/session.export");
  assert.equal(url.searchParams.get("sessionId"), "session/name");
  assert.equal(url.searchParams.get("includeDescendants"), "true");
  assert.ok(url.searchParams.get("minkeExport"));

  const item = fixture.downloads[0];
  assert.equal(item.savePath, "/chosen/session-export.zip");
  assert.equal(item.saveDialogOptions, undefined);
  item.emit("done", {}, "completed");
  await operation;

  assert.deepEqual(fixture.revealed, [
    "/chosen/session-export.zip",
  ]);
  assert.deepEqual(fixture.reported, []);
  fixture.binding.dispose();
});

test("cancelling the native save dialog is a quiet no-op", async () => {
  const fixture = createFixture();
  fixture.setNextDestination(undefined);

  await fixture.invoke("allowed", "session-2");

  assert.equal(fixture.downloads.length, 0);
  assert.deepEqual(fixture.reported, []);
  assert.deepEqual(fixture.revealed, []);
  fixture.binding.dispose();
});

test("repeated clicks share one native export operation per Session", async () => {
  const fixture = createFixture();
  const first = fixture.invoke("allowed", "session-duplicate");
  const second = fixture.invoke("allowed", "session-duplicate");

  assert.equal(first, second);
  await waitFor(() => fixture.downloads.length === 1);
  assert.equal(fixture.chosen.length, 1);
  assert.equal(fixture.downloadSession.fetchCalls.length, 1);

  fixture.downloads[0].emit("done", {}, "completed");
  await Promise.all([first, second]);
  assert.equal(fixture.revealed.length, 1);
  fixture.binding.dispose();
});

test("invalid and unauthorized export requests never reach the Host", async () => {
  const fixture = createFixture();

  await assert.rejects(
    fixture.invoke("denied", "session-3"),
    /unauthorized/u,
  );
  for (const invalid of ["", "bad\u0000id", "x".repeat(513)]) {
    await assert.rejects(
      fixture.invoke("allowed", invalid),
      /invalid Session id/u,
    );
  }

  assert.equal(fixture.downloadSession.fetchCalls.length, 0);
  assert.deepEqual(fixture.reported, []);
  fixture.binding.dispose();
});

test("Host and download failures reject once and show only a native error", async () => {
  const preflight = createFixture();
  preflight.downloadSession.response = { ok: false, status: 503 };

  await assert.rejects(
    preflight.invoke("allowed", "session-4"),
    /HTTP 503/u,
  );
  assert.equal(preflight.reported.length, 1);
  assert.equal(preflight.downloads.length, 0);
  preflight.binding.dispose();

  const interrupted = createFixture();
  const operation = interrupted.invoke("allowed", "session-5");
  await waitFor(() => interrupted.downloads.length === 1);
  interrupted.downloads[0].emit("done", {}, "interrupted");

  await assert.rejects(operation, /interrupted/u);
  assert.equal(interrupted.reported.length, 1);
  assert.deepEqual(interrupted.revealed, []);
  interrupted.binding.dispose();
});

test("the upstream /export download gets a native save dialog and Finder reveal", async () => {
  const fixture = createFixture();
  const item = new FakeDownloadItem(
    "http://127.0.0.1:4317/api/session.export" +
      "?sessionId=slash-export&includeDescendants=true",
  );

  fixture.downloadSession.emit(
    "will-download",
    {},
    item,
    fixture.webContents,
  );

  assert.deepEqual(item.saveDialogOptions, {
    title: "Export Session log",
    defaultPath: "/Downloads/dsh-session-slash-export.zip",
    filters: [{ name: "ZIP archives", extensions: ["zip"] }],
  });
  item.savePath = "/chosen/slash-export.zip";
  item.emit("done", {}, "completed");
  assert.deepEqual(fixture.revealed, [
    "/chosen/slash-export.zip",
  ]);
  assert.deepEqual(fixture.reported, []);

  const cancelled = new FakeDownloadItem(
    "http://127.0.0.1:4317/api/session.export" +
      "?sessionId=cancelled&includeDescendants=true",
  );
  fixture.downloadSession.emit(
    "will-download",
    {},
    cancelled,
    fixture.webContents,
  );
  cancelled.emit("done", {}, "cancelled");
  assert.deepEqual(fixture.reported, []);
  fixture.binding.dispose();
});

test("unrelated downloads are untouched and disposal releases listeners", async () => {
  const fixture = createFixture();
  const unrelated = new FakeDownloadItem(
    "https://example.com/report.zip",
  );
  fixture.downloadSession.emit(
    "will-download",
    {},
    unrelated,
    fixture.webContents,
  );

  assert.equal(unrelated.savePath, "");
  assert.equal(unrelated.saveDialogOptions, undefined);
  assert.equal(unrelated.listenerCount("done"), 0);

  fixture.binding.dispose();
  fixture.binding.dispose();
  assert.equal(
    fixture.ipc.handlers.has(SESSION_LOG_EXPORT_CHANNEL),
    false,
  );
  assert.equal(
    fixture.downloadSession.listenerCount("will-download"),
    0,
  );
});
