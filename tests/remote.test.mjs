import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, test } from "node:test";
import {
  DEFAULT_REMOTE_SETTINGS,
  discoverRemoteCommands,
  parseRemoteSettingsSnapshot,
  RemoteAccessService,
  REMOTE_SETTINGS_READ_CHANNEL,
  REMOTE_SETTINGS_WRITE_CHANNEL,
} from "@lencx/minke-remote-access";
import {
  bindRemoteSettingsIpc,
} from "@minke/desktop/main/remote-settings.ts";
import {
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  harnessWebArguments,
} from "@minke/desktop/main/harness-launch.ts";
import {
  remoteEn,
  remoteZh,
} from "@minke/harness-overlay/client/remote/locales.ts";
import {
  RemoteSettingsRuntime,
} from "@minke/harness-overlay/client/remote/runtime.ts";
import {
  desktopRemoteSettingsStore,
} from "@minke/harness-overlay/client/desktop/settings.ts";

const roots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "minke-remote-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

function tailscaleStatus(
  dnsName = "minke.example-tailnet.ts.net.",
) {
  return JSON.stringify({
    BackendState: "Running",
    Self: {
      DNSName: dnsName,
      Online: true,
    },
  });
}

function foregroundProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 41_237;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    child.signalCode = signal;
    queueMicrotask(() => {
      child.emit("exit", 0, signal);
    });
    return true;
  };
  return child;
}

test("remote contracts default closed and reject malformed snapshots", () => {
  assert.deepEqual(DEFAULT_REMOTE_SETTINGS, {
    tailscale: { enabled: false },
  });
  assert.deepEqual(
    parseRemoteSettingsSnapshot({
      available: { tailscale: true },
      settings: { tailscale: { enabled: true } },
      runtime: {
        method: "tailscale",
        state: "active",
        url: "https://minke.example-tailnet.ts.net",
      },
    }),
    {
      available: { tailscale: true },
      settings: { tailscale: { enabled: true } },
      runtime: {
        method: "tailscale",
        state: "active",
        url: "https://minke.example-tailnet.ts.net",
      },
    },
  );
  assert.throws(
    () =>
      parseRemoteSettingsSnapshot({
        available: { tailscale: true },
        settings: { tailscale: { enabled: true } },
        runtime: {
          method: "tailscale",
          state: "active",
          url: "http://minke.example-tailnet.ts.net",
        },
      }),
    /remote runtime snapshot/u,
  );
  assert.throws(
    () =>
      parseRemoteSettingsSnapshot({
        available: { tailscale: true },
        settings: { tailscale: { enabled: false } },
        runtime: {
          method: "tailscale",
          state: "disabled",
        },
        unknown: true,
      }),
    /remote settings snapshot/u,
  );
});

test("remote command discovery checks PATH without executing Tailscale", async () => {
  const root = await temporaryRoot();
  const firstBin = join(root, "first-bin");
  const secondBin = join(root, "second-bin");
  const executable = join(
    secondBin,
    process.platform === "win32" ? "tailscale.exe" : "tailscale",
  );
  await Promise.all([mkdir(firstBin), mkdir(secondBin)]);
  await writeFile(executable, "");
  if (process.platform !== "win32") await chmod(executable, 0o700);

  assert.deepEqual(
    await discoverRemoteCommands({
      homeDirectory: join(root, "home"),
      pathValue: [firstBin, secondBin].join(delimiter),
      platform: process.platform,
      includeSystemLocations: false,
    }),
    { tailscale: executable },
  );
});

