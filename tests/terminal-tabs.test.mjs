import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TerminalSessionRuntime,
} from "@minke/desktop/main/tabs/terminal.ts";
import {
  TerminalTabsController,
} from "@minke/harness-overlay/client/tabs/terminal/controller.ts";
import {
  TabRendererRegistry,
} from "@minke/harness-overlay/client/tabs/registry.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  parseTerminalCreateRequest,
  parseTerminalResizeRequest,
  parseTerminalWriteRequest,
} from "@minke/harness-overlay/tabs/terminal-contract.ts";

test("terminal IPC requests keep dimensions and input bounded", () => {
  assert.deepEqual(
    parseTerminalCreateRequest({
      cwd: "/workspace",
      cols: 120,
      rows: 36,
    }),
    {
      cwd: "/workspace",
      cols: 120,
      rows: 36,
    },
  );
  assert.deepEqual(
    parseTerminalResizeRequest({
      sessionId: "terminal-1",
      cols: 90,
      rows: 28,
    }),
    {
      sessionId: "terminal-1",
      cols: 90,
      rows: 28,
    },
  );
  assert.deepEqual(
    parseTerminalWriteRequest({
      sessionId: "terminal-1",
      data: "pwd\r",
    }),
    {
      sessionId: "terminal-1",
      data: "pwd\r",
    },
  );
  assert.throws(
    () => parseTerminalCreateRequest({
      cwd: "/workspace",
      cols: 1,
      rows: 24,
    }),
    /terminal dimensions/u,
  );
  assert.throws(
    () => parseTerminalWriteRequest({
      sessionId: "terminal-1",
      data: "x".repeat(65_537),
    }),
    /terminal input/u,
  );
});

test("desktop terminal runtime owns PTY data, resize, and teardown", async () => {
  const writes = [];
  const resizes = [];
  const events = [];
  let dataListener;
  let exitListener;
  let killed = false;
  let spawn;
  const pty = {
    pid: 42,
    write(data) {
      writes.push(data);
    },
    resize(cols, rows) {
      resizes.push([cols, rows]);
    },
    kill() {
      killed = true;
    },
    onData(listener) {
      dataListener = listener;
      return { dispose() {} };
    },
    onExit(listener) {
      exitListener = listener;
      return { dispose() {} };
    },
  };
  const runtime = new TerminalSessionRuntime({
    pty: {
      spawn(file, args, options) {
        spawn = { file, args, options };
        return pty;
      },
    },
    shell: "/bin/zsh",
    defaultCwd: "/Users/test",
    environment: {
      DSH_HOME: "/data/harness",
      TERM_PROGRAM: "Minke",
    },
    resolveCwd: async (candidate) => candidate,
    createId: () => "terminal-1",
    send: (event) => events.push(event),
  });

  assert.deepEqual(
    await runtime.create({
      cwd: "/workspace",
      cols: 120,
      rows: 36,
    }),
    { sessionId: "terminal-1" },
  );
  assert.equal(spawn.file, "/bin/zsh");
  assert.deepEqual(spawn.args, ["-l"]);
  assert.equal(spawn.options.cwd, "/workspace");
  assert.equal(spawn.options.name, "xterm-256color");
  assert.equal(spawn.options.env.DSH_HOME, "/data/harness");

  runtime.write({
    sessionId: "terminal-1",
    data: "pwd\r",
  });
  runtime.resize({
    sessionId: "terminal-1",
    cols: 90,
    rows: 28,
  });
  dataListener("prompt");
  assert.deepEqual(writes, ["pwd\r"]);
  assert.deepEqual(resizes, [[90, 28]]);
  assert.deepEqual(events, [
    {
      type: "data",
      sessionId: "terminal-1",
      data: "prompt",
    },
  ]);

  exitListener({ exitCode: 0, signal: 0 });
  assert.deepEqual(events.at(-1), {
    type: "exit",
    sessionId: "terminal-1",
    exitCode: 0,
  });
  await runtime.dispose();
  assert.equal(killed, false);
});

