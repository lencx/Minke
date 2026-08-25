import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_WEIXIN_QR_CONTENT_BYTES,
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  WEIXIN_MAX_QR_CONTENT_BYTES,
  WeixinTransportError,
} from "@lencx/minke-im-weixin";
import {
  prepareDiscordPayload,
} from "@lencx/minke-im-discord";
import {
  WeixinCapabilityRuntime,
} from "@minke/desktop/main/remote-hub/weixin-runtime.ts";
import {
  RemoteHubCredentialVault,
} from "@minke/desktop/main/remote-hub/credential-vault.ts";
import {
  BotCapabilityRuntime,
} from "@minke/desktop/main/remote-hub/bot-runtime.ts";
import {
  createGatewayMailboxRecovery,
} from "@minke/desktop/main/remote-hub/mailbox-recovery.ts";
import {
  createDiscordBotDriver,
  createTelegramBotDriver,
  RemoteHubCapabilityRuntime,
} from "@minke/desktop/main/remote-hub/runtime.ts";
import {
  externalizeAgentTurnPreviews,
} from "@minke/desktop/main/remote-hub/agent-preview.ts";
import {
  bindRemoteHubIpc,
} from "@minke/desktop/main/remote-hub/ipc.ts";
import {
  REMOTE_HUB_COMMAND_CHANNEL,
  REMOTE_HUB_READ_CHANNEL,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  remoteHubEn,
} from "@minke/harness-overlay/client/remote-hub/locales.ts";
import {
  RemoteHubRuntime,
} from "@minke/harness-overlay/client/remote-hub/runtime.ts";
import {
  NewSessionRemoteHubAction,
  RemoteHubAction,
  RemoteHubDialogHost,
} from "@minke/harness-overlay/client/remote-hub/view.tsx";
import {
  remoteEn,
} from "@minke/harness-overlay/client/remote/locales.ts";
import {
  RemoteSettingsRuntime,
} from "@minke/harness-overlay/client/remote/runtime.ts";
import {
  inspectCssContract,
} from "./support/css-contract.mjs";

function snapshot(weixin = { state: "unlinked" }) {
  return {
    revision: 3,
    telegramNetwork: {
      httpProxyUrl: "",
    },
    discordNetwork: {
      httpProxyUrl: "",
      proxySource: "pending",
    },
    dependencies: {
      credentialVault: "ready",
      agentRoute: "pending",
    },
    channels: {
      weixin,
      telegram: { state: "unlinked" },
      discord: { state: "unlinked" },
    },
  };
}

function withoutActivity(value) {
  const { activity: _activity, ...snapshotValue } = value;
  return snapshotValue;
}

function telegramDirectMessageInput() {
  const conversationId = "telegram:chat:owner-user";
  const nativeId = "telegram:update:42";
  return {
    conversationId,
    kind: "user-message",
    nativeId,
    payload: {
      chat: {
        firstName: "Ada",
        id: "owner-user",
        type: "private",
        username: "owner",
      },
      content: {
        kind: "text",
        text: "hello from Telegram",
      },
      conversationId,
      createdAt: 1_800_000_000_000,
      id: nativeId,
      isTopicMessage: false,
      messageId: "7",
      peerId: "owner-user",
      sender: {
        firstName: "Ada",
        id: "owner-user",
        isBot: false,
        lastName: "Lovelace",
        username: "owner",
      },
      senderId: "owner-user",
      updateId: "42",
      updateType: "message",
    },
    peerId: "owner-user",
    senderId: "owner-user",
  };
}

function discordDirectMessageInput() {
  const channelId = "400000000000000001";
  const messageId = "600000000000000001";
  const senderId = "300000000000000001";
  return {
    conversationId: channelId,
    kind: "user-message",
    nativeId: messageId,
    payload: {
      attachments: [],
      author: {
        bot: false,
        discriminator: "0",
        globalName: "Ada Lovelace",
        id: senderId,
        username: "ada",
      },
      channelId,
      content: "hello from Discord",
      context: {
        channelId,
        kind: "direct",
      },
      embeds: [],
      flags: 0,
      id: messageId,
      mentionedUserIds: [],
      messageType: 0,
      timestamp: 1_800_000_000_000,
    },
    peerId: channelId,
    senderId,
  };
}

function discordGuildMessageInput(options = {}) {
  const botId =
    options.botId ?? "100000000000000001";
  const channelId =
    options.channelId ?? "400000000000000002";
  const guildId =
    options.guildId ?? "500000000000000001";
  const messageId =
    options.messageId ?? "600000000000000002";
  const senderId =
    options.senderId ?? "300000000000000001";
  const mentionedUserIds =
    options.mentionedUserIds ?? [botId];
  const replyAuthorId = options.replyAuthorId;
  return {
    conversationId: channelId,
    kind: "user-message",
    nativeId: messageId,
    payload: {
      attachments: [],
      author: {
        bot: false,
        discriminator: "0",
        globalName: "Ada Lovelace",
        id: senderId,
        username: "ada",
      },
      channelId,
      content:
        options.content ?? `<@${botId}> server status`,
      context: {
        channelId,
        guildId,
        kind: options.contextKind ?? "guild-channel",
        ...(options.contextKind === "guild-thread"
          ? {
              parentChannelId: "700000000000000001",
              threadType: 11,
            }
          : {}),
      },
      embeds: [],
      flags: 0,
      guildId,
      id: messageId,
      mentionedUserIds,
      messageType: options.messageType ?? 0,
      ...(replyAuthorId === undefined
        ? {}
        : {
            reply: {
              authorId: replyAuthorId,
              channelId,
              guildId,
              messageId: "600000000000000000",
            },
          }),
      timestamp: 1_800_000_000_000,
    },
    peerId: channelId,
    senderId,
  };
}

test("Discord driver recognizes only internally consistent direct user messages", () => {
  const inspect = createDiscordBotDriver().inspectMessage;
  assert.equal(typeof inspect, "function");
  const direct = discordDirectMessageInput();
  assert.deepEqual(
    inspect(direct, {
      providerAccountId: "100000000000000001",
    }),
    {
      conversationKind: "direct",
      senderLabel: "Ada Lovelace (@ada)",
      text: "hello from Discord",
    },
  );
  assert.equal(
    inspect(
      {
        ...direct,
        payload: {
          ...direct.payload,
          context: {
            channelId: direct.peerId,
            guildId: "500000000000000001",
            kind: "guild-channel",
          },
        },
      },
      {
        providerAccountId: "100000000000000001",
      },
    ),
    undefined,
  );
});

test("Discord driver gates server messages on a bot mention or reply and removes the trigger mention", () => {
  const botId = "100000000000000001";
  const driver = createDiscordBotDriver();
  const inspect = driver.inspectMessage;
  assert.equal(typeof inspect, "function");

  const mentioned = discordGuildMessageInput({ botId });
  assert.deepEqual(
    inspect(mentioned, { providerAccountId: botId }),
    {
      conversationKind: "group",
      senderLabel: "Ada Lovelace (@ada)",
      text: "server status",
    },
  );

  const reply = discordGuildMessageInput({
    botId,
    content: "continue in this thread",
    mentionedUserIds: [],
    replyAuthorId: botId,
  });
  assert.deepEqual(
    inspect(reply, { providerAccountId: botId }),
    {
      conversationKind: "group",
      senderLabel: "Ada Lovelace (@ada)",
      text: "continue in this thread",
    },
  );

  assert.equal(
    inspect(
      discordGuildMessageInput({
        botId,
        content: "ordinary server chatter",
        mentionedUserIds: [],
      }),
      { providerAccountId: botId },
    ),
    undefined,
  );
  assert.equal(
    inspect(
      discordGuildMessageInput({
        botId,
        messageType: 7,
      }),
      { providerAccountId: botId },
    ),
    undefined,
  );
});

test("Discord driver preserves Agent markdown for provider-owned chunking", () => {
  const botId = "100000000000000001";
  const input = discordGuildMessageInput({ botId });
  const driver = createDiscordBotDriver();
  const message = driver.inspectMessage(input, {
    providerAccountId: botId,
  });
  assert.ok(message);
  const longReply = "x".repeat(2_100);
  const delivery = {
    accountKey: `discord:${botId}`,
    generation: 1,
    operationId: "discord-long-agent-reply",
    outboxId: 1,
    recipientId: input.peerId,
  };

  const payload = driver.agentReplyPayload(longReply, {
    input,
    message,
  });
  assert.equal(payload.text, longReply);
  assert.doesNotThrow(() =>
    prepareDiscordPayload({
      ...delivery,
      payload,
    })
  );
});

test("Telegram driver uses the injected desktop network stack throughout startup", async () => {
  const token = "123456789:telegram-private-token-value";
  const requests = [];
  const fetch = async (input, init) => {
    requests.push({
      method: init?.method,
      url: String(input),
    });
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          first_name: "Minke",
          id: 123456789,
          is_bot: true,
          username: "minke_test_bot",
        },
      }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    );
  };
  const driver = createTelegramBotDriver({ fetch });
  const signal = AbortSignal.timeout(100);

  const identity = await driver.validate(token, { signal });
  const provider = await driver.createProvider({
    accountKey: "telegram:123456789",
    generation: 1,
    identity,
    signal,
    token,
  });
  await provider.start({ signal });

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["POST", "POST", "POST"],
  );
  assert.equal(
    requests.every(({ url }) =>
      url.startsWith(
        "https://api.telegram.org/bot123456789:",
      )
    ),
    true,
  );
  await provider.close();
});

test("Telegram direct-message inspection rejects groups, bots, and forged event relationships", () => {
  const inspect =
    createTelegramBotDriver().inspectMessage;
  assert.equal(typeof inspect, "function");
  const valid = telegramDirectMessageInput();

  assert.deepEqual(
    inspect(valid, {
      providerAccountId: "123456789",
    }),
    {
      conversationKind: "direct",
      senderLabel: "@owner",
      text: "hello from Telegram",
    },
  );

  const violatingInputs = [
    ["non-message event", (input) => {
      input.kind = "system";
    }],
    ["group chat", (input) => {
      input.payload.chat.type = "supergroup";
    }],
    ["bot sender", (input) => {
      input.payload.sender.isBot = true;
    }],
    ["forged chat peer", (input) => {
      input.payload.chat.id = "other-chat";
    }],
    ["forged payload peer", (input) => {
      input.payload.peerId = "other-chat";
    }],
    ["forged sender", (input) => {
      input.payload.sender.id = "other-user";
    }],
    ["forged payload sender", (input) => {
      input.payload.senderId = "other-user";
    }],
    ["forged conversation", (input) => {
      input.payload.conversationId =
        "telegram:chat:other-user";
    }],
    ["forged native id", (input) => {
      input.payload.id = "telegram:update:999";
    }],
    ["edited message", (input) => {
      input.payload.updateType = "edited-message";
    }],
  ];
  for (const [label, violate] of violatingInputs) {
    const input = structuredClone(valid);
    violate(input);
    assert.equal(
      inspect(input, {
        providerAccountId: "123456789",
      }),
      undefined,
      label,
    );
  }
});

test("Agent preview routes become links only on stable remote origins", () => {
  const result = {
    outcome: "completed",
    sessionId: "minke-im-weixin-preview",
    text: "Built it.",
    turn: 1,
    endReason: "completed",
    previews: [{
      title: "demo.html",
      route: "/minke-preview/abcdefghijklmnopqrstuv/",
    }],
  };
  assert.deepEqual(
    externalizeAgentTurnPreviews(result, {
      method: "tailscale",
      transport: "serve",
      state: "active",
      url: "https://minke.tailnet.ts.net",
    }),
    {
      ...result,
      previews: [{
        title: "demo.html",
        url:
          "https://minke.tailnet.ts.net/minke-preview/abcdefghijklmnopqrstuv/",
      }],
    },
  );
  assert.deepEqual(
    externalizeAgentTurnPreviews(result, {
      method: "cloudflare",
      transport: "access",
      state: "active",
      url: "https://minke.example.com/",
    }).previews,
    [{
      title: "demo.html",
      url:
        "https://minke.example.com/minke-preview/abcdefghijklmnopqrstuv/",
    }],
  );
  assert.equal(
    Object.hasOwn(
      externalizeAgentTurnPreviews(result, {
        method: "tailscale",
        transport: "direct",
        state: "active",
        url: "http://100.64.0.1:49123",
      }),
      "previews",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      externalizeAgentTurnPreviews(result, {
        method: "tailscale",
        transport: "serve",
        state: "ready",
      }),
      "previews",
    ),
    false,
  );
});

test("Remote Hub contract keeps QR payload transient and rejects secret fields", () => {
  assert.equal(
    MAX_WEIXIN_QR_CONTENT_BYTES,
    WEIXIN_MAX_QR_CONTENT_BYTES,
  );
  const linking = snapshot({
    state: "linking",
    flowId: "flow-1",
    phase: "verification-required",
    challenge: {
      content: "https://weixin.qq.com/x/opaque",
      expiresAt: Date.now() + 60_000,
    },
  });
  assert.deepEqual(parseRemoteHubSnapshot(linking), linking);
  assert.throws(
    () =>
      parseRemoteHubSnapshot({
        ...linking,
        channels: {
          ...linking.channels,
          weixin: {
            ...linking.channels.weixin,
            token: "must-not-cross-preload",
          },
        },
      }),
    /unexpected fields/u,
  );
  assert.throws(
    () =>
      parseRemoteHubSnapshot(
        snapshot({
          state: "linking",
          flowId: "flow-1",
          phase: "waiting",
          challenge: {
            content: "x".repeat(
              MAX_WEIXIN_QR_CONTENT_BYTES + 1,
            ),
            expiresAt: Date.now() + 60_000,
          },
        }),
      ),
    /QR content/u,
  );
  assert.throws(
    () =>
      parseRemoteHubSnapshot(
        snapshot({
          state: "linking",
          flowId: "flow-1",
          phase: "waiting",
          challenge: {
            content: "微".repeat(700),
            expiresAt: Date.now() + 60_000,
          },
        }),
      ),
    /QR content/u,
  );
});

test("Remote Hub connection activity exposes only bounded session metadata", () => {
  const value = snapshot({
    state: "connected",
    accountLabel: "•• 931D53",
    activity: {
      connectedAt: 1_800_000_000_000,
      lastActivityAt: 1_800_000_060_000,
      receivedMessages: 12,
      sentMessages: 9,
    },
  });
  value.channels.telegram = {
    state: "disconnected",
    accountLabel: "@minke_bot",
  };
  assert.deepEqual(parseRemoteHubSnapshot(value), value);

  const invalid = structuredClone(value);
  invalid.channels.weixin.activity.receivedMessages = -1;
  assert.throws(
    () => parseRemoteHubSnapshot(invalid),
    /received message count/u,
  );
  const secret = structuredClone(value);
  secret.channels.weixin.activity.token = "must-not-cross-preload";
  assert.throws(
    () => parseRemoteHubSnapshot(secret),
    /unexpected fields/u,
  );
});

test("Remote Hub commands are finite and validate verification input", () => {
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "gateway/reset-local",
    }),
    { kind: "gateway/reset-local" },
  );
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "weixin/reset-local",
    }),
    { kind: "weixin/reset-local" },
  );
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "weixin/link/verify",
      flowId: "flow-1",
      code: "123456",
    }),
    {
      kind: "weixin/link/verify",
      flowId: "flow-1",
      code: "123456",
    },
  );
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "weixin/link/verify",
        flowId: "flow-1",
        code: "12 34",
      }),
    /verification code/u,
  );
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "weixin/link/start",
        token: "must-not-be-accepted",
      }),
    /unexpected fields/u,
  );
  const telegramToken =
    "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "telegram/connect",
      token: telegramToken,
    }),
    {
      kind: "telegram/connect",
      token: telegramToken,
    },
  );
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "telegram/network/set",
      settings: {
        httpProxyUrl: "http://LOCALHOST:7897",
      },
    }),
    {
      kind: "telegram/network/set",
      settings: {
        httpProxyUrl: "http://localhost:7897",
      },
    },
  );
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "discord/network/set",
      settings: {
        httpProxyUrl: "http://LOCALHOST:7897",
      },
    }),
    {
      kind: "discord/network/set",
      settings: {
        httpProxyUrl: "http://localhost:7897",
      },
    },
  );
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "telegram/network/set",
        settings: {
          httpProxyUrl:
            "http://username:password@localhost:7897",
        },
      }),
    /unauthenticated/u,
  );
  for (const kind of [
    "bot/pairing/approve",
    "bot/pairing/dismiss",
  ]) {
    for (const provider of ["telegram", "discord"]) {
      assert.deepEqual(
        parseRemoteHubCommand({
          kind,
          provider,
          requestId: "pairing-request-1",
        }),
        {
          kind,
          provider,
          requestId: "pairing-request-1",
        },
      );
    }
  }
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "bot/pairing/approve",
        provider: "discord",
        requestId: "",
      }),
    /pairing request id/u,
  );
  assert.deepEqual(
    parseRemoteHubCommand({
      kind: "discord/unlink",
    }),
    { kind: "discord/unlink" },
  );
  for (const kind of [
    "telegram/disconnect",
    "telegram/token/copy",
    "discord/disconnect",
    "discord/token/copy",
  ]) {
    assert.deepEqual(
      parseRemoteHubCommand({ kind }),
      { kind },
    );
  }
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "telegram/token/copy",
        token: telegramToken,
      }),
    /unexpected fields/u,
  );
  assert.throws(
    () =>
      parseRemoteHubCommand({
        kind: "discord/connect",
        token: "contains whitespace and must fail",
      }),
    /Discord bot token/u,
  );
});

test("Remote Hub bot snapshots expose identity but reject credentials", () => {
  const value = snapshot();
  value.channels.telegram = {
    state: "error",
    hasStoredCredential: true,
    issue: "polling-conflict",
  };
  value.channels.discord = {
    state: "error",
    hasStoredCredential: true,
    issue: "privileged-intent",
  };
  assert.deepEqual(parseRemoteHubSnapshot(value), value);
  assert.throws(
    () =>
      parseRemoteHubSnapshot({
        ...value,
        channels: {
          ...value.channels,
          telegram: {
            ...value.channels.telegram,
            token: "must-never-cross-preload",
          },
        },
      }),
    /unexpected fields/u,
  );
});

test("Remote Hub contract exposes a ready Agent route and connected Weixin channel", () => {
  const value = snapshot({
    state: "connected",
    accountLabel: "Weixin account",
  });
  value.dependencies.agentRoute = "ready";

  assert.deepEqual(parseRemoteHubSnapshot(value), value);
});

