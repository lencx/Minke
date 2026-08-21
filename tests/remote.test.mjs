import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createServer as createHttpServer,
  request as requestHttp,
} from "node:http";
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
  CloudflareAccessGateway,
  CloudflareAccessService,
  createRemoteHostnameLabel,
  createDefaultRemoteSettings,
  DEFAULT_REMOTE_SETTINGS,
  discoverRemoteCommands,
  parseCloudflareAccessConfig,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettingsSnapshot,
  parseTailscaleStatusIpv4,
  RemoteAccessService,
  REMOTE_RESTART_CHANNEL,
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
  copyRemoteAddress,
} from "@minke/harness-overlay/client/remote/clipboard.ts";
import {
  maskRemoteAddress,
  presentRemoteStatus,
} from "@minke/harness-overlay/client/remote/presentation.ts";
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
      TailscaleIPs: [
        "100.101.102.103",
        "fd7a:115c:a1e0::1234",
      ],
    },
  });
}

function remoteConfig({
  enabled = false,
  method = "tailscale",
  transport = "serve",
  cloudflare = {},
} = {}) {
  return {
    enabled,
    method,
    tailscale: { transport },
    cloudflare: {
      hostnameMode: "generated",
      domain: "",
      generatedLabel: "",
      customHostname: "",
      teamName: "",
      audience: "",
      tunnel: "",
      configPath: "",
      originPort: 49_321,
      ...cloudflare,
    },
  };
}

