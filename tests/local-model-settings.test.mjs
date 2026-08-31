import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, test } from "node:test";
import {
  act,
  createElement,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  JSDOM,
} from "../vendor/deepseek-harness/node_modules/jsdom/lib/api.js";
import {
  bindModelRuntimeSettingsIpc,
} from "@minke/desktop/main/model-runtime-settings.ts";
import {
  discoverLocalModelCommands,
} from "@minke/desktop/main/local-model-command.ts";
import {
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  DEFAULT_MODEL_RUNTIME_SETTINGS,
  MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
  MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  parseModelRuntimeSettingsSnapshot,
} from "@lencx/minke-model-runtime/contract";
import {
  installLocalModel,
} from "@minke/harness-overlay/client/local-model/install.ts";
import {
  LOCAL_MODEL_SETTINGS_STYLES,
  LocalModelSettingsRuntime,
} from "@minke/harness-overlay/client/local-model/index.ts";
import {
  installLocalModelSettings,
} from "@minke/harness-overlay/client/local-model/view.tsx";
import {
  localModelEn,
  localModelZh,
} from "@minke/harness-overlay/client/local-model/locales.ts";

const roots = [];

async function temporaryRoot(prefix = "minke-local-model-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

test("local model command discovery shares standard-path and PATH lookup", async () => {
  const root = await temporaryRoot();
  const home = join(root, "home");
  const standard = join(
    home,
    ".lmstudio",
    "bin",
    process.platform === "win32" ? "lms.exe" : "lms",
  );
  await mkdir(join(home, ".lmstudio", "bin"), { recursive: true });
  await writeFile(standard, "");
  if (process.platform !== "win32") await chmod(standard, 0o700);

  assert.equal(
    await discoverLocalModelCommands({
      homeDirectory: home,
      pathValue: "",
      platform: process.platform,
      includeSystemLocations: false,
    }).then(({ lmStudio }) => lmStudio),
    standard,
  );

  await rm(standard);
  const firstBin = join(root, "first-bin");
  const secondBin = join(root, "second-bin");
  const ollamaFromPath = join(
    secondBin,
    process.platform === "win32" ? "ollama.exe" : "ollama",
  );
  await Promise.all([
    mkdir(firstBin),
    mkdir(secondBin),
  ]);
  await writeFile(ollamaFromPath, "");
  if (process.platform !== "win32") {
    await chmod(ollamaFromPath, 0o700);
  }

  assert.deepEqual(
    await discoverLocalModelCommands({
      homeDirectory: home,
      pathValue: [firstBin, secondBin].join(delimiter),
      platform: process.platform,
      includeSystemLocations: false,
    }),
    {
      ollama: ollamaFromPath,
    },
  );
  assert.deepEqual(
    await discoverLocalModelCommands({
      homeDirectory: home,
      pathValue: "",
      platform: process.platform,
      includeSystemLocations: false,
    }),
    {},
  );
});

test("model runtime settings IPC reports availability and persists opt-ins", async () => {
  const root = await temporaryRoot();
  const config = new MinkeConfigStore(root);
  const handlers = new Map();
  const applied = [];
  const ipcMain = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
  const binding = bindModelRuntimeSettingsIpc(
    ipcMain,
    config.modelRuntime,
    {
      lmStudio: true,
      ollama: false,
    },
    (event) => event === "allowed",
    async (settings, mode) => {
      applied.push({ settings, mode });
    },
  );

  assert.deepEqual(
    await handlers.get(MODEL_RUNTIME_SETTINGS_READ_CHANNEL)("allowed"),
    {
      available: {
        lmStudio: true,
        ollama: false,
      },
      settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
    },
  );
  await handlers.get(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL)(
    "allowed",
    {
      lmStudio: { enabled: true },
      ollama: { enabled: false },
    },
  );
  assert.deepEqual(await config.modelRuntime.read(), {
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  });
  assert.deepEqual(applied, [
    {
      settings: {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
      mode: "apply",
    },
    {
      settings: {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
      mode: "finalize",
    },
  ]);
  await assert.rejects(
    handlers.get(MODEL_RUNTIME_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("settings reads wait for an in-flight live persistence transaction", async () => {
  const handlers = new Map();
  let persisted = {
    lmStudio: { enabled: false },
    ollama: { enabled: false },
  };
  let releaseWrite;
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let announceWrite;
  const writeStarted = new Promise((resolve) => {
    announceWrite = resolve;
  });
  const binding = bindModelRuntimeSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        return persisted;
      },
      async write(settings) {
        announceWrite();
        await writeGate;
        persisted = settings;
      },
    },
    {
      lmStudio: true,
      ollama: true,
    },
    () => true,
    async () => {},
  );
  const next = {
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  };
  const writing = handlers.get(
    MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL,
  )("allowed", next);
  await writeStarted;

  let readSettled = false;
  const reading = handlers.get(
    MODEL_RUNTIME_SETTINGS_READ_CHANNEL,
  )("allowed").then((snapshot) => {
    readSettled = true;
    return snapshot;
  });
  await Promise.resolve();
  assert.equal(
    readSettled,
    false,
    "a new renderer generation must not hydrate from the old disk baseline",
  );

  releaseWrite();
  await writing;
  assert.deepEqual(await reading, {
    available: {
      lmStudio: true,
      ollama: true,
    },
    settings: next,
  });
  binding.dispose();
});

test("a local runtime cannot be enabled when its command is absent", async () => {
  const handlers = new Map();
  const binding = bindModelRuntimeSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        return DEFAULT_MODEL_RUNTIME_SETTINGS;
      },
      async write() {
        assert.fail("unavailable settings must not be persisted");
      },
    },
    {
      lmStudio: true,
      ollama: false,
    },
    () => true,
    async () => {
      assert.fail("unavailable settings must not be applied");
    },
  );

  await assert.rejects(
    handlers.get(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      {
        lmStudio: { enabled: false },
        ollama: { enabled: true },
      },
    ),
    /Ollama command is unavailable/u,
  );
  binding.dispose();
});

test("model runtime settings stay persisted only when live reconciliation succeeds", async () => {
  const handlers = new Map();
  const writes = [];
  const initial = {
    lmStudio: { enabled: false },
    ollama: { enabled: false },
  };
  const binding = bindModelRuntimeSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        return initial;
      },
      async write(settings) {
        writes.push(settings);
      },
    },
    {
      lmStudio: true,
      ollama: true,
    },
    () => true,
    async () => {
      throw new Error("candidate runtime failed");
    },
  );

  await assert.rejects(
    handlers.get(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
    ),
    /candidate runtime failed/u,
  );
  assert.deepEqual(writes, []);
  binding.dispose();
});

