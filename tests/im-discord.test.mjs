import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiscordGatewayProvider,
  DiscordTransportError,
  discordNonceForOperation,
  normalizeDiscordMessage,
  validateDiscordBotToken,
} from "../packages/im-discord/src/index.ts";
import {
  pollGatewayProviderOnce,
} from "../packages/im-gateway/src/index.ts";

const secretToken = "private.discord.bot-token";
const bot = Object.freeze({
  avatar: "avatar-hash",
  discriminator: "0",
  globalName: "Minke Bot",
  id: "100000000000000001",
  username: "minke",
});

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function botResponse() {
  return json({
    avatar: bot.avatar,
    bot: true,
    discriminator: bot.discriminator,
    global_name: bot.globalName,
    id: bot.id,
    username: bot.username,
  });
}

function gatewayResponse(
  url = "wss://gateway.discord.gg",
) {
  return json({
    session_start_limit: {
      max_concurrency: 1,
      remaining: 999,
      reset_after: 60_000,
      total: 1_000,
    },
    shards: 1,
    url,
  });
}

function sequenceFetch(responses, requests = []) {
  let index = 0;
  return Object.assign(
    async (input, init) => {
      requests.push({
        body: init?.body,
        headers: Object.fromEntries(
          new Headers(init?.headers).entries(),
        ),
        method: init?.method,
        redirect: init?.redirect,
        signal: init?.signal,
        url: String(input),
      });
      const response = responses[index];
      index += 1;
      if (response === undefined) {
        throw new Error(`unexpected request ${String(input)}`);
      }
      return typeof response === "function"
        ? await response(input, init)
        : response;
    },
    {
      consumed() {
        return index;
      },
    },
  );
}

class FakeTimers {
  #nextId = 1;
  #tasks = new Map();

  clearTimeout = (id) => {
    this.#tasks.delete(id);
  };

  setTimeout = (callback, delayMs) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#tasks.set(id, { callback, delayMs });
    return id;
  };

  get size() {
    return this.#tasks.size;
  }

  nextDelay() {
    const first = this.#tasks.values().next().value;
    return first?.delayMs;
  }

  runNext() {
    const first = this.#tasks.entries().next().value;
    if (first === undefined) {
      throw new Error("no pending timer");
    }
    const [id, task] = first;
    this.#tasks.delete(id);
    task.callback();
  }

  runDelay(delayMs) {
    const entry = [...this.#tasks.entries()].find(
      ([, task]) => task.delayMs === delayMs,
    );
    if (entry === undefined) {
      throw new Error(`no pending ${delayMs}ms timer`);
    }
    const [id, task] = entry;
    this.#tasks.delete(id);
    task.callback();
  }
}

class FakeSocket {
  #listeners = {
    close: new Set(),
    error: new Set(),
    message: new Set(),
    open: new Set(),
  };

  closes = [];
  readyState;
  sent = [];

  constructor(readyState = 1) {
    this.readyState = readyState;
  }

  addEventListener(type, listener) {
    this.#listeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.#listeners[type].delete(listener);
  }

  close(code, reason) {
    if (this.readyState === 3) return;
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.#emit("close", { code });
  }

  emitMessage(value) {
    this.#emit("message", {
      data: JSON.stringify(value),
    });
  }

  emitOpen() {
    if (this.readyState === 3) return;
    this.readyState = 1;
    this.#emit("open", {});
  }

  serverClose(code) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#emit("close", { code });
  }

  send(value) {
    if (this.readyState !== 1) {
      throw new Error("socket is closed");
    }
    this.sent.push(JSON.parse(value));
  }

  #emit(type, event) {
    for (const listener of [...this.#listeners[type]]) {
      listener(event);
    }
  }
}

