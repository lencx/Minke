import assert from "node:assert/strict";
import test from "node:test";
import {
  createTelegramGatewayProvider,
  createTelegramTransport,
  deliverTelegramAttempt,
  prepareTelegramDelivery,
  telegramAccountKey,
  TelegramTransportError,
  validateTelegramBotToken,
} from "../packages/im-telegram/src/index.ts";

const TOKEN =
  "123456789:abcdefghijklmnopqrstuvwxyz_123456789";

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function success(result) {
  return json({ ok: true, result });
}

function botIdentity(overrides = {}) {
  return {
    can_join_groups: true,
    can_read_all_group_messages: false,
    first_name: "Minke",
    id: 123456789,
    is_bot: true,
    supports_inline_queries: false,
    username: "minke_test_bot",
    ...overrides,
  };
}

function sentMessage(overrides = {}) {
  return {
    chat: { id: -10042, title: "Minke", type: "supergroup" },
    date: 1_723_456_789,
    message_id: 501,
    ...overrides,
  };
}

function requestBody(init) {
  if (init?.body === undefined || init.body === null) {
    return undefined;
  }
  if (typeof init.body === "string") {
    return JSON.parse(init.body);
  }
  return init.body;
}

function sequenceFetch(responses, requests = []) {
  let index = 0;
  return Object.assign(
    async (input, init) => {
      requests.push({
        body: requestBody(init),
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
        throw new Error(`unexpected mocked request ${String(input)}`);
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

function transportOptions(fetch, overrides = {}) {
  return {
    credential: { token: TOKEN },
    fetch,
    longPollTimeoutMs: 2_000,
    requestTimeoutMs: 5_000,
    ...overrides,
  };
}

function inboundMessage(messageId, content = {}, overrides = {}) {
  return {
    chat: {
      id: -10042,
      is_forum: true,
      title: "Minke",
      type: "supergroup",
      username: "minke_group",
    },
    date: 1_723_456_789,
    from: {
      first_name: "Ada",
      id: 77,
      is_bot: false,
      language_code: "en",
      username: "ada",
    },
    message_id: messageId,
    ...content,
    ...overrides,
  };
}

test("getMe validates a bot token without exposing it through the public transport", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [success(botIdentity()), success(botIdentity())],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );

  assert.equal(transport.identity, undefined);
  assert.deepEqual(await transport.getMe(), {
    canConnectToBusiness: undefined,
    canJoinGroups: true,
    canReadAllGroupMessages: false,
    firstName: "Minke",
    id: "123456789",
    supportsInlineQueries: false,
    username: "minke_test_bot",
  });
  assert.equal(transport.identity?.id, "123456789");
  await transport.start();

  assert.equal(
    requests[0].url,
    `https://api.telegram.org/bot${TOKEN}/getMe`,
  );
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].redirect, "manual");
  assert.deepEqual(requests[0].body, {});
  assert.equal(
    requests[0].headers["content-type"],
    "application/json",
  );
  assert.equal(
    Object.hasOwn(transport, "token"),
    false,
  );
  await transport.close();
});

test("standalone token validation closes its temporary transport", async () => {
  const fetch = sequenceFetch([success(botIdentity())]);
  assert.equal(
    (
      await validateTelegramBotToken(
        transportOptions(fetch),
      )
    ).username,
    "minke_test_bot",
  );
  assert.equal(fetch.consumed(), 1);
});

test("invalid and rejected credentials fail closed without leaking token material", async () => {
  let calls = 0;
  assert.throws(
    () =>
      createTelegramTransport({
        credential: { token: "not/a/token" },
        fetch: async () => {
          calls += 1;
          return success(botIdentity());
        },
      }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
  assert.equal(calls, 0);

  const privateDescription = `revoked ${TOKEN}`;
  const transport = createTelegramTransport(
    transportOptions(
      sequenceFetch([
        json(
          {
            description: privateDescription,
            error_code: 401,
            ok: false,
          },
          { status: 401 },
        ),
      ]),
    ),
  );
  let failure;
  try {
    await transport.start();
  } catch (error) {
    failure = error;
  }
  assert.equal(failure instanceof TelegramTransportError, true);
  assert.equal(failure.code, "credential-invalid");
  assert.doesNotMatch(String(failure), new RegExp(TOKEN, "u"));
  assert.doesNotMatch(
    JSON.stringify(failure),
    new RegExp(TOKEN, "u"),
  );
  assert.doesNotMatch(String(failure), /revoked/u);
  await assert.rejects(
    transport.getMe(),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "credential-invalid",
  );
  await transport.close();
});

test("the transport pins credentials to Telegram's official HTTPS API host", () => {
  assert.throws(
    () =>
      createTelegramTransport({
        apiBaseUrl: "https://example.com",
        credential: { token: TOKEN },
        fetch: async () => success(botIdentity()),
      }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
  assert.throws(
    () =>
      createTelegramTransport({
        apiBaseUrl: "http://api.telegram.org",
        credential: { token: TOKEN },
        fetch: async () => success(botIdentity()),
      }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
});

test("receive replays one durable offset and normalizes supported message content with chat, thread, and reply context", async () => {
  const reply = inboundMessage(
    40,
    { text: "quoted text" },
    { message_thread_id: 900 },
  );
  const updates = [
    {
      message: inboundMessage(
        41,
        { text: "hello" },
        {
          is_topic_message: true,
          message_thread_id: 900,
          reply_to_message: reply,
        },
      ),
      update_id: 101,
    },
    {
      edited_message: inboundMessage(42, {
        caption: "photo caption",
        photo: [
          {
            file_id: "photo-small",
            file_size: 100,
            file_unique_id: "photo-unique-small",
            height: 90,
            width: 160,
          },
          {
            file_id: "photo-large",
            file_size: 500,
            file_unique_id: "photo-unique-large",
            height: 720,
            width: 1280,
          },
        ],
      }),
      update_id: 102,
    },
    {
      message: inboundMessage(43, {
        caption: "document caption",
        document: {
          file_id: "document-id",
          file_name: "report.pdf",
          file_size: 1234,
          file_unique_id: "document-unique",
          mime_type: "application/pdf",
        },
      }),
      update_id: 103,
    },
    {
      message: inboundMessage(44, {
        audio: {
          duration: 12,
          file_id: "audio-id",
          file_name: "song.mp3",
          file_unique_id: "audio-unique",
          mime_type: "audio/mpeg",
          performer: "Minke",
          title: "Song",
        },
      }),
      update_id: 104,
    },
    {
      channel_post: inboundMessage(45, {
        video: {
          duration: 20,
          file_id: "video-id",
          file_name: "clip.mp4",
          file_unique_id: "video-unique",
          height: 720,
          mime_type: "video/mp4",
          width: 1280,
        },
      }),
      update_id: 105,
    },
    {
      message: inboundMessage(46, {
        voice: {
          duration: 4,
          file_id: "voice-id",
          file_unique_id: "voice-unique",
          mime_type: "audio/ogg",
        },
      }),
      update_id: 106,
    },
    {
      message: inboundMessage(47, {
        sticker: {
          emoji: "🐟",
          file_id: "sticker-id",
          file_unique_id: "sticker-unique",
          height: 512,
          is_animated: false,
          is_video: false,
          set_name: "minke",
          width: 512,
        },
      }),
      update_id: 107,
    },
    {
      message: inboundMessage(48, {
        location: {
          heading: 90,
          horizontal_accuracy: 3.5,
          latitude: 31.2304,
          longitude: 121.4737,
        },
      }),
      update_id: 108,
    },
    {
      edited_channel_post: inboundMessage(49, {
        contact: {
          first_name: "Grace",
          last_name: "Hopper",
          phone_number: "+12025550123",
          user_id: 88,
          vcard: "BEGIN:VCARD\nEND:VCARD",
        },
      }),
      update_id: 109,
    },
  ];
  const requests = [];
  const fetch = sequenceFetch(
    [
      success(botIdentity()),
      success(updates),
      success(updates),
    ],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();

  const first = await transport.receive("100");
  const replay = await transport.receive("100");
  assert.deepEqual(first, replay);
  assert.equal(first.fromCheckpoint, "100");
  assert.equal(first.nextCheckpoint, "110");
  assert.equal(first.suggestedPollTimeoutMs, 2_000);
  assert.deepEqual(
    first.messages.map(({ content }) => content.kind),
    [
      "text",
      "photo",
      "document",
      "audio",
      "video",
      "voice",
      "sticker",
      "location",
      "contact",
    ],
  );
  assert.deepEqual(first.messages[0].reply, {
    chatId: "-10042",
    contentKind: "text",
    messageId: "40",
    senderId: "77",
    text: "quoted text",
    threadId: "900",
  });
  assert.equal(
    first.messages[0].conversationId,
    "telegram:chat:-10042:thread:900",
  );
  assert.equal(first.messages[0].senderId, "77");
  assert.equal(first.messages[0].chat.isForum, true);
  assert.equal(first.messages[1].content.photo.fileId, "photo-large");
  assert.equal(first.messages[4].updateType, "channel-post");
  assert.equal(
    first.messages[8].content.userId,
    "88",
  );

  const pollRequests = requests.slice(1);
  assert.deepEqual(
    pollRequests.map(({ body }) => body.offset),
    [100, 100],
  );
  assert.deepEqual(pollRequests[0].body.allowed_updates, [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
  ]);
  assert.equal(pollRequests[0].body.timeout, 2);
  await transport.close();
});

test("unsupported updates still advance the durable checkpoint and invalid checkpoints never reach the network", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      success(botIdentity()),
      success([
        {
          callback_query: { id: "ignored" },
          update_id: 700,
        },
      ]),
    ],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();
  assert.deepEqual(await transport.receive(null), {
    fromCheckpoint: null,
    messages: [],
    nextCheckpoint: "701",
    suggestedPollTimeoutMs: 2_000,
  });
  await assert.rejects(
    transport.receive("07"),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
  assert.equal(requests.length, 2);
  await transport.close();
});

test("sendMessage preserves reply and thread targeting and returns a stable receipt", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      success(botIdentity()),
      success(
        sentMessage({
          message_id: 777,
          message_thread_id: 900,
        }),
      ),
    ],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();
  assert.deepEqual(
    await transport.sendMessage({
      allowSendingWithoutReply: true,
      chatId: "-10042",
      messageThreadId: 900,
      replyToMessageId: 41,
      text: "answer",
    }),
    {
      chatId: "-10042",
      messageId: "777",
      occurredAt: 1_723_456_789_000,
      threadId: "900",
    },
  );
  assert.equal(
    requests[1].url,
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
  );
  assert.deepEqual(requests[1].body, {
    chat_id: "-10042",
    message_thread_id: 900,
    reply_parameters: {
      allow_sending_without_reply: true,
      message_id: 41,
    },
    text: "answer",
  });
  await transport.close();
});

test("common media sends use file IDs or bounded multipart byte uploads", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [
      success(botIdentity()),
      success(sentMessage({ message_id: 601 })),
      success(sentMessage({ message_id: 602 })),
      success(sentMessage({ message_id: 603 })),
      success(sentMessage({ message_id: 604 })),
      success(sentMessage({ message_id: 605 })),
      success(sentMessage({ message_id: 606 })),
    ],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();

  await transport.sendPhoto({
    caption: "existing",
    chatId: "-10042",
    photo: { fileId: "telegram-photo-id", kind: "file-id" },
  });
  await transport.sendDocument({
    chatId: "-10042",
    document: {
      bytes: new TextEncoder().encode("document"),
      fileName: "report.txt",
      kind: "bytes",
      mimeType: "text/plain",
    },
    messageThreadId: 900,
  });
  await transport.sendAudio({
    audio: { fileId: "audio-id", kind: "file-id" },
    chatId: "-10042",
    durationSeconds: 12,
  });
  await transport.sendVideo({
    chatId: "-10042",
    video: { fileId: "video-id", kind: "file-id" },
  });
  await transport.sendVoice({
    chatId: "-10042",
    voice: { fileId: "voice-id", kind: "file-id" },
  });
  await transport.sendSticker({
    chatId: "-10042",
    emoji: "🐟",
    sticker: { fileId: "sticker-id", kind: "file-id" },
  });

  assert.deepEqual(requests[1].body, {
    caption: "existing",
    chat_id: "-10042",
    photo: "telegram-photo-id",
  });
  assert.equal(requests[2].body instanceof FormData, true);
  assert.equal(requests[2].headers["content-type"], undefined);
  assert.equal(requests[2].body.get("chat_id"), "-10042");
  assert.equal(
    requests[2].body.get("message_thread_id"),
    "900",
  );
  const uploaded = requests[2].body.get("document");
  assert.equal(uploaded.name, "report.txt");
  assert.equal(uploaded.type, "text/plain");
  assert.equal(await uploaded.text(), "document");
  assert.deepEqual(
    requests.slice(3).map(({ url }) =>
      url.slice(url.lastIndexOf("/") + 1)
    ),
    ["sendAudio", "sendVideo", "sendVoice", "sendSticker"],
  );
  await transport.close();
});

test("preflight cancellation and oversized uploads fail before the send boundary", async () => {
  const requests = [];
  const fetch = sequenceFetch(
    [success(botIdentity())],
    requests,
  );
  const transport = createTelegramTransport(
    transportOptions(fetch, { maxUploadBytes: 4 }),
  );
  await transport.start();

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transport.sendMessage(
      { chatId: "-10042", text: "answer" },
      { signal: controller.signal },
    ),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "aborted" &&
      error.effect === "none",
  );
  await assert.rejects(
    transport.sendDocument({
      chatId: "-10042",
      document: {
        bytes: new Uint8Array(5),
        fileName: "large.bin",
        kind: "bytes",
      },
    }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "payload-too-large" &&
      error.effect === "none",
  );
  assert.equal(requests.length, 1);
  await transport.close();
});

test("429 response parameters remain retry-safe while ambiguous send failures never auto-retry", async () => {
  const rateLimited = createTelegramTransport(
    transportOptions(
      sequenceFetch([
        success(botIdentity()),
        json(
          {
            description: `slow down ${TOKEN}`,
            error_code: 429,
            ok: false,
            parameters: { retry_after: 7 },
          },
          { status: 429 },
        ),
      ]),
    ),
  );
  await rateLimited.start();
  await assert.rejects(
    rateLimited.sendMessage({
      chatId: "-10042",
      text: "answer",
    }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "rate-limited" &&
      error.effect === "none" &&
      error.retryable === true &&
      error.retryAfterMs === 7_000 &&
      !String(error).includes(TOKEN),
  );
  await rateLimited.close();

  let sends = 0;
  const failed = createTelegramTransport(
    transportOptions(async (input) => {
      if (String(input).endsWith("/getMe")) {
        return success(botIdentity());
      }
      sends += 1;
      throw new Error(`socket failed for ${String(input)}`);
    }),
  );
  await failed.start();
  await assert.rejects(
    failed.sendMessage({
      chatId: "-10042",
      text: "must not be replayed internally",
    }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "network" &&
      error.effect === "unknown" &&
      error.retryable === false &&
      !String(error).includes(TOKEN) &&
      !JSON.stringify(error).includes(TOKEN),
  );
  assert.equal(sends, 1);
  await failed.close();
});

test("caller cancellation and request timeouts are distinct redacted failures", async () => {
  let pollStarted;
  const started = new Promise((resolve) => {
    pollStarted = resolve;
  });
  const controller = new AbortController();
  const fetch = sequenceFetch([
    success(botIdentity()),
    (_input, init) =>
      new Promise((_resolve, reject) => {
        pollStarted();
        init.signal.addEventListener(
          "abort",
          () =>
            reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      }),
  ]);
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const pending = transport.receive("1", {
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "aborted" &&
      error.effect === "none",
  );
  await transport.close();

  const timeoutFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const fallback = setTimeout(
        () => reject(new Error(`late ${TOKEN}`)),
        100,
      );
      init.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(fallback);
          reject(new DOMException("timeout", "AbortError"));
        },
        { once: true },
      );
    });
  const timed = createTelegramTransport(
    transportOptions(timeoutFetch, { requestTimeoutMs: 5 }),
  );
  await assert.rejects(
    timed.start(),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "timeout" &&
      !String(error).includes(TOKEN),
  );
  await timed.close();
});

test("cancelling an in-flight send reports an unknown remote effect", async () => {
  let sendStarted;
  const started = new Promise((resolve) => {
    sendStarted = resolve;
  });
  const fetch = sequenceFetch([
    success(botIdentity()),
    (_input, init) =>
      new Promise((_resolve, reject) => {
        sendStarted();
        init.signal.addEventListener(
          "abort",
          () =>
            reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      }),
  ]);
  const transport = createTelegramTransport(
    transportOptions(fetch),
  );
  await transport.start();
  const controller = new AbortController();
  const pending = transport.sendMessage(
    { chatId: "-10042", text: "answer" },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  await assert.rejects(
    pending,
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "aborted" &&
      error.effect === "unknown" &&
      error.retryable === false,
  );
  await transport.close();
});

function gatewayMessage() {
  return Object.freeze({
    chat: Object.freeze({
      id: "-10042",
      title: "Minke",
      type: "supergroup",
    }),
    content: Object.freeze({ kind: "text", text: "hello" }),
    conversationId: "telegram:chat:-10042:thread:900",
    createdAt: 1_723_456_789_000,
    id: "telegram:update:101",
    isTopicMessage: true,
    messageId: "41",
    peerId: "-10042",
    sender: Object.freeze({
      firstName: "Ada",
      id: "77",
      isBot: false,
    }),
    senderId: "77",
    threadId: "900",
    updateId: "101",
    updateType: "message",
  });
}

function gatewayPreparation(overrides = {}) {
  return {
    accountKey: "telegram:123456789",
    generation: 1,
    operationId: "operation-1",
    outboxId: 1,
    payload: {
      chatId: "@must_be_ignored",
      kind: "text",
      messageThreadId: 900,
      replyToMessageId: 41,
      text: "answer",
    },
    recipientId: "-10042",
    ...overrides,
  };
}

function gatewayAttempt(preparedPayload) {
  return {
    accountKey: "telegram:123456789",
    attemptNumber: 1,
    attemptToken: "attempt-1",
    generation: 1,
    operationId: "operation-1",
    outboxId: 1,
    preparedPayload,
    recipientId: "-10042",
  };
}

test("Gateway provider preserves Telegram payloads and binds prepared delivery to the outbox recipient", async () => {
  const message = gatewayMessage();
  const sends = [];
  const transport = {
    identity: botIdentity({ id: "123456789" }),
    async close() {},
    async getMe() {
      return this.identity;
    },
    async receive(checkpoint) {
      return {
        fromCheckpoint: checkpoint,
        messages: [message],
        nextCheckpoint: "102",
        suggestedPollTimeoutMs: 2_000,
      };
    },
    async send(intent) {
      sends.push(intent);
      return {
        chatId: intent.chatId,
        messageId: "777",
        occurredAt: 1_723_456_789_000,
      };
    },
    async start() {},
  };
  const provider = createTelegramGatewayProvider({
    accountKey: telegramAccountKey("123456789"),
    generation: 1,
    transport,
  });
  assert.deepEqual(provider.account, {
    accountKey: "telegram:123456789",
    generation: 1,
    provider: "telegram",
    providerAccountId: "123456789",
    requiresDeliveryContext: false,
  });
  assert.deepEqual(await provider.receive("100"), {
    accountKey: "telegram:123456789",
    events: [
      {
        conversationId: message.conversationId,
        kind: "user-message",
        nativeId: message.id,
        occurredAt: message.createdAt,
        payload: message,
        peerId: message.peerId,
        senderId: message.senderId,
      },
    ],
    fromCheckpoint: "100",
    generation: 1,
    nextCheckpoint: "102",
  });

  const preparation = await provider.prepare(
    gatewayPreparation(),
  );
  assert.equal(preparation.status, "ready");
  assert.equal(
    preparation.preparedPayload.intent.chatId,
    "-10042",
  );
  assert.equal(
    preparation.preparedPayload.intent.messageThreadId,
    900,
  );
  assert.equal(
    preparation.preparedPayload.intent.replyToMessageId,
    41,
  );
  assert.deepEqual(
    await provider.deliver(
      gatewayAttempt(preparation.preparedPayload),
    ),
    {
      providerReceiptId: "-10042:777",
      status: "accepted",
    },
  );
  assert.equal(sends.length, 1);
  assert.equal(sends[0].chatId, "-10042");

  const misbound = {
    ...preparation.preparedPayload,
    recipientId: "-10099",
  };
  assert.deepEqual(
    await deliverTelegramAttempt(
      transport,
      gatewayAttempt(misbound),
    ),
    {
      errorCode: "invalid-intent",
      status: "rejected",
    },
  );
  assert.equal(sends.length, 1);
});

test("Gateway delivery maps rate limits, credentials, cancellation, and ambiguous remote effects conservatively", async () => {
  const preparation = await prepareTelegramDelivery(
    gatewayPreparation(),
  );
  assert.equal(preparation.status, "ready");
  const attempt = gatewayAttempt(preparation.preparedPayload);

  const cases = [
    {
      error: new TelegramTransportError(
        "rate-limited",
        "limited",
        { retryAfterMs: 4_000, retryable: true },
      ),
      expected: {
        errorCode: "rate-limited",
        retryAfterMs: 4_000,
        status: "retry",
      },
    },
    {
      error: new TelegramTransportError(
        "credential-invalid",
        "invalid",
      ),
      expected: {
        errorCode: "credential-invalid",
        status: "rejected",
        terminal: "credential-invalid",
      },
    },
    {
      error: new TelegramTransportError(
        "aborted",
        "aborted",
      ),
      expected: {
        reasonCode: "aborted",
        status: "deferred",
      },
    },
    {
      error: new TelegramTransportError(
        "network",
        "unknown",
        { effect: "unknown" },
      ),
      expected: {
        errorCode: "network",
        status: "uncertain",
      },
    },
  ];
  for (const { error, expected } of cases) {
    assert.deepEqual(
      await deliverTelegramAttempt(
        {
          async send() {
            throw error;
          },
        },
        attempt,
      ),
      expected,
    );
  }
});

test("Gateway provider creation refuses an unvalidated transport identity", () => {
  assert.throws(
    () =>
      createTelegramGatewayProvider({
        accountKey: "telegram:123456789",
        generation: 1,
        transport: { identity: undefined },
      }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-state",
  );
});

test("Gateway provider rejects a durable account key for another Telegram bot", () => {
  assert.equal(
    telegramAccountKey("123456789"),
    "telegram:123456789",
  );
  assert.throws(
    () =>
      createTelegramGatewayProvider({
        accountKey: "telegram:987654321",
        generation: 1,
        transport: {
          identity: {
            firstName: "Minke",
            id: "123456789",
          },
        },
      }),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
  assert.throws(
    () => telegramAccountKey("../not-a-bot"),
    (error) =>
      error instanceof TelegramTransportError &&
      error.code === "invalid-config",
  );
});