function configuredCloudflare(overrides = {}) {
  return remoteConfig({
    method: "cloudflare",
    cloudflare: {
      domain: "example.com",
      generatedLabel: "m-0123456789abcdef",
      teamName: "minke-team",
      audience:
        "0123456789abcdef0123456789abcdef",
      tunnel: "minke",
      configPath: "/tmp/cloudflared.yml",
      originPort: 49_321,
      ...overrides,
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

function serverAddress(server) {
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return address;
}

async function listenLoopback(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return serverAddress(server).port;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function availableLoopbackPort() {
  const server = createHttpServer();
  const port = await listenLoopback(server);
  await closeServer(server);
  return port;
}

async function httpResponse({
  port,
  host,
  token,
  cookie,
  path = "/",
}) {
  return await new Promise((resolve, reject) => {
    const request = requestHttp({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        host,
        ...(token === undefined
          ? {}
          : { "cf-access-jwt-assertion": token }),
        ...(cookie === undefined ? {} : { cookie }),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("error", reject);
    request.end();
  });
}

test("remote contracts default closed and reject malformed snapshots", () => {
  assert.deepEqual(DEFAULT_REMOTE_SETTINGS, remoteConfig());
  const enabled = remoteConfig({ enabled: true });
  assert.deepEqual(
    parseRemoteSettingsSnapshot({
      available: { tailscale: true, cloudflare: false },
      settings: enabled,
      runtime: {
        method: "tailscale",
        transport: "serve",
        state: "active",
        url: "https://minke.example-tailnet.ts.net",
      },
    }),
    {
      available: { tailscale: true, cloudflare: false },
      settings: enabled,
      runtime: {
        method: "tailscale",
        transport: "serve",
        state: "active",
        url: "https://minke.example-tailnet.ts.net",
      },
    },
  );
  assert.throws(
    () =>
      parseRemoteSettingsSnapshot({
        available: { tailscale: true, cloudflare: false },
        settings: enabled,
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "active",
          url: "http://minke.example-tailnet.ts.net",
        },
      }),
    /remote runtime snapshot/u,
  );
  assert.throws(
    () =>
      parseRemoteSettingsSnapshot({
        available: { tailscale: true, cloudflare: false },
        settings: remoteConfig(),
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "disabled",
        },
        unknown: true,
      }),
    /remote settings snapshot/u,
  );
  assert.deepEqual(
    parseRemoteRuntimeSnapshot({
      method: "tailscale",
      transport: "serve",
      state: "error",
      error: "serve-permission",
    }),
    {
      method: "tailscale",
      transport: "serve",
      state: "error",
      error: "serve-permission",
    },
  );
});

test("remote host labels compactly encode 80 bits and custom names require explicit selection", () => {
  const entropy = Uint8Array.from(
    { length: 10 },
    (_, index) => index,
  );
  const label = "m-000g40r40m30e209";

  assert.equal(createRemoteHostnameLabel(entropy), label);
  assert.equal(
    createDefaultRemoteSettings(entropy)
      .cloudflare.generatedLabel,
    label,
  );
  assert.match(
    createRemoteHostnameLabel(),
    /^m-[0123456789abcdefghjkmnpqrstvwxyz]{16}$/u,
  );
  assert.deepEqual(
    parseCloudflareAccessConfig(configuredCloudflare()),
    {
      hostname:
        "m-0123456789abcdef.example.com",
      teamDomain:
        "https://minke-team.cloudflareaccess.com",
      audience:
        "0123456789abcdef0123456789abcdef",
      tunnel: "minke",
      configPath: "/tmp/cloudflared.yml",
      originPort: 49_321,
    },
  );
  assert.equal(
    parseCloudflareAccessConfig(configuredCloudflare({
      hostnameMode: "custom",
      customHostname: "private.example.com",
    })).hostname,
    "private.example.com",
  );
  assert.throws(
    () =>
      parseCloudflareAccessConfig(configuredCloudflare({
        generatedLabel: "lencx-macbook-pro",
      })),
    /generated Cloudflare hostname/u,
  );
});

test("optional remote access stays outside the local startup path", async () => {
  const source = await readFile(
    new URL("../desktop/main/main.ts", import.meta.url),
    "utf8",
  );
  const startHarnessSource = source.slice(
    source.indexOf("async function startHarness"),
    source.indexOf("async function handleUnexpectedExit"),
  );
  const bootstrapSource = source.slice(
    source.indexOf("async function bootstrap"),
    source.indexOf('app.on("before-quit"'),
  );

  assert.ok(
    bootstrapSource.indexOf("await createWindow()") <
      bootstrapSource.indexOf("await remoteAccess.prepare()"),
    "the local bootstrap window must appear before Tailscale preparation",
  );
  assert.match(
    startHarnessSource,
    /harnessLifecycle\?\.start\(mainWindow\)/u,
    "Harness startup must delegate window-independent lifecycle ordering",
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

test("Tailscale direct binds only the node CGNAT address", async () => {
  const bindings = [];
  const servers = [];
  const createDirectServer = () => {
    const server = new EventEmitter();
    server.listening = false;
    server.listen = (options) => {
      bindings.push(options);
      server.listening = true;
      queueMicrotask(() => server.emit("listening"));
    };
    server.address = () => ({
      address: "100.101.102.103",
      family: "IPv4",
      port: 41_877,
    });
    server.close = (callback) => {
      server.listening = false;
      queueMicrotask(() => {
        server.emit("close");
        callback?.();
      });
    };
    servers.push(server);
    return server;
  };
  const service = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({
      enabled: true,
      transport: "direct",
    }),
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    createDirectServer,
  });

  assert.equal(
    parseTailscaleStatusIpv4(tailscaleStatus()),
    "100.101.102.103",
  );
  assert.throws(
    () =>
      parseTailscaleStatusIpv4(JSON.stringify({
        BackendState: "Running",
        Self: { TailscaleIPs: ["192.168.1.2"] },
      })),
    /valid IPv4/u,
  );
  assert.deepEqual(await service.prepare(), {
    trustedHosts: ["100.101.102.103:41877"],
  });
  assert.deepEqual(bindings, [{
    host: "100.101.102.103",
    port: 0,
    exclusive: true,
  }]);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "ready",
    url: "http://100.101.102.103:41877",
  });

  await service.start("http://127.0.0.1:43117");
  assert.equal(servers.length, 1);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "active",
    url: "http://100.101.102.103:41877",
  });
  await service.stop();
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "ready",
    url: "http://100.101.102.103:41877",
  });
});

test("Tailscale remote owns one foreground Serve process", async () => {
  const executions = [];
  const spawns = [];
  const child = foregroundProcess();
  const service = new RemoteAccessService({
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    settings: remoteConfig({ enabled: true }),
    async execute(command, args, options) {
      executions.push({ command, args, options });
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn(command, args, options) {
      spawns.push({ command, args, options });
      setImmediate(() => {
        child.stdout.write(
          "Serve configured.\nPress Ctrl+C to exit.\n",
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
        "--bg=false",
        "http://127.0.0.1:43117",
      ],
    }],
  );
  assert.equal(spawns[0].options.detached, false);
  assert.equal(spawns[0].options.env.TAILSCALE_BE_CLI, "1");
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });

  await service.stop();
  assert.deepEqual(child.signals, [
    process.platform === "win32" ? "SIGTERM" : "SIGINT",
  ]);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "serve",
    state: "ready",
    url: "https://minke.example-tailnet.ts.net",
  });
});

