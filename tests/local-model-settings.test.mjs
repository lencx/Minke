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
  LocalModelSettingsRuntime,
} from "@minke/harness-overlay/client/local-model/index.ts";
import {
  installLocalModelSettings,
} from "@minke/harness-overlay/client/local-model/view.ts";
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

function localModelViewRuntime() {
  return {
    getSnapshot() {
      return {
        available: {
          lmStudio: true,
          ollama: true,
        },
        settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
        editable: true,
        applying: false,
        error: undefined,
        revision: 1,
      };
    },
    subscribe: () => () => {},
    setEnabled() {},
  };
}

async function settleLocalModelView(dom, frames = 2) {
  for (let index = 0; index < frames; index += 1) {
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });
  }
}

function appendCustomProviderDraft(
  section,
  providerId = "manual-provider",
) {
  const card = section.ownerDocument.createElement("div");
  card.dataset.testCustomProviderCard = "";
  card.innerHTML = `
    <span>Custom provider</span>
    <label>
      <span>Provider ID</span>
      <input aria-label="Provider ID">
    </label>
    <label>
      <span>Display name</span>
      <input aria-label="Display name">
    </label>
    <label>
      <span>API type</span>
      <select aria-label="API type">
        <option value="openai-completions">OpenAI</option>
      </select>
    </label>
    <label>
      <span>Base URL</span>
      <input aria-label="Base URL">
    </label>
    <label>
      <span>API key</span>
      <input type="password" aria-label="API key">
    </label>
  `;
  const route = card.querySelector(
    'input[aria-label="Provider ID"]',
  );
  assert.ok(route);
  route.value = providerId;
  section.append(card);
  return { card, route };
}

test("synthetic Configure survives the real add-action DOM replacement", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <div data-test-add-block>
            <div data-test-add-actions>
              <button type="button">Add a custom provider</button>
            </div>
          </div>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );

  try {
    const section = dom.window.document.querySelector("section");
    const addProvider = section?.querySelector("button");
    const addActions = section?.querySelector(
      "[data-test-add-actions]",
    );
    const addBlock = section?.querySelector(
      "[data-test-add-block]",
    );
    assert.ok(section);
    assert.ok(addProvider);
    assert.ok(addActions);
    assert.ok(addBlock);
    const existingDraft = appendCustomProviderDraft(
      section,
      "existing-draft",
    );
    let openedDraft;
    addProvider.addEventListener("click", () => {
      openedDraft = appendCustomProviderDraft(addBlock, "");
      addActions.remove();
    });
    const dispose = installLocalModelSettings(
      localModelViewRuntime(),
      (key) => localModelEn[key],
      dom.window.document,
    );
    await settleLocalModelView(dom);

    const configure = section.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(configure);
    configure.click();
    await settleLocalModelView(dom);

    assert.equal(existingDraft.route.value, "existing-draft");
    assert.equal(
      existingDraft.card.hasAttribute(
        "data-minke-local-model-configure-card",
      ),
      false,
    );
    assert.ok(openedDraft);
    assert.equal(openedDraft.route.value, "lm-studio");
    assert.equal(
      openedDraft.card.getAttribute(
        "data-minke-local-model-configure-card",
      ),
      "lmStudio",
    );
    dispose();
  } finally {
    dom.window.close();
  }
});

test("pending Configure expires when its expected card disappears", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <button type="button">Add a custom provider</button>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );

  try {
    const section = dom.window.document.querySelector("section");
    const addProvider = section?.querySelector("button");
    assert.ok(section);
    assert.ok(addProvider);
    let laterDraft;
    addProvider.addEventListener("click", () => {
      const expectedDraft = appendCustomProviderDraft(
        section,
        "",
      );
      expectedDraft.card.remove();
      laterDraft = appendCustomProviderDraft(section);
    });
    const dispose = installLocalModelSettings(
      localModelViewRuntime(),
      (key) => localModelEn[key],
      dom.window.document,
    );
    await settleLocalModelView(dom);

    const configure = section.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(configure);
    configure.click();
    await settleLocalModelView(dom);

    assert.ok(laterDraft);
    assert.equal(
      laterDraft.route.value,
      "manual-provider",
      "a later card must not inherit a disappeared card's intent",
    );
    assert.equal(
      laterDraft.card.hasAttribute(
        "data-minke-local-model-configure-card",
      ),
      false,
    );
    dispose();
  } finally {
    dom.window.close();
  }
});

