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
  isRemoteHostnameLabel,
  isTailscaleIpv4,
  parseCloudflareAccessConfig,
  parseRemoteBootstrapToken,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettingsSnapshot,
  parseTailscaleStatusIpv4,
  RemoteAccessRuntime,
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
  canEnableRemoteSettings,
  cloudflareBaseDomainAdvisory,
  cloudflareHostnameFields,
  cloudflareHostnameLabelAdvisory,
  RemoteSettingsRuntime,
  tailscaleIpAddressAdvisory,
} from "@minke/harness-overlay/client/remote/runtime.ts";
import {
  desktopRemoteSettingsStore,
} from "@minke/harness-overlay/client/desktop/settings.ts";

const roots = [];
const HARNESS_ORIGIN = "http://127.0.0.1:43117";
const HARNESS_LAUNCH_TOKEN = "a".repeat(43);
const REMOTE_ORIGIN =
  "https://minke.example-tailnet.ts.net";
const REMOTE_BOOTSTRAP_URL =
  `${REMOTE_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}`;

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
  tailscaleIps = [
    "100.101.102.103",
    "fd7a:115c:a1e0::1234",
  ],
) {
  return JSON.stringify({
    BackendState: "Running",
    Self: {
      DNSName: dnsName,
      Online: true,
      TailscaleIPs: tailscaleIps,
    },
  });
}

function remoteConfig({
  enabled = false,
  method = "tailscale",
  transport = "serve",
  ipAddress = "",
  cloudflare = {},
} = {}) {
  return {
    enabled,
    method,
    tailscale: { transport, ipAddress },
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
      state: "active",
      url: REMOTE_ORIGIN,
      bootstrapUrl: REMOTE_BOOTSTRAP_URL,
    }),
    {
      method: "tailscale",
      transport: "serve",
      state: "active",
      url: REMOTE_ORIGIN,
      bootstrapUrl: REMOTE_BOOTSTRAP_URL,
    },
  );
  assert.equal(
    parseRemoteBootstrapToken(HARNESS_LAUNCH_TOKEN),
    HARNESS_LAUNCH_TOKEN,
  );
  for (const bootstrapUrl of [
    `${REMOTE_ORIGIN}/?token=short`,
    `${REMOTE_ORIGIN}/path?token=${HARNESS_LAUNCH_TOKEN}`,
    `${REMOTE_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}&debug=1`,
    `${REMOTE_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}#fragment`,
    `https://other.example/?token=${HARNESS_LAUNCH_TOKEN}`,
    `https://user@minke.example-tailnet.ts.net/?token=${HARNESS_LAUNCH_TOKEN}`,
  ]) {
    assert.throws(
      () => parseRemoteRuntimeSnapshot({
        method: "tailscale",
        transport: "serve",
        state: "active",
        url: REMOTE_ORIGIN,
        bootstrapUrl,
      }),
      /remote runtime snapshot/u,
      bootstrapUrl,
    );
  }
  for (const launchToken of [
    "",
    "short",
    `${"a".repeat(42)}+`,
    "a".repeat(44),
  ]) {
    assert.throws(
      () => parseRemoteBootstrapToken(launchToken),
      /remote bootstrap token/u,
      launchToken,
    );
  }
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