test("Remote Hub IPC authorizes both reads and finite commands", async () => {
  const handlers = new Map();
  const commands = [];
  const ipc = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
  const current = snapshot();
  const binding = bindRemoteHubIpc(
    ipc,
    {
      getSnapshot() {
        return current;
      },
      async dispatch(command) {
        commands.push(command);
        return current;
      },
      subscribe() {
        return () => {};
      },
    },
    () => {},
    (event) => event === "authorized",
  );
  assert.throws(
    () => handlers.get(REMOTE_HUB_READ_CHANNEL)("foreign"),
    /unauthorized/u,
  );
  await assert.rejects(
    handlers.get(REMOTE_HUB_COMMAND_CHANNEL)(
      "foreign",
      { kind: "telegram/token/copy" },
    ),
    /unauthorized/u,
  );
  await assert.rejects(
    handlers.get(REMOTE_HUB_COMMAND_CHANNEL)(
      "authorized",
      {
        kind: "weixin/link/start",
        token: "not-accepted",
      },
    ),
    /unexpected fields/u,
  );
  assert.deepEqual(
    await handlers.get(REMOTE_HUB_COMMAND_CHANNEL)(
      "authorized",
      { kind: "discord/token/copy" },
    ),
    current,
  );
  assert.deepEqual(commands, [
    { kind: "discord/token/copy" },
  ]);
  binding.dispose();
  assert.equal(handlers.size, 0);
});

function waitForSnapshot(runtime, predicate) {
  const current = runtime.getSnapshot();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for Remote Hub snapshot"));
    }, 2_000);
    const unsubscribe = runtime.subscribe(() => {
      const next = runtime.getSnapshot();
      if (!predicate(next)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolvePromise(next);
    });
  });
}

function abortableWait(signal) {
  return new Promise((resolvePromise, reject) => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function waitForCondition(
  predicate,
  label = "condition",
) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolvePromise) => {
      setImmediate(resolvePromise);
    });
  }
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function assertFailClosedIngressPolicy(ingressPolicy) {
  assert.equal(typeof ingressPolicy, "function");
  assert.equal(
    ingressPolicy({
      account: {},
      event: { kind: "user-message" },
    }),
    false,
  );
  assert.equal(
    ingressPolicy({
      account: {},
      event: { kind: "bot-echo" },
    }),
    true,
  );
}

function stalledBotPoll({ ingressPolicy, signal }) {
  assertFailClosedIngressPolicy(ingressPolicy);
  return new Promise((resolvePromise) => {
    if (signal.aborted) {
      resolvePromise();
      return;
    }
    signal.addEventListener(
      "abort",
      () => resolvePromise(),
      { once: true },
    );
  });
}

function transactionalBotHarness(options = {}) {
  const providerName = options.provider ?? "telegram";
  const state = {
    deletes: 0,
    mailboxes: [],
    providers: [],
    stored: options.stored,
    writes: [],
  };
  const cipher = {
    open(value) {
      return value;
    },
    seal(value) {
      return value;
    },
  };
  const runtime = new BotCapabilityRuntime({
    mailboxPath: "/tmp/minke-transactional-bot-test.sqlite",
    vault: {
      available: true,
      async readBot() {
        return state.stored;
      },
      async writeBot(_provider, value) {
        state.writes.push(value);
        if (options.writeBot !== undefined) {
          await options.writeBot(value, state);
          return;
        }
        state.stored = value;
      },
      async deleteBot() {
        state.deletes += 1;
        if (options.deleteBot !== undefined) {
          await options.deleteBot(state);
          return;
        }
        state.stored = undefined;
      },
      gatewayCipher() {
        return cipher;
      },
    },
    driver: {
      provider: providerName,
      agentReplyPayload: options.agentReplyPayload,
      candidateHealthIssue(provider) {
        return options.candidateHealthIssue?.(
          provider,
          state,
        );
      },
      async validate(token) {
        if (options.validate !== undefined) {
          return await options.validate(token);
        }
        return {
          id: "transactional-bot-id",
          label: `@${token.slice(0, 8)}`,
        };
      },
      identityId(identity) {
        return identity.id;
      },
      identityLabel(identity) {
        return identity.label;
      },
      isAborted(_error, signal) {
        return signal.aborted;
      },
      issue(error) {
        return error?.code ?? "transport-start";
      },
      async createProvider(input) {
        const record = {
          closes: 0,
          input,
          provider: undefined,
          starts: 0,
        };
        state.providers.push(record);
        const provider = {
          account: {
            accountKey: input.accountKey,
            generation: input.generation,
            provider: providerName,
            providerAccountId: input.identity.id,
            requiresDeliveryContext: false,
          },
          async start() {
            record.starts += 1;
            await options.startProvider?.(input, record);
          },
          async close() {
            record.closes += 1;
          },
          async receive() {
            throw new Error("injected poll owns receive");
          },
          async prepare() {
            throw new Error("not exercised");
          },
          async deliver() {
            throw new Error("not exercised");
          },
        };
        record.provider = provider;
        return provider;
      },
      inspectMessage: options.inspectMessage,
    },
    createMailbox() {
      const mailbox = {
        accounts: [],
        closes: 0,
        recoveries: 0,
        removals: 0,
        close() {
          this.closes += 1;
        },
        getAccountGeneration() {
          return options.durableGeneration;
        },
        inspectOutboxHealth() {
          return {
            accountKey:
              `${providerName}:transactional-bot-id`,
            awaitingDeliveryContext: 0,
            generation: 1,
            terminalFailures: 0,
            uncertain: 0,
          };
        },
        recover() {
          this.recoveries += 1;
          options.recoverMailbox?.(this);
        },
        registerAccount(account) {
          options.registerAccount?.(account, this);
          this.accounts.push(account);
        },
        removeProviderAccounts() {
          this.removals += 1;
          return 1;
        },
      };
      state.mailboxes.push(mailbox);
      return mailbox;
    },
    pollProviderOnce:
      options.pollProviderOnce ?? stalledBotPoll,
    routeInboxOnce: options.routeInboxOnce,
    dispatchProviderOnce: options.dispatchProviderOnce,
    agentRoute: options.agentRoute,
    now: options.now,
    createPairingCode: options.createPairingCode,
    createPairingRequestId:
      options.createPairingRequestId,
  });
  return { runtime, state };
}

test("an unknown Telegram DM creates a pairing reply and approval authorizes only its sender", async (t) => {
  const now = 1_800_000_000_000;
  const directMessage = telegramDirectMessageInput();
  const pairingCreated = deferred();
  const ingressDecision = deferred();
  const routeResult = deferred();
  const agentInputs = [];
  let routeCalls = 0;
  const telegramDriver = createTelegramBotDriver();
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@minke_dsh_bot",
      generation: 1,
      token: "123456789:telegram-private-token-value",
    },
    inspectMessage: telegramDriver.inspectMessage,
    agentReplyPayload:
      telegramDriver.agentReplyPayload,
    now: () => now,
    createPairingCode: () => "ABCDEFGH",
    createPairingRequestId: () =>
      "pairing-request-1",
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      ingressDecision.resolve(
        ingressPolicy({
          account: provider.account,
          event: directMessage,
        }),
      );
      pairingCreated.resolve();
      await abortableWait(signal);
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 1) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      await pairingCreated.promise;
      const result = await handler({
        account: {
          accountKey: "telegram:transactional-bot-id",
          generation: 1,
          provider: "telegram",
          providerAccountId: "transactional-bot-id",
          requiresDeliveryContext: false,
        },
        lease: {
          ...directMessage,
          accountKey: "telegram:transactional-bot-id",
          inboxId: 8,
          leaseToken: "lease-pairing",
        },
        operationId: "gateway-pairing-reply-1",
        signal,
      });
      routeResult.resolve(result);
      return {
        operationId: "gateway-pairing-reply-1",
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        agentInputs.push(input);
        throw new Error(
          "the unapproved pairing message must not reach Agent",
        );
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.equal(await ingressDecision.promise, true);
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "pairing",
    accountLabel: "@minke_dsh_bot",
    request: {
      code: "ABCDEFGH",
      expiresAt: now + 60 * 60 * 1_000,
      requestId: "pairing-request-1",
      senderLabel: "@owner",
    },
  });
  assert.deepEqual(await routeResult.promise, {
    status: "reply",
    payload: {
      kind: "text",
      text:
        "Minke 收到了你的 Telegram 私聊配对请求。\n"
        + "配对码：ABCDEFGH\n"
        + "请在 Minke 的「远端 → Telegram」中确认。"
        + "这条消息尚未交给 Agent。",
    },
  });
  assert.equal(agentInputs.length, 0);

  await runtime.approvePairing("pairing-request-1");
  assert.deepEqual(state.writes.at(-1), {
    accountId: "transactional-bot-id",
    accountLabel: "@minke_dsh_bot",
    authorizedUserId: "owner-user",
    generation: 1,
    token: "123456789:telegram-private-token-value",
  });
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "connected",
    accountLabel: "@minke_dsh_bot",
  });
});

test("an unknown Discord DM creates an approvable pairing request", async (t) => {
  const now = 1_800_000_000_000;
  const directMessage = discordDirectMessageInput();
  const pairingCreated = deferred();
  const ingressDecision = deferred();
  const routeResult = deferred();
  let routeCalls = 0;
  const discordDriver = createDiscordBotDriver();
  const { runtime, state } = transactionalBotHarness({
    provider: "discord",
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "Minke (@minke)",
      generation: 1,
      token: "discord-private-token-value-123456789",
    },
    inspectMessage: discordDriver.inspectMessage,
    now: () => now,
    createPairingCode: () => "ABCDEFGH",
    createPairingRequestId: () =>
      "discord-pairing-request-1",
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      ingressDecision.resolve(
        ingressPolicy({
          account: provider.account,
          event: directMessage,
        }),
      );
      pairingCreated.resolve();
      await abortableWait(signal);
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 1) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      await pairingCreated.promise;
      const result = await handler({
        account: {
          accountKey: "discord:transactional-bot-id",
          generation: 1,
          provider: "discord",
          providerAccountId: "transactional-bot-id",
          requiresDeliveryContext: false,
        },
        lease: {
          ...directMessage,
          accountKey: "discord:transactional-bot-id",
          inboxId: 9,
          leaseToken: "lease-discord-pairing",
        },
        operationId: "gateway-discord-pairing-reply-1",
        signal,
      });
      routeResult.resolve(result);
      return {
        operationId: "gateway-discord-pairing-reply-1",
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn() {
        throw new Error(
          "the unapproved Discord message must not reach Agent",
        );
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.equal(await ingressDecision.promise, true);
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "pairing",
    accountLabel: "Minke (@minke)",
    request: {
      code: "ABCDEFGH",
      expiresAt: now + 60 * 60 * 1_000,
      requestId: "discord-pairing-request-1",
      senderLabel: "Ada Lovelace (@ada)",
    },
  });
  assert.deepEqual(await routeResult.promise, {
    status: "reply",
    payload: {
      kind: "text",
      text:
        "Minke 收到了你的 Discord 私聊配对请求。\n"
        + "配对码：ABCDEFGH\n"
        + "请在 Minke 的「远端 → Discord」中确认。"
        + "这条消息尚未交给 Agent。",
    },
  });

  await runtime.approvePairing(
    "discord-pairing-request-1",
  );
  assert.equal(
    state.writes.at(-1).authorizedUserId,
    directMessage.senderId,
  );
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "connected",
    accountLabel: "Minke (@minke)",
  });
});

test("an unpaired Discord server mention cannot create an authorization request", async (t) => {
  const botId = "100000000000000001";
  const guildMessage = discordGuildMessageInput({ botId });
  const ingressDecision = deferred();
  const discordDriver = createDiscordBotDriver();
  const { runtime } = transactionalBotHarness({
    provider: "discord",
    stored: {
      accountId: botId,
      accountLabel: "Minke (@minke)",
      generation: 1,
      token: "discord-private-token-value-123456789",
    },
    validate: async () => ({
      id: botId,
      label: "Minke (@minke)",
    }),
    inspectMessage: discordDriver.inspectMessage,
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      ingressDecision.resolve(
        ingressPolicy({
          account: provider.account,
          event: guildMessage,
        }),
      );
      await abortableWait(signal);
    },
    async routeInboxOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    async dispatchProviderOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn() {
        throw new Error(
          "an unpaired server message must not reach Agent",
        );
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.equal(await ingressDecision.promise, false);
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "pairing",
    accountLabel: "Minke (@minke)",
  });
});

test("authorized Telegram DMs route through Agent and durable reply dispatch", async (t) => {
  const ingressDecision = deferred();
  const routeResult = deferred();
  const dispatchStarted = deferred();
  const agentInputs = [];
  let now = 1_800_000_000_000;
  let pollCalls = 0;
  let routeCalls = 0;
  let dispatchCalls = 0;
  const telegramDriver = createTelegramBotDriver();
  const { runtime } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@minke_dsh_bot",
      authorizedUserId: "owner-user",
      generation: 1,
      token: "123456789:telegram-private-token-value",
    },
    agentReplyPayload:
      telegramDriver.agentReplyPayload,
    inspectMessage(input) {
      const payload = input.payload;
      if (
        input.kind !== "user-message" ||
        payload?.chat?.type !== "private"
      ) {
        return undefined;
      }
      return {
        conversationKind: "direct",
        senderLabel: "@owner",
        text:
          payload.content?.kind === "text"
            ? payload.content.text
            : undefined,
      };
    },
    now: () => now,
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      pollCalls += 1;
      if (pollCalls === 1) {
        const accepted = ingressPolicy({
          account: provider.account,
          event: {
            conversationId: "telegram:chat:owner-user",
            kind: "user-message",
            nativeId: "telegram:update:42",
            payload: {
              chat: { type: "private" },
              content: {
                kind: "text",
                text: "hello from Telegram",
              },
            },
            peerId: "owner-user",
            senderId: "owner-user",
          },
        });
        ingressDecision.resolve(accepted);
        now += 1_000;
        return {
          admittedNativeIds: accepted
            ? ["telegram:update:42"]
            : [],
          confirmedOperationIds: [],
          nextCheckpoint: "42",
        };
      }
      if (pollCalls === 2) {
        now += 1_000;
        return {
          admittedNativeIds: [],
          confirmedOperationIds: ["gateway-reply-1"],
          nextCheckpoint: "43",
        };
      }
      await abortableWait(signal);
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 1) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      const result = await handler({
        account: {
          accountKey: "telegram:transactional-bot-id",
          generation: 1,
          provider: "telegram",
          providerAccountId: "transactional-bot-id",
          requiresDeliveryContext: false,
        },
        lease: {
          accountKey: "telegram:transactional-bot-id",
          conversationId: "telegram:chat:owner-user",
          inboxId: 7,
          kind: "user-message",
          leaseToken: "lease-1",
          nativeId: "telegram:update:42",
          payload: {
            chat: { type: "private" },
            content: {
              kind: "text",
              text: "hello from Telegram",
            },
          },
          peerId: "owner-user",
          senderId: "owner-user",
        },
        operationId: "gateway-reply-1",
        signal,
      });
      routeResult.resolve(result);
      return {
        operationId: "gateway-reply-1",
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      dispatchCalls += 1;
      if (dispatchCalls === 1) {
        dispatchStarted.resolve();
        now += 1_000;
        return {
          status: "settled",
          attempt: {
            operationId: "gateway-reply-1",
          },
          outcome: {
            status: "accepted",
          },
        };
      }
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        agentInputs.push(input);
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "# Minke reply\n\n**Ready**",
          turn: 1,
          endReason: "completed",
        };
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.equal(await ingressDecision.promise, true);
  await dispatchStarted.promise;
  assert.deepEqual(await routeResult.promise, {
    status: "reply",
    payload: {
      kind: "rich-markdown",
      markdown: "# Minke reply\n\n**Ready**",
    },
  });
  assert.equal(agentInputs.length, 1);
  assert.equal(agentInputs[0].operationId, "gateway-reply-1");
  assert.equal(agentInputs[0].text, "hello from Telegram");
  assert.match(
    agentInputs[0].sessionId,
    /^minke-im-telegram-[a-f0-9]{32}$/u,
  );
  await waitForCondition(
    () => {
      const activity = runtime.getSnapshot().activity;
      return (
        activity?.receivedMessages === 1 &&
        activity.sentMessages === 1
      );
    },
    "Telegram activity counters",
  );
  assert.deepEqual(runtime.getSnapshot().activity, {
    connectedAt: 1_800_000_000_000,
    lastActivityAt: now,
    receivedMessages: 1,
    sentMessages: 1,
  });
});

test("authorized Discord DMs route through Agent and durable reply dispatch", async (t) => {
  const directMessage = discordDirectMessageInput();
  const ingressDecision = deferred();
  const routeResult = deferred();
  const dispatchStarted = deferred();
  const agentInputs = [];
  let routeCalls = 0;
  const discordDriver = createDiscordBotDriver();
  const { runtime } = transactionalBotHarness({
    provider: "discord",
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "Minke (@minke)",
      authorizedUserId: directMessage.senderId,
      generation: 1,
      token: "discord-private-token-value-123456789",
    },
    inspectMessage: discordDriver.inspectMessage,
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      ingressDecision.resolve(
        ingressPolicy({
          account: provider.account,
          event: directMessage,
        }),
      );
      await abortableWait(signal);
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 1) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      const result = await handler({
        account: {
          accountKey: "discord:transactional-bot-id",
          generation: 1,
          provider: "discord",
          providerAccountId: "transactional-bot-id",
          requiresDeliveryContext: false,
        },
        lease: {
          ...directMessage,
          accountKey: "discord:transactional-bot-id",
          inboxId: 10,
          leaseToken: "lease-discord-agent",
        },
        operationId: "gateway-discord-reply-1",
        signal,
      });
      routeResult.resolve(result);
      return {
        operationId: "gateway-discord-reply-1",
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      dispatchStarted.resolve();
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        agentInputs.push(input);
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "**Discord ready**",
          turn: 1,
          endReason: "completed",
        };
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.equal(await ingressDecision.promise, true);
  await dispatchStarted.promise;
  assert.deepEqual(await routeResult.promise, {
    status: "reply",
    payload: {
      kind: "text",
      text: "**Discord ready**",
    },
  });
  assert.equal(agentInputs.length, 1);
  assert.equal(
    agentInputs[0].operationId,
    "gateway-discord-reply-1",
  );
  assert.equal(
    agentInputs[0].text,
    "hello from Discord",
  );
  assert.match(
    agentInputs[0].sessionId,
    /^minke-im-discord-[a-f0-9]{32}$/u,
  );
});

