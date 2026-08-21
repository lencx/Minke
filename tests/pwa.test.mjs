import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import {
  injectMinkePwaHead,
  MINKE_PWA_MANIFEST,
  MINKE_PWA_ROUTES,
  MINKE_PWA_SERVICE_WORKER,
} from "@minke/harness-overlay/host/pwa.ts";
import {
  PwaInstallRuntime,
} from "@minke/harness-overlay/client/pwa/runtime.ts";

const overlayManifest = JSON.parse(
  readFileSync(
    new URL(
      "../packages/harness-overlay/package.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const stageSource = readFileSync(
  new URL("../scripts/harness/stage.mjs", import.meta.url),
  "utf8",
);

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pngAlphaAt(buffer, x, y) {
  const { width, height } = pngDimensions(buffer);
  assert.equal(buffer[24], 8, "PWA icons must use 8-bit channels");
  assert.equal(buffer[25], 6, "PWA icons must use RGBA pixels");
  assert.ok(x >= 0 && x < width);
  assert.ok(y >= 0 && y < height);
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(chunks));
  const rows = Buffer.alloc(rowLength * height);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (
      leftDistance <= aboveDistance &&
      leftDistance <= upperLeftDistance
    ) {
      return left;
    }
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowLength + 1);
    const targetOffset = row * rowLength;
    const filter = filtered[sourceOffset];
    for (let column = 0; column < rowLength; column += 1) {
      const raw = filtered[sourceOffset + 1 + column];
      const left =
        column >= bytesPerPixel
          ? rows[targetOffset + column - bytesPerPixel]
          : 0;
      const above =
        row > 0
          ? rows[targetOffset + column - rowLength]
          : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? rows[
              targetOffset +
                column -
                rowLength -
                bytesPerPixel
            ]
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      rows[targetOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return rows[y * rowLength + x * bytesPerPixel + 3];
}

function installPrompt(outcome = "accepted") {
  let prompts = 0;
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  });
  Object.defineProperties(event, {
    prompt: {
      value: async () => {
        prompts += 1;
      },
    },
    userChoice: {
      value: Promise.resolve({
        outcome,
        platform: "web",
      }),
    },
  });
  return {
    event,
    promptCount: () => prompts,
  };
}

function pwaWindow({
  bootstrapPrompt,
  ios = false,
  secure = true,
  standalone = false,
} = {}) {
  const target = new EventTarget();
  const registrations = [];
  const media = new EventTarget();
  media.matches = standalone;
  media.media = "(display-mode: standalone)";
  const navigator = {
    serviceWorker: {
      async register(url, options) {
        registrations.push([url, options]);
        return {};
      },
    },
  };
  if (ios) navigator.standalone = standalone;
  Object.assign(target, {
    isSecureContext: secure,
    navigator,
    __minkePwa: {
      installPrompt: bootstrapPrompt,
    },
    matchMedia() {
      return media;
    },
  });
  return {
    registrations,
    target,
  };
}

function serviceWorkerNavigation(fetchImpl, language = "zh-CN") {
  const listeners = new Map();
  const timers = [];
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      async claim() {},
    },
    async skipWaiting() {},
  };
  runInNewContext(MINKE_PWA_SERVICE_WORKER, {
    AbortController,
    Response,
    clearTimeout(timer) {
      const index = Number(timer) - 1;
      if (index >= 0) timers[index] = undefined;
    },
    fetch: fetchImpl,
    self,
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  });
  let response;
  listeners.get("fetch")({
    request: {
      headers: new Headers({
        "accept-language": language,
      }),
      mode: "navigate",
    },
    respondWith(value) {
      response = Promise.resolve(value);
    },
  });
  assert.ok(response, "navigation must be handled by the service worker");
  return {
    fireTimer(index = 0) {
      const callback = timers[index];
      timers[index] = undefined;
      callback?.();
    },
    response,
    timers,
  };
}