function socketFixture() {
  const sockets = [];
  const urls = [];
  return {
    sockets,
    urls,
    factory(url) {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function ready(
  socket,
  sequence = 1,
  sessionId = "opaque-session-id",
) {
  socket.emitMessage({
    d: {
      application: { id: "200000000000000001" },
      guilds: [],
      resume_gateway_url:
        "wss://gateway-us-east1-b.discord.gg",
      session_id: sessionId,
      user: {
        bot: true,
        id: bot.id,
        username: bot.username,
      },
      v: 10,
    },
    op: 0,
    s: sequence,
    t: "READY",
  });
}

function gatewayCheckpoint(
  sequence,
  sessionId = "opaque-session-id",
) {
  return JSON.stringify([
    "discord-gateway-v1",
    sessionId,
    sequence,
  ]);
}

function hello(socket, interval = 100) {
  socket.emitMessage({
    d: { heartbeat_interval: interval },
    op: 10,
  });
}

function message(overrides = {}) {
  return {
    attachments: [],
    author: {
      avatar: null,
      bot: false,
      discriminator: "0",
      global_name: "Alice",
      id: "300000000000000001",
      username: "alice",
    },
    channel_id: "400000000000000001",
    content: "hello",
    edited_timestamp: null,
    embeds: [],
    flags: 0,
    guild_id: "500000000000000001",
    id: "600000000000000001",
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    timestamp: "2026-08-23T10:20:30.000Z",
    tts: false,
    type: 0,
    ...overrides,
  };
}

async function startedProvider(overrides = {}) {
  const timers = new FakeTimers();
  const sockets = socketFixture();
  const requests = [];
  const fetch = sequenceFetch(
    [botResponse(), gatewayResponse()],
    requests,
  );
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    fetch,
    generation: 1,
    random: () => 0,
    reconnectBackoffMs: () => 0,
    timers,
    token: secretToken,
    webSocketFactory: sockets.factory,
    ...overrides,
  });
  const start = provider.start();
  await flush();
  await waitFor(() => sockets.sockets.length > 0);
  const socket = sockets.sockets[0];
  assert.ok(socket);
  hello(socket);
  ready(socket);
  await start;
  return {
    fetch,
    provider,
    requests,
    socket,
    sockets,
    timers,
  };
}

test("bot validation uses the Bot scheme and never exposes the token on failure", async () => {
  const requests = [];
  const fetch = sequenceFetch([botResponse()], requests);
  assert.deepEqual(
    await validateDiscordBotToken({
      fetch,
      token: secretToken,
    }),
    bot,
  );
  assert.equal(
    requests[0].url,
    "https://discord.com/api/v10/users/@me",
  );
  assert.equal(
    requests[0].headers.authorization,
    `Bot ${secretToken}`,
  );
  assert.equal(
    requests[0].headers["user-agent"].startsWith(
      "DiscordBot (",
    ),
    true,
  );
  assert.equal(requests[0].redirect, "error");

  await assert.rejects(
    validateDiscordBotToken({
      fetch: async () => {
        throw new Error(`network saw ${secretToken}`);
      },
      token: secretToken,
    }),
    (error) => {
      assert.equal(error instanceof DiscordTransportError, true);
      assert.equal(error.code, "network");
      assert.equal(error.message.includes(secretToken), false);
      assert.equal(JSON.stringify(error).includes(secretToken), false);
      assert.equal("cause" in error, false);
      return true;
    },
  );
});

test("request timeout remains active while a response body is stalled", async () => {
  const timers = new FakeTimers();
  const pending = validateDiscordBotToken({
    fetch: async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              "abort",
              () =>
                controller.error(
                  new DOMException("aborted", "AbortError"),
                ),
              { once: true },
            );
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    requestTimeoutMs: 25,
    timers,
    token: secretToken,
  });
  await waitFor(() => timers.size === 1);
  timers.runNext();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "timeout" &&
      error.effect === "none" &&
      error.retryable,
  );
});

test("a prevalidated bot identity skips /users/@me and determines the durable account key", async () => {
  const fetch = sequenceFetch([]);
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch,
    generation: 3,
    token: secretToken,
    webSocketFactory() {
      throw new Error("not started");
    },
  });
  assert.equal(fetch.consumed(), 0);
  assert.deepEqual(provider.account, {
    accountKey: `discord:${bot.id}`,
    generation: 3,
    provider: "discord",
    providerAccountId: bot.id,
    requiresDeliveryContext: false,
  });
  await provider.close();

  await assert.rejects(
    createDiscordGatewayProvider({
      accountKey: "discord:bad",
      bot: { ...bot, id: "not-a-snowflake" },
      fetch,
      generation: 1,
      token: secretToken,
    }),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "protocol",
  );
  await assert.rejects(
    createDiscordGatewayProvider({
      accountKey: "discord:local",
      bot,
      fetch,
      generation: 1,
      token: secretToken,
    }),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "invalid-config",
  );
  await assert.rejects(
    createDiscordGatewayProvider({
      accountKey: `discord:${bot.id}`,
      bot,
      fetch,
      generation: 1,
      maxPendingMessages: 0,
      token: secretToken,
    }),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "invalid-config",
  );
});

