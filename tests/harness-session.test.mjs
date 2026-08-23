import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HarnessLifecycle,
} from "@minke/desktop/main/harness-lifecycle.ts";
import {
  canGrantHarnessPermission,
  installHarnessPermissionPolicy,
} from "@minke/desktop/main/harness-permission-policy.ts";

function harnessWindow(events) {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
    },
    async loadURL(url) {
      events.push(`window:${url}`);
    },
  };
}

test("Harness permissions are limited to clipboard writes by the active renderer", () => {
  const activeWebContents = {};
  const request = {
    permission: "clipboard-sanitized-write",
    candidateUrl: "http://127.0.0.1:43117/session/one",
    harnessUrl: "http://127.0.0.1:43117",
    requestingWebContents: activeWebContents,
    activeWebContents,
  };

  assert.equal(canGrantHarnessPermission(request), true);
  assert.equal(
    canGrantHarnessPermission({
      ...request,
      permission: "geolocation",
    }),
    false,
  );
  assert.equal(
    canGrantHarnessPermission({
      ...request,
      requestingWebContents: {},
    }),
    false,
    "a same-origin popup must not inherit main-window permissions",
  );
  assert.equal(
    canGrantHarnessPermission({
      ...request,
      candidateUrl: "http://127.0.0.1:43118/session/one",
    }),
    false,
  );
  assert.equal(
    canGrantHarnessPermission({
      ...request,
      candidateUrl: "not a URL",
    }),
    false,
  );
});

test("Harness permission wiring applies the same policy to checks and requests", () => {
  const activeWebContents = {};
  let check;
  let request;
  installHarnessPermissionPolicy(
    {
      setPermissionCheckHandler(handler) {
        check = handler;
      },
      setPermissionRequestHandler(handler) {
        request = handler;
      },
    },
    {
      harnessUrl: () => "http://127.0.0.1:43117",
      activeWebContents: () => activeWebContents,
    },
  );

  assert.equal(
    check(
      activeWebContents,
      "clipboard-sanitized-write",
      "http://127.0.0.1:43117",
      {},
    ),
    true,
  );
  assert.equal(
    check(
      activeWebContents,
      "geolocation",
      "http://127.0.0.1:43117",
      {},
    ),
    false,
  );

  let granted;
  request(
    {},
    "clipboard-sanitized-write",
    (value) => {
      granted = value;
    },
    { requestingUrl: "http://127.0.0.1:43117/session/one" },
  );
  assert.equal(
    granted,
    false,
    "the request path must also reject a same-origin popup",
  );
});

test("Harness restarts without a window and a later window attaches to it", async () => {
  const events = [];
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        events.push("runtime:start");
        return "http://127.0.0.1:43117";
      },
    },
    remote: {
      async detach() {
        events.push("remote:detach");
      },
      async start(url) {
        events.push(`remote:start:${url}`);
      },
    },
  });

  await lifecycle.start();
  assert.equal(
    lifecycle.url,
    "http://127.0.0.1:43117",
  );
  assert.deepEqual(events, [
    "remote:detach",
    "runtime:start",
    "remote:start:http://127.0.0.1:43117",
  ]);

  await lifecycle.attach(harnessWindow(events));
  assert.equal(
    events.at(-1),
    "window:http://127.0.0.1:43117",
  );

  lifecycle.clear();
  await lifecycle.attach(harnessWindow(events));
  assert.equal(
    events.filter((event) => event.startsWith("window:")).length,
    1,
  );
});

test("Harness loads the local window before enabling remote access", async () => {
  const events = [];
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        events.push("runtime:start");
        return "http://127.0.0.1:43117";
      },
    },
    remote: {
      async detach() {
        events.push("remote:detach");
      },
      async start() {
        events.push("remote:start");
      },
    },
  });

  await lifecycle.start(harnessWindow(events));
  assert.deepEqual(events, [
    "remote:detach",
    "runtime:start",
    "window:http://127.0.0.1:43117",
    "remote:start",
  ]);
});
