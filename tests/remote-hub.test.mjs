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
  WeixinGrantVault,
} from "@minke/desktop/main/remote-hub/weixin-vault.ts";
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
      telegram: { state: "planned" },
      discord: { state: "planned" },
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
            "register:1",
            "recover",
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
    async pollProviderOnce({ signal }) {
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
    "register:1",
    "recover",
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
  const root = await mkdtemp(join(tmpdir(), "minke-weixin-vault-"));
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
    const vault = new WeixinGrantVault(root, safeStorage);
    await vault.write({
      generation: 1,
      grant: {
        accountId: "private-account",
        token: "private-token",
        baseUrl: "https://ilinkai.weixin.qq.com/",
      },
    });
    const source = await readFile(
      join(root, "secrets", "weixin.grant.json"),
      "utf8",
    );
    const keySource = await readFile(
      join(root, "secrets", "im-gateway.key.json"),
      "utf8",
    );
    assert.equal(source.includes("private-token"), false);
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
    const reopenedVault = new WeixinGrantVault(
      root,
      safeStorage,
    );
    assert.deepEqual(
      await reopenedVault.read(),
      expectedGrant,
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