test("socket open, Hello, and Ready startup phases each have a bounded deadline", async (t) => {
  async function pendingStart({
    helloTimeoutMs = 12,
    openTimeoutMs = 11,
    readyTimeoutMs = 13,
    socket,
  }) {
    const timers = new FakeTimers();
    let socketCreated = false;
    const provider = await createDiscordGatewayProvider({
      accountKey: `discord:${bot.id}`,
      bot,
      fetch: sequenceFetch([gatewayResponse()]),
      gatewayHelloTimeoutMs: helloTimeoutMs,
      gatewayOpenTimeoutMs: openTimeoutMs,
      gatewayReadyTimeoutMs: readyTimeoutMs,
      generation: 1,
      random: () => 0,
      timers,
      token: secretToken,
      webSocketFactory: () => {
        socketCreated = true;
        return socket;
      },
    });
    const start = provider.start();
    await waitFor(() => socketCreated);
    return { provider, start, timers };
  }

  await t.test("socket open timeout", async () => {
    const socket = new FakeSocket(0);
    const fixture = await pendingStart({ socket });
    const rejected = assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "timeout" &&
        error.retryable &&
        error.message ===
          "Discord socket open deadline expired",
    );
    fixture.timers.runDelay(11);
    await rejected;
    assert.equal(fixture.provider.getStatus().state, "fatal");
    assert.deepEqual(socket.closes, [
      { code: 1000, reason: "Fatal" },
    ]);
    assert.equal(fixture.timers.size, 0);
    await fixture.provider.close();
  });

  await t.test("Gateway Hello timeout", async () => {
    const socket = new FakeSocket();
    const fixture = await pendingStart({ socket });
    const rejected = assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "timeout" &&
        error.message ===
          "Discord Gateway Hello deadline expired",
    );
    fixture.timers.runDelay(12);
    await rejected;
    assert.equal(fixture.provider.getStatus().state, "fatal");
    assert.equal(socket.closes.at(-1).reason, "Fatal");
    assert.equal(fixture.timers.size, 0);
    await fixture.provider.close();
  });

  await t.test("Gateway Ready timeout", async () => {
    const socket = new FakeSocket();
    const fixture = await pendingStart({ socket });
    hello(socket, 100);
    const rejected = assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "timeout" &&
        error.message ===
          "Discord Gateway Ready deadline expired",
    );
    fixture.timers.runDelay(13);
    await rejected;
    assert.equal(fixture.provider.getStatus().state, "fatal");
    assert.equal(socket.closes.at(-1).reason, "Fatal");
    assert.equal(fixture.timers.size, 0);
    await fixture.provider.close();
  });

  await t.test("an asynchronous socket open advances every deadline", async () => {
    const socket = new FakeSocket(0);
    const fixture = await pendingStart({ socket });
    assert.equal(fixture.timers.nextDelay(), 11);
    socket.emitOpen();
    assert.equal(fixture.timers.nextDelay(), 12);
    hello(socket, 100);
    assert.equal(fixture.timers.nextDelay(), 13);
    ready(socket);
    await fixture.start;
    assert.equal(fixture.provider.getStatus().state, "ready");
    await fixture.provider.close();
    assert.equal(fixture.timers.size, 0);
  });
});

test("initial Gateway recovery has a total deadline that abort and close can preempt", async (t) => {
  async function recoveringProvider({
    signal,
    startupTimeoutMs = 40,
  } = {}) {
    const timers = new FakeTimers();
    let attempts = 0;
    const provider = await createDiscordGatewayProvider({
      accountKey: `discord:${bot.id}`,
      bot,
      fetch: sequenceFetch([gatewayResponse()]),
      gatewayInitialReadyTimeoutMs: startupTimeoutMs,
      generation: 1,
      reconnectBackoffMs: () => 0,
      timers,
      token: secretToken,
      webSocketFactory() {
        attempts += 1;
        throw new Error("socket factory unavailable");
      },
    });
    const start = provider.start({ signal });
    await waitFor(() => attempts === 1);
    return {
      attempts: () => attempts,
      provider,
      start,
      timers,
    };
  }

  await t.test("persistent socket failure settles start", async (t) => {
    const fixture = await recoveringProvider();
    t.after(() => fixture.provider.close());
    const rejected = assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "network" &&
        error.retryable &&
        error.message ===
          "Discord Gateway initial Ready deadline expired",
    );
    fixture.timers.runDelay(0);
    fixture.timers.runDelay(0);
    assert.equal(fixture.attempts(), 3);
    fixture.timers.runDelay(40);
    await rejected;
    assert.equal(fixture.provider.getStatus().state, "fatal");
    assert.equal(fixture.timers.size, 0);
  });

  await t.test("AbortSignal wins over the recovery deadline", async () => {
    const controller = new AbortController();
    const fixture = await recoveringProvider({
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "aborted",
    );
    assert.equal(fixture.provider.getStatus().state, "idle");
    assert.equal(fixture.timers.size, 0);
    await fixture.provider.close();
  });

  await t.test("close wins over the recovery deadline", async () => {
    const fixture = await recoveringProvider();
    await fixture.provider.close();
    await assert.rejects(
      fixture.start,
      (error) =>
        error instanceof DiscordTransportError &&
        error.code === "gateway-closed",
    );
    assert.equal(fixture.provider.getStatus().state, "closed");
    assert.equal(fixture.timers.size, 0);
  });
});