test("Tailscale remote identifies macOS Keychain persistence failures", async () => {
  const child = foregroundProcess();
  const service = new RemoteAccessService({
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    settings: remoteConfig({ enabled: true }),
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      setImmediate(() => {
        child.stderr.write(
          "prefs_save failed add tailscale-serve/test to keychain: " +
            "UNIX[Operation not permitted]\n",
        );
        child.exitCode = 1;
        child.emit("exit", 1, null);
      });
      return child;
    },
    startupTimeoutMs: 250,
  });

  await service.prepare();
  await assert.rejects(
    service.start("http://127.0.0.1:43117"),
    (error) => error?.kind === "serve-permission",
  );
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "serve",
    state: "error",
    error: "serve-permission",
  });
});

test("Tailscale remote rejects untrusted names and non-loopback targets", async () => {
  let spawnCount = 0;
  const unsafeStatus = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({ enabled: true }),
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
    transport: "serve",
    state: "error",
    error: "status",
  });

  const service = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({ enabled: true }),
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

test("Cloudflare Access gateway fails closed and strips identity credentials", async () => {
  const upstreamRequests = [];
  const upstream = createHttpServer((request, response) => {
    upstreamRequests.push({
      path: request.url,
      host: request.headers.host,
      token: request.headers["cf-access-jwt-assertion"],
      cookie: request.headers.cookie,
    });
    response.writeHead(200, {
      "content-type": "text/plain",
    });
    response.end("upstream");
  });
  const upstreamPort = await listenLoopback(upstream);
  const gatewayPort = await availableLoopbackPort();
  const verifiedTokens = [];
  const config = {
    ...parseCloudflareAccessConfig(configuredCloudflare()),
    originPort: gatewayPort,
  };
  const gateway = new CloudflareAccessGateway({
    config,
    async verifyToken(token) {
      verifiedTokens.push(token);
      if (token !== "valid") {
        throw new Error("invalid Access token");
      }
    },
  });
  gateway.setTarget(`http://127.0.0.1:${String(upstreamPort)}`);

  try {
    await gateway.start();
    assert.deepEqual(
      await httpResponse({
        port: gatewayPort,
        host: config.hostname,
      }),
      { status: 403, body: "forbidden" },
    );
    assert.deepEqual(
      await httpResponse({
        port: gatewayPort,
        host: "attacker.example.com",
        token: "valid",
      }),
      { status: 403, body: "forbidden" },
    );
    assert.deepEqual(
      await httpResponse({
        port: gatewayPort,
        host: config.hostname,
        token: "invalid",
      }),
      { status: 403, body: "forbidden" },
    );
    assert.deepEqual(
      await httpResponse({
        port: gatewayPort,
        host: config.hostname,
        token: "valid",
        cookie: "CF_Authorization=secret; session=kept",
        path: "/health?source=remote",
      }),
      { status: 200, body: "upstream" },
    );
  } finally {
    await gateway.stop();
    await closeServer(upstream);
  }

  assert.deepEqual(verifiedTokens, ["invalid", "valid"]);
  assert.deepEqual(upstreamRequests, [{
    path: "/health?source=remote",
    host: config.hostname,
    token: undefined,
    cookie: "session=kept",
  }]);
});

