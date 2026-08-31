import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HarnessLifecycle,
} from "@minke/desktop/main/harness-lifecycle.ts";
import {
  canGrantHarnessPermission,
  installHarnessPermissionPolicy,
} from "@minke/desktop/main/harness-permission-policy.ts";

const HARNESS_ORIGIN = "http://127.0.0.1:43117";
const HARNESS_LAUNCH_TOKEN = "a".repeat(43);
const HARNESS_AUTHENTICATED_URL =
  `${HARNESS_ORIGIN}/?token=${HARNESS_LAUNCH_TOKEN}`;

function harnessEndpoint() {
  return {
    origin: HARNESS_ORIGIN,
    authenticatedUrl: HARNESS_AUTHENTICATED_URL,
    launchToken: HARNESS_LAUNCH_TOKEN,
  };
}

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
        return harnessEndpoint();
      },
    },
    remote: {
      async detach() {
        events.push("remote:detach");
      },
      async start(url, launchToken) {
        events.push(`remote:start:${url}:${launchToken}`);
      },
    },
  });

  await lifecycle.start();
  assert.equal(
    lifecycle.url,
    HARNESS_ORIGIN,
  );
  assert.deepEqual(events, [
    "remote:detach",
    "runtime:start",
    `remote:start:${HARNESS_ORIGIN}:${HARNESS_LAUNCH_TOKEN}`,
  ]);

  await lifecycle.attach(harnessWindow(events));
  assert.equal(
    events.at(-1),
    `window:${HARNESS_AUTHENTICATED_URL}`,
  );

  await lifecycle.attach(harnessWindow(events));
  assert.equal(
    events.at(-1),
    `window:${HARNESS_ORIGIN}`,
    "the launch capability is discarded after a successful exchange",
  );

  lifecycle.clear();
  await lifecycle.attach(harnessWindow(events));
  assert.equal(
    events.filter((event) => event.startsWith("window:")).length,
    2,
  );
});

test("Harness loads the local window before enabling remote access", async () => {
  const events = [];
  const lifecycle = new HarnessLifecycle({
    runtime: {
      async start() {
        events.push("runtime:start");
        return harnessEndpoint();
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
    `window:${HARNESS_AUTHENTICATED_URL}`,
    "remote:start",
  ]);
});