test("authorized Discord server mentions route in the channel and reply to the triggering message", async (t) => {
  const botId = "100000000000000001";
  const guildMessage = discordGuildMessageInput({ botId });
  const threadMessage = discordGuildMessageInput({
    botId,
    channelId: "400000000000000003",
    contextKind: "guild-thread",
    content: `<@${botId}> thread status`,
    messageId: "600000000000000005",
  });
  const ingressDecisions = deferred();
  const routeResults = deferred();
  const routedResults = [];
  const agentInputs = [];
  let routeCalls = 0;
  const discordDriver = createDiscordBotDriver();
  const inspectMessage = discordDriver.inspectMessage;
  const { runtime } = transactionalBotHarness({
    provider: "discord",
    stored: {
      accountId: botId,
      accountLabel: "Minke (@minke)",
      authorizedUserId: guildMessage.senderId,
      generation: 1,
      token: "discord-private-token-value-123456789",
    },
    validate: async () => ({
      id: botId,
      label: "Minke (@minke)",
    }),
    inspectMessage,
    agentReplyPayload: discordDriver.agentReplyPayload,
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      const unmentioned = discordGuildMessageInput({
        botId,
        content: "ordinary server chatter",
        messageId: "600000000000000003",
        mentionedUserIds: [],
      });
      const anotherUser = discordGuildMessageInput({
        botId,
        messageId: "600000000000000004",
        senderId: "300000000000000009",
      });
      ingressDecisions.resolve([
        ingressPolicy({
          account: provider.account,
          event: guildMessage,
        }),
        ingressPolicy({
          account: provider.account,
          event: threadMessage,
        }),
        ingressPolicy({
          account: provider.account,
          event: unmentioned,
        }),
        ingressPolicy({
          account: provider.account,
          event: anotherUser,
        }),
      ]);
      await abortableWait(signal);
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 2) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      const incoming =
        routeCalls === 1 ? guildMessage : threadMessage;
      const result = await handler({
        account: {
          accountKey: `discord:${botId}`,
          generation: 1,
          provider: "discord",
          providerAccountId: botId,
          requiresDeliveryContext: false,
        },
        lease: {
          ...incoming,
          accountKey: `discord:${botId}`,
          inboxId: 10 + routeCalls,
          leaseToken:
            `lease-discord-guild-agent-${routeCalls}`,
        },
        operationId:
          `gateway-discord-guild-reply-${routeCalls}`,
        signal,
      });
      routedResults.push(result);
      if (routedResults.length === 2) {
        routeResults.resolve(routedResults);
      }
      return {
        operationId:
          `gateway-discord-guild-reply-${routeCalls}`,
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        agentInputs.push(input);
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "x".repeat(2_100),
          turn: 1,
          endReason: "completed",
        };
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  assert.deepEqual(await ingressDecisions.promise, [
    true,
    true,
    false,
    false,
  ]);
  const routed = (await routeResults.promise)[0];
  assert.equal(routed.status, "reply");
  assert.equal(routed.payload.kind, "text");
  assert.equal(routed.payload.text, "x".repeat(2_100));
  assert.deepEqual(routed.payload.replyTo, {
    channelId: guildMessage.peerId,
    failIfNotExists: false,
    guildId: guildMessage.payload.guildId,
    messageId: guildMessage.nativeId,
  });
  assert.equal(agentInputs.length, 2);
  assert.equal(agentInputs[0].text, "server status");
  assert.equal(agentInputs[1].text, "thread status");
  assert.match(
    agentInputs[0].sessionId,
    /^minke-im-discord-[a-f0-9]{32}$/u,
  );
  assert.notEqual(
    agentInputs[0].sessionId,
    agentInputs[1].sessionId,
  );
});

test("disconnect preserves a bot token until an explicit clear and reconnect reuses it", async (t) => {
  const credential = {
    accountId: "transactional-bot-id",
    accountLabel: "@minke_dsh_bot",
    authorizedUserId: "owner-user",
    generation: 4,
    token: "123456789:telegram-private-token-value",
  };
  const activeOptions = {
    inspectMessage() {
      return {
        conversationKind: "direct",
        senderLabel: "@owner",
        text: "hello",
      };
    },
    async routeInboxOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    async dispatchProviderOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "ready",
          turn: 1,
          endReason: "completed",
        };
      },
    },
  };
  const first = transactionalBotHarness({
    ...activeOptions,
    stored: credential,
  });
  t.after(async () => {
    await first.runtime.dispose();
  });

  await first.runtime.initialize();
  assert.deepEqual(
    withoutActivity(first.runtime.getSnapshot()),
    {
      state: "connected",
      accountLabel: credential.accountLabel,
    },
  );

  await first.runtime.disconnect();
  assert.deepEqual(first.state.stored, {
    ...credential,
    connectionPaused: true,
  });
  assert.equal(first.state.deletes, 0);
  assert.equal(first.state.providers[0].closes, 1);
  assert.deepEqual(first.runtime.getSnapshot(), {
    state: "disconnected",
    accountLabel: credential.accountLabel,
  });
  assert.equal(
    JSON.stringify(first.runtime.getSnapshot()).includes(
      credential.token,
    ),
    false,
  );

  let validations = 0;
  const resumed = transactionalBotHarness({
    ...activeOptions,
    stored: first.state.stored,
    async validate(token) {
      validations += 1;
      assert.equal(token, credential.token);
      return {
        id: credential.accountId,
        label: credential.accountLabel,
      };
    },
  });
  t.after(async () => {
    await resumed.runtime.dispose();
  });

  await resumed.runtime.initialize();
  assert.deepEqual(resumed.runtime.getSnapshot(), {
    state: "disconnected",
    accountLabel: credential.accountLabel,
  });
  assert.equal(validations, 0);
  assert.equal(resumed.state.providers.length, 0);

  await resumed.runtime.refresh();
  assert.equal(validations, 0);
  assert.equal(resumed.state.providers.length, 0);
  assert.deepEqual(resumed.runtime.getSnapshot(), {
    state: "disconnected",
    accountLabel: credential.accountLabel,
  });

  await resumed.runtime.reconnect();
  assert.equal(validations, 1);
  assert.equal(
    resumed.state.providers[0].input.token,
    credential.token,
  );
  assert.deepEqual(resumed.state.stored, credential);
  assert.deepEqual(
    withoutActivity(resumed.runtime.getSnapshot()),
    {
      state: "connected",
      accountLabel: credential.accountLabel,
    },
  );

  await resumed.runtime.unlink();
  assert.equal(resumed.state.deletes, 1);
  assert.equal(resumed.state.stored, undefined);
  assert.deepEqual(resumed.runtime.getSnapshot(), {
    state: "unlinked",
  });
});

test("token bot runtime validates before persistence and fences generations", async () => {
  const token = "123456789:telegram-private-token-value";
  let stored = {
    accountId: "telegram-bot-id",
    accountLabel: "@old_bot",
    generation: 4,
    token: "123456789:old-private-token-value",
  };
  const writes = [];
  const snapshots = [];
  const providers = [];
  const mailboxes = [];
  const runtime = new BotCapabilityRuntime({
    mailboxPath: "/tmp/minke-bot-runtime-test.sqlite",
    vault: {
      available: true,
      async readBot(provider) {
        assert.equal(provider, "telegram");
        return stored;
      },
      async writeBot(provider, value) {
        assert.equal(provider, "telegram");
        writes.push(value);
        stored = value;
      },
      async deleteBot(provider) {
        assert.equal(provider, "telegram");
        stored = undefined;
      },
      gatewayCipher() {
        return {
          open(value) {
            return value;
          },
          seal(value) {
            return value;
          },
        };
      },
    },
    driver: {
      provider: "telegram",
      async validate(value, { signal }) {
        assert.equal(value, token);
        assert.equal(signal.aborted, false);
        return {
          id: "telegram-bot-id",
          label: "@minke_bot",
        };
      },
      identityId(identity) {
        return identity.id;
      },
      identityLabel(identity) {
        return identity.label;
      },
      isAborted(_error, signal) {
        return signal.aborted;
      },
      issue(error) {
        return error?.code === "credential-invalid"
          ? "credential-invalid"
          : "network";
      },
      async createProvider(input) {
        providers.push(input);
        return {
          account: {
            accountKey: input.accountKey,
            generation: input.generation,
            provider: "telegram",
            providerAccountId: input.identity.id,
            requiresDeliveryContext: false,
          },
          async start() {},
          async close() {},
          async receive() {
            throw new Error("injected poll owns receive");
          },
          async prepare() {
            throw new Error("not exercised");
          },
          async deliver() {
            throw new Error("not exercised");
          },
        };
      },
    },
    createMailbox() {
      const mailbox = {
        close() {},
        getAccountGeneration() {
          return 7;
        },
        recover() {},
        registerAccount(account) {
          this.account = account;
        },
        removeProviderAccounts() {
          return 1;
        },
      };
      mailboxes.push(mailbox);
      return mailbox;
    },
    pollProviderOnce: stalledBotPoll,
    onSnapshot(value) {
      snapshots.push(value);
    },
  });

  await runtime.connect(token);
  assert.deepEqual(writes, [{
    accountId: "telegram-bot-id",
    accountLabel: "@minke_bot",
    generation: 8,
    token,
  }]);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].generation, 8);
  assert.equal(providers[0].token, token);
  assert.equal(
    providers[0].accountKey,
    "telegram:telegram-bot-id",
  );
  assert.equal(mailboxes.at(-1).account.generation, 8);
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "degraded",
    accountLabel: "@minke_bot",
    issue: "agent-route-pending",
  });
  assert.equal(
    snapshots.some((value) =>
      JSON.stringify(value).includes(token)
    ),
    false,
  );

  await runtime.unlink();
  assert.equal(stored, undefined);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "unlinked",
  });
  await runtime.dispose();
});

test("token bot runtime never persists an invalid credential", async () => {
  let writes = 0;
  const runtime = new BotCapabilityRuntime({
    mailboxPath: "/tmp/minke-invalid-bot-runtime-test.sqlite",
    vault: {
      available: true,
      async readBot() {
        return undefined;
      },
      async writeBot() {
        writes += 1;
      },
      async deleteBot() {},
      gatewayCipher() {
        throw new Error("mailbox must not open");
      },
    },
    driver: {
      provider: "discord",
      async validate() {
        throw { code: "credential-invalid" };
      },
      identityId(identity) {
        return identity.id;
      },
      identityLabel(identity) {
        return identity.label;
      },
      isAborted(_error, signal) {
        return signal.aborted;
      },
      issue(error) {
        return error?.code === "credential-invalid"
          ? "credential-invalid"
          : "network";
      },
      async createProvider() {
        throw new Error("provider must not be created");
      },
    },
    createMailbox() {
      throw new Error("mailbox must not open");
    },
  });

  await runtime.connect(
    "discord-private-token-value-123456789",
  );
  assert.equal(writes, 0);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: false,
    issue: "credential-invalid",
  });
  await runtime.dispose();
});

test("an invalid replacement token leaves the active bot provider running", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:invalid-private-token-value";
  let stored = {
    accountId: "123456789",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  let closes = 0;
  const runtime = new BotCapabilityRuntime({
    mailboxPath: "/tmp/minke-active-bot-runtime-test.sqlite",
    vault: {
      available: true,
      async readBot() {
        return stored;
      },
      async writeBot(_provider, value) {
        stored = value;
      },
      async deleteBot() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          open(value) {
            return value;
          },
          seal(value) {
            return value;
          },
        };
      },
    },
    driver: {
      provider: "telegram",
      async validate(token) {
        if (token === replacementToken) {
          throw { code: "credential-invalid" };
        }
        assert.equal(token, oldToken);
        return {
          id: "123456789",
          label: "@active_bot",
        };
      },
      identityId(identity) {
        return identity.id;
      },
      identityLabel(identity) {
        return identity.label;
      },
      isAborted(_error, signal) {
        return signal.aborted;
      },
      issue(error) {
        return error?.code === "credential-invalid"
          ? "credential-invalid"
          : "network";
      },
      async createProvider(input) {
        return {
          account: {
            accountKey: input.accountKey,
            generation: input.generation,
            provider: "telegram",
            providerAccountId: input.identity.id,
            requiresDeliveryContext: false,
          },
          async start() {},
          async close() {
            closes += 1;
          },
          async receive() {
            throw new Error("injected poll owns receive");
          },
          async prepare() {
            throw new Error("not exercised");
          },
          async deliver() {
            throw new Error("not exercised");
          },
        };
      },
    },
    createMailbox() {
      return {
        close() {},
        getAccountGeneration() {
          return 1;
        },
        recover() {},
        registerAccount() {},
        removeProviderAccounts() {
          return 1;
        },
      };
    },
    pollProviderOnce: stalledBotPoll,
  });

  await runtime.initialize();
  assert.equal(closes, 0);
  await runtime.connect(replacementToken);
  assert.equal(closes, 0);
  assert.equal(stored.token, oldToken);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "credential-invalid",
  });
  await runtime.dispose();
  assert.equal(closes, 1);
});

test("a failed first connect restores the provider from cold-start storage", async () => {
  const oldToken =
    "123456789:stored-private-token-value";
  const invalidToken =
    "123456789:invalid-private-token-value";
  const coldValidationStarted = deferred();
  const releaseColdValidation = deferred();
  let oldValidations = 0;
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@active_bot",
      generation: 1,
      token: oldToken,
    },
    async validate(token) {
      if (token === invalidToken) {
        throw { code: "credential-invalid" };
      }
      oldValidations += 1;
      if (oldValidations === 1) {
        coldValidationStarted.resolve();
        await releaseColdValidation.promise;
      }
      return {
        id: "transactional-bot-id",
        label: "@active_bot",
      };
    },
  });

  const initialization = runtime.initialize();
  await coldValidationStarted.promise;
  await runtime.connect(invalidToken);

  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].closes, 0);
  assert.equal(state.stored.token, oldToken);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "credential-invalid",
  });

  releaseColdValidation.resolve();
  await initialization;
  await runtime.dispose();
  assert.equal(state.providers[0].closes, 1);
});

test("a failed reconnect leaves the stored provider running", async () => {
  const token = "123456789:active-private-token-value";
  let validations = 0;
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@active_bot",
      generation: 1,
      token,
    },
    async validate() {
      validations += 1;
      if (validations > 1) {
        throw { code: "credential-invalid" };
      }
      return {
        id: "transactional-bot-id",
        label: "@active_bot",
      };
    },
  });

  await runtime.initialize();
  const active = state.providers[0];
  await runtime.reconnect();

  assert.equal(active.closes, 0);
  assert.equal(state.providers.length, 1);
  assert.equal(state.stored.token, token);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "credential-invalid",
  });
  await runtime.dispose();
  assert.equal(active.closes, 1);
});

test("a replacement provider must reach READY before its credential commits", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    async startProvider(input) {
      if (input.token === replacementToken) {
        throw { code: "privileged-intent" };
      }
    },
  });

  await runtime.initialize();
  const active = state.providers[0];
  await runtime.connect(replacementToken);

  assert.deepEqual(state.stored, previous);
  assert.equal(state.writes.length, 0);
  assert.equal(active.closes, 0);
  assert.equal(state.providers[1].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "privileged-intent",
  });

  await runtime.dispose();
  assert.equal(active.closes, 1);
});

test("a failed credential commit rolls back and keeps the active provider", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  let rejectCandidate = true;
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    async writeBot(value, current) {
      current.stored = value;
      if (
        value.token === replacementToken &&
        rejectCandidate
      ) {
        rejectCandidate = false;
        throw new Error("credential commit failed");
      }
    },
  });

  await runtime.initialize();
  const active = state.providers[0];
  await runtime.connect(replacementToken);

  assert.deepEqual(state.stored, previous);
  assert.deepEqual(
    state.writes.map((value) => value.token),
    [replacementToken, oldToken],
  );
  assert.equal(active.closes, 0);
  assert.equal(state.providers[1].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "credential-store",
  });
  await runtime.dispose();
});

test("a mailbox registration failure rolls back the credential and keeps the active provider", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    registerAccount(account) {
      if (account.generation > previous.generation) {
        throw new Error("mailbox registration failed");
      }
    },
  });

  await runtime.initialize();
  const active = state.providers[0];
  await runtime.connect(replacementToken);

  assert.deepEqual(state.stored, previous);
  assert.deepEqual(
    state.writes.map((value) => value.token),
    [replacementToken, oldToken],
  );
  assert.equal(active.closes, 0);
  assert.equal(state.providers[1].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "gateway-store",
  });
  await runtime.dispose();
});

test("a candidate that turns fatal during credential commit cannot replace the active provider", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    candidateHealthIssue(provider, current) {
      return current.providers.find(
        (record) => record.provider === provider,
      )?.healthIssue;
    },
    async writeBot(value, current) {
      current.stored = value;
      if (value.token === replacementToken) {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
    },
  });

  await runtime.initialize();
  const active = state.providers[0];
  const connecting = runtime.connect(replacementToken);
  await writeStarted.promise;
  state.providers[1].healthIssue = "transport-fatal";
  releaseWrite.resolve();
  await connecting;

  assert.deepEqual(state.stored, previous);
  assert.equal(active.closes, 0);
  assert.equal(state.providers[1].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "transport-fatal",
  });
  await runtime.dispose();
});

test("a committed candidate that turns fatal during handoff never starts receiving", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const oldAborted = deferred();
  const releaseOldPoll = deferred();
  let candidatePolls = 0;
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@active_bot",
      generation: 1,
      token: oldToken,
    },
    candidateHealthIssue(provider, current) {
      return current.providers.find(
        (record) => record.provider === provider,
      )?.healthIssue;
    },
    async pollProviderOnce({ provider, signal }) {
      if (provider === state.providers[0]?.provider) {
        await new Promise((resolvePromise) => {
          signal.addEventListener(
            "abort",
            () => {
              oldAborted.resolve();
              resolvePromise();
            },
            { once: true },
          );
        });
        await releaseOldPoll.promise;
        return;
      }
      candidatePolls += 1;
      await abortableWait(signal);
    },
  });

  await runtime.initialize();
  const connecting = runtime.connect(replacementToken);
  await oldAborted.promise;
  state.providers[1].healthIssue = "transport-fatal";
  releaseOldPoll.resolve();
  await connecting;

  assert.equal(candidatePolls, 0);
  assert.equal(state.providers[0].closes, 1);
  assert.equal(state.providers[1].closes, 1);
  assert.equal(state.stored.token, replacementToken);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "transport-fatal",
  });
  await runtime.dispose();
});