test("Tailscale remote owns one foreground Serve process", async () => {
  const executions = [];
  const spawns = [];
  const child = foregroundProcess();
  const service = new RemoteAccessService({
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    settings: { tailscale: { enabled: true } },
    async execute(command, args, options) {
      executions.push({ command, args, options });
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn(command, args, options) {
      spawns.push({ command, args, options });
      setImmediate(() => {
        child.stdout.write(
          "Available within your tailnet:\n" +
            "https://minke.example-tailnet.ts.net\n",
        );
      });
      return child;
    },
    startupTimeoutMs: 250,
    shutdownTimeoutMs: 250,
  });

  assert.deepEqual(await service.prepare(), {
    trustedHosts: ["minke.example-tailnet.ts.net"],
  });
  assert.deepEqual(executions.map(({ command, args }) => ({
    command,
    args,
  })), [{
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    args: ["status", "--json"],
  }]);
  assert.equal(
    executions[0].options.env.TAILSCALE_BE_CLI,
    "1",
  );

  const layout = {
    entryPath: "/runtime/index.mjs",
    productPatch: "/runtime/overlay/cordis.patch.yml",
  };
  assert.deepEqual(
    harnessWebArguments(
      layout,
      (await service.prepare()).trustedHosts,
    ).slice(-2),
    ["--trusted-host", "minke.example-tailnet.ts.net"],
  );

  await service.start("http://127.0.0.1:43117");
  assert.deepEqual(
    spawns.map(({ command, args }) => ({ command, args })),
    [{
      command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      args: [
        "serve",
        "--yes",
        "http://127.0.0.1:43117",
      ],
    }],
  );
  assert.equal(spawns[0].options.detached, false);
  assert.equal(spawns[0].options.env.TAILSCALE_BE_CLI, "1");
  assert.deepEqual(service.read(), {
    method: "tailscale",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });

  await service.stop();
  assert.deepEqual(child.signals, [
    process.platform === "win32" ? "SIGTERM" : "SIGINT",
  ]);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    state: "ready",
    url: "https://minke.example-tailnet.ts.net",
  });
});

test("Tailscale remote rejects untrusted names and non-loopback targets", async () => {
  let spawnCount = 0;
  const unsafeStatus = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: { tailscale: { enabled: true } },
    async execute() {
      return {
        stdout: tailscaleStatus("attacker.example."),
        stderr: "",
      };
    },
    spawn() {
      spawnCount += 1;
      return foregroundProcess();
    },
  });
  await assert.rejects(
    unsafeStatus.prepare(),
    /Tailscale status/u,
  );
  assert.deepEqual(unsafeStatus.read(), {
    method: "tailscale",
    state: "error",
    error: "status",
  });

  const service = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: { tailscale: { enabled: true } },
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      spawnCount += 1;
      return foregroundProcess();
    },
  });
  await service.prepare();
  for (const target of [
    "http://192.168.1.4:43117",
    "http://localhost:43117",
    "http://127.0.0.1:43117/path",
    "http://user@127.0.0.1:43117",
    "http://127.0.0.1:43117?debug=1",
  ]) {
    await assert.rejects(
      service.start(target),
      /loopback Harness URL/u,
    );
  }
  assert.equal(spawnCount, 0);
});

test("disabled remote access executes no command and reports foreground exits", async () => {
  let commandCount = 0;
  const disabled = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: DEFAULT_REMOTE_SETTINGS,
    async execute() {
      commandCount += 1;
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      commandCount += 1;
      return foregroundProcess();
    },
  });
  assert.deepEqual(await disabled.prepare(), {
    trustedHosts: [],
  });
  await disabled.start("http://127.0.0.1:43117");
  assert.equal(commandCount, 0);
  assert.deepEqual(disabled.read(), {
    method: "tailscale",
    state: "disabled",
  });

  const child = foregroundProcess();
  const active = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: { tailscale: { enabled: true } },
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      setImmediate(() => {
        child.stderr.write(
          "https://minke.example-tailnet.ts.net\n",
        );
      });
      return child;
    },
    startupTimeoutMs: 250,
  });
  await active.prepare();
  await active.start("http://127.0.0.1:43117");
  child.emit("error", new Error("late process error"));
  assert.deepEqual(active.read(), {
    method: "tailscale",
    state: "error",
    error: "serve",
  });
  await active.stop();

  const exitedChild = foregroundProcess();
  const exited = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: { tailscale: { enabled: true } },
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      setImmediate(() => {
        exitedChild.stderr.write(
          "https://minke.example-tailnet.ts.net\n",
        );
      });
      return exitedChild;
    },
    startupTimeoutMs: 250,
  });
  await exited.prepare();
  await exited.start("http://127.0.0.1:43117");
  exitedChild.exitCode = 1;
  exitedChild.emit("exit", 1, null);
  assert.deepEqual(exited.read(), {
    method: "tailscale",
    state: "error",
    error: "serve",
  });
});