test("Minke PWA manifest owns standalone branding and install icons", () => {
  const manifest = JSON.parse(MINKE_PWA_MANIFEST);
  assert.equal(manifest.id, "/");
  assert.equal(manifest.name, "Minke");
  assert.equal(manifest.short_name, "Minke");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#0e1324");
  assert.equal(manifest.theme_color, "#0e1324");
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type, purpose }) => ({
      src,
      sizes,
      type,
      purpose,
    })),
    [
      {
        src: MINKE_PWA_ROUTES.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: MINKE_PWA_ROUTES.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: MINKE_PWA_ROUTES.maskableIcon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  );
});

test("PWA package icons have the dimensions declared by the manifest", () => {
  const root = new URL(
    "../packages/harness-overlay/assets/pwa/",
    import.meta.url,
  );
  assert.deepEqual(
    pngDimensions(readFileSync(new URL("icon-192.png", root))),
    { width: 192, height: 192 },
  );
  assert.deepEqual(
    pngDimensions(readFileSync(new URL("icon-512.png", root))),
    { width: 512, height: 512 },
  );
  assert.deepEqual(
    pngDimensions(
      readFileSync(new URL("icon-maskable-512.png", root)),
    ),
    { width: 512, height: 512 },
  );
  assert.deepEqual(
    pngDimensions(readFileSync(new URL("apple-touch-icon.png", root))),
    { width: 180, height: 180 },
  );
});

test("PWA install icons fill the canvas without transparent padding", () => {
  const root = new URL(
    "../packages/harness-overlay/assets/pwa/",
    import.meta.url,
  );
  for (const [name, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ]) {
    const icon = readFileSync(new URL(name, root));
    const middle = Math.floor(size / 2);
    assert.equal(
      pngAlphaAt(icon, middle, 0),
      255,
      `${name} must reach the top edge`,
    );
    assert.equal(
      pngAlphaAt(icon, 0, middle),
      255,
      `${name} must reach the left edge`,
    );
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ]) {
      assert.equal(
        pngAlphaAt(icon, x, y),
        255,
        `${name} must be opaque at ${String(x)},${String(y)}`,
      );
    }
  }
  const maskable = readFileSync(
    new URL("icon-maskable-512.png", root),
  );
  assert.equal(
    pngAlphaAt(maskable, 0, 0),
    255,
    "maskable icon background must cover the complete canvas",
  );
  assert.match(MINKE_PWA_ROUTES.icon192, /fullbleed/u);
  assert.match(MINKE_PWA_ROUTES.icon512, /fullbleed/u);
  assert.match(MINKE_PWA_ROUTES.appleTouchIcon, /fullbleed/u);
});

test("PWA assets are part of the staged product package", () => {
  assert.equal(overlayManifest.files.includes("assets"), true);
  assert.match(
    stageSource,
    /"package\.json",\s*"lib",\s*"assets",\s*"config"/u,
  );
});

test("PWA index metadata is branded, early, and idempotent", () => {
  const source = [
    "<!doctype html>",
    "<html><head>",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<script type="module" src="/assets/app.js"></script>',
    '</head><body><div id="root"></div></body></html>',
  ].join("");
  const once = injectMinkePwaHead(source);
  const twice = injectMinkePwaHead(once);
  assert.equal(twice, once);
  assert.match(
    once,
    new RegExp(`href="${MINKE_PWA_ROUTES.appleTouchIcon}"`, "u"),
  );
  assert.match(
    once,
    new RegExp(`href="${MINKE_PWA_ROUTES.iconSvg}"`, "u"),
  );
  assert.match(once, /name="theme-color" content="#0e1324"/u);
  assert.match(
    once,
    /name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/u,
  );
  assert.equal(
    once.match(/\bname="viewport"/gu)?.length,
    1,
  );
  assert.match(
    once,
    /name="apple-mobile-web-app-title" content="Minke"/u,
  );
  assert.match(
    once,
    new RegExp(
      `<script defer src="${MINKE_PWA_ROUTES.bootstrap}"`,
      "u",
    ),
  );
  assert.ok(
    once.indexOf(MINKE_PWA_ROUTES.bootstrap) <
      once.indexOf('type="module"'),
  );
  assert.match(once, /data-minke-pwa-launch/u);
  assert.match(once, /role="status" aria-live="polite"/u);
  assert.match(
    once,
    /#root:has\(> :not\(\[data-minke-pwa-launch\]\)\)/u,
  );
  assert.doesNotMatch(once, /href="\/favicon\.svg"/u);
});