test("replacement waits for the prior receive owner before polling", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  const candidatePolling = deferred();
  let oldPolling = false;
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      assertFailClosedIngressPolicy(ingressPolicy);
      if (provider.account.generation === 1) {
        oldPolling = true;
        await new Promise((resolvePromise) => {
          signal.addEventListener(
            "abort",
            () => {
              oldPolling = false;
              resolvePromise();
            },
            { once: true },
          );
        });
        return;
      }
      assert.equal(oldPolling, false);
      candidatePolling.resolve();
      await new Promise((resolvePromise) => {
        signal.addEventListener(
          "abort",
          resolvePromise,
          { once: true },
        );
      });
    },
  });

  await runtime.initialize();
  assert.equal(oldPolling, true);
  await runtime.connect(replacementToken);
  await candidatePolling.promise;

  assert.equal(state.stored.token, replacementToken);
  assert.equal(state.providers[0].closes, 1);
  assert.equal(state.providers[1].closes, 0);
  await runtime.dispose();
});

test("a new connection waits for every detached receive owner to drain", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const oldAborted = deferred();
  const releaseOldPoll = deferred();
  let candidatePolling = false;
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@active_bot",
      generation: 1,
      token: oldToken,
    },
    async pollProviderOnce({
      ingressPolicy,
      provider,
      signal,
    }) {
      assertFailClosedIngressPolicy(ingressPolicy);
      if (provider === state.providers[0]?.provider) {
        await new Promise((resolvePromise) => {
          signal.addEventListener(
            "abort",
            () => {
              oldAborted.resolve();
              resolvePromise();
            },
            { once: true },
          );
        });
        await releaseOldPoll.promise;
        return;
      }
      candidatePolling = true;
      await new Promise((resolvePromise) => {
        signal.addEventListener(
          "abort",
          resolvePromise,
          { once: true },
        );
      });
    },
  });

  await runtime.initialize();
  const unlinking = runtime.unlink();
  await oldAborted.promise;
  const connecting = runtime.connect(replacementToken);
  await new Promise((resolvePromise) => {
    setImmediate(resolvePromise);
  });
  assert.equal(candidatePolling, false);

  releaseOldPoll.resolve();
  await Promise.all([unlinking, connecting]);
  assert.equal(candidatePolling, true);
  await runtime.dispose();
});

test("unlink fences and removes a delayed candidate credential write", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let delayed = true;
  const { runtime, state } = transactionalBotHarness({
    async writeBot(value, current) {
      if (delayed) {
        delayed = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      current.stored = value;
    },
  });
  const token =
    "123456789:first-private-token-value";

  const connecting = runtime.connect(token);
  await writeStarted.promise;
  const unlinking = runtime.unlink();
  releaseWrite.resolve();
  await Promise.all([connecting, unlinking]);

  assert.equal(state.stored, undefined);
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "unlinked",
  });
  await runtime.dispose();
});

test("a failed newer connect preempts unlink without killing the restored provider", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const invalidToken =
    "123456789:invalid-private-token-value";
  const previous = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: oldToken,
  };
  const deleteStarted = deferred();
  const releaseDelete = deferred();
  let delayed = true;
  const { runtime, state } = transactionalBotHarness({
    stored: previous,
    async deleteBot(current) {
      if (delayed) {
        delayed = false;
        deleteStarted.resolve();
        await releaseDelete.promise;
      }
      current.stored = undefined;
    },
    async validate(token) {
      if (token === invalidToken) {
        throw { code: "credential-invalid" };
      }
      return {
        id: "transactional-bot-id",
        label: "@active_bot",
      };
    },
  });

  await runtime.initialize();
  const unlinking = runtime.unlink();
  await deleteStarted.promise;
  const connecting = runtime.connect(invalidToken);
  releaseDelete.resolve();
  await Promise.all([unlinking, connecting]);

  assert.deepEqual(state.stored, previous);
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].closes, 0);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue: "credential-invalid",
  });
  await runtime.dispose();
});

test("a newer connect cannot be overwritten by a delayed stale write", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let delayed = true;
  const { runtime, state } = transactionalBotHarness({
    async writeBot(value, current) {
      if (delayed) {
        delayed = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      current.stored = value;
    },
  });
  const firstToken =
    "123456789:first-private-token-value";
  const secondToken =
    "123456789:second-private-token-value";

  const firstConnect = runtime.connect(firstToken);
  await writeStarted.promise;
  const secondConnect = runtime.connect(secondToken);
  releaseWrite.resolve();
  await Promise.all([firstConnect, secondConnect]);

  assert.equal(state.stored.token, secondToken);
  assert.equal(state.providers.length, 2);
  assert.equal(state.providers[0].closes, 1);
  assert.equal(state.providers[1].closes, 0);
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "degraded",
    accountLabel: `@${secondToken.slice(0, 8)}`,
    issue: "agent-route-pending",
  });
  await runtime.dispose();
});

test("a failed newer connect does not revive a delayed stale credential", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let delayed = true;
  const firstToken =
    "123456789:first-private-token-value";
  const secondToken =
    "123456789:second-private-token-value";
  const { runtime, state } = transactionalBotHarness({
    async writeBot(value, current) {
      if (delayed) {
        delayed = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      current.stored = value;
    },
    async startProvider(input) {
      if (input.token === secondToken) {
        throw { code: "network" };
      }
    },
  });

  const firstConnect = runtime.connect(firstToken);
  await writeStarted.promise;
  const secondConnect = runtime.connect(secondToken);
  releaseWrite.resolve();
  await Promise.all([firstConnect, secondConnect]);

  assert.equal(state.stored, undefined);
  assert.equal(state.providers[0].closes, 1);
  assert.equal(state.providers[1].closes, 1);
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: false,
    issue: "network",
  });
  await runtime.dispose();
});

test("a newer connect fences reset before it removes the durable account", async () => {
  const oldToken =
    "123456789:old-private-token-value";
  const replacementToken =
    "123456789:replacement-private-token-value";
  const deleteStarted = deferred();
  const releaseDelete = deferred();
  let delayed = true;
  const { runtime, state } = transactionalBotHarness({
    stored: {
      accountId: "transactional-bot-id",
      accountLabel: "@active_bot",
      generation: 1,
      token: oldToken,
    },
    async deleteBot(current) {
      if (delayed) {
        delayed = false;
        deleteStarted.resolve();
        await releaseDelete.promise;
      }
      current.stored = undefined;
    },
  });

  await runtime.initialize();
  const resetting = runtime.resetLocal();
  await deleteStarted.promise;
  const connecting = runtime.connect(replacementToken);
  releaseDelete.resolve();
  await Promise.all([resetting, connecting]);

  assert.equal(state.stored.token, replacementToken);
  assert.equal(
    state.mailboxes.reduce(
      (count, mailbox) => count + mailbox.removals,
      0,
    ),
    0,
  );
  assert.deepEqual(withoutActivity(runtime.getSnapshot()), {
    state: "degraded",
    accountLabel: `@${replacementToken.slice(0, 8)}`,
    issue: "agent-route-pending",
  });
  await runtime.dispose();
});

test("dispose waits for and rolls back an in-flight credential write", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const { runtime, state } = transactionalBotHarness({
    async writeBot(value, current) {
      writeStarted.resolve();
      await releaseWrite.promise;
      current.stored = value;
    },
  });
  const connecting = runtime.connect(
    "123456789:first-private-token-value",
  );
  await writeStarted.promise;
  let disposed = false;
  const disposing = runtime.dispose().then(() => {
    disposed = true;
  });
  await new Promise((resolvePromise) => {
    setImmediate(resolvePromise);
  });
  assert.equal(disposed, false);

  releaseWrite.resolve();
  await Promise.all([connecting, disposing]);
  assert.equal(state.stored, undefined);
  assert.equal(disposed, true);
});

test("mailbox recovery runs once across bot reconnects by default", async () => {
  const stored = {
    accountId: "transactional-bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: "123456789:old-private-token-value",
  };
  let recoveries = 0;
  const { runtime } = transactionalBotHarness({
    stored,
    recoverMailbox() {
      recoveries += 1;
    },
  });

  await runtime.initialize();
  await runtime.reconnect();
  assert.equal(recoveries, 1);
  await runtime.dispose();
});

async function assertTerminalBotReceiveIssue(issue) {
  const stored = {
    accountId: "bot-id",
    accountLabel: "@active_bot",
    generation: 1,
    token: "private-bot-token-value-123456789",
  };
  let closes = 0;
  let mailboxCloses = 0;
  let polls = 0;
  let retries = 0;
  let resolveSurfaced;
  const surfaced = new Promise((resolvePromise) => {
    resolveSurfaced = resolvePromise;
  });
  const runtime = new BotCapabilityRuntime({
    mailboxPath: "/tmp/minke-terminal-bot-runtime-test.sqlite",
    vault: {
      available: true,
      async readBot() {
        return stored;
      },
      async writeBot() {},
      async deleteBot() {},
      gatewayCipher() {
        return {
          open(value) {
            return value;
          },
          seal(value) {
            return value;
          },
        };
      },
    },
    driver: {
      provider:
        issue === "polling-conflict"
          ? "telegram"
          : "discord",
      async validate() {
        return {
          id: stored.accountId,
          label: stored.accountLabel,
        };
      },
      identityId(identity) {
        return identity.id;
      },
      identityLabel(identity) {
        return identity.label;
      },
      isAborted(_error, signal) {
        return signal.aborted;
      },
      issue(error) {
        return error.code;
      },
      async createProvider(input) {
        return {
          account: {
            accountKey: input.accountKey,
            generation: input.generation,
            provider:
              issue === "polling-conflict"
                ? "telegram"
                : "discord",
            providerAccountId: input.identity.id,
            requiresDeliveryContext: false,
          },
          async start() {},
          async close() {
            closes += 1;
          },
          async receive() {
            throw new Error("injected poll owns receive");
          },
          async prepare() {
            throw new Error("not exercised");
          },
          async deliver() {
            throw new Error("not exercised");
          },
        };
      },
    },
    createMailbox() {
      return {
        close() {
          mailboxCloses += 1;
        },
        getAccountGeneration() {
          return 1;
        },
        recover() {},
        registerAccount() {},
        removeProviderAccounts() {
          return 1;
        },
      };
    },
    async pollProviderOnce() {
      polls += 1;
      throw { code: issue };
    },
    async waitBeforeRetry() {
      retries += 1;
    },
    onSnapshot(value) {
      if (
        value.state === "error" &&
        value.issue === issue
      ) {
        resolveSurfaced();
      }
    },
  });

  await runtime.initialize();
  await surfaced;
  assert.deepEqual(runtime.getSnapshot(), {
    state: "error",
    hasStoredCredential: true,
    issue,
  });
  assert.equal(polls, 1);
  assert.equal(retries, 0);
  assert.equal(closes, 1);
  assert.equal(mailboxCloses, 1);
  await runtime.dispose();
  assert.equal(closes, 1);
}

test("terminal bot receive failures stop instead of entering the generic retry loop", async () => {
  await assertTerminalBotReceiveIssue("polling-conflict");
  await assertTerminalBotReceiveIssue("privileged-intent");
  await assertTerminalBotReceiveIssue("transport-fatal");
});

function botRuntimeStub(initial) {
  let current = initial;
  const calls = [];
  return {
    calls,
    getSnapshot() {
      return current;
    },
    async initialize() {
      calls.push("initialize");
    },
    async connect(token) {
      calls.push(["connect", token]);
      current = {
        state: "degraded",
        accountLabel: "@connected_bot",
        issue: "agent-route-pending",
      };
    },
    async reconnect() {
      calls.push("reconnect");
      current = { state: "unlinked" };
    },
    async refresh() {
      calls.push("refresh");
      current = { state: "unlinked" };
    },
    async disconnect() {
      calls.push("disconnect");
      current = {
        state: "disconnected",
        accountLabel:
          current.accountLabel ?? "@connected_bot",
      };
    },
    async resetLocal() {
      calls.push("reset-local");
      current = { state: "unlinked" };
    },
    async stopForGatewayReset() {
      calls.push("stop-for-gateway-reset");
    },
    async unlink() {
      calls.push("unlink");
      current = { state: "unlinked" };
    },
    async dispose() {
      calls.push("dispose");
    },
  };
}

function weixinRuntimeStub(initial) {
  let current = snapshot(initial);
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async initialize() {
      calls.push("initialize");
    },
    async dispatch(command) {
      calls.push(command.kind);
      if (command.kind === "gateway/reset-local") {
        current = {
          ...current,
          revision: current.revision + 1,
          channels: {
            ...current.channels,
            weixin: { state: "unlinked" },
          },
        };
        for (const listener of listeners) listener();
      }
      return current;
    },
    async dispose() {
      calls.push("dispose");
    },
  };
}

test("Remote Hub composes bot lifecycles and gates whole-Gateway recovery", async () => {
  const telegram = botRuntimeStub({ state: "unlinked" });
  const discord = botRuntimeStub({
    state: "error",
    hasStoredCredential: true,
    issue: "gateway-store",
  });
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-runtime-test",
    vault: {},
    weixin,
    telegram,
    discord,
  });

  await runtime.dispatch({ kind: "gateway/reset-local" });
  assert.deepEqual(
    telegram.calls.slice(-2),
    ["stop-for-gateway-reset", "refresh"],
  );
  assert.deepEqual(
    discord.calls.slice(-2),
    ["stop-for-gateway-reset", "refresh"],
  );
  assert.equal(
    weixin.calls.includes("gateway/reset-local"),
    true,
  );
  assert.deepEqual(runtime.getSnapshot().channels.discord, {
    state: "unlinked",
  });

  const token =
    "123456789:telegram-private-token-value";
  await runtime.dispatch({
    kind: "telegram/connect",
    token,
  });
  assert.deepEqual(telegram.calls.at(-1), ["connect", token]);
  assert.deepEqual(runtime.getSnapshot().channels.telegram, {
    state: "degraded",
    accountLabel: "@connected_bot",
    issue: "agent-route-pending",
  });
  assert.equal(
    JSON.stringify(runtime.getSnapshot()).includes(token),
    false,
  );
  await assert.rejects(
    runtime.dispatch({ kind: "gateway/reset-local" }),
    /only available after a Gateway store failure/u,
  );
  await runtime.dispose();
});

test("Remote Hub copies a decrypted bot token only into the main-process clipboard port", async () => {
  const telegram = botRuntimeStub({
    state: "disconnected",
    accountLabel: "@minke_dsh_bot",
  });
  const discord = botRuntimeStub({ state: "unlinked" });
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  const token =
    "123456789:telegram-private-token-value";
  const copied = [];
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-copy-test",
    vault: {
      async readBot(provider) {
        if (provider !== "telegram") return undefined;
        return {
          accountId: "123456789",
          accountLabel: "@minke_dsh_bot",
          generation: 1,
          token,
        };
      },
    },
    credentialClipboard: {
      writeText(value) {
        copied.push(value);
      },
    },
    weixin,
    telegram,
    discord,
  });

  const result = await runtime.dispatch({
    kind: "telegram/token/copy",
  });
  assert.deepEqual(copied, [token]);
  assert.equal(JSON.stringify(result).includes(token), false);
  await assert.rejects(
    runtime.dispatch({ kind: "discord/token/copy" }),
    /No saved discord token/u,
  );

  await runtime.dispose();
});

test("Remote Hub applies Telegram proxy settings only while its provider is inactive", async () => {
  const telegram = botRuntimeStub({ state: "unlinked" });
  const discord = botRuntimeStub({ state: "unlinked" });
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  const calls = [];
  let settings = { httpProxyUrl: "" };
  const telegramNetwork = {
    async initialize() {
      calls.push(["initialize"]);
    },
    async configure(value) {
      calls.push(["configure", value]);
      settings = value;
    },
    getSnapshot() {
      return settings;
    },
  };
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-proxy-test",
    vault: {},
    weixin,
    telegram,
    telegramNetwork,
    discord,
  });
  const configured = {
    httpProxyUrl: "http://127.0.0.1:7897",
  };

  await runtime.dispatch({
    kind: "telegram/network/set",
    settings: configured,
  });
  assert.deepEqual(calls, [["configure", configured]]);
  assert.deepEqual(
    runtime.getSnapshot().telegramNetwork,
    configured,
  );

  await runtime.dispatch({
    kind: "telegram/connect",
    token: "123456789:telegram-private-token-value",
  });
  await assert.rejects(
    runtime.dispatch({
      kind: "telegram/network/set",
      settings: { httpProxyUrl: "" },
    }),
    /Disconnect Telegram/u,
  );
  await runtime.dispatch({
    kind: "telegram/disconnect",
  });
  assert.equal(
    telegram.calls.includes("disconnect"),
    true,
  );
  assert.deepEqual(
    runtime.getSnapshot().channels.telegram,
    {
      state: "disconnected",
      accountLabel: "@connected_bot",
    },
  );
  await runtime.dispatch({
    kind: "telegram/network/set",
    settings: { httpProxyUrl: "" },
  });
  assert.deepEqual(calls.at(-1), [
    "configure",
    { httpProxyUrl: "" },
  ]);

  await runtime.dispose();
});

test("Remote Hub refreshes Discord automatic routing before connect and applies a manual fallback only while inactive", async () => {
  const calls = [];
  const telegram = botRuntimeStub({ state: "unlinked" });
  const discord = botRuntimeStub({
    state: "error",
    hasStoredCredential: true,
    issue: "network",
  });
  discord.connect = async (token) => {
    calls.push(["connect", token]);
  };
  discord.reconnect = async () => {
    calls.push(["reconnect"]);
  };
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  const telegramNetwork = {
    async initialize() {
      calls.push(["telegram-network"]);
    },
    async configure() {},
    getSnapshot() {
      return { httpProxyUrl: "http://127.0.0.1:7897" };
    },
  };
  let discordNetworkSnapshot = {
    httpProxyUrl: "",
    proxySource: "telegram",
  };
  const discordNetwork = {
    async initialize() {
      calls.push(["discord-network-initialize"]);
    },
    async refresh() {
      calls.push(["discord-network-refresh"]);
    },
    async configure(settings) {
      calls.push(["discord-network-configure", settings]);
      discordNetworkSnapshot = {
        ...settings,
        proxySource:
          settings.httpProxyUrl === ""
            ? "telegram"
            : "manual",
      };
    },
    getSnapshot() {
      return discordNetworkSnapshot;
    },
  };
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-discord-network-test",
    vault: {},
    weixin,
    telegram,
    telegramNetwork,
    discord,
    discordNetwork,
  });

  const token = "discord-private-token-value-123456789";
  await runtime.dispatch({
    kind: "discord/connect",
    token,
  });
  assert.deepEqual(calls, [
    ["telegram-network"],
    ["discord-network-refresh"],
    ["connect", token],
  ]);

  calls.length = 0;
  await runtime.dispatch({
    kind: "discord/network/set",
    settings: {
      httpProxyUrl: "http://127.0.0.1:7898",
    },
  });
  assert.deepEqual(calls, [
    [
      "discord-network-configure",
      { httpProxyUrl: "http://127.0.0.1:7898" },
    ],
    ["reconnect"],
  ]);
  assert.deepEqual(runtime.getSnapshot().discordNetwork, {
    httpProxyUrl: "http://127.0.0.1:7898",
    proxySource: "manual",
  });

  discord.getSnapshot = () => ({
    state: "connected",
    accountLabel: "@connected_bot",
  });
  await assert.rejects(
    runtime.dispatch({
      kind: "discord/network/set",
      settings: { httpProxyUrl: "" },
    }),
    /Disconnect Discord/u,
  );
  await runtime.dispose();
});