test("Gateway v10 identifies, heartbeats, reconnects with Resume, and re-identifies an invalid session", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  assert.equal(
    fixture.sockets.urls[0],
    "wss://gateway.discord.gg/?v=10&encoding=json",
  );
  assert.deepEqual(fixture.socket.sent[0], {
    d: {
      intents: 37_377,
      properties: {
        browser: "minke-im-discord",
        device: "minke-im-discord",
        os: process.platform,
      },
      token: secretToken,
    },
    op: 2,
  });

  fixture.timers.runNext();
  assert.deepEqual(fixture.socket.sent.at(-1), {
    d: 1,
    op: 1,
  });
  fixture.socket.emitMessage({ d: null, op: 11 });
  fixture.timers.runNext();
  assert.deepEqual(fixture.socket.sent.at(-1), {
    d: 1,
    op: 1,
  });
  fixture.timers.runNext();
  assert.equal(fixture.socket.closes[0].code, 4000);
  assert.equal(fixture.timers.nextDelay(), 0);
  fixture.timers.runNext();
  const resumedSocket = fixture.sockets.sockets[1];
  assert.ok(resumedSocket);
  hello(resumedSocket);
  assert.deepEqual(resumedSocket.sent[0], {
    d: {
      seq: 1,
      session_id: "opaque-session-id",
      token: secretToken,
    },
    op: 6,
  });
  resumedSocket.emitMessage({
    d: {},
    op: 0,
    s: 2,
    t: "RESUMED",
  });

  resumedSocket.emitMessage({ d: false, op: 9 });
  assert.equal(resumedSocket.closes.at(-1).code, 4000);
  assert.equal(fixture.timers.nextDelay(), 1_000);
  fixture.timers.runNext();
  const identifiedSocket = fixture.sockets.sockets[2];
  assert.ok(identifiedSocket);
  hello(identifiedSocket);
  assert.equal(identifiedSocket.sent[0].op, 2);
  assert.equal(
    Object.hasOwn(identifiedSocket.sent[0].d, "session_id"),
    false,
  );
});

test("MESSAGE_CREATE normalizes attachment, embed, reply, and thread context into a checkpointed batch", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  fixture.socket.emitMessage({
    d: {
      channels: [],
      id: "500000000000000001",
      threads: [
        {
          guild_id: "500000000000000001",
          id: "400000000000000001",
          parent_id: "700000000000000001",
          type: 11,
        },
      ],
    },
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
  });
  const receive = fixture.provider.receive(null);
  fixture.socket.emitMessage({
    d: message({
      attachments: [
        {
          content_type: "image/png",
          description: "diagram",
          ephemeral: false,
          filename: "diagram.png",
          height: 480,
          id: "800000000000000001",
          proxy_url:
            "https://media.discordapp.net/attachments/a/b.png",
          size: 1234,
          url:
            "https://cdn.discordapp.com/attachments/a/b.png",
          width: 640,
        },
      ],
      embeds: [
        {
          description: "embedded",
          fields: [
            { inline: true, name: "k", value: "v" },
          ],
          title: "Card",
          type: "rich",
          url: "https://example.com/card",
        },
      ],
      message_reference: {
        channel_id: "400000000000000001",
        guild_id: "500000000000000001",
        message_id: "900000000000000001",
        type: 0,
      },
      nonce: "minke-correlation",
      referenced_message: {
        author: {
          id: "300000000000000002",
        },
        content: "earlier",
      },
    }),
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  });
  const batch = await receive;
  assert.equal(batch.fromCheckpoint, null);
  assert.equal(batch.nextCheckpoint, gatewayCheckpoint(3));
  assert.equal(batch.events.length, 1);
  assert.deepEqual(
    {
      conversationId: batch.events[0].conversationId,
      correlationId: batch.events[0].correlationId,
      kind: batch.events[0].kind,
      nativeId: batch.events[0].nativeId,
      peerId: batch.events[0].peerId,
      senderId: batch.events[0].senderId,
    },
    {
      conversationId: "400000000000000001",
      correlationId: "minke-correlation",
      kind: "user-message",
      nativeId: "600000000000000001",
      peerId: "400000000000000001",
      senderId: "300000000000000001",
    },
  );
  assert.deepEqual(batch.events[0].payload.context, {
    channelId: "400000000000000001",
    guildId: "500000000000000001",
    kind: "guild-thread",
    parentChannelId: "700000000000000001",
    threadType: 11,
  });
  assert.equal(
    batch.events[0].payload.attachments[0].fileName,
    "diagram.png",
  );
  assert.equal(
    batch.events[0].payload.embeds[0].fields[0].value,
    "v",
  );
  assert.deepEqual(batch.events[0].payload.reply, {
    authorId: "300000000000000002",
    channelId: "400000000000000001",
    content: "earlier",
    guildId: "500000000000000001",
    messageId: "900000000000000001",
  });
});

