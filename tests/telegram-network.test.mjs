import assert from "node:assert/strict";
import test from "node:test";
import {
  TelegramNetworkRuntime,
} from "@minke/desktop/main/remote-hub/telegram-network.ts";

function fixture(
  stored = { httpProxyUrl: "" },
  options = {},
) {
  const events = [];
  const session = {
    async fetch(input, init) {
      events.push(["fetch", String(input), init?.method]);
      return new Response("telegram-network");
    },
    async setProxy(config) {
      events.push(["setProxy", config]);
    },
    async closeAllConnections() {
      events.push(["closeAllConnections"]);
    },
  };
  const store = {
    async read() {
      events.push(["read"]);
      return stored;
    },
    async write(settings) {
      events.push(["write", settings]);
      if (options.writeError !== undefined) {
        throw options.writeError;
      }
      stored = settings;
    },
  };
  return {
    events,
    runtime: new TelegramNetworkRuntime({
      session,
      store,
    }),
  };
}

test("Telegram network initialization leaves the default system network untouched", async () => {
  const { events, runtime } = fixture();

  await Promise.all([
    runtime.initialize(),
    runtime.initialize(),
  ]);
  await runtime.initialize();

  assert.deepEqual(events, [["read"]]);
  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
  });
  assert.deepEqual(runtime.settings, {
    httpProxyUrl: "",
  });
});

test("Telegram network initialization applies one stored fixed proxy", async () => {
  const { events, runtime } = fixture({
    httpProxyUrl: "http://127.0.0.1:7890",
  });

  await runtime.initialize();

  assert.deepEqual(events, [
    ["read"],
    [
      "setProxy",
      {
        mode: "fixed_servers",
        proxyRules: "https=http://127.0.0.1:7890",
      },
    ],
    ["closeAllConnections"],
  ]);
  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "http://127.0.0.1:7890",
  });
});

test("Telegram network configuration applies, drains, then persists", async () => {
  const { events, runtime } = fixture();
  await runtime.initialize();
  events.length = 0;

  await runtime.configure({
    httpProxyUrl: "http://localhost:8080",
  });

  assert.deepEqual(events, [
    [
      "setProxy",
      {
        mode: "fixed_servers",
        proxyRules: "https=http://localhost:8080",
      },
    ],
    ["closeAllConnections"],
    [
      "write",
      {
        httpProxyUrl: "http://localhost:8080",
      },
    ],
  ]);
  assert.deepEqual(runtime.settings, {
    httpProxyUrl: "http://localhost:8080",
  });
});

test("Telegram network configuration clears a fixed proxy back to system", async () => {
  const { events, runtime } = fixture({
    httpProxyUrl: "http://127.0.0.1:7890",
  });
  await runtime.initialize();
  events.length = 0;

  await runtime.configure({ httpProxyUrl: "" });

  assert.deepEqual(events, [
    ["setProxy", { mode: "system" }],
    ["closeAllConnections"],
    ["write", { httpProxyUrl: "" }],
  ]);
  assert.deepEqual(runtime.getSnapshot(), {
    httpProxyUrl: "",
  });
});

test("Telegram network configuration rolls the live proxy back when persistence fails", async () => {
  const writeError = new Error("fixture write failed");
  const { events, runtime } = fixture(
    {
      httpProxyUrl: "http://127.0.0.1:7890",
    },
    { writeError },
  );
  await runtime.initialize();
  events.length = 0;

  await assert.rejects(
    runtime.configure({
      httpProxyUrl: "http://localhost:8080",
    }),
    (error) => error === writeError,
  );

  assert.deepEqual(events, [
    [
      "setProxy",
      {
        mode: "fixed_servers",
        proxyRules: "https=http://localhost:8080",
      },
    ],
    ["closeAllConnections"],
    [
      "write",
      {
        httpProxyUrl: "http://localhost:8080",
      },
    ],
    [
      "setProxy",
      {
        mode: "fixed_servers",
        proxyRules: "https=http://127.0.0.1:7890",
      },
    ],
    ["closeAllConnections"],
  ]);
  assert.deepEqual(runtime.settings, {
    httpProxyUrl: "http://127.0.0.1:7890",
  });
});

test("Telegram network exposes the selected Electron Session fetch", async () => {
  const { events, runtime } = fixture();
  const fetch = runtime.fetch;

  const response = await fetch(
    "https://api.telegram.org/",
    { method: "POST" },
  );

  assert.equal(await response.text(), "telegram-network");
  assert.deepEqual(events, [
    ["fetch", "https://api.telegram.org/", "POST"],
  ]);
});