test("Minke service worker never caches authenticated app traffic", () => {
  assert.match(
    MINKE_PWA_SERVICE_WORKER,
    /request\.mode !== "navigate"/u,
  );
  assert.match(
    MINKE_PWA_SERVICE_WORKER,
    /fetch\(request,\{signal:controller\.signal\}\)/u,
  );
  assert.match(MINKE_PWA_SERVICE_WORKER, /Minke Host/u);
  assert.doesNotMatch(
    MINKE_PWA_SERVICE_WORKER,
    /\bcaches\.(?:open|match)|cache\.put/u,
  );
});

test("a slow installed-PWA navigation shows connecting feedback promptly", async () => {
  const navigation = serviceWorkerNavigation(
    () => new Promise(() => {}),
  );
  assert.equal(
    navigation.timers.length,
    1,
    "navigation should have a bounded wait",
  );
  navigation.fireTimer();
  const result = await Promise.race([
    navigation.response,
    new Promise((resolve) => {
      setTimeout(() => resolve("stalled"), 50);
    }),
  ]);
  assert.notEqual(result, "stalled");
  assert.ok(result instanceof Response);
  assert.equal(result.status, 503);
  const body = await result.text();
  assert.match(body, /data-minke-pwa-connecting/u);
  assert.match(body, /正在连接 Minke Host/u);
  assert.match(body, /fetch\(location\.href/u);
});

test("PWA navigation preserves fast responses and explicit offline feedback", async () => {
  const networkResponse = new Response("<p>Minke</p>", {
    status: 200,
  });
  const online = serviceWorkerNavigation(
    async () => networkResponse,
    "en-US",
  );
  assert.equal(await online.response, networkResponse);

  const offline = serviceWorkerNavigation(
    async () => {
      throw new TypeError("network unavailable");
    },
    "zh-CN",
  );
  const offlineResponse = await offline.response;
  assert.equal(offlineResponse.status, 503);
  assert.match(
    await offlineResponse.text(),
    /无法连接到 Minke Host/u,
  );
});

test("Chromium install prompts are captured and consumed once", async () => {
  const window = pwaWindow();
  const runtime = new PwaInstallRuntime(window.target);
  const dispose = runtime.mount();
  assert.equal(runtime.getSnapshot().mode, "hidden");

  const prompt = installPrompt("accepted");
  window.target.dispatchEvent(prompt.event);
  assert.equal(prompt.event.defaultPrevented, true);
  assert.equal(runtime.getSnapshot().mode, "ready");
  assert.equal(await runtime.install(), "installed");
  assert.equal(prompt.promptCount(), 1);
  assert.equal(runtime.getSnapshot().mode, "installed");
  assert.deepEqual(window.registrations, [
    [
      MINKE_PWA_ROUTES.serviceWorker,
      {
        scope: "/",
        updateViaCache: "none",
      },
    ],
  ]);
  dispose();
});

test("a prompt captured before Harness boot remains installable", () => {
  const prompt = installPrompt();
  const window = pwaWindow({
    bootstrapPrompt: prompt.event,
  });
  const runtime = new PwaInstallRuntime(window.target);
  const dispose = runtime.mount();
  assert.equal(runtime.getSnapshot().mode, "ready");
  dispose();
});

test("iOS receives manual Home Screen guidance without a fake prompt", async () => {
  const window = pwaWindow({ ios: true });
  const runtime = new PwaInstallRuntime(window.target);
  const dispose = runtime.mount();
  assert.deepEqual(runtime.getSnapshot(), {
    mode: "manual",
    guide: "ios",
  });
  assert.equal(await runtime.install(), "manual");
  dispose();
});

test("standalone and insecure contexts do not offer installation", () => {
  for (const options of [
    { standalone: true },
    { ios: true, standalone: true },
    { secure: false },
  ]) {
    const window = pwaWindow(options);
    const runtime = new PwaInstallRuntime(window.target);
    const dispose = runtime.mount();
    assert.equal(runtime.getSnapshot().mode, options.secure === false
      ? "hidden"
      : "installed");
    assert.equal(window.registrations.length, options.secure === false ? 0 : 1);
    dispose();
  }
});
