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
  LocalModelSettingsRuntime,
} from "@minke/harness-overlay/client/local-model/runtime.ts";
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
  await assert.rejects(
    handlers.get(MODEL_RUNTIME_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
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
});