test("remote settings IPC persists opt-in and reports live status", async () => {
  const root = await temporaryRoot();
  const config = new MinkeConfigStore(root);
  const handlers = new Map();
  const binding = bindRemoteSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    config.remote,
    { tailscale: true },
    () => ({
      method: "tailscale",
      state: "active",
      url: "https://minke.example-tailnet.ts.net",
    }),
    (event) => event === "allowed",
  );

  assert.deepEqual(
    await handlers.get(REMOTE_SETTINGS_READ_CHANNEL)("allowed"),
    {
      available: { tailscale: true },
      settings: DEFAULT_REMOTE_SETTINGS,
      runtime: {
        method: "tailscale",
        state: "active",
        url: "https://minke.example-tailnet.ts.net",
      },
    },
  );
  await handlers.get(REMOTE_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    { tailscale: { enabled: true } },
  );
  assert.deepEqual(await config.remote.read(), {
    tailscale: { enabled: true },
  });
  assert.deepEqual(
    JSON.parse(await readFile(config.path, "utf8")).remote,
    { tailscale: { enabled: true } },
  );
  await assert.rejects(
    handlers.get(REMOTE_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("remote settings runtime serializes changes and keeps locales aligned", async () => {
  const writes = [];
  const runtime = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true },
        settings: DEFAULT_REMOTE_SETTINGS,
        runtime: {
          method: "tailscale",
          state: "disabled",
        },
      };
    },
    async write(settings) {
      writes.push(settings);
    },
  });

  await runtime.initialize();
  runtime.setTailscaleEnabled(true);
  await runtime.flush();
  assert.deepEqual(writes, [{
    tailscale: { enabled: true },
  }]);
  assert.equal(runtime.getSnapshot().restartRequired, true);
  assert.deepEqual(
    Object.keys(remoteEn).sort(),
    Object.keys(remoteZh).sort(),
  );
  assert.equal(remoteZh.nav, "远程访问");
  assert.equal(remoteEn.nav, "Remote access");
  runtime.dispose();
});

test("remote settings runtime refreshes the live status on demand", async () => {
  let reads = 0;
  const runtime = new RemoteSettingsRuntime({
    available: true,
    async read() {
      reads += 1;
      return {
        available: { tailscale: true },
        settings: DEFAULT_REMOTE_SETTINGS,
        runtime: reads === 1
          ? {
              method: "tailscale",
              state: "disabled",
            }
          : {
              method: "tailscale",
              state: "active",
              url: "https://minke.example-tailnet.ts.net",
            },
      };
    },
    async write() {},
  });

  await runtime.initialize();
  assert.equal(runtime.getSnapshot().data.runtime.state, "disabled");
  await runtime.refresh();
  assert.equal(reads, 2);
  assert.deepEqual(runtime.getSnapshot().data.runtime, {
    method: "tailscale",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  runtime.dispose();
});

test("remote settings stay desktop-capability gated", async () => {
  assert.equal(
    desktopRemoteSettingsStore({}).available,
    false,
  );
  const store = desktopRemoteSettingsStore({
    minkeDesktop: {
      remote: {
        async read() {
          return {
            available: { tailscale: true },
            settings: {
              tailscale: { enabled: true },
            },
            runtime: {
              method: "tailscale",
              state: "active",
              url: "https://minke.example-tailnet.ts.net",
            },
          };
        },
        async write() {},
      },
    },
  });
  assert.equal(store.available, true);
  assert.equal(
    (await store.read()).runtime.url,
    "https://minke.example-tailnet.ts.net",
  );
});