test("a persistence failure restores the previous live runtime settings", async () => {
  const handlers = new Map();
  const applied = [];
  const initial = {
    lmStudio: { enabled: false },
    ollama: { enabled: false },
  };
  const binding = bindModelRuntimeSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        return initial;
      },
      async write() {
        throw new Error("disk unavailable");
      },
    },
    {
      lmStudio: true,
      ollama: true,
    },
    () => true,
    async (settings, mode) => {
      applied.push({ settings, mode });
    },
  );

  await assert.rejects(
    handlers.get(MODEL_RUNTIME_SETTINGS_WRITE_CHANNEL)(
      "allowed",
      {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
    ),
    /disk unavailable/u,
  );
  assert.deepEqual(applied, [
    {
      settings: {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
      mode: "apply",
    },
    {
      settings: initial,
      mode: "rollback",
    },
  ]);
  binding.dispose();
});

test("local model settings runtime hydrates and serializes switch changes", async () => {
  const writes = [];
  const runtime = new LocalModelSettingsRuntime({
    available: true,
    async read() {
      return {
        available: {
          lmStudio: true,
          ollama: true,
        },
        settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
      };
    },
    async write(settings) {
      writes.push({ ...settings });
    },
  });

  await runtime.initialize();
  assert.equal(runtime.getSnapshot().available.ollama, true);
  assert.equal(runtime.getSnapshot().editable, true);
  runtime.setEnabled("ollama", true);
  await runtime.flush();
  assert.deepEqual(writes, [{
    lmStudio: { enabled: false },
    ollama: { enabled: true },
  }]);
  assert.equal(
    runtime.getSnapshot().settings.ollama.enabled,
    true,
  );
  runtime.dispose();
});

