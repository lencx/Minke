import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
  RemoteHubCapabilityRuntime,
} from "@minke/desktop/main/remote-hub/runtime.ts";
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

function snapshot(weixin = { state: "unlinked" }) {
  return {
    revision: 3,
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
      kind: "discord/unlink",
    }),
    { kind: "discord/unlink" },
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
    issue: "polling-conflict",
  };
  value.channels.discord = {
    state: "error",
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

test("Remote Hub IPC authorizes both reads and finite commands", async () => {
  const handlers = new Map();
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
      async dispatch() {
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
      { kind: "refresh" },
    ),
    current,
  );
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
      provider: "telegram",
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
            provider: "telegram",
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
  });
  return { runtime, state };
}

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
  assert.deepEqual(runtime.getSnapshot(), {
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
  assert.deepEqual(runtime.getSnapshot(), {
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
  assert.deepEqual(runtime.getSnapshot(), {
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
    ["stop-for-gateway-reset", "reconnect"],
  );
  assert.deepEqual(
    discord.calls.slice(-2),
    ["stop-for-gateway-reset", "reconnect"],
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
  const reconnectIndex = telegram.calls.indexOf("reconnect");
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
    runtime.getSnapshot().channels.weixin,
    { state: "unlinked" },
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
    runtime.getSnapshot().channels.weixin,
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
    runtime.getSnapshot().channels.weixin,
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

test("Weixin vault wraps one AEAD key and rejects Gateway tampering", async () => {
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
    assert.equal(source.includes("private-token"), false);
    assert.equal(
      telegramSource.includes(telegramCredential.token),
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

test("Remote entry surfaces Remote Settings work and write failures", async () => {
  let rejectWrite;
  const remote = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: {
          enabled: true,
          method: "tailscale",
          tailscale: { transport: "serve" },
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
    /aria-label="Remote: working"/u,
  );

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
    /aria-label="Remote: needs attention"/u,
  );
  await hub.dispose();
  remote.dispose();
});

test("Remote Hub renders one accessible entry and a dialog containing IM and Tailscale controls", async () => {
  const remote = new RemoteSettingsRuntime({
    available: true,
    async read() {
      return {
        available: { tailscale: true, cloudflare: false },
        settings: {
          enabled: false,
          method: "tailscale",
          tailscale: { transport: "serve" },
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
  assert.match(
    trigger,
    /aria-label="Remote: needs attention"/u,
  );
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
  assert.match(dialog, />Weixin</u);
  assert.match(dialog, />Telegram</u);
  assert.match(dialog, />Discord</u);
  assert.equal(
    (dialog.match(/type="password"/gu) ?? []).length,
    2,
  );
  assert.equal(
    (dialog.match(/aria-describedby=/gu) ?? []).length >= 3,
    true,
  );
  assert.doesNotMatch(dialog, /planned/iu);
  assert.match(dialog, /Tailscale connection/u);
  assert.match(dialog, /role="status"/u);
  assert.match(dialog, /Enable remote access/u);
  assert.match(dialog, />Disconnect</u);
  assert.match(dialog, />Reset local data</u);

  channels = {
    ...snapshot({
      state: "error",
      issue: "gateway-store",
    }),
    revision: 4,
  };
  await hub.dispatch({ kind: "refresh" });
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