test("mailbox admission failure replays the unconfirmed Discord batch from the same checkpoint", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  let checkpoint = null;
  const admitted = [];
  const mailbox = {
    admitBatch(batch) {
      admitted.push(batch);
      if (admitted.length === 1) {
        throw new Error("mailbox temporarily unavailable");
      }
      checkpoint = batch.nextCheckpoint;
      return {
        admittedNativeIds: batch.events.map(
          (event) => event.nativeId,
        ),
        confirmedOperationIds: [],
        nextCheckpoint: batch.nextCheckpoint,
      };
    },
    getCheckpoint() {
      return checkpoint;
    },
  };
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000010" }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });

  await assert.rejects(
    pollGatewayProviderOnce({
      mailbox,
      provider: fixture.provider,
    }),
    /mailbox temporarily unavailable/u,
  );

  fixture.socket.emitMessage({
    d: message({ id: "600000000000000011" }),
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  });
  const retried = await pollGatewayProviderOnce({
    mailbox,
    provider: fixture.provider,
  });

  assert.equal(retried.nextCheckpoint, gatewayCheckpoint(2));
  assert.equal(admitted.length, 2);
  assert.equal(admitted[0].fromCheckpoint, null);
  assert.equal(admitted[1].fromCheckpoint, null);
  assert.equal(
    admitted[0].events[0].nativeId,
    "600000000000000010",
  );
  assert.equal(
    admitted[1].events[0].nativeId,
    "600000000000000010",
  );

  const next = await pollGatewayProviderOnce({
    mailbox,
    provider: fixture.provider,
  });
  assert.equal(next.nextCheckpoint, gatewayCheckpoint(3));
  assert.equal(
    admitted[2].events[0].nativeId,
    "600000000000000011",
  );
});

test("a stale session checkpoint cannot confirm a same-sequence head", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  const staleCheckpoint = gatewayCheckpoint(
    2,
    "retired-session-id",
  );
  const firstReceive = fixture.provider.receive(staleCheckpoint);
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000029" }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });

  const first = await firstReceive;
  assert.equal(first.fromCheckpoint, staleCheckpoint);
  assert.equal(first.nextCheckpoint, gatewayCheckpoint(2));

  const replayed = await fixture.provider.receive(
    staleCheckpoint,
  );
  assert.equal(replayed.nextCheckpoint, gatewayCheckpoint(2));
  assert.equal(
    replayed.events[0].nativeId,
    "600000000000000029",
  );
});

test("mailbox admission failure replays a same-sequence message from a replacement session", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  let checkpoint = null;
  const admitted = [];
  const mailbox = {
    admitBatch(batch) {
      admitted.push(batch);
      if (admitted.length === 2) {
        throw new Error("mailbox temporarily unavailable");
      }
      checkpoint = batch.nextCheckpoint;
      return {
        admittedNativeIds: batch.events.map(
          (event) => event.nativeId,
        ),
        confirmedOperationIds: [],
        nextCheckpoint: batch.nextCheckpoint,
      };
    },
    getCheckpoint() {
      return checkpoint;
    },
  };
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000040" }),
    op: 0,
    s: 100,
    t: "MESSAGE_CREATE",
  });
  await pollGatewayProviderOnce({
    mailbox,
    provider: fixture.provider,
  });
  const oldCheckpoint = gatewayCheckpoint(100);
  assert.equal(checkpoint, oldCheckpoint);

  const pendingAdmission = pollGatewayProviderOnce({
    mailbox,
    provider: fixture.provider,
  });
  fixture.socket.serverClose(4009);
  fixture.timers.runDelay(0);
  const replacement = fixture.sockets.sockets[1];
  assert.ok(replacement);
  hello(replacement);
  ready(replacement, 1, "replacement-session-id");
  replacement.emitMessage({
    d: message({ id: "600000000000000041" }),
    op: 0,
    s: 100,
    t: "MESSAGE_CREATE",
  });
  await assert.rejects(
    pendingAdmission,
    /mailbox temporarily unavailable/u,
  );
  assert.equal(checkpoint, oldCheckpoint);

  const retried = await pollGatewayProviderOnce({
    mailbox,
    provider: fixture.provider,
  });
  const replacementCheckpoint = gatewayCheckpoint(
    100,
    "replacement-session-id",
  );
  assert.equal(retried.nextCheckpoint, replacementCheckpoint);
  assert.equal(admitted.length, 3);
  assert.equal(admitted[1].fromCheckpoint, oldCheckpoint);
  assert.equal(admitted[2].fromCheckpoint, oldCheckpoint);
  assert.equal(
    admitted[1].events[0].nativeId,
    "600000000000000041",
  );
  assert.equal(
    admitted[2].events[0].nativeId,
    "600000000000000041",
  );
  assert.equal(checkpoint, replacementCheckpoint);
});