test("one stalled bot cannot block another channel or its own unlink", async () => {
  const telegram = botRuntimeStub({ state: "unlinked" });
  const discord = botRuntimeStub({ state: "unlinked" });
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  let resolveDiscordInitialization;
  const discordInitialization = new Promise(
    (resolvePromise) => {
      resolveDiscordInitialization = resolvePromise;
    },
  );
  let resolveDiscordConnect;
  let resolveConnectStarted;
  const connectStarted = new Promise((resolvePromise) => {
    resolveConnectStarted = resolvePromise;
  });
  const pendingConnect = new Promise((resolvePromise) => {
    resolveDiscordConnect = resolvePromise;
  });
  discord.initialize = async () => {
    discord.calls.push("initialize");
    await discordInitialization;
  };
  discord.connect = async (token) => {
    discord.calls.push(["connect", token]);
    resolveConnectStarted();
    await pendingConnect;
  };
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-independent-remote-hub-test",
    vault: {},
    weixin,
    telegram,
    discord,
  });

  const initialization = runtime.initialize();
  const token = "discord-private-token-value-123456789";
  const connecting = runtime.dispatch({
    kind: "discord/connect",
    token,
  });
  await connectStarted;
  await runtime.dispatch({ kind: "telegram/unlink" });
  await runtime.dispatch({ kind: "discord/unlink" });

  assert.equal(telegram.calls.includes("unlink"), true);
  assert.equal(discord.calls.includes("unlink"), true);
  resolveDiscordConnect();
  resolveDiscordInitialization();
  await Promise.all([connecting, initialization]);
  await runtime.dispose();
});

test("Gateway reset is exclusive while ordinary channel commands remain concurrent", async () => {
  const telegram = botRuntimeStub({ state: "unlinked" });
  const discord = botRuntimeStub({
    state: "error",
    hasStoredCredential: true,
    issue: "gateway-store",
  });
  const weixin = weixinRuntimeStub({ state: "unlinked" });
  const resetStarted = deferred();
  const releaseReset = deferred();
  const recoverMailbox = createGatewayMailboxRecovery();
  const recoveryFailure = new Error("stale recovery epoch");
  let recoveryAttempts = 0;
  assert.throws(
    () =>
      recoverMailbox({
        recover() {
          recoveryAttempts += 1;
          throw recoveryFailure;
        },
      }),
    recoveryFailure,
  );
  const dispatchWeixin = weixin.dispatch;
  weixin.dispatch = async (command) => {
    if (command.kind === "gateway/reset-local") {
      resetStarted.resolve();
      await releaseReset.promise;
    }
    return await dispatchWeixin(command);
  };
  const runtime = new RemoteHubCapabilityRuntime({
    dataHome: "/tmp/minke-exclusive-gateway-reset-test",
    vault: {},
    weixin,
    telegram,
    discord,
    recoverMailbox,
  });

  const resetting = runtime.dispatch({
    kind: "gateway/reset-local",
  });
  await resetStarted.promise;
  const connecting = runtime.dispatch({
    kind: "telegram/connect",
    token: "telegram-private-token-value-123456789",
  });
  await new Promise((resolvePromise) => {
    setImmediate(resolvePromise);
  });
  assert.equal(
    telegram.calls.some(
      (call) =>
        Array.isArray(call) &&
        call[0] === "connect",
    ),
    false,
  );

  releaseReset.resolve();
  await Promise.all([resetting, connecting]);
  const reconnectIndex = telegram.calls.indexOf("refresh");
  const connectIndex = telegram.calls.findIndex(
    (call) =>
      Array.isArray(call) &&
      call[0] === "connect",
  );
  assert.equal(reconnectIndex >= 0, true);
  assert.equal(connectIndex > reconnectIndex, true);
  recoverMailbox({
    recover() {
      recoveryAttempts += 1;
    },
  });
  assert.equal(recoveryAttempts, 2);
  await runtime.dispose();
});

test("shared mailbox recovery can start a fresh epoch after Gateway reset", () => {
  const recovery = createGatewayMailboxRecovery();
  const firstFailure = new Error("incompatible mailbox");
  let recoveries = 0;

  assert.throws(
    () =>
      recovery({
        recover() {
          recoveries += 1;
          throw firstFailure;
        },
      }),
    firstFailure,
  );
  assert.throws(
    () =>
      recovery({
        recover() {
          recoveries += 1;
        },
      }),
    firstFailure,
  );
  assert.equal(recoveries, 1);

  recovery.reset();
  recovery({
    recover() {
      recoveries += 1;
    },
  });
  recovery({
    recover() {
      recoveries += 1;
    },
  });
  assert.equal(recoveries, 2);
});

test("Weixin runtime commits the grant before starting its durable provider", async () => {
  const operations = [];
  let stored;
  let pollCount = 0;
  let flowCloseCount = 0;
  const flow = {
    challenge: {
      qrContent: "https://weixin.qq.com/x/opaque",
      expiresAt: Date.now() + 60_000,
    },
    async poll(options = {}) {
      pollCount += 1;
      if (options.verificationCode === undefined) {
        return { status: "verification-required" };
      }
      assert.equal(options.verificationCode, "123456");
      return {
        status: "grant-issued",
        grant: {
          accountId: "private-account-id",
          token: "private-grant-token",
          baseUrl: "https://ilinkai.weixin.qq.com/",
        },
      };
    },
    close() {
      flowCloseCount += 1;
    },
  };
  const mailbox = {
    getAccountGeneration() {
      operations.push("generation-read");
      return undefined;
    },
    registerAccount(account) {
      operations.push(`register:${account.generation}`);
    },
    recover() {
      operations.push("recover");
    },
    close() {
      operations.push("mailbox-close");
    },
  };
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write(value) {
        stored = value;
        operations.push("credential-commit");
      },
      async delete() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      return flow;
    },
    createFlowId() {
      return "flow-1";
    },
    createMailbox() {
      return mailbox;
    },
    createTransport({ credential }) {
      assert.equal(credential.token, "private-grant-token");
      return {
        accountId: credential.accountId,
        async start() {},
        async receive() {
          throw new Error("provider adapter owns receive");
        },
        async deliver() {
          throw new Error("not used");
        },
        async deliverPrepared() {
          throw new Error("not used");
        },
        async prepareDelivery() {
          throw new Error("not used");
        },
        async downloadMedia() {
          throw new Error("not used");
        },
        async setTyping() {
          return { sent: false };
        },
        async close() {},
      };
    },
    createProvider({ generation, transport }) {
      return {
        account: {
          accountKey: "weixin:test",
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start() {
          assert.deepEqual(operations, [
            "generation-read",
            "mailbox-close",
            "credential-commit",
            "recover",
            "register:1",
          ]);
          operations.push("provider-start");
        },
        async receive() {
          throw new Error("not used");
        },
        async prepare() {
          throw new Error("not used");
        },
        async deliver() {
          throw new Error("not used");
        },
        async close() {
          operations.push("provider-close");
        },
      };
    },
    async pollProviderOnce({ ingressPolicy, signal }) {
      assertFailClosedIngressPolicy(ingressPolicy);
      await new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      });
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  await runtime.dispatch({ kind: "weixin/link/start" });
  const verification = await waitForSnapshot(
    runtime,
    (value) =>
      value.channels.weixin.state === "linking" &&
      value.channels.weixin.phase === "verification-required",
  );
  assert.equal(
    verification.channels.weixin.challenge.content,
    "https://weixin.qq.com/x/opaque",
  );
  await runtime.dispatch({
    kind: "weixin/link/verify",
    flowId: "flow-1",
    code: "123456",
  });
  const connected = await waitForSnapshot(
    runtime,
    (value) => value.channels.weixin.state === "degraded",
  );
  assert.equal(connected.channels.weixin.issue, "agent-route-pending");
  assert.equal(JSON.stringify(connected).includes("private-grant-token"), false);
  assert.equal(JSON.stringify(connected).includes("private-account-id"), false);
  assert.equal(pollCount, 2);
  assert.equal(flowCloseCount, 1);
  assert.deepEqual(operations.slice(0, 6), [
    "generation-read",
    "mailbox-close",
    "credential-commit",
    "recover",
    "register:1",
    "provider-start",
  ]);
  await new Promise((resolvePromise) => {
    setImmediate(resolvePromise);
  });
  await runtime.dispatch({
    kind: "weixin/link/cancel",
    flowId: "flow-1",
  });
  assert.equal(stored, undefined);
  assert.deepEqual(
    withoutActivity(runtime.getSnapshot().channels.weixin),
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("authorized Weixin DMs route through Agent and durable reply dispatch", async () => {
  const routeResult = deferred();
  const receiveStarted = deferred();
  const dispatchStarted = deferred();
  const agentInputs = [];
  const provider = {
    account: {
      accountKey: "weixin:bot-account",
      generation: 3,
      provider: "weixin",
      providerAccountId: "bot-account",
      requiresDeliveryContext: true,
    },
    async start() {},
    async receive() {
      throw new Error("injected poll owns receive");
    },
    async prepare() {
      throw new Error("injected dispatch owns preparation");
    },
    async deliver() {
      throw new Error("injected dispatch owns delivery");
    },
    async close() {},
  };
  let now = 1_800_000_000_000;
  let pollCalls = 0;
  let routeCalls = 0;
  let dispatchCalls = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-agent-route-test",
    vault: {
      available: true,
      async read() {
        return {
          generation: 3,
          grant: {
            accountId: "bot-account",
            token: "private-token",
            baseUrl: "https://ilinkai.weixin.qq.com/",
            authorizedUserId: "owner-user",
          },
        };
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return 3;
        },
        inspectOutboxHealth() {
          return {
            accountKey: provider.account.accountKey,
            awaitingDeliveryContext: 0,
            generation: provider.account.generation,
            terminalFailures: 0,
            uncertain: 0,
          };
        },
        registerAccount() {},
        recover() {},
        close() {},
      };
    },
    createTransport() {
      return {
        accountId: "bot-account",
        async close() {},
      };
    },
    createProvider() {
      return provider;
    },
    now: () => now,
    async pollProviderOnce({ ingressPolicy, signal }) {
      pollCalls += 1;
      if (pollCalls > 1) {
        if (pollCalls === 2) {
          now += 1_000;
          return {
            admittedNativeIds: [],
            confirmedOperationIds: ["gateway-reply-1"],
            nextCheckpoint: "2",
          };
        }
        await abortableWait(signal);
        return;
      }
      assert.equal(
        ingressPolicy({
          account: provider.account,
          event: {
            conversationId: "owner-user",
            kind: "user-message",
            nativeId: "native-message-1",
            senderId: "owner-user",
            peerId: "owner-user",
            payload: { text: "hello" },
          },
        }),
        true,
      );
      assert.equal(
        ingressPolicy({
          account: provider.account,
          event: {
            conversationId: "stranger",
            kind: "user-message",
            nativeId: "native-message-stranger",
            senderId: "stranger",
            peerId: "stranger",
            payload: { text: "hello" },
          },
        }),
        false,
      );
      assert.equal(
        ingressPolicy({
          account: provider.account,
          event: {
            conversationId: "group-1",
            kind: "user-message",
            nativeId: "native-message-group",
            senderId: "owner-user",
            peerId: "group-1",
            payload: { groupId: "group-1", text: "hello" },
          },
        }),
        false,
      );
      receiveStarted.resolve();
      now += 1_000;
      return {
        admittedNativeIds: ["native-message-1"],
        confirmedOperationIds: [],
        nextCheckpoint: "1",
      };
    },
    async routeInboxOnce({ handler, signal }) {
      routeCalls += 1;
      if (routeCalls > 1) {
        await abortableWait(signal);
        return { status: "idle" };
      }
      const result = await handler({
        account: provider.account,
        lease: {
          accountKey: "weixin:bot-account",
          conversationId: "owner-user",
          inboxId: 7,
          kind: "user-message",
          leaseToken: "lease-1",
          nativeId: "native-message-1",
          payload: {
            text: "hello from Weixin",
          },
          peerId: "owner-user",
          senderId: "owner-user",
        },
        operationId: "gateway-reply-1",
        signal,
      });
      routeResult.resolve(result);
      return {
        operationId: "gateway-reply-1",
        status: "reply-enqueued",
      };
    },
    async dispatchProviderOnce({ signal }) {
      dispatchCalls += 1;
      if (dispatchCalls === 1) {
        dispatchStarted.resolve();
        now += 1_000;
        return {
          status: "settled",
          attempt: {
            operationId: "gateway-reply-1",
          },
          outcome: {
            status: "accepted",
          },
        };
      }
      await abortableWait(signal);
      return { status: "idle" };
    },
    agentRoute: {
      async runAgentTurn(input) {
        agentInputs.push(input);
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "Agent reply",
          turn: 1,
          endReason: "completed",
          previews: [{
            title: "demo.html",
            url:
              "https://minke.tailnet.ts.net/minke-preview/abcdefghijklmnopqrstuv/",
          }],
        };
      },
    },
  });

  await runtime.initialize();
  const connected = await waitForSnapshot(
    runtime,
    (value) => value.channels.weixin.state === "connected",
  );
  assert.equal(connected.dependencies.agentRoute, "ready");
  await Promise.all([
    receiveStarted.promise,
    dispatchStarted.promise,
  ]);
  assert.deepEqual(await routeResult.promise, {
    status: "reply",
    payload: {
      kind: "text",
      text:
        "Agent reply\n\nHTML 预览：\ndemo.html\n"
        + "https://minke.tailnet.ts.net/minke-preview/abcdefghijklmnopqrstuv/",
    },
  });
  assert.equal(agentInputs.length, 1);
  assert.equal(agentInputs[0].operationId, "gateway-reply-1");
  assert.equal(agentInputs[0].text, "hello from Weixin");
  assert.match(
    agentInputs[0].sessionId,
    /^minke-im-weixin-[a-f0-9]{32}$/u,
  );
  await waitForCondition(
    () => {
      const activity =
        runtime.getSnapshot().channels.weixin.activity;
      return (
        activity?.receivedMessages === 1 &&
        activity.sentMessages === 1
      );
    },
    "WeChat activity counters",
  );
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin.activity,
    {
      connectedAt: 1_800_000_000_000,
      lastActivityAt: now,
      receivedMessages: 1,
      sentMessages: 1,
    },
  );

  await runtime.dispose();
});

test("Weixin keeps delivery degraded while its outbox remains blocked", async (t) => {
  const allowIdle = deferred();
  const idleObserved = deferred();
  let dispatchCalls = 0;
  const account = {
    accountKey: "weixin:blocked-delivery",
    generation: 1,
    provider: "weixin",
    providerAccountId: "blocked-delivery",
    requiresDeliveryContext: true,
  };
  const provider = {
    account,
    async start() {},
    async receive() {
      throw new Error("injected poll owns receive");
    },
    async prepare() {
      throw new Error("injected dispatch owns preparation");
    },
    async deliver() {
      throw new Error("injected dispatch owns delivery");
    },
    async close() {},
  };
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-weixin-blocked-delivery-test",
    vault: {
      available: true,
      async read() {
        return {
          generation: 1,
          grant: {
            accountId: "blocked-delivery",
            token: "private-token",
            baseUrl: "https://ilinkai.weixin.qq.com/",
            authorizedUserId: "owner-user",
          },
        };
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return 1;
        },
        inspectOutboxHealth() {
          return {
            accountKey: account.accountKey,
            awaitingDeliveryContext: 0,
            generation: account.generation,
            terminalFailures: 0,
            uncertain: 1,
          };
        },
        registerAccount() {},
        recover() {},
        close() {},
      };
    },
    createTransport() {
      return {
        accountId: account.providerAccountId,
        async close() {},
      };
    },
    createProvider() {
      return provider;
    },
    async pollProviderOnce({ signal }) {
      await abortableWait(signal);
    },
    async routeInboxOnce({ signal }) {
      await abortableWait(signal);
      return { status: "idle" };
    },
    async dispatchProviderOnce() {
      dispatchCalls += 1;
      if (dispatchCalls === 1) {
        return {
          status: "settled",
          outcome: {
            status: "uncertain",
            errorCode: "ambiguous-send",
          },
        };
      }
      await allowIdle.promise;
      idleObserved.resolve();
      return { status: "idle" };
    },
    async waitBeforePoll(signal) {
      await abortableWait(signal);
    },
    agentRoute: {
      async runAgentTurn() {
        throw new Error("no inbound message is routed");
      },
    },
  });
  t.after(async () => {
    await runtime.dispose();
  });

  await runtime.initialize();
  await waitForSnapshot(
    runtime,
    (value) =>
      value.channels.weixin.state === "degraded" &&
      value.channels.weixin.issue === "delivery",
  );
  allowIdle.resolve();
  await idleObserved.promise;
  await new Promise((resolvePromise) => {
    setImmediate(resolvePromise);
  });
  assert.deepEqual(
    withoutActivity(runtime.getSnapshot().channels.weixin),
    {
    state: "degraded",
    accountLabel: runtime.getSnapshot().channels.weixin.accountLabel,
    issue: "delivery",
    },
  );
});