test("a failed settings read stays non-editable and can retry safely", async () => {
  let reads = 0;
  const recovered = {
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  };
  const runtime = new LocalModelSettingsRuntime({
    available: true,
    async read() {
      reads += 1;
      return reads === 1
        ? {
            available: {
              lmStudio: true,
              ollama: true,
            },
            settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
            error: "read",
          }
        : {
            available: {
              lmStudio: true,
              ollama: true,
            },
            settings: recovered,
          };
    },
    async write() {
      assert.fail("an unknown persisted baseline must not be overwritten");
    },
  });

  await runtime.initialize();
  assert.equal(runtime.getSnapshot().error, "read");
  assert.equal(runtime.getSnapshot().editable, false);
  assert.throws(
    () => runtime.setEnabled("ollama", true),
    /not editable/u,
  );

  await runtime.retry();
  assert.equal(reads, 2);
  assert.equal(runtime.getSnapshot().error, undefined);
  assert.equal(runtime.getSnapshot().editable, true);
  assert.deepEqual(runtime.getSnapshot().settings, recovered);
  runtime.dispose();
});

test("a rejected live switch rolls the optimistic setting back", async () => {
  const runtime = new LocalModelSettingsRuntime({
    available: true,
    async read() {
      return {
        available: {
          lmStudio: true,
          ollama: true,
        },
        settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
      };
    },
    async write() {
      throw new Error("live apply failed");
    },
  });

  await runtime.initialize();
  runtime.setEnabled("lmStudio", true);
  assert.equal(
    runtime.getSnapshot().settings.lmStudio.enabled,
    true,
  );
  await runtime.flush();
  assert.equal(runtime.getSnapshot().error, "write");
  assert.equal(
    runtime.getSnapshot().settings.lmStudio.enabled,
    false,
  );
  runtime.dispose();
});

function localModelViewRuntime(overrides = {}) {
  const snapshot = {
    available: {
      lmStudio: true,
      ollama: false,
    },
    settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
    editable: true,
    applying: false,
    error: undefined,
    revision: 1,
    ...overrides.snapshot,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    retry: async () => {},
    setEnabled() {},
    ...overrides,
  };
}

function installLocalModelSlotHarness(runtime) {
  const records = [];
  const events = [];
  const slots = {
    inject(name, callback) {
      events.push(`inject:${name}`);
      const unregister = callback();
      return () => {
        unregister();
        events.push(`inject:remove:${name}`);
      };
    },
    register(options, component) {
      records.push({ options, component });
      events.push(`register:${options.name}`);
      return () => events.push(`register:remove:${options.name}`);
    },
  };
  const dispose = installLocalModelSettings(
    slots,
    runtime,
    (key) => localModelEn[key],
  );
  return { dispose, events, records };
}

test("native Models slots render local provider controls and fallback rows", () => {
  const runtime = localModelViewRuntime();
  const harness = installLocalModelSlotHarness(runtime);
  assert.deepEqual(
    harness.records.map(({ options }) => options),
    [
      {
        name: "settings.models.provider-card",
        key: "llm-pi-ai",
        inject: harness.records[0].options.inject,
      },
      {
        name: "settings.models.footer",
        id: "minke-local-model-runtimes",
        order: 0,
        inject: harness.records[1].options.inject,
      },
    ],
  );

  const provider = harness.records[0];
  const providerProps = provider.options.inject();
  const lmStudioMarkup = renderToStaticMarkup(
    createElement(provider.component, {
      ...providerProps,
      configured: true,
      keyConfigured: false,
      provider: {
        provider: "lm-studio",
        displayName: "LM Studio",
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", "lm-studio"],
        active: true,
      },
    }),
  );
  assert.match(
    lmStudioMarkup,
    /data-minke-local-model-provider-card="lmStudio"/u,
  );
  assert.match(lmStudioMarkup, /role="switch"/u);
  assert.match(lmStudioMarkup, /aria-label="LM Studio: Auto-start"/u);
  assert.equal(
    renderToStaticMarkup(
      createElement(provider.component, {
        ...providerProps,
        configured: true,
        keyConfigured: true,
        provider: {
          provider: "openai",
          displayName: "OpenAI",
          settingsNs: "llm-pi-ai",
          settingsPath: ["providers", "openai"],
          active: true,
        },
      }),
    ),
    "",
    "the keyed adapter family seat must ignore unrelated pi-ai routes",
  );

  const footer = harness.records[1];
  const footerMarkup = renderToStaticMarkup(
    createElement(
      footer.component,
      footer.options.inject(),
    ),
  );
  assert.match(
    footerMarkup,
    /data-minke-local-model-runtime-settings=""/u,
  );
  assert.match(
    footerMarkup,
    /data-minke-local-model-footer-row="lmStudio"/u,
  );
  assert.match(
    footerMarkup,
    /data-minke-local-model-footer-row="ollama"/u,
  );
  assert.match(footerMarkup, /Ollama: Auto-start/u);
  assert.match(
    footerMarkup,
    /Local command not found; configure a service URL manually/u,
  );
  assert.match(
    LOCAL_MODEL_SETTINGS_STYLES,
    /:root:has\([\s\S]*data-minke-local-model-provider-card="lmStudio"[\s\S]*data-minke-local-model-footer-row="lmStudio"/u,
  );
  assert.doesNotMatch(
    LOCAL_MODEL_SETTINGS_STYLES,
    /minke-local-model-(?:configure-card|hidden-field|token-hint)/u,
  );

  harness.dispose();
  assert.deepEqual(harness.events.slice(-4), [
    "register:remove:settings.models.footer",
    "inject:remove:settings.models.footer",
    "register:remove:settings.models.provider-card",
    "inject:remove:settings.models.provider-card",
  ]);
});

async function withBrowserGlobals(dom, callback) {
  const values = {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    window: dom.window,
  };
  const descriptors = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    }
    return await callback();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
}