test("a confirmed head cannot discard lower sequences from a new Gateway session", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000030" }),
    op: 0,
    s: 100,
    t: "MESSAGE_CREATE",
  });
  const oldSessionBatch = await fixture.provider.receive(null);
  assert.equal(
    oldSessionBatch.nextCheckpoint,
    gatewayCheckpoint(100),
  );

  fixture.socket.serverClose(4009);
  fixture.timers.runDelay(0);
  const newSessionSocket = fixture.sockets.sockets[1];
  assert.ok(newSessionSocket);
  hello(newSessionSocket);
  ready(newSessionSocket, 1, "replacement-session-id");
  newSessionSocket.emitMessage({
    d: message({ id: "600000000000000031" }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });

  const nextBatch = fixture.provider.receive(
    gatewayCheckpoint(100),
  );
  newSessionSocket.emitMessage({
    d: message({ id: "600000000000000032" }),
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  });
  const admitted = await nextBatch;
  assert.equal(
    admitted.fromCheckpoint,
    gatewayCheckpoint(100),
  );
  assert.equal(
    admitted.nextCheckpoint,
    gatewayCheckpoint(2, "replacement-session-id"),
  );
  assert.equal(
    admitted.events[0].nativeId,
    "600000000000000031",
  );
});

test("fatal queue overflow preserves an already delivered but unconfirmed head", async (t) => {
  const fixture = await startedProvider({
    maxPendingMessages: 1,
  });
  t.after(() => fixture.provider.close());
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000020" }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });
  const delivered = await fixture.provider.receive(null);
  assert.equal(
    delivered.events[0].nativeId,
    "600000000000000020",
  );

  fixture.socket.emitMessage({
    d: message({ id: "600000000000000021" }),
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  });
  assert.equal(fixture.provider.getStatus().state, "fatal");

  const replayed = await fixture.provider.receive(null);
  assert.equal(replayed.nextCheckpoint, gatewayCheckpoint(2));
  assert.equal(
    replayed.events[0].nativeId,
    "600000000000000020",
  );
  await assert.rejects(
    fixture.provider.receive(gatewayCheckpoint(2)),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "inbound-overflow",
  );
});

test("the pre-admission MESSAGE_CREATE queue fails closed at its configured limit", async (t) => {
  const fixture = await startedProvider({
    maxPendingMessages: 1,
  });
  t.after(() => fixture.provider.close());
  fixture.socket.emitMessage({
    d: message({ id: "600000000000000002" }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });
  assert.equal(fixture.provider.getStatus().state, "ready");

  fixture.socket.emitMessage({
    d: message({ id: "600000000000000003" }),
    op: 0,
    s: 3,
    t: "MESSAGE_CREATE",
  });

  assert.equal(fixture.provider.getStatus().state, "fatal");
  assert.deepEqual(fixture.socket.closes.at(-1), {
    code: 1000,
    reason: "Fatal",
  });
  assert.equal(fixture.timers.size, 0);
  const retained = await fixture.provider.receive(null);
  assert.equal(retained.nextCheckpoint, gatewayCheckpoint(2));
  assert.equal(
    retained.events[0].nativeId,
    "600000000000000002",
  );
  await assert.rejects(
    fixture.provider.receive(gatewayCheckpoint(2)),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "inbound-overflow" &&
      error.message ===
        "Discord inbound queue reached its pre-admission limit",
  );
});

test("a bot echo maps Discord's bounded nonce back to the Gateway operation id", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  const preparation = await fixture.provider.prepare(
    deliveryPreparation({
      kind: "text",
      text: "echo me",
    }),
  );
  assert.equal(preparation.status, "ready");
  const receive = fixture.provider.receive(
    gatewayCheckpoint(1),
  );
  fixture.socket.emitMessage({
    d: message({
      author: {
        avatar: null,
        bot: true,
        discriminator: "0",
        global_name: bot.globalName,
        id: bot.id,
        username: bot.username,
      },
      channel_type: 1,
      guild_id: undefined,
      nonce: discordNonceForOperation("operation-1"),
    }),
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
  });
  const batch = await receive;
  assert.equal(batch.events[0].kind, "bot-echo");
  assert.equal(
    batch.events[0].correlationId,
    "operation-1",
  );
});

test("normalization distinguishes direct context and rejects executable attachment URLs", () => {
  assert.deepEqual(
    normalizeDiscordMessage(
      message({
        channel_type: 1,
        guild_id: undefined,
      }),
    ).context,
    {
      channelId: "400000000000000001",
      channelType: 1,
      kind: "direct",
    },
  );
  assert.throws(
    () =>
      normalizeDiscordMessage(
        message({
          attachments: [
            {
              filename: "payload",
              id: "800000000000000001",
              proxy_url: "https://cdn.discordapp.com/safe",
              size: 1,
              url: "file:///etc/passwd",
            },
          ],
        }),
      ),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "protocol",
  );
});

function deliveryPreparation(payload, overrides = {}) {
  return {
    accountKey: `discord:${bot.id}`,
    generation: 1,
    operationId: "operation-1",
    payload,
    recipientId: "400000000000000001",
    ...overrides,
  };
}