test("remote host labels default to 80 random bits and accept manual DNS labels", () => {
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
  assert.equal(isRemoteHostnameLabel(label), true);
  assert.deepEqual(
    cloudflareHostnameFields(
      configuredCloudflare().cloudflare,
    ),
    {
      baseDomain: "example.com",
      label: "m-0123456789abcdef",
    },
  );
  assert.deepEqual(
    cloudflareHostnameFields(
      configuredCloudflare({
        hostnameMode: "custom",
        customHostname: "private.example.com",
      }).cloudflare,
    ),
    {
      baseDomain: "example.com",
      label: "private",
    },
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
  assert.equal(
    parseCloudflareAccessConfig(configuredCloudflare({
      generatedLabel: "private-console",
    })).hostname,
    "private-console.example.com",
  );
  for (const generatedLabel of [
    "private_console",
    "-private",
    "private-",
    "private.console",
  ]) {
    assert.equal(
      isRemoteHostnameLabel(generatedLabel),
      false,
    );
    assert.throws(
      () =>
        parseCloudflareAccessConfig(configuredCloudflare({
          generatedLabel,
        })),
      /Cloudflare hostname label/u,
    );
  }
});

test("Cloudflare base-domain advisories do not gate renderer completeness", () => {
  assert.equal(
    cloudflareBaseDomainAdvisory("example.com"),
    undefined,
  );
  assert.equal(
    cloudflareBaseDomainAdvisory("minke.example.com"),
    "nested",
  );
  for (const value of [
    "invalid_domain.example",
    "https://example.com",
    "example.com.",
    "100.101.102.103",
    "team.cloudflareaccess.com",
  ]) {
    assert.equal(
      cloudflareBaseDomainAdvisory(value),
      "invalid",
    );
  }
  assert.equal(
    canEnableRemoteSettings(
      configuredCloudflare({
        domain: "invalid_domain.example",
      }),
      { tailscale: true, cloudflare: true },
    ),
    true,
  );
  assert.equal(
    cloudflareHostnameLabelAdvisory("private-console"),
    undefined,
  );
  assert.equal(
    cloudflareHostnameLabelAdvisory("private_console"),
    "invalid",
  );
  assert.equal(
    canEnableRemoteSettings(
      configuredCloudflare({
        generatedLabel: "private_console",
      }),
      { tailscale: true, cloudflare: true },
    ),
    true,
  );
  assert.equal(
    canEnableRemoteSettings(
      configuredCloudflare({ domain: "" }),
      { tailscale: true, cloudflare: true },
    ),
    false,
  );
});

test("Tailscale IP advisories preserve manual input without gating enablement", () => {
  assert.equal(tailscaleIpAddressAdvisory(""), undefined);
  assert.equal(
    tailscaleIpAddressAdvisory("100.101.102.103"),
    undefined,
  );
  for (const value of [
    "100.101.102",
    "100.101.102.999",
    "100.063.1.2",
    "192.168.1.2",
  ]) {
    assert.equal(
      tailscaleIpAddressAdvisory(value),
      "invalid",
    );
    assert.equal(
      canEnableRemoteSettings(
        remoteConfig({
          transport: "direct",
          ipAddress: value,
        }),
        { tailscale: true, cloudflare: true },
      ),
      true,
    );
  }
});

test("Tailscale status probes allow slow desktop startup and preserve preference failures", async () => {
  let timeoutMs;
  const service = new RemoteAccessService({
    command: "/usr/local/bin/tailscale",
    settings: remoteConfig({ enabled: true }),
    async execute(_command, _args, options) {
      timeoutMs = options.timeoutMs;
      return {
        stdout:
          "The Tailscale CLI failed to start: " +
          "Failed to load preferences.\n",
        stderr: "",
      };
    },
  });

  await assert.rejects(
    service.prepare(),
    (error) => {
      assert.equal(error?.kind, "status");
      assert.match(
        error?.message,
        /Tailscale CLI failed to load preferences/u,
      );
      assert.ok(error?.cause instanceof TypeError);
      return true;
    },
  );
  assert.equal(timeoutMs, 30_000);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "serve",
    state: "error",
    error: "status",
  });
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
  const selectedIp = "100.111.112.113";
  const status = tailscaleStatus(
    "minke.example-tailnet.ts.net.",
    [
      "100.101.102.103",
      selectedIp,
      "fd7a:115c:a1e0::1234",
    ],
  );
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
      address: selectedIp,
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
      ipAddress: selectedIp,
    }),
    async execute() {
      return { stdout: status, stderr: "" };
    },
    createDirectServer,
  });

  assert.equal(
    parseTailscaleStatusIpv4(tailscaleStatus()),
    "100.101.102.103",
  );
  assert.equal(
    parseTailscaleStatusIpv4(status, selectedIp),
    selectedIp,
  );
  assert.equal(isTailscaleIpv4(selectedIp), true);
  assert.equal(isTailscaleIpv4("192.168.1.2"), false);
  assert.throws(
    () =>
      parseTailscaleStatusIpv4(
        status,
        "100.120.121.122",
      ),
    /not assigned to this device/u,
  );
  assert.throws(
    () => parseTailscaleStatusIpv4(status, "192.168.1.2"),
    /100\.64\.0\.0\/10/u,
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
    trustedHosts: [`${selectedIp}:41877`],
  });
  assert.deepEqual(bindings, [{
    host: selectedIp,
    port: 0,
    exclusive: true,
  }]);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "ready",
    url: `http://${selectedIp}:41877`,
  });

  await service.start("http://127.0.0.1:43117");
  assert.equal(servers.length, 1);
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "active",
    url: `http://${selectedIp}:41877`,
  });
  await service.stop();
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "ready",
    url: `http://${selectedIp}:41877`,
  });
});

