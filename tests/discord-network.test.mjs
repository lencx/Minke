import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscordNetworkRuntime,
} from "@minke/desktop/main/remote-hub/discord-network.ts";

function socket() {
  return {
    readyState: 0,
    addEventListener() {},
    close() {},
    removeEventListener() {},
    send() {},
  };
}

function fixture({
  fallbackProxyUrl = "",
  resolvedProxy = "DIRECT",
  stored = { httpProxyUrl: "" },
} = {}) {
  const events = [];
  const createdSocket = socket();
  const session = {
    async fetch(input, init) {
      events.push(["fetch", String(input), init?.method]);
      return new Response("discord-network");
    },
    async setProxy(config) {
      events.push(["setProxy", config]);
    },
    async closeAllConnections() {
      events.push(["closeAllConnections"]);
    },
    async resolveProxy(url) {
      events.push(["resolveProxy", url]);
      return typeof resolvedProxy === "function"
        ? resolvedProxy(url)
        : resolvedProxy;
    },
  };
  const store = {
    async read() {
      events.push(["read"]);
      return stored;
    },
    async write(settings) {
      events.push(["write", settings]);
      stored = settings;
    },
  };
  const runtime = new DiscordNetworkRuntime({
    fallbackProxyUrl: () => fallbackProxyUrl,
    session,
    store,
    webSocket: {
      create(url, proxyUrl) {
        events.push(["webSocket", url, proxyUrl]);
        return createdSocket;
      },
    },
  });
  return { createdSocket, events, runtime };
}

test("Discord network uses one detected system HTTP proxy for REST and Gateway", async () => {
  const { createdSocket, events, runtime } = fixture({
    resolvedProxy: "PROXY 127.0.0.1:8888; DIRECT",
  });

  await runtime.initialize();
  const response = await runtime.fetch(
    "https://discord.com/api/v10/gateway",
    { method: "GET" },
  );
  const result = runtime.webSocketFactory(
    "wss://gateway.discord.gg/?v=10&encoding=json",
  );

  assert.equal(await response.text(), "discord-network");
  assert.equal(result, createdSocket);
  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
    proxySource: "system",
  });
  assert.deepEqual(events.at(-2), [
    "fetch",
    "https://discord.com/api/v10/gateway",
    "GET",
  ]);
  assert.deepEqual(events.at(-1), [
    "webSocket",
    "wss://gateway.discord.gg/?v=10&encoding=json",
    "http://127.0.0.1:8888",
  ]);
  assert.equal(
    events.some(
      (event) =>
        event[0] === "setProxy" &&
        event[1]?.proxyRules ===
          "https=http://127.0.0.1:8888",
    ),
    true,
  );
});

test("Discord network reuses the saved Telegram proxy when the system route is direct", async () => {
  const { events, runtime } = fixture({
    fallbackProxyUrl: "http://127.0.0.1:7897",
  });

  await runtime.initialize();
  runtime.webSocketFactory("wss://gateway.discord.gg/");

  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
    proxySource: "telegram",
  });
  assert.deepEqual(events.at(-1), [
    "webSocket",
    "wss://gateway.discord.gg/",
    "http://127.0.0.1:7897",
  ]);
  assert.equal(
    events.some(
      (event) =>
        event[0] === "setProxy" &&
        event[1]?.proxyRules ===
          "https=http://127.0.0.1:7897",
    ),
    true,
  );
});

test("Discord network uses direct system routing when no compatible proxy exists", async () => {
  const { events, runtime } = fixture({
    resolvedProxy: "SOCKS5 127.0.0.1:7898; DIRECT",
  });

  await runtime.initialize();
  runtime.webSocketFactory("wss://gateway.discord.gg/");

  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
    proxySource: "direct",
  });
  assert.deepEqual(events.at(-1), [
    "webSocket",
    "wss://gateway.discord.gg/",
    "",
  ]);
});

test("Discord manual proxy overrides automatic discovery and can be cleared back to auto", async () => {
  const { events, runtime } = fixture({
    fallbackProxyUrl: "http://127.0.0.1:7897",
    stored: {
      httpProxyUrl: "http://localhost:8080",
    },
  });

  await runtime.initialize();
  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "http://localhost:8080",
    proxySource: "manual",
  });
  assert.equal(
    events.some((event) => event[0] === "resolveProxy"),
    false,
  );

  events.length = 0;
  await runtime.configure({ httpProxyUrl: "" });
  runtime.webSocketFactory("wss://gateway.discord.gg/");

  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
    proxySource: "telegram",
  });
  assert.deepEqual(events.at(-1), [
    "webSocket",
    "wss://gateway.discord.gg/",
    "http://127.0.0.1:7897",
  ]);
  assert.deepEqual(
    events.find((event) => event[0] === "write"),
    ["write", { httpProxyUrl: "" }],
  );
});

test("Discord ignores endpoint-specific system proxies so REST and Gateway never diverge", async () => {
  const { runtime } = fixture({
    fallbackProxyUrl: "http://127.0.0.1:7897",
    resolvedProxy(url) {
      return url.startsWith("wss:")
        ? "PROXY 127.0.0.1:8888; DIRECT"
        : "PROXY 127.0.0.1:9999; DIRECT";
    },
  });

  await runtime.initialize();

  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
    proxySource: "telegram",
  });
});