function deliveryAttempt(preparedPayload, overrides = {}) {
  return {
    accountKey: `discord:${bot.id}`,
    attemptNumber: 1,
    attemptToken: "attempt-token",
    generation: 1,
    operationId: "operation-1",
    outboxId: 1,
    preparedPayload,
    recipientId: "400000000000000001",
    ...overrides,
  };
}

test("REST delivery suppresses mentions, enforces a stable nonce, and returns the Discord receipt", async (t) => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({
        channel_id: "400000000000000001",
        id: "600000000000000099",
      }),
    ],
    requests,
  );
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch,
    generation: 1,
    token: secretToken,
  });
  t.after(() => provider.close());
  const preparation = await provider.prepare(
    deliveryPreparation({
      kind: "text",
      replyTo: {
        messageId: "900000000000000001",
      },
      text: "@everyone do not ping",
    }),
  );
  assert.equal(preparation.status, "ready");
  const outcome = await provider.deliver(
    deliveryAttempt(preparation.preparedPayload),
  );
  assert.deepEqual(outcome, {
    providerReceiptId: "600000000000000099",
    status: "accepted",
  });
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(body.allowed_mentions, {
    parse: [],
    replied_user: false,
  });
  assert.equal(body.content, "@everyone do not ping");
  assert.equal(body.enforce_nonce, true);
  assert.equal(body.nonce.length, 25);
  assert.equal(
    body.nonce,
    discordNonceForOperation("operation-1"),
  );
  assert.deepEqual(body.message_reference, {
    fail_if_not_exists: false,
    message_id: "900000000000000001",
    type: 0,
  });
  assert.equal(
    requests[0].url,
    "https://discord.com/api/v10/channels/400000000000000001/messages",
  );
});

test("attachment delivery uses Discord multipart indices and copies caller-owned bytes", async (t) => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({
        channel_id: "400000000000000001",
        id: "600000000000000099",
      }),
    ],
    requests,
  );
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch,
    generation: 1,
    token: secretToken,
  });
  t.after(() => provider.close());
  const bytes = new Uint8Array([1, 2, 3]);
  const preparation = await provider.prepare(
    deliveryPreparation({
      attachments: [
        {
          bytes,
          contentType: "application/octet-stream",
          description: "small file",
          fileName: "sample.bin",
        },
      ],
      kind: "message",
      text: "attached",
    }),
  );
  assert.equal(preparation.status, "ready");
  bytes.fill(9);
  await provider.deliver(
    deliveryAttempt(preparation.preparedPayload),
  );
  assert.equal(requests[0].body instanceof FormData, true);
  const payload = JSON.parse(
    requests[0].body.get("payload_json"),
  );
  assert.deepEqual(payload.attachments, [
    {
      description: "small file",
      filename: "sample.bin",
      id: 0,
    },
  ]);
  const file = requests[0].body.get("files[0]");
  assert.equal(file.name, "sample.bin");
  assert.deepEqual(
    new Uint8Array(await file.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

test("rate-limit headers prevent a second request and 5xx delivery remains uncertain", async (t) => {
  const requests = [];
  const accepted = json(
    {
      channel_id: "400000000000000001",
      id: "600000000000000099",
    },
    {
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset-after": "2.5",
      },
    },
  );
  const fetch = sequenceFetch([accepted], requests);
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch,
    generation: 1,
    now: () => 1_000,
    token: secretToken,
  });
  t.after(() => provider.close());
  const first = await provider.prepare(
    deliveryPreparation({ kind: "text", text: "one" }),
  );
  assert.equal(first.status, "ready");
  assert.equal(
    (await provider.deliver(
      deliveryAttempt(first.preparedPayload),
    )).status,
    "accepted",
  );
  const second = await provider.prepare(
    deliveryPreparation(
      { kind: "text", text: "two" },
      { operationId: "operation-2" },
    ),
  );
  assert.equal(second.status, "ready");
  assert.deepEqual(
    await provider.deliver(
      deliveryAttempt(second.preparedPayload, {
        operationId: "operation-2",
      }),
    ),
    {
      errorCode: "rate-limited",
      retryAfterMs: 2_500,
      status: "retry",
    },
  );
  assert.equal(requests.length, 1);

  const failing = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch: sequenceFetch([
      json(
        { code: 0, message: "upstream failed" },
        { status: 503 },
      ),
    ]),
    generation: 1,
    token: secretToken,
  });
  t.after(() => failing.close());
  const prepared = await failing.prepare(
    deliveryPreparation({ kind: "text", text: "maybe" }),
  );
  assert.equal(prepared.status, "ready");
  assert.deepEqual(
    await failing.deliver(
      deliveryAttempt(prepared.preparedPayload),
    ),
    {
      errorCode: "server",
      status: "uncertain",
    },
  );
});