test("Weixin live loop persists an authorized DM, runs Agent, and delivers its reply", async (t) => {
  const dataHome = await mkdtemp(
    join(tmpdir(), "minke-weixin-live-loop-"),
  );
  t.after(async () => {
    await rm(dataHome, { recursive: true, force: true });
  });
  const delivered = deferred();
  let firstReceive = true;
  const account = {
    accountKey: "weixin:live-account",
    generation: 1,
    provider: "weixin",
    providerAccountId: "live-account",
    requiresDeliveryContext: true,
  };
  const provider = {
    account,
    async start() {},
    async receive(checkpoint, { signal }) {
      if (!firstReceive) {
        await abortableWait(signal);
        throw new Error("unreachable");
      }
      firstReceive = false;
      assert.equal(checkpoint, null);
      return {
        accountKey: account.accountKey,
        events: [{
          conversationId: "owner-user",
          deliveryContext: "opaque-reply-context",
          kind: "user-message",
          nativeId: "wx-message-1",
          payload: {
            text: "ping",
          },
          peerId: "owner-user",
          senderId: "owner-user",
        }],
        fromCheckpoint: null,
        generation: account.generation,
        nextCheckpoint: "checkpoint-1",
      };
    },
    async prepare(input) {
      return {
        status: "ready",
        preparedPayload: input.payload,
      };
    },
    async deliver(attempt) {
      delivered.resolve(attempt);
      return {
        status: "accepted",
        providerReceiptId: "receipt-1",
      };
    },
    async close() {},
  };
  const runtime = new WeixinCapabilityRuntime({
    dataHome,
    vault: {
      available: true,
      async read() {
        return {
          generation: 1,
          grant: {
            accountId: "live-account",
            token: "private-token",
            baseUrl: "https://ilinkai.weixin.qq.com/",
            authorizedUserId: "owner-user",
          },
        };
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createTransport() {
      return {
        accountId: "live-account",
        async close() {},
      };
    },
    createProvider() {
      return provider;
    },
    agentRoute: {
      async runAgentTurn(input) {
        assert.equal(input.text, "ping");
        return {
          outcome: "completed",
          sessionId: input.sessionId,
          text: "pong",
          turn: 1,
          endReason: "completed",
        };
      },
    },
  });

  await runtime.initialize();
  const attempt = await Promise.race([
    delivered.promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(
          `Weixin reply was not delivered: ${JSON.stringify(
            runtime.getSnapshot().channels.weixin,
          )}`,
        )),
        2_000,
      ).unref();
    }),
  ]);
  assert.equal(attempt.recipientId, "owner-user");
  assert.equal(attempt.conversationId, "owner-user");
  assert.equal(attempt.deliveryContext, "opaque-reply-context");
  assert.deepEqual(attempt.preparedPayload, {
    kind: "text",
    text: "pong",
  });
  assert.equal(
    runtime.getSnapshot().channels.weixin.state,
    "connected",
  );

  await runtime.dispose();
});

test("Weixin relink advances generation from the durable mailbox after vault deletion", async () => {
  let stored;
  let durableGeneration;
  let flowNumber = 0;
  const registered = [];
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-relink-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write(value) {
        stored = value;
      },
      async delete() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      flowNumber += 1;
      return {
        challenge: {
          qrContent: `https://weixin.qq.com/x/${String(flowNumber)}`,
          expiresAt: Date.now() + 60_000,
        },
        async poll() {
          return {
            status: "grant-issued",
            grant: {
              accountId: "same-private-account",
              token: `private-token-${String(flowNumber)}`,
              baseUrl: "https://ilinkai.weixin.qq.com/",
            },
          };
        },
        close() {},
      };
    },
    createFlowId() {
      return `flow-${String(flowNumber)}`;
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return durableGeneration;
        },
        registerAccount(account) {
          assert.equal(
            account.generation,
            (durableGeneration ?? 0) + 1,
          );
          durableGeneration = account.generation;
          registered.push(account);
        },
        recover() {},
        close() {},
      };
    },
    createTransport({ credential }) {
      return { accountId: credential.accountId };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start() {},
        async close() {},
      };
    },
    async pollProviderOnce({ signal }) {
      await abortableWait(signal);
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  await runtime.dispatch({ kind: "weixin/link/start" });
  await waitForSnapshot(
    runtime,
    (value) =>
      value.channels.weixin.state === "degraded" &&
      registered.length === 1,
  );
  await runtime.dispatch({ kind: "weixin/unlink" });
  assert.equal(stored, undefined);

  await runtime.dispatch({ kind: "weixin/link/start" });
  await waitForSnapshot(
    runtime,
    (value) =>
      value.channels.weixin.state === "degraded" &&
      registered.length === 2,
  );
  assert.deepEqual(
    registered.map((value) => value.generation),
    [1, 2],
  );
  assert.equal(
    registered[0].accountKey,
    registered[1].accountKey,
  );
  await runtime.dispose();
});

test("Weixin unlink fences an in-flight credential commit and deletes its result", async () => {
  let stored;
  let releaseWrite;
  let writeStarted;
  const started = new Promise((resolvePromise) => {
    writeStarted = resolvePromise;
  });
  const release = new Promise((resolvePromise) => {
    releaseWrite = resolvePromise;
  });
  let transportStarts = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-cancel-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write(value) {
        writeStarted();
        await release;
        stored = value;
      },
      async delete() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      return {
        challenge: {
          qrContent: "https://weixin.qq.com/x/cancel",
          expiresAt: Date.now() + 60_000,
        },
        async poll() {
          return {
            status: "grant-issued",
            grant: {
              accountId: "private-account",
              token: "private-token",
              baseUrl: "https://ilinkai.weixin.qq.com/",
            },
          };
        },
        close() {},
      };
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return undefined;
        },
        registerAccount() {},
        recover() {},
        close() {},
      };
    },
    createTransport() {
      transportStarts += 1;
      return { accountId: "private-account" };
    },
    createProvider() {
      throw new Error("provider must not start after unlink");
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  await runtime.dispatch({ kind: "weixin/link/start" });
  await started;
  assert.equal(
    runtime.getSnapshot().channels.weixin.state,
    "connecting",
  );
  const unlink = runtime.dispatch({ kind: "weixin/unlink" });
  releaseWrite();
  await unlink;
  assert.equal(stored, undefined);
  assert.equal(transportStarts, 0);
  assert.equal(
    runtime.getSnapshot().channels.weixin.state,
    "unlinked",
  );
  await runtime.dispose();
});

test("a stale Weixin cancel fences an in-flight credential commit", async () => {
  let stored;
  let releaseWrite;
  let writeStarted;
  const started = new Promise((resolvePromise) => {
    writeStarted = resolvePromise;
  });
  const release = new Promise((resolvePromise) => {
    releaseWrite = resolvePromise;
  });
  let providerStarts = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-stale-cancel-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write(value) {
        writeStarted();
        await release;
        stored = value;
      },
      async delete() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      return {
        challenge: {
          qrContent: "https://weixin.qq.com/x/stale-cancel",
          expiresAt: Date.now() + 60_000,
        },
        async poll() {
          return {
            status: "grant-issued",
            grant: {
              accountId: "private-account",
              token: "private-token",
              baseUrl: "https://ilinkai.weixin.qq.com/",
            },
          };
        },
        close() {},
      };
    },
    createFlowId() {
      return "stale-cancel-flow";
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return undefined;
        },
        registerAccount() {},
        recover() {},
        removeProviderAccounts() {
          return 0;
        },
        close() {},
      };
    },
    createTransport() {
      providerStarts += 1;
      return { accountId: "private-account" };
    },
    createProvider() {
      throw new Error("provider must not start after cancel");
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  await runtime.dispatch({ kind: "weixin/link/start" });
  await started;
  assert.equal(
    runtime.getSnapshot().channels.weixin.state,
    "connecting",
  );
  const cancel = runtime.dispatch({
    kind: "weixin/link/cancel",
    flowId: "stale-cancel-flow",
  });
  releaseWrite();
  await cancel;
  assert.equal(stored, undefined);
  assert.equal(providerStarts, 0);
  assert.deepEqual(
    withoutActivity(runtime.getSnapshot().channels.weixin),
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("cancelling after provider registration restores with a newer generation", async () => {
  let stored = {
    generation: 1,
    grant: {
      accountId: "private-account",
      token: "private-old-token",
      baseUrl: "https://ilinkai.weixin.qq.com/",
    },
  };
  let durableGeneration = 1;
  let providerStarts = 0;
  let relinkProviderStarted;
  const relinkStarted = new Promise((resolvePromise) => {
    relinkProviderStarted = resolvePromise;
  });
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-generation-rollback-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write(value) {
        stored = value;
      },
      async delete() {
        stored = undefined;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      return {
        challenge: {
          qrContent: "https://weixin.qq.com/x/generation-rollback",
          expiresAt: Date.now() + 60_000,
        },
        async poll() {
          return {
            status: "grant-issued",
            grant: {
              accountId: "private-account",
              token: "private-new-token",
              baseUrl: "https://ilinkai.weixin.qq.com/",
            },
          };
        },
        close() {},
      };
    },
    createFlowId() {
      return "generation-rollback-flow";
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return durableGeneration;
        },
        registerAccount(account) {
          if (account.generation < durableGeneration) {
            throw new Error("generation moved backwards");
          }
          durableGeneration = account.generation;
        },
        recover() {},
        removeProviderAccounts() {
          return 0;
        },
        close() {},
      };
    },
    createTransport({ credential }) {
      return { accountId: credential.accountId };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start({ signal }) {
          providerStarts += 1;
          if (providerStarts === 1) {
            throw new WeixinTransportError(
              "session-stale",
              "stored session is stale",
            );
          }
          if (providerStarts === 2) {
            relinkProviderStarted();
            await abortableWait(signal);
          }
        },
        async close() {},
      };
    },
    async pollProviderOnce({ signal }) {
      await abortableWait(signal);
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "session-stale", issue: "session-stale" },
  );
  await runtime.dispatch({ kind: "weixin/link/start" });
  await relinkStarted;
  assert.equal(durableGeneration, 2);
  await runtime.dispatch({
    kind: "weixin/link/cancel",
    flowId: "generation-rollback-flow",
  });
  assert.equal(stored.grant.token, "private-old-token");
  assert.equal(stored.generation, 3);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "session-stale", issue: "session-stale" },
  );

  await runtime.dispatch({ kind: "weixin/reconnect" });
  assert.equal(durableGeneration, 3);
  assert.equal(providerStarts, 3);
  assert.deepEqual(
    withoutActivity(runtime.getSnapshot().channels.weixin),
    {
      state: "degraded",
      accountLabel:
        runtime.getSnapshot().channels.weixin.accountLabel,
      issue: "agent-route-pending",
    },
  );
  await runtime.dispose();
});

test("Weixin local reset recovers without reading a corrupt credential", async () => {
  let vaultDeletes = 0;
  let mailboxResets = 0;
  const cipher = {
    open(value) {
      return new Uint8Array(value);
    },
    seal(value) {
      return new Uint8Array(value);
    },
  };
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-reset-test",
    vault: {
      available: true,
      async read() {
        throw new Error("corrupt credential");
      },
      async write() {},
      async delete() {
        vaultDeletes += 1;
      },
      gatewayCipher() {
        return cipher;
      },
    },
    createMailbox({ cipher: receivedCipher, path }) {
      assert.equal(
        path,
        "/tmp/minke-remote-hub-reset-test/minke/im/gateway.sqlite",
      );
      assert.equal(receivedCipher, cipher);
      return {
        removeProviderAccounts(provider) {
          assert.equal(provider, "weixin");
          mailboxResets += 1;
          return 1;
        },
        close() {},
      };
    },
  });

  await runtime.initialize();
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "error", issue: "credential-read" },
  );
  await runtime.dispatch({ kind: "weixin/reset-local" });
  assert.equal(mailboxResets, 1);
  assert.equal(vaultDeletes, 1);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("an incompatible shared mailbox requires a separate confirmed Gateway reset", async () => {
  const stored = {
    generation: 1,
    grant: {
      accountId: "private-account",
      token: "private-token",
      baseUrl: "https://ilinkai.weixin.qq.com/",
    },
  };
  let vaultDeletes = 0;
  let gatewayKeyResets = 0;
  let gatewayResets = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-gateway-reset-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write() {},
      async delete() {
        vaultDeletes += 1;
      },
      async resetGatewayCipher() {
        gatewayKeyResets += 1;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      throw new Error("incompatible pre-release schema");
    },
    async resetGatewayMailbox(path) {
      assert.equal(
        path,
        "/tmp/minke-remote-hub-gateway-reset-test/minke/im/gateway.sqlite",
      );
      gatewayResets += 1;
    },
  });

  await runtime.initialize();
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "error", issue: "transport-start" },
  );
  await runtime.dispatch({ kind: "weixin/reset-local" });
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "error", issue: "gateway-store" },
  );
  assert.equal(vaultDeletes, 0);
  assert.equal(gatewayKeyResets, 0);
  assert.equal(gatewayResets, 0);

  await runtime.dispatch({ kind: "gateway/reset-local" });
  assert.equal(gatewayResets, 1);
  assert.equal(vaultDeletes, 1);
  assert.equal(gatewayKeyResets, 1);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("a healthy Remote Hub rejects a direct whole-Gateway reset", async () => {
  let gatewayResets = 0;
  let vaultDeletes = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-gateway-reset-gate-test",
    vault: {
      available: true,
      async read() {
        return undefined;
      },
      async write() {},
      async delete() {
        vaultDeletes += 1;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async resetGatewayMailbox() {
      gatewayResets += 1;
    },
  });

  await runtime.initialize();
  await assert.rejects(
    runtime.dispatch({ kind: "gateway/reset-local" }),
    /only available after a Gateway store failure/u,
  );
  assert.equal(gatewayResets, 0);
  assert.equal(vaultDeletes, 0);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("whole-Gateway recovery removes every SQLite sidecar", async () => {
  const dataHome = await mkdtemp(
    join(tmpdir(), "minke-remote-hub-sidecars-"),
  );
  const mailboxDirectory = join(dataHome, "minke", "im");
  const mailboxPath = join(mailboxDirectory, "gateway.sqlite");
  const paths = [
    mailboxPath,
    `${mailboxPath}-journal`,
    `${mailboxPath}-shm`,
    `${mailboxPath}-wal`,
  ];
  let gatewayKeyResets = 0;
  await mkdir(mailboxDirectory, { recursive: true });
  await Promise.all(
    paths.map((path) => writeFile(path, "obsolete")),
  );
  const runtime = new WeixinCapabilityRuntime({
    dataHome,
    vault: {
      available: true,
      async read() {
        return undefined;
      },
      async write() {},
      async delete() {},
      async resetGatewayCipher() {
        gatewayKeyResets += 1;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      throw new Error("incompatible pre-release schema");
    },
  });

  try {
    await runtime.initialize();
    await runtime.dispatch({ kind: "weixin/reset-local" });
    assert.deepEqual(
      runtime.getSnapshot().channels.weixin,
      { state: "error", issue: "gateway-store" },
    );
    await runtime.dispatch({ kind: "gateway/reset-local" });
    assert.equal(gatewayKeyResets, 1);
    for (const path of paths) {
      await assert.rejects(
        readFile(path),
        (error) => error?.code === "ENOENT",
      );
    }
  } finally {
    await runtime.dispose();
    await rm(dataHome, { recursive: true, force: true });
  }
});

test("Weixin relink forwards the stored token and reconnects an already-bound account", async () => {
  const stored = {
    generation: 4,
    grant: {
      accountId: "private-account",
      token: "private-existing-token",
      baseUrl: "https://ilinkai.weixin.qq.com/",
    },
  };
  let providerStarts = 0;
  let knownBotTokens;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-already-bound-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin(options) {
      knownBotTokens = options.knownBotTokens;
      return {
        challenge: {
          qrContent: "https://weixin.qq.com/x/already-bound",
          expiresAt: Date.now() + 60_000,
        },
        async poll() {
          return { status: "already-bound" };
        },
        close() {},
      };
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return stored.generation;
        },
        registerAccount() {},
        recover() {},
        removeProviderAccounts() {
          return 0;
        },
        close() {},
      };
    },
    createTransport({ credential }) {
      return { accountId: credential.accountId };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start() {
          providerStarts += 1;
          if (providerStarts === 1) {
            throw new WeixinTransportError(
              "session-stale",
              "stored session is stale",
            );
          }
        },
        async close() {},
      };
    },
    async pollProviderOnce({ signal }) {
      await abortableWait(signal);
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "session-stale", issue: "session-stale" },
  );
  await runtime.dispatch({ kind: "weixin/link/start" });
  await waitForSnapshot(
    runtime,
    (value) => value.channels.weixin.state === "degraded",
  );
  assert.deepEqual(knownBotTokens, ["private-existing-token"]);
  assert.equal(providerStarts, 2);
  await runtime.dispose();
});

test("cancelling a Weixin relink restores the prior stale-session state", async () => {
  const stored = {
    generation: 2,
    grant: {
      accountId: "private-account",
      token: "private-existing-token",
      baseUrl: "https://ilinkai.weixin.qq.com/",
    },
  };
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-cancel-relink-test",
    vault: {
      available: true,
      async read() {
        return stored;
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    async beginLogin() {
      return {
        challenge: {
          qrContent: "https://weixin.qq.com/x/cancel-relink",
          expiresAt: Date.now() + 60_000,
        },
        async poll({ signal }) {
          await abortableWait(signal);
        },
        close() {},
      };
    },
    createFlowId() {
      return "cancel-relink-flow";
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return stored.generation;
        },
        registerAccount() {},
        recover() {},
        removeProviderAccounts() {
          return 0;
        },
        close() {},
      };
    },
    createTransport({ credential }) {
      return { accountId: credential.accountId };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start() {
          throw new WeixinTransportError(
            "session-stale",
            "stored session is stale",
          );
        },
        async close() {},
      };
    },
    async waitBeforePoll() {},
  });

  await runtime.initialize();
  await runtime.dispatch({ kind: "weixin/link/start" });
  await waitForSnapshot(
    runtime,
    (value) => value.channels.weixin.state === "linking",
  );
  await runtime.dispatch({
    kind: "weixin/link/cancel",
    flowId: "cancel-relink-flow",
  });
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "session-stale", issue: "session-stale" },
  );
  assert.equal(stored.grant.token, "private-existing-token");
  await runtime.dispose();
});

test("unlink preempts provider setup during cold initialization", async () => {
  let providerSignal;
  let providerStarted;
  const started = new Promise((resolvePromise) => {
    providerStarted = resolvePromise;
  });
  let vaultDeletes = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-cold-unlink-test",
    vault: {
      available: true,
      async read() {
        return {
          generation: 1,
          grant: {
            accountId: "private-account",
            token: "private-token",
            baseUrl: "https://ilinkai.weixin.qq.com/",
          },
        };
      },
      async write() {},
      async delete() {
        vaultDeletes += 1;
      },
      gatewayCipher() {
        return {
          open(value) {
            return new Uint8Array(value);
          },
          seal(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return 1;
        },
        registerAccount() {},
        recover() {},
        removeProviderAccounts() {
          return 0;
        },
        close() {},
      };
    },
    createTransport({ credential }) {
      return { accountId: credential.accountId };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start({ signal }) {
          providerSignal = signal;
          providerStarted();
          await abortableWait(signal);
        },
        async close() {},
      };
    },
  });

  const initialization = runtime.initialize();
  await started;
  await runtime.dispatch({ kind: "weixin/unlink" });
  await initialization;
  assert.equal(providerSignal.aborted, true);
  assert.equal(vaultDeletes, 1);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("unlink fences a delayed cold-start vault read before provider creation", async () => {
  let releaseRead;
  const read = new Promise((resolvePromise) => {
    releaseRead = resolvePromise;
  });
  let providerCreates = 0;
  let vaultDeletes = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-cold-read-unlink-test",
    vault: {
      available: true,
      async read() {
        return await read;
      },
      async write() {},
      async delete() {
        vaultDeletes += 1;
      },
      gatewayCipher() {
        throw new Error("provider must not be created");
      },
    },
    createMailbox() {
      throw new Error("provider must not be created");
    },
    createProvider() {
      providerCreates += 1;
      throw new Error("provider must not be created");
    },
  });

  const initialization = runtime.initialize();
  const unlink = runtime.dispatch({ kind: "weixin/unlink" });
  releaseRead({
    generation: 1,
    grant: {
      accountId: "private-account",
      token: "private-token",
      baseUrl: "https://ilinkai.weixin.qq.com/",
    },
  });
  await unlink;
  await initialization;
  assert.equal(providerCreates, 0);
  assert.equal(vaultDeletes, 1);
  assert.deepEqual(
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
  );
  await runtime.dispose();
});