test("pending Configure expires when the Models section is rebuilt", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <button type="button">Add a custom provider</button>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );

  try {
    const dispose = installLocalModelSettings(
      localModelViewRuntime(),
      (key) => localModelEn[key],
      dom.window.document,
    );
    await settleLocalModelView(dom);
    const originalSection =
      dom.window.document.querySelector("section");
    const configure = originalSection?.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(originalSection);
    assert.ok(configure);
    configure.click();

    const replacement =
      dom.window.document.createElement("section");
    replacement.innerHTML = `
      <h2>Models</h2>
      <ul></ul>
      <button type="button">Add a custom provider</button>
    `;
    const draft = appendCustomProviderDraft(replacement);
    originalSection.replaceWith(replacement);
    await settleLocalModelView(dom);

    assert.equal(
      draft.route.value,
      "manual-provider",
      "a card from a new section generation must keep its draft",
    );
    assert.equal(
      draft.card.hasAttribute(
        "data-minke-local-model-configure-card",
      ),
      false,
    );
    dispose();
  } finally {
    dom.window.close();
  }
});

test("pending Configure expires when the dialog closes and reopens", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <main>
        <div role="dialog">
          <section>
            <h2>Models</h2>
            <ul></ul>
            <button type="button">Add a custom provider</button>
          </section>
        </div>
      </main>`,
    { pretendToBeVisual: true },
  );

  try {
    const dispose = installLocalModelSettings(
      localModelViewRuntime(),
      (key) => localModelEn[key],
      dom.window.document,
    );
    await settleLocalModelView(dom);
    const originalDialog = dom.window.document.querySelector(
      '[role="dialog"]',
    );
    const configure = originalDialog?.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(originalDialog);
    assert.ok(configure);
    configure.click();

    const reopenedDialog =
      dom.window.document.createElement("div");
    reopenedDialog.setAttribute("role", "dialog");
    reopenedDialog.innerHTML = `
      <section>
        <h2>Models</h2>
        <ul></ul>
        <button type="button">Add a custom provider</button>
      </section>
    `;
    const reopenedSection =
      reopenedDialog.querySelector("section");
    assert.ok(reopenedSection);
    const draft = appendCustomProviderDraft(reopenedSection);
    originalDialog.replaceWith(reopenedDialog);
    await settleLocalModelView(dom);

    assert.equal(
      draft.route.value,
      "manual-provider",
      "a reopened dialog must not inherit a closed dialog's intent",
    );
    assert.equal(
      draft.card.hasAttribute(
        "data-minke-local-model-configure-card",
      ),
      false,
    );
    dispose();
  } finally {
    dom.window.close();
  }
});

test("manual Add provider supersedes a pending synthetic Configure", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <button type="button">Add a custom provider</button>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );

  try {
    const section = dom.window.document.querySelector("section");
    const addProvider = section?.querySelector("button");
    assert.ok(section);
    assert.ok(addProvider);
    let forwardedClicks = 0;
    let manualDraft;
    addProvider.addEventListener("click", () => {
      forwardedClicks += 1;
      if (forwardedClicks === 2) {
        manualDraft = appendCustomProviderDraft(section);
      }
    });
    const dispose = installLocalModelSettings(
      localModelViewRuntime(),
      (key) => localModelEn[key],
      dom.window.document,
    );
    await settleLocalModelView(dom);

    const configure = section.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(configure);
    configure.click();
    addProvider.click();
    await settleLocalModelView(dom);

    assert.equal(forwardedClicks, 2);
    assert.ok(manualDraft);
    assert.equal(
      manualDraft.route.value,
      "manual-provider",
      "a later manual draft must win over the stale Configure intent",
    );
    assert.equal(
      manualDraft.card.hasAttribute(
        "data-minke-local-model-configure-card",
      ),
      false,
    );
    dispose();
  } finally {
    dom.window.close();
  }
});

test("auto-start switches live inside their provider row actions", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul>
            <li data-test-provider="lmStudio">
              <div>
                <span>LM Studio</span>
                <span data-test-actions>
                  <button
                    type="button"
                    aria-label="Edit LM Studio (lm-studio)"
                  >Configure</button>
                </span>
              </div>
            </li>
            <li data-test-provider="ollama">
              <div>
                <span>Ollama</span>
                <span data-test-actions>
                  <button
                    type="button"
                    aria-label="Edit Ollama (ollama)"
                  >Configure</button>
                </span>
              </div>
            </li>
          </ul>
          <div>
            <button type="button">Add a custom provider</button>
          </div>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );
  const changes = [];
  let snapshotReads = 0;
  const snapshot = {
    available: {
      lmStudio: true,
      ollama: false,
    },
    settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
    editable: true,
    error: undefined,
    revision: 1,
  };
  const runtime = {
    getSnapshot() {
      snapshotReads += 1;
      return snapshot;
    },
    subscribe: () => () => {},
    setEnabled(id, enabled) {
      changes.push({ id, enabled });
    },
  };

  try {
    const dispose = installLocalModelSettings(
      runtime,
      (key) => localModelEn[key],
      dom.window.document,
    );
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });
    const settledSnapshotReads = snapshotReads;
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });
    assert.equal(
      snapshotReads,
      settledSnapshotReads,
      "row reconciliation must settle instead of scheduling itself forever",
    );

    const providerRows = [
      ...dom.window.document.querySelectorAll(
        "[data-test-provider]",
      ),
    ];
    assert.equal(providerRows.length, 2);
    assert.equal(
      dom.window.document.querySelector(
        "[data-minke-local-model-runtime-settings]",
      ),
      null,
    );
    assert.equal(
      dom.window.document.querySelector(
        "[data-minke-local-model-row]",
      ),
      null,
      "existing provider rows must not be duplicated",
    );
    for (const row of providerRows) {
      const actions = row.querySelector(
        "[data-test-actions]",
      );
      assert.ok(actions);
      assert.ok(
        actions.firstElementChild?.hasAttribute(
          "data-minke-local-model-settings",
        ),
      );
      assert.ok(
        actions.lastElementChild?.matches("button"),
      );
    }

    const inputs = [
      ...dom.window.document.querySelectorAll(
        'input[role="switch"]',
      ),
    ];
    assert.equal(inputs.length, 2);
    assert.equal(
      inputs[0].getAttribute("aria-label"),
      "LM Studio: Auto-start",
    );
    assert.equal(inputs[0].disabled, false);
    assert.equal(
      inputs[1].getAttribute("aria-label"),
      "Ollama: Auto-start",
    );
    assert.equal(
      inputs[1].disabled,
      true,
      "an unavailable command keeps its row-level switch visible but disabled",
    );
    const unavailableStatus = dom.window.document.getElementById(
      inputs[1].getAttribute("aria-describedby"),
    );
    assert.equal(
      unavailableStatus?.textContent,
      localModelEn.commandNotFound,
    );
    inputs[0].checked = true;
    inputs[0].dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    assert.deepEqual(changes, [{
      id: "lmStudio",
      enabled: true,
    }]);

    dispose();
    assert.equal(
      dom.window.document.querySelector(
        "[data-minke-local-model-settings]",
      ),
      null,
    );
    assert.equal(
      dom.window.document.querySelectorAll(
        "[data-test-provider]",
      ).length,
      2,
      "disposing the adapter must preserve Harness-owned rows",
    );
  } finally {
    dom.window.close();
  }
});

test("auto-start switches share synthetic provider row actions", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <button
            id="custom-provider"
            type="button"
            disabled
          >Add a custom provider</button>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );
  let snapshotReads = 0;
  let forwardedConfigureClicks = 0;
  const customProvider = dom.window.document.querySelector(
    "#custom-provider",
  );
  assert.ok(customProvider);
  customProvider.addEventListener("click", () => {
    forwardedConfigureClicks += 1;
  });
  const runtime = {
    getSnapshot() {
      snapshotReads += 1;
      return {
        available: {
          lmStudio: true,
          ollama: true,
        },
        settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
        editable: true,
        error: undefined,
        revision: 1,
      };
    },
    subscribe: () => () => {},
    setEnabled() {},
  };
  const nextFrame = async () =>
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });

  try {
    const dispose = installLocalModelSettings(
      runtime,
      (key) => localModelEn[key],
      dom.window.document,
    );
    await nextFrame();
    await nextFrame();

    const rows = [
      ...dom.window.document.querySelectorAll(
        "[data-minke-local-model-row]",
      ),
    ];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const actions = row.querySelector(
        ".minke-local-model-row__actions",
      );
      assert.ok(actions);
      assert.ok(
        actions.firstElementChild?.hasAttribute(
          "data-minke-local-model-settings",
        ),
      );
      assert.ok(
        actions.lastElementChild?.matches(
          ".minke-local-model-row__configure",
        ),
      );
    }
    assert.equal(
      dom.window.document.querySelectorAll(
        '[role="switch"]',
      ).length,
      2,
    );
    const configure = dom.window.document.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.ok(configure);
    assert.equal(
      configure.disabled,
      true,
      "the proxy starts disabled with the provider action",
    );

    const initiallySettledReads = snapshotReads;
    await nextFrame();
    await nextFrame();
    assert.equal(
      snapshotReads,
      initiallySettledReads,
      "initial synthetic-row reconciliation must settle",
    );

    customProvider.disabled = false;
    await nextFrame();
    await nextFrame();
    assert.equal(
      configure.disabled,
      false,
      "the proxy must follow the provider action becoming enabled",
    );

    const enabledSettledReads = snapshotReads;
    await nextFrame();
    await nextFrame();
    assert.equal(
      snapshotReads,
      enabledSettledReads,
      "enabled-state reconciliation must settle",
    );
    configure.click();
    assert.equal(
      forwardedConfigureClicks,
      1,
      "Configure must forward exactly one click to the provider editor",
    );

    dispose();
    assert.equal(
      dom.window.document.querySelector(
        "[data-minke-local-model-row]",
      ),
      null,
    );
  } finally {
    dom.window.close();
  }
});

test("synthetic Configure follows a replaced Models section", async () => {
  const dom = new JSDOM(
    `<!doctype html>
      <div role="dialog">
        <section>
          <h2>Models</h2>
          <ul></ul>
          <button type="button">Add a custom provider</button>
        </section>
      </div>`,
    { pretendToBeVisual: true },
  );
  const runtime = {
    getSnapshot() {
      return {
        available: {
          lmStudio: true,
          ollama: true,
        },
        settings: DEFAULT_MODEL_RUNTIME_SETTINGS,
        editable: true,
        applying: false,
        error: undefined,
        revision: 1,
      };
    },
    subscribe: () => () => {},
    setEnabled() {},
  };
  const nextFrame = async () =>
    await new Promise((resolve) => {
      dom.window.requestAnimationFrame(resolve);
    });

  try {
    const dispose = installLocalModelSettings(
      runtime,
      (key) => localModelEn[key],
      dom.window.document,
    );
    await nextFrame();
    await nextFrame();

    const originalConfigure = dom.window.document.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    const originalSection = dom.window.document.querySelector(
      '[role="dialog"] section',
    );
    assert.ok(originalConfigure);
    assert.ok(originalSection);

    const replacement = dom.window.document.createElement("section");
    replacement.innerHTML = `
      <h2>Models</h2>
      <ul></ul>
      <button type="button">Add a custom provider</button>
    `;
    let replacementClicks = 0;
    replacement
      .querySelector("button")
      .addEventListener("click", () => {
        replacementClicks += 1;
      });
    originalSection.replaceWith(replacement);
    await nextFrame();
    await nextFrame();

    const currentConfigure = replacement.querySelector(
      '[data-minke-local-model-row="lmStudio"] ' +
        ".minke-local-model-row__configure",
    );
    assert.equal(
      currentConfigure,
      originalConfigure,
      "the synthetic row should be reused in the current Models section",
    );
    currentConfigure.click();
    assert.equal(
      replacementClicks,
      1,
      "Configure must forward to the current section's provider action",
    );

    dispose();
  } finally {
    dom.window.close();
  }
});

test("local model installation does not register a separate settings surface", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const cleanups = [];
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
        if (
          label.endsWith(" styles") ||
          label.endsWith(" runtime")
        ) {
          return;
        }
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
        inject() {
          assert.fail(
            "local models must not inject a separate settings slot",
          );
        },
        register() {
          assert.fail(
            "local models must not register a separate settings section",
          );
        },
      },
    };

    installLocalModel(ctx);
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