test("explicit REST authentication and 429 failures map to durable Gateway outcomes", async (t) => {
  const unauthorized = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch: sequenceFetch([
      json(
        { code: 0, message: "401: Unauthorized" },
        { status: 401 },
      ),
    ]),
    generation: 1,
    token: secretToken,
  });
  t.after(() => unauthorized.close());
  const unauthorizedPreparation = await unauthorized.prepare(
    deliveryPreparation({ kind: "text", text: "hello" }),
  );
  assert.equal(unauthorizedPreparation.status, "ready");
  assert.deepEqual(
    await unauthorized.deliver(
      deliveryAttempt(
        unauthorizedPreparation.preparedPayload,
      ),
    ),
    {
      errorCode: "credential-invalid",
      status: "rejected",
      terminal: "credential-invalid",
    },
  );

  const limited = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch: sequenceFetch([
      json(
        {
          global: false,
          message: "You are being rate limited.",
          retry_after: 1.75,
        },
        {
          headers: {
            "content-type": "application/json",
            "retry-after": "1.75",
            "x-ratelimit-scope": "user",
          },
          status: 429,
        },
      ),
    ]),
    generation: 1,
    token: secretToken,
  });
  t.after(() => limited.close());
  const limitedPreparation = await limited.prepare(
    deliveryPreparation({ kind: "text", text: "hello" }),
  );
  assert.equal(limitedPreparation.status, "ready");
  assert.deepEqual(
    await limited.deliver(
      deliveryAttempt(limitedPreparation.preparedPayload),
    ),
    {
      errorCode: "rate-limited",
      retryAfterMs: 1_750,
      status: "retry",
    },
  );
});

test("aborted work, malformed intent, close, and fatal Gateway codes fail closed", async (t) => {
  const fixture = await startedProvider();
  t.after(() => fixture.provider.close());
  assert.deepEqual(
    await fixture.provider.prepare(
      deliveryPreparation({
        kind: "text",
        text: "x".repeat(2_001),
      }),
    ),
    {
      errorCode: "invalid-intent",
      status: "rejected",
    },
  );
  const controller = new AbortController();
  controller.abort();
  const prepared = await fixture.provider.prepare(
    deliveryPreparation({ kind: "text", text: "hello" }),
  );
  assert.equal(prepared.status, "ready");
  assert.deepEqual(
    await fixture.provider.deliver(
      deliveryAttempt(prepared.preparedPayload),
      { signal: controller.signal },
    ),
    {
      reasonCode: "aborted",
      status: "deferred",
    },
  );

  const pending = fixture.provider.receive(
    gatewayCheckpoint(1),
  );
  fixture.socket.serverClose(4014);
  await assert.rejects(
    pending,
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "invalid-intent" &&
      error.gatewayCloseCode === 4014 &&
      !error.message.includes(secretToken),
  );
  assert.equal(fixture.provider.getStatus().state, "fatal");
  assert.equal(fixture.timers.size, 0);
});

test("close and AbortSignal release pending operations without reconnecting", async () => {
  const fixture = await startedProvider();
  const pendingReceive = fixture.provider.receive(
    gatewayCheckpoint(1),
  );
  await fixture.provider.close();
  await assert.rejects(
    pendingReceive,
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "gateway-closed",
  );
  assert.equal(fixture.socket.closes.at(-1).code, 1000);
  assert.equal(fixture.timers.size, 0);

  const controller = new AbortController();
  let requestObserved = false;
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch: async (_input, init) => {
      requestObserved = true;
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () =>
            reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
    generation: 1,
    token: secretToken,
    webSocketFactory() {
      throw new Error("must not open");
    },
  });
  const start = provider.start({ signal: controller.signal });
  await waitFor(() => requestObserved);
  controller.abort();
  await assert.rejects(
    start,
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "aborted" &&
      error.effect === "none",
  );
  assert.equal(provider.getStatus().state, "idle");
  await provider.close();
});

test("untrusted Gateway URLs and exhausted identify quotas never receive the bot token", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      botResponse(),
      gatewayResponse("wss://attacker.example/socket"),
    ],
    requests,
  );
  const provider = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    fetch,
    generation: 1,
    token: secretToken,
  });
  await assert.rejects(
    provider.start(),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "untrusted-url",
  );
  assert.equal(requests.length, 2);
  await provider.close();

  const quota = await createDiscordGatewayProvider({
    accountKey: `discord:${bot.id}`,
    bot,
    fetch: sequenceFetch([
      json({
        session_start_limit: {
          remaining: 0,
          reset_after: 12_345,
        },
        url: "wss://gateway.discord.gg",
      }),
    ]),
    generation: 1,
    token: secretToken,
  });
  await assert.rejects(
    quota.start(),
    (error) =>
      error instanceof DiscordTransportError &&
      error.code === "rate-limited" &&
      error.retryAfterMs === 12_345,
  );
  await quota.close();
});