test("Tailscale direct rejects a configured IP not assigned to this device", async () => {
  const service = new RemoteAccessService({
    command: "/usr/bin/tailscale",
    settings: remoteConfig({
      enabled: true,
      transport: "direct",
      ipAddress: "100.120.121.122",
    }),
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    createDirectServer() {
      throw new Error("server must not be created");
    },
  });

  await assert.rejects(
    service.prepare(),
    (error) => {
      assert.equal(error?.kind, "direct-ip");
      assert.match(
        error?.message,
        /not assigned to this device/u,
      );
      return true;
    },
  );
  assert.deepEqual(service.read(), {
    method: "tailscale",
    transport: "direct",
    state: "error",
    error: "direct-ip",
  });
});

test("Tailscale remote owns one foreground Serve process", async () => {
  const executions = [];
  const spawns = [];
  const child = foregroundProcess();
  const service = new RemoteAccessService({
    command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    settings: remoteConfig({ enabled: true }),
    environment: {
      PATH: "/usr/bin",
      electron_run_as_node: "1",
      minke_interactive_node_options: "--original",
      MINKE_INTERACTIVE_NODE_PATH: "/original-modules",
      minke_node_bootstrap: "/runtime/bootstrap.cjs",
      Node_Options: "--require /tmp/minke-loader.cjs",
      node_path: "/tmp/minke-node-modules",
    },
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
  assert.equal(
    Object.keys(executions[0].options.env).some(
      (key) => key.toUpperCase() === "ELECTRON_RUN_AS_NODE",
    ),
    false,
  );
  assert.equal(
    Object.keys(executions[0].options.env).some(
      (key) => key.toUpperCase() === "NODE_OPTIONS",
    ),
    false,
  );
  assert.equal(
    Object.keys(executions[0].options.env).some(
      (key) => key.toUpperCase() === "NODE_PATH",
    ),
    false,
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
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "MINKE_INTERACTIVE_NODE_OPTIONS",
    "MINKE_INTERACTIVE_NODE_PATH",
    "MINKE_NODE_BOOTSTRAP",
    "NODE_OPTIONS",
    "NODE_PATH",
  ]) {
    assert.equal(
      Object.keys(spawns[0].options.env).some(
        (key) => key.toUpperCase() === name,
      ),
      false,
    );
  }
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
      electron_run_as_node: "1",
      minke_interactive_node_options: "--original",
      MINKE_INTERACTIVE_NODE_PATH: "/original-modules",
      minke_node_bootstrap: "/runtime/bootstrap.cjs",
      Node_Options: "--require /tmp/minke-loader.cjs",
      node_path: "/tmp/minke-node-modules",
      tunnel_token: "must-not-be-forwarded",
      Tunnel_Cred_File: "/tmp/override.json",
      tunnel_url: "http://127.0.0.1:1",
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
  for (const name of [
    "TUNNEL_TOKEN",
    "TUNNEL_CRED_FILE",
    "TUNNEL_URL",
  ]) {
    assert.equal(
      Object.keys(spawns[0].options.env).some(
        (key) => key.toUpperCase() === name,
      ),
      false,
    );
  }
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "MINKE_INTERACTIVE_NODE_OPTIONS",
    "MINKE_INTERACTIVE_NODE_PATH",
    "MINKE_NODE_BOOTSTRAP",
    "NODE_OPTIONS",
    "NODE_PATH",
  ]) {
    assert.equal(
      Object.keys(spawns[0].options.env).some(
        (key) => key.toUpperCase() === name,
      ),
      false,
    );
  }
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
  const applied = [];
  const published = [];
  let runtimeListener;
  let runtimeSnapshot = {
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  };
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
    {
      async availability() {
        return { tailscale: true, cloudflare: false };
      },
      async apply(settings) {
        applied.push(settings);
      },
      read() {
        return runtimeSnapshot;
      },
      subscribe(listener) {
        runtimeListener = listener;
        return () => {
          runtimeListener = undefined;
        };
      },
    },
    (snapshot) => published.push(snapshot),
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
  assert.deepEqual(applied, [
    remoteConfig({ enabled: true }),
  ]);
  runtimeSnapshot = {
    method: "tailscale",
    transport: "serve",
    state: "starting",
  };
  runtimeListener();
  assert.deepEqual(published, [runtimeSnapshot]);
  await assert.rejects(
    handlers.get(REMOTE_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(runtimeListener, undefined);
  assert.equal(handlers.size, 0);
});

test("remote settings runtime applies saved changes without requiring a restart", async () => {
  const writes = [];
  let publishRuntime;
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
    subscribe(listener) {
      publishRuntime = listener;
      return () => {
        publishRuntime = undefined;
      };
    },
  });

  await runtime.initialize();
  runtime.setTailscaleEnabled(true);
  await runtime.flush();
  assert.deepEqual(writes, [
    remoteConfig({ enabled: true }),
  ]);
  assert.deepEqual(runtime.getSnapshot().operation, {
    kind: "idle",
  });
  publishRuntime({
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  assert.equal(
    runtime.getSnapshot().data.runtime.state,
    "active",
  );
  assert.deepEqual(
    Object.keys(remoteEn).sort(),
    Object.keys(remoteZh).sort(),
  );
  assert.equal(remoteZh.randomLabel, "随机或自定义标签");
  assert.equal(remoteZh.regenerateHostname, "生成随机标签");
  assert.equal(remoteEn.randomLabel, "Random or custom label");
  assert.equal(
    remoteEn.regenerateHostname,
    "Generate random label",
  );
  runtime.dispose();
});

test("remote settings keep a newer pushed runtime over an older read response", async () => {
  let publishRuntime;
  let resolveRead;
  const runtime = new RemoteSettingsRuntime({
    available: true,
    read() {
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    async write() {},
    subscribe(listener) {
      publishRuntime = listener;
      return () => {
        publishRuntime = undefined;
      };
    },
  });

  const initialize = runtime.initialize();
  publishRuntime({
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  resolveRead({
    available: { tailscale: true, cloudflare: false },
    settings: remoteConfig({ enabled: true }),
    runtime: {
      method: "tailscale",
      transport: "serve",
      state: "starting",
    },
  });
  await initialize;

  assert.deepEqual(runtime.getSnapshot().data.runtime, {
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: "https://minke.example-tailnet.ts.net",
  });
  runtime.dispose();
});

test("remote settings show live disable progress instead of a restart prompt", async () => {
  let publishRuntime;
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
    subscribe(listener) {
      publishRuntime = listener;
      return () => {
        publishRuntime = undefined;
      };
    },
  });

  await runtime.initialize();
  runtime.setTailscaleEnabled(false);
  await runtime.flush();

  publishRuntime({
    method: "tailscale",
    transport: "serve",
    state: "stopping",
  });
  assert.deepEqual(
    presentRemoteStatus(runtime.getSnapshot()),
    {
      state: "stopping",
      statusKey: "statusStopping",
      helpKey: undefined,
      canRefresh: true,
      showAddress: false,
    },
  );
  publishRuntime({
    method: "tailscale",
    transport: "serve",
    state: "disabled",
  });
  assert.deepEqual(
    presentRemoteStatus(runtime.getSnapshot()),
    {
      state: "disabled",
      statusKey: "statusDisabled",
      helpKey: undefined,
      canRefresh: true,
      showAddress: false,
    },
  );
  runtime.dispose();
});

test("remote runtime retries Tailscale in the background before exposing Harness", async () => {
  const child = foregroundProcess();
  const events = [];
  let attempts = 0;
  const runtime = new RemoteAccessRuntime({
    settings: remoteConfig({ enabled: true }),
    async discoverCommands() {
      events.push("discover");
      return { tailscale: "/usr/bin/tailscale" };
    },
    async replaceTrustedHosts(trustedHosts) {
      events.push(["trust", trustedHosts]);
    },
    async execute(_command, _args, options) {
      attempts += 1;
      events.push(["status", options.timeoutMs]);
      if (attempts === 1) {
        throw Object.assign(new Error("timed out"), {
          code: "ETIMEDOUT",
        });
      }
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn(_command, args) {
      events.push(["serve", args]);
      setImmediate(() => {
        child.stdout.write(
          "Serve configured.\nPress Ctrl+C to exit.\n",
        );
      });
      return child;
    },
    retryDelaysMs: [0],
    startupTimeoutMs: 250,
    shutdownTimeoutMs: 250,
  });

  await runtime.start(HARNESS_ORIGIN, HARNESS_LAUNCH_TOKEN);

  assert.equal(attempts, 2);
  assert.deepEqual(events, [
    "discover",
    ["status", 30_000],
    "discover",
    ["status", 30_000],
    ["trust", ["minke.example-tailnet.ts.net"]],
    [
      "serve",
      ["serve", "--yes", "--bg=false", HARNESS_ORIGIN],
    ],
  ]);
  assert.deepEqual(runtime.read(), {
    method: "tailscale",
    transport: "serve",
    state: "active",
    url: REMOTE_ORIGIN,
    bootstrapUrl: REMOTE_BOOTSTRAP_URL,
  });

  const disabling = runtime.apply(
    remoteConfig({ enabled: false }),
  );
  assert.equal(runtime.read().state, "stopping");
  assert.equal(
    Object.hasOwn(runtime.read(), "bootstrapUrl"),
    false,
  );
  await disabling;
  assert.deepEqual(events.at(-1), ["trust", []]);
  assert.deepEqual(runtime.read(), {
    method: "tailscale",
    transport: "serve",
    state: "disabled",
  });
  await runtime.stop();
});

test("remote runtime keeps provider targets clean and drops detached bootstrap capabilities", async () => {
  let providerTarget;
  let providerStops = 0;
  let providerSnapshot = {
    method: "tailscale",
    transport: "serve",
    state: "starting",
  };
  const runtime = new RemoteAccessRuntime({
    settings: remoteConfig({ enabled: true }),
    async discoverCommands() {
      return { tailscale: "/usr/bin/tailscale" };
    },
    async replaceTrustedHosts() {},
    createService() {
      return {
        async prepare() {
          return { trustedHosts: [] };
        },
        async start(target) {
          providerTarget = target;
          providerSnapshot = {
            method: "tailscale",
            transport: "serve",
            state: "active",
            url: REMOTE_ORIGIN,
          };
        },
        read() {
          return providerSnapshot;
        },
        async stop() {
          providerStops += 1;
        },
      };
    },
  });

  await runtime.start(HARNESS_ORIGIN, HARNESS_LAUNCH_TOKEN);
  assert.equal(providerTarget, HARNESS_ORIGIN);
  assert.equal(
    String(providerTarget).includes(HARNESS_LAUNCH_TOKEN),
    false,
  );
  assert.equal(
    runtime.read().bootstrapUrl,
    REMOTE_BOOTSTRAP_URL,
  );

  const detaching = runtime.detach();
  assert.equal(
    Object.hasOwn(runtime.read(), "bootstrapUrl"),
    false,
    "detaching must revoke the renderer capability synchronously",
  );
  await detaching;
  assert.equal(runtime.read().state, "starting");
  assert.equal(providerStops, 1);
  await runtime.stop();
});

test("remote runtime validates both startup inputs before attaching either", async () => {
  let discoveries = 0;
  const runtime = new RemoteAccessRuntime({
    settings: {
      ...configuredCloudflare(),
      enabled: true,
    },
    async discoverCommands() {
      discoveries += 1;
      return {};
    },
    async replaceTrustedHosts() {},
  });

  assert.throws(
    () => runtime.start(HARNESS_ORIGIN, "invalid"),
    /remote bootstrap token/u,
  );
  await runtime.apply({
    ...configuredCloudflare(),
    enabled: true,
  });
  assert.equal(
    discoveries,
    0,
    "a rejected token must not leave a live Harness target behind",
  );
  assert.equal(runtime.read().state, "starting");
  await runtime.stop();
});

test("remote runtime does not retry a rejected Tailscale IP override", async () => {
  let attempts = 0;
  let retryWaits = 0;
  const runtime = new RemoteAccessRuntime({
    settings: remoteConfig({
      enabled: true,
      transport: "direct",
      ipAddress: "100.120.121.122",
    }),
    async discoverCommands() {
      return { tailscale: "/usr/bin/tailscale" };
    },
    async replaceTrustedHosts() {},
    async execute() {
      attempts += 1;
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    createDirectServer() {
      throw new Error("server must not be created");
    },
    retryDelaysMs: [0],
    async waitForRetry() {
      retryWaits += 1;
    },
  });

  await runtime.start(HARNESS_ORIGIN, HARNESS_LAUNCH_TOKEN);

  assert.equal(attempts, 1);
  assert.equal(retryWaits, 0);
  assert.deepEqual(runtime.read(), {
    method: "tailscale",
    transport: "direct",
    state: "error",
    error: "direct-ip",
  });
  await runtime.stop();
});

test("remote runtime retries a failed trusted-host revocation", async () => {
  const child = foregroundProcess();
  const replacements = [];
  let revokeAttempts = 0;
  const runtime = new RemoteAccessRuntime({
    settings: remoteConfig({ enabled: true }),
    async discoverCommands() {
      return { tailscale: "/usr/bin/tailscale" };
    },
    async replaceTrustedHosts(trustedHosts) {
      replacements.push([...trustedHosts]);
      if (trustedHosts.length === 0 && revokeAttempts++ === 0) {
        throw new Error("control channel unavailable");
      }
    },
    async execute() {
      return { stdout: tailscaleStatus(), stderr: "" };
    },
    spawn() {
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

  await runtime.start(HARNESS_ORIGIN, HARNESS_LAUNCH_TOKEN);
  await assert.rejects(
    runtime.apply(remoteConfig({ enabled: false })),
    /control channel unavailable/u,
  );
  assert.deepEqual(runtime.read(), {
    method: "tailscale",
    transport: "serve",
    state: "error",
    error: "harness-control",
  });

  await runtime.apply(remoteConfig({ enabled: false }));
  assert.deepEqual(replacements, [
    ["minke.example-tailnet.ts.net"],
    [],
    [],
  ]);
  assert.deepEqual(runtime.read(), {
    method: "tailscale",
    transport: "serve",
    state: "disabled",
  });
  await runtime.stop();
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
  let publishRuntime;
  assert.equal(
    desktopRemoteSettingsStore({}).available,
    false,
  );
  const store = desktopRemoteSettingsStore({
    minkeDesktop: {
      remote: {
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
        subscribe(listener) {
          publishRuntime = listener;
          return () => {
            publishRuntime = undefined;
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
  let observed;
  const unsubscribe = store.subscribe((snapshot) => {
    observed = snapshot;
  });
  publishRuntime({
    method: "tailscale",
    transport: "serve",
    state: "starting",
  });
  assert.deepEqual(observed, {
    method: "tailscale",
    transport: "serve",
    state: "starting",
  });
  unsubscribe();
  assert.equal(publishRuntime, undefined);
});