test("native provider auto-start switches delegate through the settings runtime", async () => {
  const changes = [];
  const runtime = localModelViewRuntime({
    setEnabled(id, enabled) {
      changes.push({ id, enabled });
    },
  });
  const harness = installLocalModelSlotHarness(runtime);
  const provider = harness.records[0];
  const dom = new JSDOM(
    '<!doctype html><div id="root"></div>',
    { pretendToBeVisual: true },
  );
  try {
    await withBrowserGlobals(dom, async () => {
      const { createRoot } = await import("react-dom/client");
      const container =
        dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(provider.component, {
              ...provider.options.inject(),
              configured: true,
              keyConfigured: false,
              provider: {
                provider: "lm-studio",
                displayName: "LM Studio",
                settingsNs: "llm-pi-ai",
                settingsPath: ["providers", "lm-studio"],
                active: true,
              },
            }),
          );
        });
        const input = container.querySelector(
          'input[role="switch"]',
        );
        assert.ok(input instanceof dom.window.HTMLInputElement);
        assert.equal(input.disabled, false);
        await act(async () => {
          input.click();
        });
        assert.deepEqual(changes, [{
          id: "lmStudio",
          enabled: true,
        }]);
      } finally {
        await act(async () => {
          root.unmount();
        });
      }
    });
  } finally {
    dom.window.close();
    harness.dispose();
  }
});

test("local model installation targets only native Models extension slots", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const cleanups = [];
  const slotNames = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      minkeDesktop: {
        modelRuntime: {
          async read() {
            return {
              available: {
                lmStudio: true,
                ollama: true,
              },
              settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
            };
          },
          async write() {},
        },
      },
    },
  });

  try {
    const ctx = {
      effect(callback, label) {
        if (label.endsWith(" styles")) return;
        const cleanup = callback();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
      locale: {
        register() {
          return () => {};
        },
        bind() {
          return (key) => localModelEn[key];
        },
      },
      slots: {
        inject(name, callback) {
          slotNames.push(name);
          const cleanup = callback();
          return typeof cleanup === "function"
            ? cleanup
            : () => {};
        },
        register() {
          return () => {};
        },
      },
    };

    installLocalModel(ctx);
    await Promise.resolve();
    assert.deepEqual(slotNames, [
      "settings.models.provider-card",
      "settings.models.footer",
    ]);
    assert.equal(slotNames.includes("settings.section"), false);
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(
        globalThis,
        "window",
        originalWindow,
      );
    }
  }
});

test("model runtime settings snapshots and bilingual copy stay exact", () => {
  assert.deepEqual(
    parseModelRuntimeSettingsSnapshot({
      available: {
        lmStudio: false,
        ollama: true,
      },
      settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
    }),
    {
      available: {
        lmStudio: false,
        ollama: true,
      },
      settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
    },
  );
  assert.throws(
    () => parseModelRuntimeSettingsSnapshot({
      available: {
        lmStudio: true,
        ollama: true,
      },
      settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
      unknown: true,
    }),
    /model runtime settings snapshot/u,
  );
  assert.deepEqual(
    Object.keys(localModelEn).sort(),
    Object.keys(localModelZh).sort(),
  );
  assert.equal(localModelZh.autoStart, "自动启动");
  assert.equal(localModelEn.autoStart, "Auto-start");
  assert.equal(localModelZh.restartRequired, "立即生效");
  assert.equal(localModelEn.restartRequired, "Applies immediately");
});