test("Weixin disposal aborts provider setup and waits for owned initialization", async () => {
  let providerSignal;
  let providerStarted;
  const started = new Promise((resolvePromise) => {
    providerStarted = resolvePromise;
  });
  let providerCloses = 0;
  let mailboxCloses = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-dispose-test",
    vault: {
      available: true,
      async read() {
        return {
          generation: 1,
          grant: {
            accountId: "private-account",
            token: "private-token",
            baseUrl: "https://ilinkai.weixin.qq.com/",
          },
        };
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        return {
          seal(value) {
            return new Uint8Array(value);
          },
          open(value) {
            return new Uint8Array(value);
          },
        };
      },
    },
    createMailbox() {
      return {
        getAccountGeneration() {
          return 1;
        },
        registerAccount() {},
        recover() {},
        close() {
          mailboxCloses += 1;
        },
      };
    },
    createTransport() {
      return { accountId: "private-account" };
    },
    createProvider({ accountKey, generation, transport }) {
      return {
        account: {
          accountKey,
          generation,
          provider: "weixin",
          providerAccountId: transport.accountId,
          requiresDeliveryContext: true,
        },
        async start({ signal }) {
          providerSignal = signal;
          providerStarted();
          await abortableWait(signal);
        },
        async close() {
          providerCloses += 1;
        },
      };
    },
  });

  const initialization = runtime.initialize();
  await started;
  await runtime.dispose();
  await initialization;
  assert.equal(providerSignal.aborted, true);
  assert.equal(providerCloses, 1);
  assert.equal(mailboxCloses, 1);
});

test("Weixin disposal aborts login creation before a QR flow is owned", async () => {
  let beginSignal;
  let beginStarted;
  const started = new Promise((resolvePromise) => {
    beginStarted = resolvePromise;
  });
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-begin-dispose-test",
    vault: {
      available: true,
      async read() {
        return undefined;
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        throw new Error("mailbox must not open");
      },
    },
    async beginLogin({ signal }) {
      beginSignal = signal;
      beginStarted();
      return await abortableWait(signal);
    },
  });

  await runtime.initialize();
  const command = runtime.dispatch({
    kind: "weixin/link/start",
  });
  await started;
  await runtime.dispose();
  await command;
  assert.equal(beginSignal.aborted, true);
});

test("Weixin disposal waits for a delayed vault read without starting later work", async () => {
  let releaseRead;
  const read = new Promise((resolvePromise) => {
    releaseRead = resolvePromise;
  });
  let mailboxCreates = 0;
  const runtime = new WeixinCapabilityRuntime({
    dataHome: "/tmp/minke-remote-hub-read-dispose-test",
    vault: {
      available: true,
      async read() {
        return await read;
      },
      async write() {},
      async delete() {},
      gatewayCipher() {
        throw new Error("mailbox must not open");
      },
    },
    createMailbox() {
      mailboxCreates += 1;
      throw new Error("mailbox must not open");
    },
  });

  const initialization = runtime.initialize();
  let disposed = false;
  const disposal = runtime.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  assert.equal(disposed, false);
  releaseRead(undefined);
  await disposal;
  await initialization;
  assert.equal(mailboxCreates, 0);
});

test("Remote Hub vault encrypts IM tokens with one OS-wrapped AEAD key", async () => {
  const root = await mkdtemp(join(tmpdir(), "minke-remote-hub-vault-"));
  const protectedValues = [];
  const safeStorage = {
    isEncryptionAvailable() {
      return true;
    },
    getSelectedStorageBackend() {
      return "keychain";
    },
    encryptString(value) {
      protectedValues.push(value);
      return Buffer.from([...Buffer.from(value)].reverse());
    },
    decryptString(value) {
      return Buffer.from([...value].reverse()).toString("utf8");
    },
  };
  try {
    const vault = new RemoteHubCredentialVault(root, safeStorage);
    await vault.write({
      generation: 1,
      grant: {
        accountId: "private-account",
        token: "private-token",
        baseUrl: "https://ilinkai.weixin.qq.com/",
      },
    });
    const telegramCredential = {
      accountId: "123456789",
      accountLabel: "@minke_bot",
      authorizedUserId: "approved-telegram-user",
      connectionPaused: true,
      generation: 2,
      token: "123456789:telegram-private-token-value",
    };
    const discordCredential = {
      accountId: "987654321",
      accountLabel: "Minke Discord",
      generation: 3,
      token: "discord-private-token-value-123456789",
    };
    await vault.writeBot("telegram", telegramCredential);
    await vault.writeBot("discord", discordCredential);
    const source = await readFile(
      join(root, "secrets", "weixin.grant.json"),
      "utf8",
    );
    const telegramSource = await readFile(
      join(root, "secrets", "telegram.bot.json"),
      "utf8",
    );
    const discordSource = await readFile(
      join(root, "secrets", "discord.bot.json"),
      "utf8",
    );
    const keySource = await readFile(
      join(root, "secrets", "im-gateway.key.json"),
      "utf8",
    );
    if (process.platform !== "win32") {
      assert.equal(
        (await stat(join(root, "secrets"))).mode & 0o777,
        0o700,
      );
      for (const filename of [
        "weixin.grant.json",
        "telegram.bot.json",
        "discord.bot.json",
        "im-gateway.key.json",
      ]) {
        assert.equal(
          (
            await stat(join(root, "secrets", filename))
          ).mode & 0o777,
          0o600,
        );
      }
    }
    assert.equal(source.includes("private-token"), false);
    assert.equal(
      telegramSource.includes(telegramCredential.token),
      false,
    );
    assert.equal(
      telegramSource.includes(
        telegramCredential.authorizedUserId,
      ),
      false,
    );
    assert.equal(
      discordSource.includes(discordCredential.token),
      false,
    );
    assert.equal(keySource.includes("private-token"), false);
    assert.equal(protectedValues.length, 1);
    assert.equal(
      protectedValues[0].includes("private-token"),
      false,
    );
    const expectedGrant = {
      generation: 1,
      grant: {
        accountId: "private-account",
        token: "private-token",
        baseUrl: "https://ilinkai.weixin.qq.com/",
      },
    };
    assert.deepEqual(await vault.read(), expectedGrant);
    assert.deepEqual(
      await vault.readBot("telegram"),
      telegramCredential,
    );
    assert.deepEqual(
      await vault.readBot("discord"),
      discordCredential,
    );
    const reopenedVault = new RemoteHubCredentialVault(
      root,
      safeStorage,
    );
    assert.deepEqual(
      await reopenedVault.read(),
      expectedGrant,
    );
    assert.deepEqual(
      await reopenedVault.readBot("telegram"),
      telegramCredential,
    );

    await writeFile(
      join(root, "secrets", "telegram.bot.json"),
      discordSource,
    );
    await assert.rejects(
      reopenedVault.readBot("telegram"),
      /authenticat/u,
    );

    const cipher = vault.gatewayCipher();
    const plaintext = new TextEncoder().encode(
      "authenticated payload",
    );
    const ciphertext = cipher.seal(
      plaintext,
      "gateway-purpose-a",
    );
    assert.deepEqual(
      cipher.open(ciphertext, "gateway-purpose-a"),
      plaintext,
    );
    assert.throws(
      () => cipher.open(ciphertext, "gateway-purpose-b"),
      /authenticat/u,
    );
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(
      () => cipher.open(tampered, "gateway-purpose-a"),
      /authenticat/u,
    );

    const grantDocument = JSON.parse(source);
    const grantTag = Buffer.from(grantDocument.tag, "base64");
    grantTag[0] ^= 1;
    grantDocument.tag = grantTag.toString("base64");
    await writeFile(
      join(root, "secrets", "weixin.grant.json"),
      `${JSON.stringify(grantDocument)}\n`,
    );
    await assert.rejects(
      reopenedVault.read(),
      /authenticat/u,
    );

    const unprotectedVault =
      new RemoteHubCredentialVault(root, {
        isEncryptionAvailable() {
          return true;
        },
        getSelectedStorageBackend() {
          return "basic_text";
        },
        encryptString() {
          throw new Error("must not use an unprotected backend");
        },
        decryptString() {
          throw new Error("must not use an unprotected backend");
        },
      });
    assert.equal(unprotectedVault.available, false);
    await assert.rejects(
      unprotectedVault.writeBot(
        "telegram",
        telegramCredential,
      ),
      /OS credential protection is unavailable/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Remote Hub hydration keeps a newer pushed revision when the initial read fails", async () => {
  let rejectRead;
  let push;
  const initialRead = new Promise((_, rejectPromise) => {
    rejectRead = rejectPromise;
  });
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return await initialRead;
    },
    async dispatch() {
      return snapshot();
    },
    subscribe(listener) {
      push = listener;
      return () => {};
    },
  });

  const initialization = hub.initialize();
  push(snapshot());
  rejectRead(new Error("stale initial read"));
  await initialization;
  assert.equal(hub.getSnapshot().channels.revision, 3);
  assert.equal(hub.getSnapshot().error, undefined);
  await hub.dispose();
  remote.dispose();
});

test("an absent Remote bridge does not mark a healthy IM-only Hub as failed", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return snapshot({ state: "unlinked" });
    },
    async dispatch() {
      return snapshot({ state: "unlinked" });
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();
  const trigger = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(
    trigger,
    /aria-label="Remote: not connected"/u,
  );
  assert.match(trigger, /data-state="idle"/u);
  await hub.dispose();
  remote.dispose();
});

test("Remote Hub trigger maps transitional and failed states to semantic colors", async () => {
  const contract = inspectCssContract(
    await readFile(
      join(
        process.cwd(),
        "packages",
        "harness-overlay",
        "src",
        "client",
        "remote-hub",
        "styles.css",
      ),
      "utf8",
    ),
  );
  const indicator =
    "[data-minke-remote-hub-indicator]";
  assert.deepEqual(
    {
      attention: contract.declaration(
        `[data-minke-remote-hub-action][data-state="attention"] ${indicator}`,
        "background",
      ),
      working: contract.declaration(
        `[data-minke-remote-hub-action][data-state="working"] ${indicator}`,
        "background",
      ),
    },
    {
      attention:
        "var(--dsw-alias-state-error-primary)",
      working:
        "var(--dsw-alias-state-warning-primary)",
    },
  );
});

test("blank-session Remote fallback yields to the live Session header trigger", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const hub = new RemoteHubRuntime(remote, {
    available: false,
    async read() {
      throw new Error("IM unavailable");
    },
    async dispatch() {
      throw new Error("IM unavailable");
    },
    subscribe() {
      return () => {};
    },
  });
  const props = {
    runtime: hub,
    t: (key) => remoteHubEn[key],
    useSessions(selector) {
      return selector({
        current: "session-1",
        byId: {
          "session-1": { blank: true },
        },
      });
    },
  };

  await hub.initialize();
  assert.equal(hub.getSnapshot().error, undefined);
  assert.deepEqual(
    hub.getSnapshot().channels.channels.weixin,
    { state: "unavailable", issue: "vault-unavailable" },
  );
  const fallback = renderToStaticMarkup(
    createElement(NewSessionRemoteHubAction, props),
  );
  assert.match(fallback, /data-location="fallback"/u);
  const unregister = hub.registerSessionTrigger();
  assert.equal(
    renderToStaticMarkup(
      createElement(NewSessionRemoteHubAction, props),
    ),
    "",
  );
  unregister();
  assert.match(
    renderToStaticMarkup(
      createElement(NewSessionRemoteHubAction, props),
    ),
    /data-minke-remote-hub-action/u,
  );
  await hub.dispose();
  remote.dispose();
});

test("Remote entry keeps connection presence green through settings work and write failures", async () => {
  let rejectWrite;
  const remote = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: {
          enabled: true,
          method: "tailscale",
          tailscale: {
            transport: "serve",
            ipAddress: "",
          },
          cloudflare: {
            hostnameMode: "generated",
            domain: "",
            generatedLabel: "m-0123456789abcdef",
            customHostname: "",
            teamName: "",
            audience: "",
            tunnel: "",
            configPath: "",
            originPort: 49_321,
          },
        },
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "active",
          url: "https://minke.example-tailnet.ts.net",
        },
      };
    },
    async write() {
      await new Promise((_, reject) => {
        rejectWrite = reject;
      });
    },
  });
  await remote.initialize();
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return snapshot({ state: "unlinked" });
    },
    async dispatch() {
      return snapshot({ state: "unlinked" });
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();

  remote.setEnabled(false);
  const working = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(
    working,
    /aria-label="Remote: capability active"/u,
  );
  assert.match(working, /data-state="active"/u);

  await Promise.resolve();
  rejectWrite(new Error("write failed"));
  await remote.flush();
  const failed = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(
    failed,
    /aria-label="Remote: capability active"/u,
  );
  assert.match(failed, /data-state="active"/u);
  await hub.dispose();
  remote.dispose();
});