test("Cloudflare remote owns a foreground named tunnel without environment tokens", async () => {
  const child = foregroundProcess();
  const spawns = [];
  const gatewayCalls = [];
  let gatewayConfig;
  const verifyToken = async () => {};
  const gateway = {
    async start() {
      gatewayCalls.push("start");
    },
    setTarget(target) {
      gatewayCalls.push(["target", target]);
    },
    async stop() {
      gatewayCalls.push("stop");
    },
  };
  const service = new CloudflareAccessService({
    command: "/usr/local/bin/cloudflared",
    settings: {
      ...configuredCloudflare(),
      enabled: true,
    },
    environment: {
      SAFE_ENVIRONMENT_VALUE: "preserved",
      TUNNEL_TOKEN: "must-not-be-forwarded",
      TUNNEL_CRED_FILE: "/tmp/override.json",
      TUNNEL_URL: "http://127.0.0.1:1",
    },
    verifyToken,
    createGateway(options) {
      gatewayConfig = options;
      return gateway;
    },
    spawn(command, args, options) {
      spawns.push({ command, args, options });
      setImmediate(() => {
        child.stderr.write(
          "INF Registered tunnel connection connIndex=0\n",
        );
      });
      return child;
    },
    startupTimeoutMs: 250,
    shutdownTimeoutMs: 250,
  });

  assert.deepEqual(await service.prepare(), {
    trustedHosts: [
      "m-0123456789abcdef.example.com",
    ],
  });
  assert.equal(gatewayConfig.verifyToken, verifyToken);
  assert.deepEqual(gatewayCalls, ["start"]);
  assert.deepEqual(service.read(), {
    method: "cloudflare",
    transport: "access",
    state: "ready",
    url:
      "https://m-0123456789abcdef.example.com",
  });

  await service.start("http://127.0.0.1:43117");
  assert.deepEqual(gatewayCalls, [
    "start",
    "start",
    ["target", "http://127.0.0.1:43117"],
  ]);
  assert.deepEqual(
    spawns.map(({ command, args }) => ({ command, args })),
    [{
      command: "/usr/local/bin/cloudflared",
      args: [
        "tunnel",
        "--no-autoupdate",
        "--config",
        "/tmp/cloudflared.yml",
        "--url",
        "http://127.0.0.1:49321",
        "--loglevel",
        "info",
        "run",
        "minke",
      ],
    }],
  );
  assert.equal(
    spawns[0].options.env.SAFE_ENVIRONMENT_VALUE,
    "preserved",
  );
  assert.equal(spawns[0].options.env.NO_AUTOUPDATE, "true");
  assert.equal(spawns[0].options.env.TUNNEL_TOKEN, undefined);
  assert.equal(spawns[0].options.env.TUNNEL_CRED_FILE, undefined);
  assert.equal(spawns[0].options.env.TUNNEL_URL, undefined);
  assert.deepEqual(service.read(), {
    method: "cloudflare",
    transport: "access",
    state: "active",
    url:
      "https://m-0123456789abcdef.example.com",
  });

  await service.stop();
  assert.equal(gatewayCalls.at(-1), "stop");
  assert.deepEqual(service.read(), {
    method: "cloudflare",
    transport: "access",
    state: "ready",
    url:
      "https://m-0123456789abcdef.example.com",
  });
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
    transport: "serve",
    state: "disabled",
  });

  const child = foregroundProcess();
  const active = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({ enabled: true }),
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      setImmediate(() => {
        child.stderr.write(
          "https://minke.example-tailnet.ts.net\n" +
            "Press Ctrl+C to exit.\n",
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
    transport: "serve",
    state: "error",
    error: "serve",
  });
  await active.stop();

  const exitedChild = foregroundProcess();
  const exited = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({ enabled: true }),
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
      setImmediate(() => {
        exitedChild.stderr.write(
          "https://minke.example-tailnet.ts.net\n" +
            "Press Ctrl+C to exit.\n",
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
    transport: "serve",
    state: "error",
    error: "serve",
  });
});

