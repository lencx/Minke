import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import test from "node:test";
import {
  beginWeixinLogin,
  createWeixinTransport,
  WEIXIN_MAX_QR_CONTENT_BYTES,
  WeixinTransportError,
} from "@lencx/minke-im-weixin";

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function requestBody(init) {
  if (init?.body === undefined || init.body === null) return undefined;
  if (typeof init.body === "string") return JSON.parse(init.body);
  let bytes;
  if (init.body instanceof ArrayBuffer) {
    bytes = new Uint8Array(init.body);
  }
  if (ArrayBuffer.isView(init.body)) {
    bytes = new Uint8Array(
      init.body.buffer,
      init.body.byteOffset,
      init.body.byteLength,
    );
  }
  if (bytes === undefined) throw new TypeError("unexpected request body");
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return new Uint8Array(bytes);
  }
}

function requestRecord(input, init) {
  return {
    body: requestBody(init),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    method: init?.method,
    redirect: init?.redirect,
    url: String(input),
  };
}

function sequenceFetch(responses, requests = []) {
  let index = 0;
  return Object.assign(
    async (input, init) => {
      requests.push(requestRecord(input, init));
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

function abortingResponse(_input, init) {
  return new Promise((resolve, reject) => {
    if (init.signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    init.signal.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
  });
}

function stalledBodyResponse(_input, init) {
  return new Response(
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
    { headers: { "content-type": "application/json" } },
  );
}

function transportOptions(fetch, overrides = {}) {
  return {
    botAgent: "Minke/0.2.0",
    credential: {
      accountId: "bot-account",
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "private-bot-token",
    },
    fetch,
    ...overrides,
  };
}

test("QR authorization is UI-driven and ends with a grant to persist", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({
        qrcode: "private-qr-secret",
        qrcode_img_content: "https://weixin.qq.com/x/minke",
      }),
      json({ status: "scaned" }),
      json({ status: "need_verifycode" }),
      json({
        status: "confirmed",
        bot_token: "issued-private-token",
        ilink_bot_id: "issued-account",
        ilink_user_id: "authorized-user",
        baseurl: "https://ilinkai.weixin.qq.com",
      }),
    ],
    requests,
  );

  const flow = await beginWeixinLogin({
    botAgent: "Minke/0.2.0",
    fetch,
    knownBotTokens: ["older-token"],
  });
  assert.deepEqual(flow.challenge, {
    expiresAt: flow.challenge.expiresAt,
    qrContent: "https://weixin.qq.com/x/minke",
  });
  assert.equal(flow.challenge.expiresAt > Date.now(), true);
  assert.deepEqual(await flow.poll(), { status: "scanned" });
  assert.deepEqual(await flow.poll(), {
    status: "verification-required",
  });
  assert.deepEqual(
    await flow.poll({ verificationCode: "123456" }),
    {
      status: "grant-issued",
      grant: {
        accountId: "issued-account",
        authorizedUserId: "authorized-user",
        baseUrl: "https://ilinkai.weixin.qq.com/",
        token: "issued-private-token",
      },
    },
  );

  assert.equal(
    requests[0].url,
    "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
  );
  assert.deepEqual(requests[0].body, {
    local_token_list: ["older-token"],
  });
  assert.equal(requests[0].redirect, "manual");
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers["ilink-app-id"], "bot");
  assert.equal(
    requests[0].headers["ilink-app-clientversion"],
    "132102",
  );
  assert.equal(
    requests[3].url,
    "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=private-qr-secret&verify_code=123456",
  );
  await assert.rejects(
    flow.poll(),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-state",
  );
});

test("QR authorization rejects content larger than the renderer capacity", async () => {
  const fetch = sequenceFetch([
    json({
      qrcode: "private-qr-secret",
      qrcode_img_content:
        `https://weixin.qq.com/x/${"a".repeat(
          WEIXIN_MAX_QR_CONTENT_BYTES,
        )}`,
    }),
  ]);
  await assert.rejects(
    beginWeixinLogin({ fetch }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "protocol",
  );
});

test("closing QR authorization aborts its only active poll", async () => {
  const fetch = sequenceFetch([
    json({
      qrcode: "private-qr-secret",
      qrcode_img_content: "https://weixin.qq.com/x/minke",
    }),
    stalledBodyResponse,
  ]);
  const flow = await beginWeixinLogin({ fetch });
  const pending = flow.poll();
  await assert.rejects(
    flow.poll(),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-state",
  );
  flow.close();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "aborted",
  );
});

test("the login creation signal owns the later QR flow lifecycle", async () => {
  const controller = new AbortController();
  const fetch = sequenceFetch([
    json({
      qrcode: "private-qr-secret",
      qrcode_img_content: "https://weixin.qq.com/x/minke",
    }),
  ]);
  const flow = await beginWeixinLogin({
    fetch,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    flow.poll(),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-state",
  );
});

test("QR authorization follows a trusted redirect, refreshes, and distinguishes an existing binding", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({
        qrcode: "first-private-qr-secret",
        qrcode_img_content: "https://weixin.qq.com/x/first",
      }),
      json({
        status: "scaned_but_redirect",
        redirect_host: "shard.weixin.qq.com",
      }),
      json({ status: "expired" }),
      json({
        qrcode: "second-private-qr-secret",
        qrcode_img_content: "https://weixin.qq.com/x/second",
      }),
      json({ status: "binded_redirect" }),
    ],
    requests,
  );
  const flow = await beginWeixinLogin({ fetch });

  assert.deepEqual(await flow.poll(), { status: "scanned" });
  assert.deepEqual(await flow.poll(), {
    status: "refreshed",
    challenge: {
      expiresAt: flow.challenge.expiresAt,
      qrContent: "https://weixin.qq.com/x/second",
    },
    reason: "expired",
  });
  assert.deepEqual(await flow.poll(), { status: "already-bound" });
  assert.equal(
    requests[2].url,
    "https://shard.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=first-private-qr-secret",
  );
  assert.equal(
    requests[3].url,
    "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
  );
  assert.equal(
    requests[4].url,
    "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=second-private-qr-secret",
  );
  await assert.rejects(
    flow.poll(),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-state",
  );
});