test("a manually edited Cloudflare label can remain empty", async () => {
  const source = await readFile(
    join(
      process.cwd(),
      "packages",
      "harness-overlay",
      "src",
      "client",
      "remote",
      "RemoteSettingsSection.tsx",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /cloudflare\.generatedLabel === ""[\s\S]{0,240}runtime\.regenerateCloudflareHostname\(\)/u,
  );
});

test("Remote Hub uses grouped sidebar navigation and stable detail panels", async () => {
  const remote = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: {
          enabled: false,
          method: "tailscale",
          tailscale: {
            transport: "serve",
            ipAddress: "",
          },
          cloudflare: {
            hostnameMode: "generated",
            domain: "",
            generatedLabel: "m-0123456789abcdef",
            customHostname: "",
            teamName: "",
            audience: "",
            tunnel: "",
            configPath: "",
            originPort: 49_321,
          },
        },
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "disabled",
        },
      };
    },
    async write() {},
  });
  await remote.initialize();
  let channels = snapshot({
    state: "error",
    issue: "credential-read",
  });
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe() {
      return () => {};
    },
  });
  assert.equal(
    hub.getSnapshot().channels.channels.weixin.state,
    "loading",
  );
  await hub.initialize();
  assert.equal(hub.remote, remote);

  const trigger = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(trigger, /aria-haspopup="dialog"/u);
  assert.match(trigger, /aria-expanded="false"/u);
  assert.match(trigger, /d="M2 8V6a2 2 0 0 1 2-2h16/u);
  assert.match(
    trigger,
    /aria-label="Remote: needs attention"/u,
  );
  assert.match(trigger, /data-state="attention"/u);
  assert.equal(
    (trigger.match(/data-minke-remote-hub-action/g) ?? [])
      .length,
    1,
  );

  hub.open();
  const dialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(dialog, /role="dialog"/u);
  assert.match(dialog, /aria-modal="true"/u);
  assert.match(
    dialog,
    /<nav[^>]*class="minke-remote-hub__navigation"/u,
  );
  assert.doesNotMatch(dialog, /role="tablist"/u);
  assert.match(
    dialog,
    /<button[^>]*aria-current="page"[^>]*>[\s\S]*WeChat/u,
  );
  assert.match(dialog, />Messaging</u);
  assert.match(dialog, />Device access</u);
  assert.ok(
    dialog.indexOf(">Messaging<") <
      dialog.indexOf(">Device access<"),
  );
  assert.match(dialog, />WeChat</u);
  assert.doesNotMatch(dialog, /Weixin/u);
  assert.equal(
    Object.values(remoteHubEn).some((value) =>
      value.includes("Weixin")
    ),
    false,
  );
  assert.match(dialog, />Telegram</u);
  assert.match(dialog, />Discord</u);
  assert.match(dialog, /d="M15\.85 8\.14c\.39/u);
  assert.match(dialog, /d="M12 2C6\.48 2 2 6\.48/u);
  assert.match(dialog, /d="M19\.27 5\.33C17\.94/u);
  assert.match(dialog, /role="region"/u);
  assert.equal(
    (dialog.match(/type="password"/gu) ?? []).length,
    0,
  );
  assert.doesNotMatch(dialog, />Manage</u);
  assert.doesNotMatch(dialog, />Done</u);
  assert.doesNotMatch(dialog, /data-expanded=/u);
  assert.doesNotMatch(dialog, /planned/iu);
  assert.match(dialog, /role="status"/u);
  assert.match(dialog, />Reset local data</u);
  assert.doesNotMatch(dialog, /Enable remote access/u);
  assert.doesNotMatch(dialog, /Tailscale connection/u);

  hub.setView("telegram");
  const telegramDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    telegramDialog,
    /<button[^>]*aria-current="page"[^>]*>[\s\S]*Telegram/u,
  );
  assert.equal(
    (telegramDialog.match(/type="password"/gu) ?? []).length,
    1,
  );
  assert.match(telegramDialog, />Connect Telegram</u);
  assert.doesNotMatch(telegramDialog, />Connect Discord</u);

  hub.setView("access");
  const remoteDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    remoteDialog,
    /<button[^>]*aria-current="page"[^>]*>[\s\S]*Remote access/u,
  );
  assert.match(remoteDialog, /Access method/u);
  assert.match(remoteDialog, /Enable remote access/u);
  assert.match(remoteDialog, /Tailscale connection/u);
  assert.match(remoteDialog, />Configuration references</u);
  assert.match(
    remoteDialog,
    /href="https:\/\/tailscale\.com\/docs\/features\/tailscale-serve"/u,
  );
  assert.match(
    remoteDialog,
    /href="https:\/\/tailscale\.com\/docs\/concepts\/ip-and-dns-addresses"/u,
  );
  assert.match(
    remoteDialog,
    /href="https:\/\/tailscale\.com\/docs\/features\/access-control"/u,
  );
  assert.match(
    remoteDialog,
    /href="https:\/\/tailscale\.com\/docs\/features\/sharing"/u,
  );
  assert.match(
    remoteDialog,
    /href="https:\/\/tailscale\.com\/docs\/features\/access-control\/device-management\/how-to\/remove"/u,
  );
  assert.match(
    remoteDialog,
    /Minke adds no second sign-in layer to the Tailscale route/u,
  );
  assert.equal(
    (
      remoteDialog.match(
        /data-minke-open-external="system"/gu,
      ) ?? []
    ).length,
    5,
  );
  assert.doesNotMatch(
    remoteDialog,
    /Allow only trusted tailnet members/u,
  );
  assert.doesNotMatch(remoteDialog, /Advanced settings/u);
  assert.doesNotMatch(
    remoteDialog,
    /Disable remote access before changing/u,
  );
  assert.match(
    remoteDialog,
    /Complete these checks when you stop using private access/u,
  );
  assert.match(
    remoteDialog,
    /run tailscale serve status/u,
  );
  assert.match(
    remoteDialog,
    /Do not use tailscale serve reset as routine cleanup/u,
  );
  assert.doesNotMatch(
    remoteDialog,
    /Remove public access completely/u,
  );

  remote.setTailscaleTransport("direct");
  const directRemoteDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    directRemoteDialog,
    /For Direct IP, confirm that the old 100\.x address and port no longer connect/u,
  );
  assert.match(
    directRemoteDialog,
    /The device keeps its Tailscale IP while it remains registered/u,
  );
  assert.doesNotMatch(
    directRemoteDialog,
    /run tailscale serve status/u,
  );
  assert.match(directRemoteDialog, />Tailscale IP \(optional\)</u);
  assert.match(
    directRemoteDialog,
    /Leave blank to detect this device&#x27;s Tailscale IPv4 automatically/u,
  );
  assert.match(
    directRemoteDialog,
    /placeholder="Auto-detect"/u,
  );
  assert.doesNotMatch(
    remoteDialog,
    />Tailscale IP \(optional\)</u,
  );

  remote.setTailscaleSettings({
    ipAddress: "192.168.1.2",
  });
  const invalidTailscaleIpDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    invalidTailscaleIpDialog,
    /100\.64\.0\.0\/10/u,
  );
  assert.match(
    invalidTailscaleIpDialog,
    /value="192\.168\.1\.2"/u,
  );
  assert.match(
    invalidTailscaleIpDialog,
    /aria-invalid="true"/u,
  );

  remote.setMethod("cloudflare");
  const cloudflareDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(cloudflareDialog, /Named Tunnel \+ Access/u);
  assert.doesNotMatch(
    cloudflareDialog,
    /Public hostname|Base domain \+ label|Full hostname/u,
  );
  assert.match(cloudflareDialog, /Base domain/u);
  assert.match(cloudflareDialog, />Random or custom label</u);
  assert.match(
    cloudflareDialog,
    /<button[^>]*class="minke-remote__regenerate"[^>]*aria-label="Generate random label"[^>]*title="Generate random label"[^>]*>[\s\S]*<svg/u,
  );
  assert.doesNotMatch(
    cloudflareDialog,
    />Generate random label</u,
  );
  assert.doesNotMatch(cloudflareDialog, />Random hostname</u);
  assert.match(
    cloudflareDialog,
    /Use the Cloudflare zone apex/u,
  );
  assert.match(
    cloudflareDialog,
    /<button[^>]*class="minke-remote__help-trigger"[^>]*aria-label="Show base domain guidance"[^>]*aria-describedby="[^"]+"/u,
  );
  assert.match(
    cloudflareDialog,
    /<span[^>]*class="minke-remote__help-tooltip"[^>]*role="tooltip"[^>]*data-open="false"[^>]*>Use the Cloudflare zone apex/u,
  );
  assert.doesNotMatch(
    cloudflareDialog,
    /class="minke-remote__field-hint"/u,
  );
  assert.match(
    cloudflareDialog,
    /<input[^>]*value="m-0123456789abcdef"[^>]*>/u,
  );
  assert.match(
    cloudflareDialog,
    /maxlength="63"/iu,
  );
  assert.doesNotMatch(
    cloudflareDialog,
    /<input[^>]*value="m-0123456789abcdef"[^>]*readOnly/u,
  );
  assert.match(
    cloudflareDialog,
    /Cloudflare Zero Trust team name/u,
  );
  assert.match(cloudflareDialog, /Access Application AUD/u);
  assert.match(cloudflareDialog, /Tunnel name or UUID/u);
  assert.match(
    cloudflareDialog,
    /Absolute cloudflared config path/u,
  );
  assert.match(
    cloudflareDialog,
    />Configuration references</u,
  );
  assert.match(
    cloudflareDialog,
    /href="https:\/\/developers\.cloudflare\.com\/cloudflare-one\/networks\/connectors\/cloudflare-tunnel\/do-more-with-tunnels\/local-management\/create-local-tunnel\/"/u,
  );
  assert.match(
    cloudflareDialog,
    /href="https:\/\/developers\.cloudflare\.com\/cloudflare-one\/access-controls\/applications\/http-apps\/self-hosted-public-app\/"/u,
  );
  assert.match(
    cloudflareDialog,
    /href="https:\/\/developers\.cloudflare\.com\/cloudflare-one\/access-controls\/applications\/http-apps\/authorization-cookie\/validating-json\/#get-your-aud-tag"/u,
  );
  assert.match(
    cloudflareDialog,
    />Create a locally managed Tunnel</u,
  );
  assert.match(
    cloudflareDialog,
    />Create a Self-hosted Access application</u,
  );
  assert.match(
    cloudflareDialog,
    />Find the Application AUD</u,
  );
  assert.match(
    cloudflareDialog,
    /<details class="minke-remote__security-disclosure" open="">/u,
  );
  assert.match(
    cloudflareDialog,
    /<section class="minke-remote__security-cleanup" role="note" aria-labelledby=/u,
  );
  assert.match(
    cloudflareDialog,
    /Remove public access completely when you no longer use it/u,
  );
  assert.match(
    cloudflareDialog,
    /Choose Disable remote access in Minke/u,
  );
  assert.match(
    cloudflareDialog,
    /cloudflared process started by Minke has exited/u,
  );
  assert.match(
    cloudflareDialog,
    /Open Cloudflare DNS Records[\s\S]*Zero Trust → Access controls → Applications[\s\S]*Networking → Tunnels/u,
  );
  assert.match(
    cloudflareDialog,
    /cert\.pem is an account-wide management credential/u,
  );
  assert.match(
    cloudflareDialog,
    /DNS caches may continue resolving until their TTL expires/u,
  );
  assert.match(
    cloudflareDialog,
    /cleanup cannot erase a hostname already recorded in Certificate Transparency logs/u,
  );
  assert.equal(
    (
      cloudflareDialog.match(
        /target="_blank" rel="noreferrer"/gu,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (
      cloudflareDialog.match(
        /data-minke-open-external="system"/gu,
      ) ?? []
    ).length,
    3,
  );
  remote.setCloudflareSettings({
    domain: "minke.example.com",
  });
  const nestedDomainDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    nestedDomainDialog,
    /final hostname may fall outside free Universal SSL coverage/u,
  );
  assert.doesNotMatch(
    nestedDomainDialog,
    /aria-invalid="true"/u,
  );

  remote.setCloudflareSettings({
    domain: "invalid_domain.example",
  });
  const invalidDomainDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    invalidDomainDialog,
    /does not look like a valid domain/u,
  );
  assert.match(
    invalidDomainDialog,
    /aria-invalid="true"/u,
  );
  remote.setCloudflareSettings({
    domain: "example.com",
    generatedLabel: "private_console",
  });
  const invalidLabelDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    invalidLabelDialog,
    /Use 1–63 lowercase letters, numbers, or hyphens/u,
  );
  assert.match(
    invalidLabelDialog,
    /value="private_console"/u,
  );
  assert.match(
    invalidLabelDialog,
    /aria-invalid="true"/u,
  );
  remote.setCloudflareSettings({
    hostnameMode: "custom",
    customHostname: "private.example.com",
  });
  const legacyCustomHostnameDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    legacyCustomHostnameDialog,
    /<input[^>]*value="example\.com"[^>]*>/u,
  );
  assert.match(
    legacyCustomHostnameDialog,
    /<input[^>]*value="private"[^>]*>/u,
  );
  assert.match(
    legacyCustomHostnameDialog,
    /<code>private\.example\.com<\/code>/u,
  );
  assert.doesNotMatch(
    legacyCustomHostnameDialog,
    /Full hostname/u,
  );
  await remote.flush();
  assert.doesNotMatch(
    cloudflareDialog,
    /Tailscale connection/u,
  );
  remote.setMethod("tailscale");
  await remote.flush();

  channels = {
    ...snapshot({
      state: "error",
      issue: "gateway-store",
    }),
    revision: 4,
  };
  await hub.dispatch({ kind: "refresh" });
  hub.setView("weixin");
  const recoveryDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(recoveryDialog, />Recreate IM Gateway</u);
  assert.doesNotMatch(
    recoveryDialog,
    />Reset local data</u,
  );

  await hub.dispose();
  remote.dispose();
});

test("Remote Hub prioritizes recovery for a blocked active remote route", async () => {
  const remote = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: {
          enabled: true,
          method: "tailscale",
          tailscale: {
            transport: "serve",
            ipAddress: "",
          },
          cloudflare: {
            hostnameMode: "generated",
            domain: "",
            generatedLabel: "m-0123456789abcdef",
            customHostname: "",
            teamName: "",
            audience: "",
            tunnel: "",
            configPath: "",
            originPort: 49_321,
          },
        },
        runtime: {
          method: "tailscale",
          transport: "serve",
          state: "retrying",
          error: "status",
        },
      };
    },
    async write() {},
  });
  await remote.initialize();
  const channels = snapshot();
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();
  const trigger = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(
    trigger,
    /aria-label="Remote: working"/u,
  );
  assert.match(trigger, /data-state="working"/u);
  hub.open();
  hub.setView("access");

  const dialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(dialog, />Retrying</u);
  assert.match(
    dialog,
    /Minke could not read a connected Tailscale node/u,
  );
  assert.match(dialog, />Refresh status</u);
  assert.match(dialog, />Disable remote access</u);
  assert.match(dialog, /Access method/u);
  assert.match(dialog, /Tailscale connection/u);
  assert.match(
    dialog,
    /Disable remote access before changing the connection configuration/u,
  );
  assert.ok(
    (dialog.match(/disabled=""/gu) ?? []).length >= 4,
  );
  assert.doesNotMatch(dialog, /Advanced settings/u);
  assert.doesNotMatch(dialog, />Enable remote access</u);
  assert.equal(
    (dialog.match(/>Private network</gu) ?? []).length,
    2,
  );

  await hub.dispose();
  remote.dispose();
});

test("Remote Hub keeps channel navigation compact and actions in the detail panel", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const channels = {
    ...snapshot({
      state: "connected",
      accountLabel: "•• 931D53",
    }),
    dependencies: {
      credentialVault: "ready",
      agentRoute: "ready",
    },
    channels: {
      weixin: {
        state: "connected",
        accountLabel: "•• 931D53",
        activity: {
          connectedAt: 1_800_000_000_000,
          lastActivityAt: 1_800_000_060_000,
          receivedMessages: 12,
          sentMessages: 9,
        },
      },
      telegram: {
        state: "pairing",
        accountLabel: "@minke_dsh_bot",
        activity: {
          connectedAt: 1_800_000_000_000,
          receivedMessages: 0,
          sentMessages: 0,
        },
      },
      discord: {
        state: "pairing",
        accountLabel: "Minke (@minke_bot)",
        request: {
          code: "ABCDEFGH",
          expiresAt: 1_900_000_000_000,
          requestId: "discord-pairing-request",
          senderLabel: "Ada Lovelace (@ada)",
        },
      },
    },
  };
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();
  const trigger = renderToStaticMarkup(
    createElement(RemoteHubAction, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
    }),
  );
  assert.match(
    trigger,
    /aria-label="Remote: capability active"/u,
  );
  assert.match(trigger, /data-state="active"/u);
  hub.open();

  const dialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(dialog, />System ready</u);
  assert.match(dialog, /WeChat · Connected/u);
  assert.doesNotMatch(dialog, /•• 931D53/u);
  assert.doesNotMatch(dialog, />Manage</u);
  assert.doesNotMatch(dialog, />Done</u);
  assert.match(dialog, />Reconnect</u);
  assert.match(dialog, />Disconnect</u);
  assert.match(dialog, /Current connection/u);
  assert.match(dialog, /Connected at/u);
  assert.match(dialog, /Online/u);
  assert.match(dialog, /Received/u);
  assert.match(dialog, /Sent/u);
  assert.match(
    dialog,
    /Counts cover this connection and reset after reconnecting or quitting Minke/u,
  );
  assert.match(
    dialog,
    /minke-remote-hub__navigation-indicator" data-state="connected" data-tone="success"/u,
  );
  assert.match(
    dialog,
    /minke-remote-hub__navigation-indicator" data-state="pairing" data-tone="success"/u,
  );
  assert.match(dialog, />Disconnect<\/button>/u);
  assert.equal(
    (dialog.match(/type="password"/gu) ?? []).length,
    0,
  );

  hub.setView("telegram");
  const telegramDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(telegramDialog, /Account @minke_dsh_bot/u);
  assert.doesNotMatch(telegramDialog, />Reconnect</u);
  assert.match(telegramDialog, />Disconnect</u);
  assert.match(telegramDialog, />Copy token</u);
  assert.match(telegramDialog, />Update token</u);
  assert.match(telegramDialog, />Clear token</u);
  assert.match(telegramDialog, /Current connection/u);
  assert.match(
    telegramDialog,
    /minke-remote-hub__channel-status" data-state="pairing" data-tone="success"/u,
  );
  assert.match(telegramDialog, />Disconnect<\/button>/u);

  hub.setView("discord");
  const discordDialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    discordDialog,
    /aria-label="Discord direct-message pairing request"/u,
  );
  assert.match(
    discordDialog,
    /After DM pairing, mention or reply to the bot in a server/u,
  );
  assert.match(
    discordDialog,
    />Pairing request from Ada Lovelace \(@ada\)</u,
  );
  assert.match(discordDialog, />Pairing code ABCDEFGH</u);
  assert.match(discordDialog, />Approve pairing</u);
  assert.match(discordDialog, />Ignore</u);
  assert.equal(
    (discordDialog.match(/type="password"/gu) ?? []).length,
    0,
  );
  assert.doesNotMatch(discordDialog, />Reconnect</u);
  assert.match(discordDialog, />Disconnect</u);
  assert.match(discordDialog, />Copy token</u);

  await hub.dispose();
  remote.dispose();
});

test("a disconnected bot offers tokenless reconnect and explicit token management", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const channels = {
    ...snapshot(),
    dependencies: {
      credentialVault: "ready",
      agentRoute: "ready",
    },
    channels: {
      weixin: { state: "unlinked" },
      telegram: {
        state: "disconnected",
        accountLabel: "@minke_dsh_bot",
      },
      discord: { state: "unlinked" },
    },
  };
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();
  hub.open();
  hub.setView("telegram");

  const dialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    dialog,
    /data-provider="telegram" data-state="disconnected"/u,
  );
  assert.match(dialog, />Disconnected</u);
  assert.match(
    dialog,
    /The token is encrypted on this device and never shown in the UI/u,
  );
  assert.match(
    dialog,
    /Copying writes the raw token to the system clipboard/u,
  );
  assert.match(dialog, />Reconnect</u);
  assert.match(dialog, />Copy token</u);
  assert.match(dialog, />Update token</u);
  assert.match(dialog, />Clear token</u);
  assert.equal(
    (dialog.match(/type="password"/gu) ?? []).length,
    0,
  );
  assert.doesNotMatch(dialog, />Connect<\/button>/u);

  await hub.dispose();
  remote.dispose();
});

test("Telegram network error does not render the Agent route-pending description", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  const channels = {
    ...snapshot(),
    dependencies: {
      credentialVault: "ready",
      agentRoute: "ready",
    },
    channels: {
      ...snapshot().channels,
      telegram: {
        state: "error",
        hasStoredCredential: false,
        issue: "network",
      },
    },
  };
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe() {
      return () => {};
    },
  });
  await hub.initialize();
  hub.open();
  hub.setView("telegram");

  const dialog = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  const telegramCard = dialog.match(
    /<section[^>]*data-provider="telegram"[^>]*>[\s\S]*?<\/section>/u,
  )?.[0];
  assert.notEqual(telegramCard, undefined);
  assert.match(
    telegramCard,
    /Telegram is temporarily unreachable\. Check the network or proxy, then retry\./u,
  );
  assert.match(
    telegramCard,
    /Connect Telegram through a Bot API token\./u,
  );
  assert.doesNotMatch(
    telegramCard,
    /Transport is verified, but external messages are not stored until Agent authorization is available\./u,
  );
  assert.doesNotMatch(telegramCard, />Reconnect</u);
  assert.doesNotMatch(telegramCard, />Disconnect</u);
  assert.match(telegramCard, /Telegram HTTP proxy/u);

  await hub.dispose();
  remote.dispose();
});

test("Discord shows manual proxy configuration only after automatic routing fails", async () => {
  const remote = new RemoteSettingsRuntime({
    available: false,
    async read() {
      throw new Error("remote access unavailable");
    },
    async write() {},
  });
  let channels = {
    ...snapshot(),
    discordNetwork: {
      httpProxyUrl: "",
      proxySource: "telegram",
    },
    dependencies: {
      credentialVault: "ready",
      agentRoute: "ready",
    },
  };
  let push = () => {};
  const hub = new RemoteHubRuntime(remote, {
    available: true,
    async read() {
      return channels;
    },
    async dispatch() {
      return channels;
    },
    subscribe(listener) {
      push = listener;
      return () => {};
    },
  });
  await hub.initialize();
  hub.open();
  hub.setView("discord");

  const healthy = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    healthy,
    /Network route: automatic proxy/u,
  );
  assert.doesNotMatch(
    healthy,
    /Discord HTTP proxy \(manual fallback\)/u,
  );

  channels = {
    ...channels,
    revision: channels.revision + 1,
    channels: {
      ...channels.channels,
      discord: {
        state: "error",
        hasStoredCredential: true,
        issue: "network",
      },
    },
  };
  push(channels);
  const failed = renderToStaticMarkup(
    createElement(RemoteHubDialogHost, {
      runtime: hub,
      t: (key) => remoteHubEn[key],
      remoteT: (key) => remoteEn[key],
    }),
  );
  assert.match(
    failed,
    /Discord HTTP proxy \(manual fallback\)/u,
  );
  assert.match(
    failed,
    /Minke already tries the system proxy and reuses the Telegram proxy when available/u,
  );
  assert.match(failed, /type="url"/u);

  await hub.dispose();
  remote.dispose();
});