test("Terminal controller preserves early output and closes removed tabs", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const calls = [];
  let terminalListener = () => {};
  let resolveCreate;
  const created = new Promise((resolve) => {
    resolveCreate = resolve;
  });
  const terminal = new TerminalTabsController(tabs, {
    available: true,
    create(request) {
      calls.push(["create", request]);
      return created;
    },
    write(request) {
      calls.push(["write", request]);
    },
    resize(request) {
      calls.push(["resize", request]);
    },
    close(sessionId) {
      calls.push(["close", sessionId]);
    },
    subscribe(listener) {
      terminalListener = listener;
      return () => {};
    },
  });

  const tabId = terminal.create("/workspace", "Terminal");
  assert.ok(tabId);
  terminalListener({
    type: "data",
    sessionId: "terminal-1",
    data: "$ ",
  });
  resolveCreate({ sessionId: "terminal-1" });
  await created;
  await Promise.resolve();

  const output = [];
  const unsubscribe = terminal.subscribe(tabId, {
    data: (value) => output.push(value),
  });
  assert.deepEqual(output, ["$ "]);
  terminal.write(tabId, "pwd\r");
  terminal.resize(tabId, 100, 30);
  assert.deepEqual(calls.slice(-2), [
    [
      "write",
      { sessionId: "terminal-1", data: "pwd\r" },
    ],
    [
      "resize",
      {
        sessionId: "terminal-1",
        cols: 100,
        rows: 30,
      },
    ],
  ]);

  tabs.close(tabId);
  assert.deepEqual(calls.at(-1), ["close", "terminal-1"]);
  unsubscribe();
  terminal.dispose();
  tabs.dispose();
});

test("Terminal controller closes a PTY created after its tab was removed", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const closed = [];
  let resolveCreate;
  const created = new Promise((resolve) => {
    resolveCreate = resolve;
  });
  const terminal = new TerminalTabsController(tabs, {
    available: true,
    create() {
      return created;
    },
    write() {},
    resize() {},
    close(sessionId) {
      closed.push(sessionId);
    },
    subscribe() {
      return () => {};
    },
  });

  const tabId = terminal.create("/workspace", "Terminal");
  assert.ok(tabId);
  tabs.close(tabId);
  resolveCreate({ sessionId: "terminal-late" });
  await created;
  await Promise.resolve();

  assert.deepEqual(closed, ["terminal-late"]);
  terminal.dispose();
  tabs.dispose();
});

test("empty Tabs offers Files, Terminal, Browser, and Plugins without chrome", () => {
  const registry = new TabRendererRegistry();
  const created = [];
  registry.register({
    kind: "files",
    createOptions: () => [
      {
        id: "files",
        label: "File manager",
        order: 0,
        icon: null,
        create: () => created.push("files"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  registry.register({
    kind: "web",
    createOptions: () => [
      {
        id: "browser",
        label: "Browser",
        order: 20,
        icon: null,
        create: () => created.push("browser"),
      },
      {
        id: "plugins",
        label: "Plugins",
        order: 30,
        icon: null,
        create: () => created.push("plugins"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  registry.register({
    kind: "terminal",
    createOptions: () => [
      {
        id: "terminal",
        label: "Terminal",
        order: 10,
        icon: null,
        create: () => created.push("terminal"),
      },
    ],
    renderIcon: () => null,
    renderView: () => null,
  });
  assert.deepEqual(
    registry.creators().map((option) => option.id),
    ["files", "terminal", "browser", "plugins"],
  );
  registry.creators().at(-1).create({});
  assert.deepEqual(created, ["plugins"]);

  const panelSource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const emptySource = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/TabsEmptyState.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const stylesCss = readFileSync(
    new URL(
      "../packages/harness-overlay/src/client/tabs/styles.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    panelSource,
    /const showCreateChooser = !hasTabs \|\| choosingType;/u,
  );
  assert.match(panelSource, /<TabsEmptyState/u);
  assert.match(panelSource, /hasTabs\s*&&\s*\([\s\S]*minke-tabs-chrome/u);
  assert.match(panelSource, /showCreateChooser\s*&&\s*\(/u);
  assert.match(
    panelSource,
    /active=\{active && !showCreateChooser\}/u,
  );
  assert.match(emptySource, /minke-tabs-empty__option/u);
  assert.match(emptySource, /option\.create\(context\)/u);
  assert.match(emptySource, /onCreated\?\.\(\)/u);
  assert.match(stylesCss, /\.minke-tabs-empty\s*\{/u);
  assert.match(stylesCss, /\.minke-tabs-empty__option\s*\{/u);
  assert.match(
    stylesCss,
    /\.minke-tabs-empty__option\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?background:\s*var\(--dsw-alias-interactive-bg-hover\);/u,
  );
  assert.doesNotMatch(
    stylesCss,
    /\.minke-tabs-empty__option:hover\s*\{[^}]*transform:/u,
  );
});