test("receive returns a replayable batch and never owns the checkpoint", async () => {
  const requests = [];
  const update = {
    ret: 0,
    get_updates_buf: "next-checkpoint",
    longpolling_timeout_ms: 42_000,
    msgs: [
      {
        message_id: 918,
        from_user_id: "wx-user",
        to_user_id: "bot-account",
        message_type: 1,
        create_time_ms: 1_723_456_789_000,
        context_token: "private-context-token",
        item_list: [
          {
            type: 1,
            text_item: { text: "hello" },
          },
          {
            type: 2,
            image_item: {
              aeskey: "00112233445566778899aabbccddeeff",
              media: {
                encrypt_query_param: "private-download-param",
              },
              mid_size: 144,
            },
          },
        ],
      },
    ],
  };
  const fetch = sequenceFetch(
    [json({ ret: 0 }), json(update), json(update), json({ ret: 0 })],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  const first = await transport.receive("old-checkpoint");
  const replay = await transport.receive("old-checkpoint");
  assert.deepEqual(first, replay);
  assert.deepEqual(first, {
    fromCheckpoint: "old-checkpoint",
    messages: [
      {
        attachments: [
          {
            fileName: undefined,
            id: "weixin:message:918:attachment:1",
            kind: "image",
            media: {
              aesKey: "ABEiM0RVZneImaq7zN3u/w==",
              encryptedQueryParam: "private-download-param",
              fullUrl: undefined,
            },
            mimeType: "image/*",
            quoted: false,
            size: 144,
          },
        ],
        clientId: undefined,
        conversationId: "wx-user",
        createdAt: 1_723_456_789_000,
        deletedAt: undefined,
        groupId: undefined,
        id: "weixin:message:918",
        messageType: "user",
        recipientId: "bot-account",
        references: [],
        replyContext: {
          contextToken: "private-context-token",
          recipientId: "wx-user",
        },
        runId: undefined,
        senderId: "wx-user",
        sessionId: undefined,
        state: "unknown",
        text: "hello",
        toolProgress: [],
        unsupportedItemTypes: [],
        updatedAt: undefined,
      },
    ],
    nextCheckpoint: "next-checkpoint",
    suggestedPollTimeoutMs: 42_000,
  });
  assert.deepEqual(
    requests
      .filter(({ url }) => url.endsWith("/ilink/bot/getupdates"))
      .map(({ body }) => body.get_updates_buf),
    ["old-checkpoint", "old-checkpoint"],
  );

  await transport.close();
  assert.equal(fetch.consumed(), 4);
});

test("start notification is advisory and a stale session is classified", async () => {
  const fetch = sequenceFetch([
    json({ ret: 17 }),
    json({ errcode: -14 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  await assert.rejects(
    transport.receive("durable-checkpoint"),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "session-stale",
  );
  await assert.rejects(
    transport.deliver({
      operationId: "must-not-leave-stale-session",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: { kind: "text", text: "answer" },
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "session-stale",
  );
  await transport.close();
  assert.equal(fetch.consumed(), 2);
});

test("stale credentials latch from start, typing config, and media setup", async () => {
  {
    const fetch = sequenceFetch([json({ ret: -14 })]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await assert.rejects(
      transport.start(),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale" &&
        error.remoteCode === -14,
    );
    await assert.rejects(
      transport.start(),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale",
    );
    await transport.close();
    assert.equal(fetch.consumed(), 1);
  }

  {
    const fetch = sequenceFetch([
      json({ ret: 0 }),
      json({ ret: -14 }),
    ]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.setTyping({
        active: true,
        contextToken: "private-context-token",
        recipientId: "wx-user",
      }),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale",
    );
    await assert.rejects(
      transport.receive("checkpoint"),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale",
    );
    await transport.close();
    assert.equal(fetch.consumed(), 2);
  }

  {
    const fetch = sequenceFetch([
      json({ ret: 0 }),
      json({ ret: -14 }),
    ]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.deliver({
        operationId: "stale-media",
        recipientId: "wx-user",
        contextToken: "private-context-token",
        content: {
          kind: "image",
          bytes: new TextEncoder().encode("image"),
        },
      }),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale",
    );
    await assert.rejects(
      transport.setTyping({
        active: true,
        contextToken: "private-context-token",
        recipientId: "wx-user",
      }),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "session-stale",
    );
    await transport.close();
    assert.equal(fetch.consumed(), 2);
  }
});

test("a stale response aborts concurrent work and prevents later requests", async () => {
  let markUploadStarted;
  const uploadStarted = new Promise((resolve) => {
    markUploadStarted = resolve;
  });
  let sendAttempts = 0;
  const fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (url.endsWith("/ilink/bot/getuploadurl")) {
      return json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      });
    }
    if (url.includes("/c2c/upload?")) {
      markUploadStarted();
      return await new Promise((resolve, reject) => {
        const fallback = setTimeout(
          () =>
            resolve(
              new Response("", {
                headers: {
                  "x-encrypted-param": "late-download-parameter",
                },
              }),
            ),
          50,
        );
        init.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(fallback);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
    if (url.endsWith("/ilink/bot/getupdates")) {
      return json({ ret: -14 });
    }
    if (url.endsWith("/ilink/bot/sendmessage")) {
      sendAttempts += 1;
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const delivery = transport.deliver({
    operationId: "concurrent-stale-media",
    recipientId: "wx-user",
    contextToken: "private-context-token",
    content: {
      kind: "image",
      bytes: new TextEncoder().encode("image"),
    },
  });
  await uploadStarted;

  await assert.rejects(
    transport.receive("checkpoint"),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "session-stale",
  );
  await assert.rejects(
    delivery,
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "session-stale",
  );
  assert.equal(sendAttempts, 0);
  await transport.close();
});

test("long polling accepts the official response without ret or errcode", async () => {
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    json({
      get_updates_buf: "official-next-checkpoint",
      msgs: [
        {
          message_id: 919,
          from_user_id: "wx-owner",
          to_user_id: "bot-account",
          message_type: 1,
          context_token: "private-context-token",
          item_list: [
            {
              type: 1,
              text_item: { text: "live owner message" },
            },
          ],
        },
      ],
    }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  const batch = await transport.receive("previous-checkpoint");
  assert.equal(batch.nextCheckpoint, "official-next-checkpoint");
  assert.equal(batch.messages.length, 1);
  assert.equal(batch.messages[0].senderId, "wx-owner");
  assert.equal(batch.messages[0].text, "live owner message");
  await transport.close();
});

test("long polling rejects malformed status fields and exposes remote codes", async () => {
  const replies = [
    { body: { ret: "0" }, remoteCode: undefined },
    { body: { ret: 71 }, remoteCode: 71 },
    { body: { errcode: 72 }, remoteCode: 72 },
  ];
  for (const { body, remoteCode } of replies) {
    const fetch = sequenceFetch([
      json({ ret: 0 }),
      json(body),
      json({ ret: 0 }),
    ]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.receive("unchanged-checkpoint"),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "protocol" &&
        error.remoteCode === remoteCode &&
        error.retryable === false,
    );
    await transport.close();
  }
});

test("malformed JSON never exposes response fragments through an error cause", async () => {
  const responseSecret = "private-response-fragment";
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    new Response(`{"${responseSecret}":`, {
      headers: { "content-type": "application/json" },
    }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await assert.rejects(
    transport.receive("checkpoint"),
    (error) => {
      assert.equal(error instanceof WeixinTransportError, true);
      assert.equal(error.code, "protocol");
      assert.equal(error.cause, undefined);
      assert.equal(
        [
          error.message,
          String(error.cause),
          error.cause instanceof Error ? error.cause.stack : "",
        ].join("\n").includes(responseSecret),
        false,
      );
      return true;
    },
  );
  await transport.close();
});

test("normal long-poll timeout keeps the input checkpoint", async () => {
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    stalledBodyResponse,
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch, { longPollTimeoutMs: 5 }),
  );
  await transport.start();
  assert.deepEqual(await transport.receive("durable-checkpoint"), {
    fromCheckpoint: "durable-checkpoint",
    messages: [],
    nextCheckpoint: "durable-checkpoint",
  });
  await transport.close();
});

test("an external abort cancels response-body consumption", async () => {
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    stalledBodyResponse,
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch, { longPollTimeoutMs: 10_000 }),
  );
  await transport.start();
  const controller = new AbortController();
  const pending = transport.receive("durable-checkpoint", {
    signal: controller.signal,
  });
  queueMicrotask(() => controller.abort());
  await assert.rejects(
    pending,
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "aborted" &&
      error.effect === "none",
  );
  await transport.close();
});

test("an earlier external abort wins over a later request timeout", async () => {
  const fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (url.endsWith("/ilink/bot/getupdates")) {
      return await new Promise((_resolve, reject) => {
        setTimeout(
          () =>
            reject(
              new DOMException("delayed abort", "AbortError"),
            ),
          20,
        );
      });
    }
    if (url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch, { longPollTimeoutMs: 5 }),
  );
  await transport.start();
  const controller = new AbortController();
  const receive = transport.receive(
    "checkpoint",
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 1);

  await assert.rejects(
    receive,
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "aborted",
  );
  await transport.close();
});

test("text delivery uses the stable outbox operation id", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [json({ ret: 0 }), json({ ret: 0 }), json({ ret: 0 })],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver({
      operationId: " outbox.2026-08-23.42 ",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: { kind: "text", text: "answer" },
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-config",
  );
  assert.deepEqual(
    await transport.deliver({
      operationId: "outbox.2026-08-23.42",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: { kind: "text", text: "answer" },
    }),
    {
      clientIds: ["outbox.2026-08-23.42"],
      operationId: "outbox.2026-08-23.42",
      outcome: "accepted",
      retrySafety: "unconfirmed",
    },
  );

  const send = requests.find(({ url }) =>
    url.endsWith("/ilink/bot/sendmessage")
  );
  assert.equal(send.body.msg.client_id, "outbox.2026-08-23.42");
  assert.equal(
    send.body.msg.context_token,
    "private-context-token",
  );
  assert.deepEqual(send.body.msg.item_list, [
    { type: 1, text_item: { text: "answer" } },
  ]);
  assert.deepEqual(send.body.base_info, {
    bot_agent: "Minke/0.2.0",
    channel_version: "2.4.6",
  });
  assert.equal(
    send.headers.authorization,
    "Bearer private-bot-token",
  );
  assert.equal(send.headers.authorizationtype, "ilink_bot_token");
  assert.equal(send.headers["ilink-app-id"], "bot");
  assert.equal(send.headers["ilink-app-clientversion"], "132102");
  assert.match(
    Buffer.from(send.headers["x-wechat-uin"], "base64").toString(
      "utf8",
    ),
    /^[0-9]+$/u,
  );
  await transport.close();
});

test("delivery refuses a missing context token and preserves tool-progress items", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({ ret: 0 }),
      json({ ret: 0 }),
      json({ ret: 0 }),
      json({ ret: 0 }),
    ],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver({
      operationId: "missing-context",
      recipientId: "wx-user",
      content: { kind: "text", text: "scheduled answer" },
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-config",
  );
  await transport.deliver({
    operationId: "tool-start",
    recipientId: "wx-user",
    contextToken: "private-context-token",
    runId: "run-42",
    content: {
      kind: "tool-call-start",
      occurredAt: 1_723_456_789_010,
      toolCallId: "call-42",
      toolName: "weather",
    },
  });
  await transport.deliver({
    operationId: "tool-result",
    recipientId: "wx-user",
    contextToken: "private-context-token",
    runId: "run-42",
    content: {
      kind: "tool-call-result",
      occurredAt: 1_723_456_789_020,
      status: "completed",
      toolCallId: "call-42",
      toolName: "weather",
    },
  });
  await transport.close();

  const sent = requests
    .filter(({ url }) => url.endsWith("/ilink/bot/sendmessage"))
    .map(({ body }) => body.msg);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    client_id: "tool-start",
    context_token: "private-context-token",
    from_user_id: "",
    item_list: [
      {
        create_time_ms: 1_723_456_789_010,
        is_completed: false,
        tool_call_start_item: {
          tool_call_id: "call-42",
          tool_name: "weather",
        },
        type: 11,
      },
    ],
    message_state: 2,
    message_type: 2,
    run_id: "run-42",
    to_user_id: "wx-user",
  });
  assert.deepEqual(sent[1].item_list, [
    {
      create_time_ms: 1_723_456_789_020,
      is_completed: true,
      tool_call_result_item: {
        status: "completed",
        tool_call_id: "call-42",
        tool_name: "weather",
      },
      type: 12,
    },
  ]);
});

test("inbound normalization preserves lifecycle, quotes, tool progress, and BOT reconciliation", async () => {
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    json({
      ret: 0,
      get_updates_buf: "next",
      msgs: [
        {
          message_id: 1001,
          from_user_id: "wx-user",
          to_user_id: "bot-account",
          message_type: 1,
          message_state: 2,
          update_time_ms: 1_723_456_789_100,
          delete_time_ms: 1_723_456_789_200,
          item_list: [
            {
              type: 1,
              text_item: { text: "actual user text" },
              ref_msg: {
                title: "quoted title",
                message_item: {
                  type: 1,
                  msg_id: "quoted-item",
                  text_item: { text: "quoted text" },
                },
              },
            },
            { type: 99 },
          ],
        },
        {
          message_id: 1002,
          client_id: "outbox-operation-42",
          from_user_id: "bot-account",
          to_user_id: "wx-user",
          message_type: 2,
          message_state: 1,
          item_list: [
            {
              type: 11,
              msg_id: "tool-item",
              create_time_ms: 1_723_456_789_300,
              is_completed: false,
              tool_call_start_item: {
                tool_name: "weather",
                tool_call_id: "call-42",
              },
            },
          ],
        },
      ],
    }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const batch = await transport.receive("previous");
  const [userMessage, botMessage] = batch.messages;

  assert.equal(userMessage.text, "actual user text");
  assert.equal(userMessage.state, "finished");
  assert.equal(userMessage.updatedAt, 1_723_456_789_100);
  assert.equal(userMessage.deletedAt, 1_723_456_789_200);
  assert.deepEqual(userMessage.unsupportedItemTypes, [99]);
  assert.deepEqual(userMessage.references, [
    {
      attachmentIds: [],
      itemId: "quoted-item",
      kind: "text",
      text: "quoted text",
      title: "quoted title",
    },
  ]);

  assert.equal(botMessage.clientId, "outbox-operation-42");
  assert.equal(botMessage.conversationId, "wx-user");
  assert.equal(botMessage.state, "generating");
  assert.deepEqual(botMessage.toolProgress, [
    {
      completed: false,
      createdAt: 1_723_456_789_300,
      itemId: "tool-item",
      kind: "start",
      status: undefined,
      toolCallId: "call-42",
      toolName: "weather",
      updatedAt: undefined,
    },
  ]);
  await transport.close();
});

test("deep quoted-message chains are truncated without poisoning the checkpoint", async () => {
  let quoted = {
    type: 1,
    msg_id: "quoted-leaf",
    text_item: { text: "leaf" },
  };
  for (let depth = 0; depth < 8; depth += 1) {
    quoted = {
      type: 1,
      msg_id: `quoted-${String(depth)}`,
      text_item: { text: `level-${String(depth)}` },
      ref_msg: {
        title: `level-${String(depth + 1)}`,
        message_item: quoted,
      },
    };
  }
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    json({
      ret: 0,
      get_updates_buf: "next",
      msgs: [
        {
          message_id: 1003,
          from_user_id: "wx-user",
          to_user_id: "bot-account",
          message_type: 1,
          item_list: [
            {
              type: 1,
              text_item: { text: "actual user text" },
              ref_msg: {
                title: "quoted title",
                message_item: quoted,
              },
            },
          ],
        },
      ],
    }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  const batch = await transport.receive("previous");
  assert.equal(batch.nextCheckpoint, "next");
  assert.equal(batch.messages[0].text, "actual user text");
  assert.equal(batch.messages[0].references[0].itemId, "quoted-7");
  await transport.close();
});

test("a send timeout is classified as an unknown remote effect", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [json({ ret: 0 }), abortingResponse, json({ ret: 0 })],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch, { requestTimeoutMs: 5 }),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver({
      operationId: "ambiguous-send",
      recipientId: "wx-user",
      contextToken: "never-print-this-context",
      content: { kind: "text", text: "answer" },
    }),
    (error) => {
      assert.equal(error instanceof WeixinTransportError, true);
      assert.equal(error.code, "timeout");
      assert.equal(error.effect, "unknown");
      assert.equal(error.retryable, false);
      assert.equal(
        error.message.includes("never-print-this-context"),
        false,
      );
      assert.equal(
        error.message.includes("private-bot-token"),
        false,
      );
      return true;
    },
  );
  await transport.close();
  assert.equal(requests.length, 3);
});

test("send accepts the official empty success response and rejects ambiguous malformed responses", async () => {
  const accepted = createWeixinTransport(
    transportOptions(sequenceFetch([
      json({ ret: 0 }),
      json({}),
      json({ ret: 0 }),
    ])),
  );
  await accepted.start();
  assert.deepEqual(
    await accepted.deliver({
      operationId: "empty-success-response",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: { kind: "text", text: "answer" },
    }),
    {
      clientIds: ["empty-success-response"],
      operationId: "empty-success-response",
      outcome: "accepted",
      retrySafety: "unconfirmed",
    },
  );
  await accepted.close();

  const replies = [
    json({ ret: "0" }),
    new Response("not-json", {
      headers: { "content-type": "application/json" },
    }),
  ];
  for (const reply of replies) {
    const fetch = sequenceFetch([
      json({ ret: 0 }),
      reply,
      json({ ret: 0 }),
    ]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.deliver({
        operationId: "ambiguous-response",
        recipientId: "wx-user",
        contextToken: "private-context-token",
        content: { kind: "text", text: "answer" },
      }),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "protocol" &&
        error.effect === "unknown" &&
        error.retryable === false,
    );
    await transport.close();
  }
});

test("media preparation uploads durably before deliverPrepared crosses the send boundary", async () => {
  const requests = [];
  const fetch = async (input, init) => {
    const request = requestRecord(input, init);
    requests.push(request);
    if (request.url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/getuploadurl")) {
      return json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      });
    }
    if (request.url.includes("/c2c/upload?")) {
      return new Response("", {
        headers: {
          "x-encrypted-param": "private-prepared-parameter",
        },
      });
    }
    if (request.url.endsWith("/ilink/bot/sendmessage")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${request.url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const draft = {
    content: {
      bytes: new TextEncoder().encode("prepared image"),
      kind: "image",
    },
    operationId: "prepared-image",
    recipientId: "wx-user",
  };
  const prepared = await transport.prepareDelivery(draft);
  assert.equal(
    requests.some(({ url }) =>
      url.endsWith("/ilink/bot/sendmessage")
    ),
    false,
  );
  const reused = await transport.prepareDelivery({
    ...draft,
    prepared,
  });
  assert.deepEqual(reused, prepared);
  assert.equal(
    requests.filter(({ url }) =>
      url.endsWith("/ilink/bot/getuploadurl")
    ).length,
    1,
  );

  await transport.deliverPrepared({
    contextToken: "fresh-context-token",
    operationId: draft.operationId,
    prepared: reused,
    recipientId: draft.recipientId,
  });
  const send = requests.find(({ url }) =>
    url.endsWith("/ilink/bot/sendmessage")
  );
  assert.equal(send.body.msg.client_id, "prepared-image");
  assert.equal(
    send.body.msg.context_token,
    "fresh-context-token",
  );
  assert.equal(
    send.body.msg.item_list[0].image_item.media
      .encrypt_query_param,
    "private-prepared-parameter",
  );

  const otherRequests = [];
  const otherTransport = createWeixinTransport(
    transportOptions(
      sequenceFetch(
        [json({ ret: 0 }), json({ ret: 0 })],
        otherRequests,
      ),
      {
        credential: {
          accountId: "another-bot-account",
          baseUrl: "https://ilinkai.weixin.qq.com",
          token: "another-private-token",
        },
      },
    ),
  );
  await otherTransport.start();
  await assert.rejects(
    otherTransport.deliverPrepared({
      contextToken: "fresh-context-token",
      operationId: draft.operationId,
      prepared,
      recipientId: draft.recipientId,
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-config",
  );
  assert.equal(
    otherRequests.some(({ url }) =>
      url.endsWith("/ilink/bot/sendmessage")
    ),
    false,
  );
  await otherTransport.close();
  await transport.close();
});

test("media delivery encrypts bytes and inbound download reverses it", async () => {
  const requests = [];
  let ciphertext;
  let outboundMedia;
  const plaintext = new TextEncoder().encode("minke image payload");
  const fetch = async (input, init) => {
    const request = requestRecord(input, init);
    requests.push(request);
    const url = request.url;
    if (url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (url.endsWith("/ilink/bot/getuploadurl")) {
      return json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      });
    }
    if (url.includes("/c2c/upload?")) {
      ciphertext = new Uint8Array(init.body);
      return new Response("", {
        headers: {
          "x-encrypted-param": "private-download-parameter",
        },
      });
    }
    if (url.endsWith("/ilink/bot/sendmessage")) {
      outboundMedia = request.body.msg.item_list[0];
      return json({ ret: 0 });
    }
    if (url.includes("/c2c/download?")) {
      return new Response(ciphertext);
    }
    if (url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await transport.deliver({
    operationId: "image-delivery",
    recipientId: "wx-user",
    contextToken: "private-context-token",
    content: { kind: "image", bytes: plaintext },
  });
  assert.equal(ciphertext.byteLength, 32);
  assert.notDeepEqual(ciphertext, plaintext);
  assert.equal(outboundMedia.type, 2);
  assert.equal(
    outboundMedia.image_item.media.encrypt_query_param,
    "private-download-parameter",
  );
  const uploadRequest = requests.find(({ url }) =>
    url.endsWith("/ilink/bot/getuploadurl")
  );
  const keyHex = Buffer.from(
    outboundMedia.image_item.media.aes_key,
    "base64",
  ).toString("ascii");
  const referenceCipher = createCipheriv(
    "aes-128-ecb",
    Buffer.from(keyHex, "hex"),
    null,
  );
  const expectedCiphertext = Buffer.concat([
    referenceCipher.update(plaintext),
    referenceCipher.final(),
  ]);
  assert.deepEqual(ciphertext, new Uint8Array(expectedCiphertext));
  assert.equal(uploadRequest.body.aeskey, keyHex);
  assert.equal(uploadRequest.body.filesize, 32);
  assert.equal(uploadRequest.body.rawsize, plaintext.byteLength);
  assert.equal(
    uploadRequest.body.rawfilemd5,
    createHash("md5").update(plaintext).digest("hex"),
  );

  const downloaded = await transport.downloadMedia({
    id: "attachment-1",
    kind: "image",
    media: {
      aesKey: outboundMedia.image_item.media.aes_key,
      encryptedQueryParam: "private-download-parameter",
    },
    mimeType: "image/png",
    quoted: false,
    size: plaintext.byteLength,
  });
  assert.deepEqual(downloaded, {
    bytes: plaintext,
    fileName: undefined,
    mimeType: "image/png",
  });
  await transport.close();
  assert.equal(
    requests.every(({ redirect }) => redirect === "manual"),
    true,
  );
});

test("file names are validated before any media upload side effect", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({ ret: 0 }),
      json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      }),
      new Response("", {
        headers: {
          "x-encrypted-param": "private-download-parameter",
        },
      }),
      json({ ret: 0 }),
    ],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver({
      operationId: "invalid-file-name",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: {
        bytes: new TextEncoder().encode("file"),
        fileName: " \u0000 ",
        kind: "file",
      },
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "invalid-config",
  );
  assert.equal(
    requests.some(({ url }) =>
      url.endsWith("/ilink/bot/getuploadurl")
    ),
    false,
  );
  await transport.close();
});

test("CDN upload retries a missing response parameter and emits safe diagnostics", async () => {
  const requests = [];
  const diagnostics = [];
  let uploadAttempts = 0;
  const fetch = async (input, init) => {
    const request = requestRecord(input, init);
    requests.push(request);
    if (request.url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/getuploadurl")) {
      return json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      });
    }
    if (request.url.includes("/c2c/upload?")) {
      uploadAttempts += 1;
      return new Response("", {
        headers:
          uploadAttempts === 1
            ? {}
            : { "x-encrypted-param": "private-download-parameter" },
      });
    }
    if (request.url.endsWith("/ilink/bot/sendmessage")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${request.url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch, {
      onDiagnostic(event) {
        diagnostics.push(event);
        throw new Error("diagnostic callbacks are isolated");
      },
    }),
  );
  await transport.start();
  await transport.deliver({
    operationId: "retry-media",
    recipientId: "wx-user",
    contextToken: "private-context-token",
    content: {
      kind: "image",
      bytes: new TextEncoder().encode("image"),
    },
  });
  await transport.close();

  assert.equal(uploadAttempts, 2);
  assert.deepEqual(diagnostics, [
    {
      attempt: 1,
      durationMs: diagnostics[0].durationMs,
      error: {
        code: "protocol",
        effect: "none",
        networkKind: undefined,
        remoteCode: undefined,
        retryAfterMs: undefined,
        status: undefined,
      },
      operation: "media-upload",
      severity: "warning",
      type: "retry",
    },
  ]);
  assert.equal(diagnostics[0].durationMs >= 0, true);
  assert.equal(
    JSON.stringify(diagnostics).includes("private"),
    false,
  );
});

test("CDN retry backoff honors abort without consuming later attempts", async () => {
  const requests = [];
  let uploadAttempts = 0;
  const fetch = async (input, init) => {
    const request = requestRecord(input, init);
    requests.push(request);
    if (request.url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/getuploadurl")) {
      return json({
        ret: 0,
        upload_full_url:
          "https://novac2c.cdn.weixin.qq.com/c2c/upload?signed=private",
      });
    }
    if (request.url.includes("/c2c/upload?")) {
      uploadAttempts += 1;
      return new Response("", {
        headers: { "retry-after": "60" },
        status: 503,
      });
    }
    if (request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${request.url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch, { requestTimeoutMs: 5 }),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver(
      {
        operationId: "abort-media-retry",
        recipientId: "wx-user",
        contextToken: "private-context-token",
        content: {
          kind: "image",
          bytes: new TextEncoder().encode("image"),
        },
      },
      { signal: AbortSignal.timeout(20) },
    ),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "aborted",
  );
  assert.equal(uploadAttempts, 1);
  await transport.close();
});

test("voice metadata stays accurate and signed download parameters stay opaque", async () => {
  const requests = [];
  const plaintext = new TextEncoder().encode("mp3 bytes");
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const opaqueParameter = "  signed+parameter==  ";
  const fetch = sequenceFetch(
    [
      json({ ret: 0 }),
      json({
        ret: 0,
        get_updates_buf: "next",
        msgs: [
          {
            message_id: 2026,
            from_user_id: "wx-user",
            to_user_id: "bot-account",
            message_type: 1,
            item_list: [
              {
                type: 3,
                voice_item: {
                  bits_per_sample: 16,
                  encode_type: 7,
                  media: {
                    aes_key: key.toString("base64"),
                    encrypt_query_param: opaqueParameter,
                  },
                  playtime: 820,
                  sample_rate: 44_100,
                },
              },
            ],
          },
        ],
      }),
      new Response(encrypted),
      json({ ret: 0 }),
    ],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const batch = await transport.receive("previous");
  const attachment = batch.messages[0].attachments[0];
  assert.equal(attachment.mimeType, "audio/mpeg");
  assert.deepEqual(attachment.audio, {
    bitsPerSample: 16,
    codec: "mp3",
    durationMs: 820,
    encodeType: 7,
    sampleRateHz: 44_100,
  });
  assert.deepEqual(
    await transport.downloadMedia(attachment),
    {
      bytes: plaintext,
      fileName: undefined,
      mimeType: "audio/mpeg",
    },
  );
  const downloadUrl = new URL(requests[2].url);
  assert.equal(
    downloadUrl.searchParams.get("encrypted_query_param"),
    opaqueParameter,
  );
  await transport.close();
});

test("typing refreshes rejected tickets and close cancels active state", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({ ret: 0 }),
      json({ ret: 0, typing_ticket: "rejected-private-ticket" }),
      json({ ret: 44 }),
      json({ ret: 0, typing_ticket: "fresh-private-ticket" }),
      json({ ret: 0 }),
      json({ ret: 0 }),
      json({ ret: 0 }),
    ],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  assert.deepEqual(
    await transport.setTyping({
      active: true,
      contextToken: "private-context-token",
      recipientId: "wx-user",
    }),
    { sent: true },
  );
  await transport.close();

  const configs = requests.filter(({ url }) =>
    url.endsWith("/ilink/bot/getconfig")
  );
  assert.equal(configs.length, 2);
  assert.deepEqual(
    configs.map(({ body }) => ({
      contextToken: body.context_token,
      recipientId: body.ilink_user_id,
    })),
    [
      {
        contextToken: "private-context-token",
        recipientId: "wx-user",
      },
      {
        contextToken: "private-context-token",
        recipientId: "wx-user",
      },
    ],
  );
  const typing = requests.filter(({ url }) =>
    url.endsWith("/ilink/bot/sendtyping")
  );
  assert.deepEqual(
    typing.map(({ body }) => ({
      recipientId: body.ilink_user_id,
      status: body.status,
      ticket: body.typing_ticket,
    })),
    [
      {
        recipientId: "wx-user",
        status: 1,
        ticket: "rejected-private-ticket",
      },
      {
        recipientId: "wx-user",
        status: 1,
        ticket: "fresh-private-ticket",
      },
      {
        recipientId: "wx-user",
        status: 2,
        ticket: "fresh-private-ticket",
      },
    ],
  );
  assert.equal(
    requests.at(-1).url.endsWith("/ilink/bot/msg/notifystop"),
    true,
  );
});

test("typing calls for one recipient are serialized and share config across contexts", async () => {
  const requests = [];
  let configRequests = 0;
  const statuses = [];
  const fetch = async (input, init) => {
    const request = requestRecord(input, init);
    requests.push(request);
    if (request.url.endsWith("/ilink/bot/msg/notifystart")) {
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/getconfig")) {
      configRequests += 1;
      await new Promise((resolve) => queueMicrotask(resolve));
      return json({ ret: 0, typing_ticket: "shared-ticket" });
    }
    if (request.url.endsWith("/ilink/bot/sendtyping")) {
      statuses.push(request.body.status);
      return json({ ret: 0 });
    }
    if (request.url.endsWith("/ilink/bot/msg/notifystop")) {
      return json({ ret: 0 });
    }
    throw new Error(`unexpected request ${request.url}`);
  };
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  await Promise.all([
    transport.setTyping({
      active: true,
      contextToken: "private-context-token-a",
      recipientId: "wx-user",
    }),
    transport.setTyping({
      active: false,
      contextToken: "private-context-token-b",
      recipientId: "wx-user",
    }),
  ]);
  await transport.close();
  assert.equal(configRequests, 1);
  assert.deepEqual(statuses, [1, 2]);
});

test("rate limits and network failures expose bounded retry metadata", async () => {
  {
    const fetch = sequenceFetch([
      json({ ret: 0 }),
      json(
        { error: "limited" },
        {
          headers: {
            "content-type": "application/json",
            "retry-after": "3",
          },
          status: 429,
        },
      ),
      json({ ret: 0 }),
    ]);
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.receive("checkpoint"),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "http" &&
        error.retryable === true &&
        error.retryAfterMs === 3_000,
    );
    await transport.close();
  }

  {
    let receive = false;
    const fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/ilink/bot/msg/notifystart")) {
        return json({ ret: 0 });
      }
      if (url.endsWith("/ilink/bot/getupdates")) {
        receive = true;
        const cause = Object.assign(
          new Error("private-dns-details"),
          { code: "ENOTFOUND" },
        );
        throw new TypeError("fetch failed", { cause });
      }
      if (url.endsWith("/ilink/bot/msg/notifystop")) {
        return json({ ret: 0 });
      }
      throw new Error(`unexpected request ${url}`);
    };
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.receive("checkpoint"),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "network" &&
        error.networkKind === "dns" &&
        !error.message.includes("private-dns-details"),
    );
    assert.equal(receive, true);
    await transport.close();
  }

  {
    const fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/ilink/bot/msg/notifystart")) {
        return json({ ret: 0 });
      }
      if (url.endsWith("/ilink/bot/getupdates")) {
        const cause = Object.assign(
          new Error("private-certificate-details"),
          { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
        );
        throw new TypeError("fetch failed", { cause });
      }
      if (url.endsWith("/ilink/bot/msg/notifystop")) {
        return json({ ret: 0 });
      }
      throw new Error(`unexpected request ${url}`);
    };
    const transport = createWeixinTransport(
      transportOptions(fetch),
    );
    await transport.start();
    await assert.rejects(
      transport.receive("checkpoint"),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "network" &&
        error.networkKind === "tls" &&
        error.retryable === false &&
        !error.message.includes("private-certificate-details"),
    );
    await transport.close();
  }
});