test("remote settings IPC persists opt-in and reports live status", async () => {
  const root = await temporaryRoot();
  const config = new MinkeConfigStore(root);
  const handlers = new Map();
  let restarts = 0;
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
    { tailscale: true, cloudflare: false },
    () => ({
      method: "tailscale",
      transport: "serve",
      state: "active",
      url: "https://minke.example-tailnet.ts.net",
    }),
    () => {
      restarts += 1;
    },
    (event) => event === "allowed",
  );

  const initial =
    await handlers.get(REMOTE_SETTINGS_READ_CHANNEL)("allowed");
  assert.deepEqual(initial.available, {
    tailscale: true,
    cloudflare: false,
  });
  assert.match(
    initial.settings.cloudflare.generatedLabel,
    /^m-[0123456789abcdefghjkmnpqrstvwxyz]{16}$/u,
  );
  assert.deepEqual(initial.settings, {
    ...remoteConfig(),
    cloudflare: {
      ...remoteConfig().cloudflare,
      generatedLabel:
        initial.settings.cloudflare.generatedLabel,
    },
  });
  assert.deepEqual(initial.runtime, {
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  await handlers.get(REMOTE_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    remoteConfig({ enabled: true }),
  );
  assert.deepEqual(
    await config.remote.read(),
    remoteConfig({ enabled: true }),
  );
  assert.deepEqual(
    JSON.parse(await readFile(config.path, "utf8")).remote,
    remoteConfig({ enabled: true }),
  );
  await handlers.get(REMOTE_RESTART_CHANNEL)("allowed");
  assert.equal(restarts, 1);
  await assert.rejects(
    handlers.get(REMOTE_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  assert.throws(
    () => handlers.get(REMOTE_RESTART_CHANNEL)("denied"),
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
        available: { tailscale: true, cloudflare: false },
        settings: DEFAULT_REMOTE_SETTINGS,
        runtime: {
          method: "tailscale",
          transport: "serve",
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
  assert.deepEqual(writes, [
    remoteConfig({ enabled: true }),
  ]);
  assert.equal(runtime.getSnapshot().restartRequired, true);
  assert.deepEqual(
    Object.keys(remoteEn).sort(),
    Object.keys(remoteZh).sort(),
  );
  assert.equal(remoteZh.nav, "远程访问");
  assert.equal(remoteEn.nav, "Remote access");
  runtime.dispose();
});

test("remote settings distinguish a saved disable from the stale runtime failure", async () => {
  const runtime = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: remoteConfig({ enabled: true }),
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "error",
          error: "serve",
        },
      };
    },
    async write() {},
  });

  await runtime.initialize();
  runtime.setTailscaleEnabled(false);
  await runtime.flush();

  assert.equal(
    runtime.getSnapshot().pendingChange,
    "disable",
  );
  assert.deepEqual(
    presentRemoteStatus(runtime.getSnapshot()),
    {
      state: "pending",
      statusKey: "statusPending",
      helpKey: "pendingDisable",
      canRefresh: false,
      showAddress: false,
    },
  );
  runtime.dispose();
});

test("remote addresses copy through the modern API or selection fallback", async () => {
  const address = "https://minke.example-tailnet.ts.net";
  const writes = [];
  assert.equal(
    await copyRemoteAddress(address, {
      async writeText(value) {
        writes.push(value);
      },
    }),
    true,
  );
  assert.deepEqual(writes, [address]);

  const appended = [];
  const removed = [];
  const commands = [];
  const textarea = {
    style: {},
    value: "",
    focus() {},
    select() {},
    setAttribute() {},
    setSelectionRange() {},
  };
  const documentValue = {
    activeElement: null,
    body: {
      appendChild(value) {
        appended.push(value);
      },
      removeChild(value) {
        removed.push(value);
      },
    },
    createElement() {
      return textarea;
    },
    execCommand(command) {
      commands.push(command);
      return true;
    },
    getSelection() {
      return null;
    },
  };
  assert.equal(
    await copyRemoteAddress(
      address,
      {
        async writeText() {
          throw new Error("clipboard permission denied");
        },
      },
      documentValue,
    ),
    true,
  );
  assert.equal(textarea.value, address);
  assert.deepEqual(appended, [textarea]);
  assert.deepEqual(removed, [textarea]);
  assert.deepEqual(commands, ["copy"]);
});

test("remote addresses mask display text without changing the copy value", () => {
  const address =
    "https://lencx-macbook-pro.tail9example.ts.net";
  const masked = maskRemoteAddress(address);

  assert.equal(
    masked,
    "https://lencx-ma••••e.ts.net",
  );
  assert.equal(masked.includes("macbook-pro"), false);
  assert.equal(masked.includes("tail9example"), false);
  assert.equal(
    maskRemoteAddress("not-a-remote-address"),
    "https://••••",
  );
});

test("remote settings runtime refreshes the live status on demand", async () => {
  let reads = 0;
  const runtime = new RemoteSettingsRuntime({
    available: true,
    async read() {
      reads += 1;
      return {
        available: { tailscale: true, cloudflare: false },
        settings: DEFAULT_REMOTE_SETTINGS,
        runtime: reads === 1
          ? {
              method: "tailscale",
              transport: "serve",
              state: "disabled",
            }
          : {
              method: "tailscale",
              transport: "serve",
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
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  runtime.dispose();
});

test("remote settings stay desktop-capability gated", async () => {
  let restarted = 0;
  assert.equal(
    desktopRemoteSettingsStore({}).available,
    false,
  );
  const store = desktopRemoteSettingsStore({
    minkeDesktop: {
      remote: {
        async restart() {
          restarted += 1;
        },
        async read() {
          return {
            available: {
              tailscale: true,
              cloudflare: false,
            },
            settings: remoteConfig({ enabled: true }),
            runtime: {
              method: "tailscale",
              transport: "serve",
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
  await store.restart();
  assert.equal(restarted, 1);
});
