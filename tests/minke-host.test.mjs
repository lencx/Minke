import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  apply as applyMinkeHost,
} from "@minke/harness-overlay/index.ts";
import {
  MINKE_HOST_PROTOCOL_VERSION,
  MINKE_HOST_RPC_CHANNEL,
} from "@minke/harness-overlay/minke-host-contract.ts";
import {
  browserFilesPort,
  browserTerminalPort,
  browserTabsPort,
} from "@minke/harness-overlay/client/host/workspace.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function hostCapabilities(root = "/host/home") {
  return {
    protocolVersion: MINKE_HOST_PROTOCOL_VERSION,
    files: {
      available: true,
      nativeOpen: false,
      root,
      watch: false,
      write: true,
    },
    tabs: {
      available: true,
      embeddedWeb: false,
      state: "client",
    },
    terminal: {
      available: true,
      resize: true,
      transport: "long-poll",
    },
  };
}

test("Minke Host mounts Files RPC on the trusted DSH connection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "minke-host-root-"));
  const outside = await mkdtemp(join(tmpdir(), "minke-host-outside-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const notesPath = join(root, "notes.txt");
  const outsidePath = join(outside, "secret.txt");
  await Promise.all([
    writeFile(notesPath, "before\n", "utf8"),
    writeFile(outsidePath, "outside\n", "utf8"),
  ]);

  let registration;
  const context = {
    effect(callback) {
      return callback();
    },
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options };
          return async () => {};
        },
      },
    },
  };
  applyMinkeHost(context, { rootPath: root });
  assert.equal(registration.channel, MINKE_HOST_RPC_CHANNEL);
  assert.deepEqual(registration.options, {
    authority: "trusted-host",
  });
  const call = (endpoint, payload) =>
    registration.handler(
      endpoint,
      payload,
      new AbortController().signal,
    );

  const capabilities = await call("capabilities", {});
  assert.equal(capabilities.ok, true);
  assert.deepEqual(capabilities.value, hostCapabilities(root));

  const listing = await call("files.list", {});
  assert.equal(listing.ok, true);
  assert.equal(listing.value.path, await realpath(root));
  assert.equal(listing.value.parent, undefined);
  assert.deepEqual(
    listing.value.entries.map((entry) => entry.name),
    ["notes.txt"],
  );

  const preview = await call("files.preview", {
    path: notesPath,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.value.kind, "text");
  assert.equal(preview.value.content, "before\n");

  const written = await call("files.write", {
    path: notesPath,
    content: "after\n",
    expectedVersion: preview.value.version,
  });
  assert.equal(written.ok, true);
  assert.equal(await readFile(notesPath, "utf8"), "after\n");

  const escaped = await call("files.preview", {
    path: outsidePath,
  });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.error.code, "bad-request");
  assert.match(escaped.error.message, /outside its root/u);
});

test("browser workspace adapters project Host Files without Electron", async () => {
  const calls = [];
  const connection = {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload]);
        if (endpoint === "capabilities") {
          return { ok: true, value: hostCapabilities() };
        }
        if (endpoint === "files.list") {
          return {
            ok: true,
            value: {
              path: "/host/home",
              entries: [
                {
                  name: "project",
                  path: "/host/home/project",
                  kind: "directory",
                },
              ],
              truncated: false,
            },
          };
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      },
    },
  };
  const storage = memoryStorage();
  const files = browserFilesPort(connection, storage);
  assert.equal(files.available, true);
  assert.equal(files.nativeOpenAvailable, false);
  assert.deepEqual(await files.list({}), {
    path: "/host/home",
    entries: [
      {
        name: "project",
        path: "/host/home/project",
        kind: "directory",
      },
    ],
    truncated: false,
  });
  assert.deepEqual(
    calls.map(([, endpoint]) => endpoint),
    ["capabilities", "files.list"],
  );

  await files.writeViewState({
    placement: "right",
    viewMode: "tree",
  });
  assert.deepEqual(await files.readViewState(), {
    right: { viewMode: "tree" },
  });

  const firstTabs = browserTabsPort(storage);
  assert.equal(firstTabs.available, true);
  assert.equal(firstTabs.embeddedWebAvailable, false);
  await firstTabs.writeLayoutState({
    placement: "right",
    size: 420,
  });
  await firstTabs.writeLayoutState({
    placement: "bottom",
    size: 260,
  });
  const restoredTabs = browserTabsPort(storage);
  assert.deepEqual(await restoredTabs.readLayoutState(), {
    rightWidth: 420,
    bottomHeight: 260,
  });
});

test("browser Terminal port long-polls Host output and closes settled sessions", async () => {
  const calls = [];
  const closed = Promise.withResolvers();
  const connection = {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push([channel, endpoint, payload]);
        if (endpoint === "capabilities") {
          return { ok: true, value: hostCapabilities() };
        }
        if (endpoint === "terminal.create") {
          return {
            ok: true,
            value: { sessionId: "host-terminal-1" },
          };
        }
        if (endpoint === "terminal.read") {
          return {
            ok: true,
            value: {
              cursor: 2,
              done: true,
              truncated: false,
              events: [
                {
                  type: "data",
                  sessionId: "host-terminal-1",
                  data: "$ ",
                },
                {
                  type: "exit",
                  sessionId: "host-terminal-1",
                  exitCode: 0,
                },
              ],
            },
          };
        }
        if (
          endpoint === "terminal.close" ||
          endpoint === "terminal.resize" ||
          endpoint === "terminal.write"
        ) {
          if (endpoint === "terminal.close") closed.resolve();
          return { ok: true, value: null };
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      },
    },
  };
  const terminal = browserTerminalPort(connection);
  const events = [];
  const settled = Promise.withResolvers();
  const unsubscribe = terminal.subscribe((event) => {
    events.push(event);
    if (event.type === "exit") settled.resolve();
  });

  assert.deepEqual(
    await terminal.create({ cols: 80, rows: 24 }),
    { sessionId: "host-terminal-1" },
  );
  await settled.promise;
  await closed.promise;
  assert.deepEqual(events, [
    {
      type: "data",
      sessionId: "host-terminal-1",
      data: "$ ",
    },
    {
      type: "exit",
      sessionId: "host-terminal-1",
      exitCode: 0,
    },
  ]);
  assert.deepEqual(
    calls.map(([, endpoint]) => endpoint),
    [
      "capabilities",
      "terminal.create",
      "terminal.read",
      "terminal.close",
    ],
  );
  unsubscribe();
});