test("server-controlled media URLs cannot escape the HTTPS host policy", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      json({ ret: 0 }),
      json({
        ret: 0,
        upload_full_url: "https://attacker.example/upload",
      }),
      json({ ret: 0 }),
    ],
    requests,
  );
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await assert.rejects(
    transport.deliver({
      operationId: "blocked-upload",
      recipientId: "wx-user",
      contextToken: "private-context-token",
      content: {
        kind: "image",
        bytes: new TextEncoder().encode("image"),
      },
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "untrusted-url",
  );
  await assert.rejects(
    transport.downloadMedia({
      id: "blocked-download",
      kind: "image",
      media: {
        fullUrl: "https://attacker.example/download",
      },
      mimeType: "image/*",
      quoted: false,
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "untrusted-url",
  );
  assert.equal(
    requests.some(({ url }) => url.includes("attacker.example")),
    false,
  );
  await transport.close();
});

test("response and media limits reject declared and streamed excess", async () => {
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(40));
      controller.close();
    },
  });
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    new Response("{}", {
      headers: {
        "content-length": "65",
        "content-type": "application/json",
      },
    }),
    new Response(oversizedStream, {
      headers: { "content-type": "application/json" },
    }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch, {
      maxJsonBytes: 64,
      maxMediaBytes: 16,
    }),
  );
  await transport.start();
  for (const checkpoint of ["declared", "streamed"]) {
    await assert.rejects(
      transport.receive(checkpoint),
      (error) =>
        error instanceof WeixinTransportError &&
        error.code === "payload-too-large",
    );
  }
  await assert.rejects(
    transport.downloadMedia({
      id: "oversized-media",
      kind: "image",
      media: {
        fullUrl:
          "https://novac2c.cdn.weixin.qq.com/c2c/download?signed=private",
      },
      mimeType: "image/*",
      quoted: false,
      size: 33,
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "payload-too-large",
  );
  await transport.close();
});

test("encrypted non-image media requires an AES key", async () => {
  const fetch = sequenceFetch([
    json({ ret: 0 }),
    json({ ret: 0 }),
  ]);
  const transport = createWeixinTransport(
    transportOptions(fetch),
  );
  await transport.start();
  await assert.rejects(
    transport.downloadMedia({
      id: "missing-key",
      kind: "file",
      media: {
        fullUrl:
          "https://novac2c.cdn.weixin.qq.com/c2c/download?signed=private",
      },
      mimeType: "application/octet-stream",
      quoted: false,
    }),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "protocol",
  );
  await transport.close();
});

test("credentials cannot redirect the transport outside trusted HTTPS hosts", () => {
  assert.throws(
    () =>
      createWeixinTransport(
        transportOptions(async () => json({}), {
          credential: {
            accountId: "bot-account",
            baseUrl: "http://127.0.0.1/private",
            token: "private-bot-token",
          },
        }),
      ),
    (error) =>
      error instanceof WeixinTransportError &&
      error.code === "untrusted-url" &&
      !error.message.includes("private-bot-token"),
  );
});
