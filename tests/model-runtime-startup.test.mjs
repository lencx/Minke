import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import yaml from "js-yaml";
import { createReconfigureModelRuntimesRequest } from "@lencx/minke-model-runtime/contract";

const require = createRequire(import.meta.url);
const source = buildSync({
  entryPoints: [fileURLToPath(new URL("../packages/model-runtime/src/dsh.ts", import.meta.url))],
  bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  external: ["@deepseek-ai/*"],
}).outputFiles[0].text;
const schema = require("../vendor/deepseek-harness/vendor/schemastery/lib/index.cjs");

function runNativeTest(pattern) {
  const env = { ...process.env };
  // A nested runner must not inherit the parent's binary test-worker channel.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--expose-internals", "--test", `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], {
    encoding: "utf8", timeout: 15_000, env,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /(?:pass 1|# pass 1)/);
}

async function productModelEntry() {
  const [{ applyEntryPatches }, { loadOverlayPatches }] = await Promise.all([
    import("../runtime/host/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js"),
    import("../runtime/host/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js"),
  ]);
  const parse = path => loadOverlayPatches("dsh", fileURLToPath(new URL(path, import.meta.url)));
  const base = parse("../runtime/host/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml");
  const product = parse("../packages/harness-overlay/cordis.patch.yml");
  const warnings = [];
  const saved = { providers: { "saved-provider": { api: "openai-completions", models: [{ id: "saved" }] } } };
  const { data: entries } = applyEntryPatches(
    [], [...base, { id: "llm-pi-ai", config: saved }, ...product], (...args) => warnings.push(args),
  );
  const entry = entries.find(row => row.id === "llm-pi-ai");
  assert.equal(entry?.name, "@lencx/minke-model-runtime/dsh", JSON.stringify(warnings));
  assert.deepEqual(entry.config, saved, "the command-line product overlay must preserve native model settings");
  assert.equal(entries.filter(row => row.id === "llm-pi-ai").length, 1);
  return entry;
}

test("the shipped product composition activates local model discovery at the native settings address", productModelEntry);

test("native Profile writes reject unserviceable model settings before persistence", async t => {
  if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
    runNativeTest("^native Profile writes");
    return;
  }
  const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const [Boot, { default: Editor }, { default: Settings }, { default: Llm }, Adapter] = await Promise.all([
    load("@deepseek-ai/dsh-app-boot"), load("@deepseek-ai/dsh-config-editor"), load("@deepseek-ai/dsh-settings"),
    load("@deepseek-ai/dsh-llm"), load("@lencx/minke-model-runtime/dsh"),
  ]);
  const home = await mkdtemp(join(tmpdir(), "minke-model-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, "profiles", "web");
  Boot.initProfile(dir, ["test-bundle"]);
  const bundle = join(dir, "node_modules", "test-bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(home, "package.json"), '{"name":"test-installation"}');
  await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "test-bundle", version: "1.0.0", dsh: { bundle: { patch: "cordis.patch.yml" } } }));
  const provider = { api: "openai-completions", baseURL: "http://127.0.0.1:1/v1", models: [{ id: "test-model" }] };
  await writeFile(join(bundle, "cordis.patch.yml"), JSON.stringify([{ insert: [
    { id: "config-editor", name: "cordis:editor" }, { id: "settings", name: "cordis:settings" },
    { id: "llm", name: "cordis:llm" }, { id: "llm-pi-ai", name: "cordis:adapter", config: {
      providers: { test: provider }, lmStudio: { enabled: false }, ollama: { enabled: false },
    } },
  ] }]));
  await writeFile(join(dir, "cordis.yml"), "[]\n");
  const profile = { name: "web", startedBundles: ["test-bundle"], dir, patchPath: join(dir, "cordis.patch.yml"), installAnchor: join(home, "package.json"), cwd: home, home, overlayPaths: [] };
  const ctx = await Boot.boot("dsh", join(dir, "cordis.yml"), Boot.readProfilePatches("dsh", profile), ctx => {
    ctx.provide("profileContext", profile);
    ctx.provide("appReady", { onReady: listener => { listener(); return () => {}; } });
    ctx.provide("credentials", { resolve: async () => undefined });
    ctx.provide("subprocess", { resolveExecutable: async () => { throw new Error("unexpected local startup"); } });
    Object.assign(ctx.loader.builtins, { editor: Editor, settings: Settings, llm: Llm, adapter: Adapter });
  });
  t.after(() => ctx.fiber.dispose());
  const before = await readFile(profile.patchPath, "utf8");
  await assert.rejects(ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, headers: { "X-Test": "a\nb" } } } }), /not valid for Fetch/);
  assert.equal(await readFile(profile.patchPath, "utf8"), before);
  await assert.rejects(ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, models: [] } } }), /models/);
  assert.equal(await readFile(profile.patchPath, "utf8"), before);
  await ctx.settings.update("llm-pi-ai", { providers: { test: { ...provider, displayName: "Edited" } } });
  await nextTurn();
  const persisted = yaml.load(await readFile(profile.patchPath, "utf8"));
  assert.equal(persisted.find(row => row.id === "llm-pi-ai").config.providers.test.displayName, "Edited");
  assert.equal(ctx.llm.listConfigurableProviders().find(row => row.provider === "test").displayName, "Edited");
});

test("a real Cordis boot starts LM Studio and publishes local models alongside native live provider settings", async t => {
  // The suite's source alias loader redirects dsh-llm into the source tree.
  // This integration must run against one coherent, shipped dependency graph.
  if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
    runNativeTest("^a real Cordis boot");
    return;
  }
  const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const [{ Context }, { default: Loader }, { default: LlmRuntime }] = await Promise.all([
    load("@deepseek-ai/cordis"), load("@deepseek-ai/cordis-plugin-loader"), load("@deepseek-ai/dsh-llm"),
  ]);
  const entry = await productModelEntry();
  const cliCalls = [];
  let running = false;
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    if (url.origin === "http://127.0.0.1:39457") {
      assert.equal(url.pathname, "/v1/models");
      return json({ data: [{ id: "gateway-model" }] });
    }
    assert.equal(url.origin, "http://127.0.0.1:39456");
    if (!running) throw new Error("LM Studio is stopped");
    if (url.pathname === "/v1/models") return json({ data: [{ id: "fixture-local" }] });
    assert.equal(url.pathname, "/api/v1/models");
    return json({ models: [{ key: "fixture-local", type: "llm", max_context_length: 8192, loaded_instances: [] }] });
  });
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide("credentials", { resolve: async () => undefined });
  ctx.provide("subprocess", {
    resolveExecutable: async () => "/fixture/lms",
    spawn({ argv }) {
      cliCalls.push(argv.slice(1));
      const command = argv.slice(1, 3).join(" ");
      assert.ok(command === "server status" || command === "server start", JSON.stringify(argv));
      if (command === "server start") running = true;
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: JSON.stringify({ running, port: 39456 }) }) } },
      };
    },
  });
  await ctx.plugin(Loader);
  await ctx.plugin(LlmRuntime);
  const profile = { api: "openai-completions", baseURL: "http://127.0.0.1:1/v1", models: [{ id: "saved-cloud" }] };
  const config = {
    providers: { "saved-provider": profile },
    lmStudio: { enabled: true, lifecycle: "ensure-running", command: "/fixture/lms", baseURL: "http://127.0.0.1:39456/v1" },
    ollama: { enabled: false },
    openAICompatible: [{ id: "local-gateway", baseURL: "http://127.0.0.1:39457/v1" }],
  };
  await ctx.loader.root.update([{ ...entry, name: pathToFileURL(runtimeRequire.resolve(entry.name)).href, config }]);
  await ctx.loader.await();
  const waitFor = async provider => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (ctx.llm.listProviders().some(row => row.id === provider)) return;
      await nextTurn();
    }
    assert.fail(`Cordis did not publish provider ${provider}`);
  };
  await waitFor("lm-studio");
  assert.ok(cliCalls.some(args => args[0] === "server" && args[1] === "start"));
  assert.ok(ctx.llm.listProviders().some(row => row.id === "saved-provider"));
  assert.equal(ctx.llm.providerRetryPolicy("saved-provider").maxRetries, 5,
    "saved cloud profiles retain DSH's native retry default");
  assert.equal(ctx.llm.providerRetryPolicy("local-gateway").maxRetries, 5,
    "generic OpenAI-compatible routes retain DSH's native retry default");
  assert.deepEqual((await ctx.llm.listModels("lm-studio")).map(row => row.id), ["fixture-local"]);
  assert.equal(ctx.llm.listConfigurableProviders().find(row => row.provider === "lm-studio").settingsNs, "llm-pi-ai");
  const owner = ctx.loader.resolve("llm-pi-ai");
  assert.equal(owner.options.config.providers["lm-studio"], undefined, "discovery must not become saved configuration");
  await owner.update({ config: { ...config, providers: { "edited-provider": profile } } });
  await waitFor("edited-provider");
  assert.equal(ctx.llm.listProviders().some(row => row.id === "saved-provider"), false);
  assert.ok(ctx.llm.listProviders().some(row => row.id === "lm-studio"));
});

for (const [label, provider, runtimeId, model] of [
  ["LM Studio", "lm-studio", "lmStudio", "qwen/qwen3.8-27b"],
  ["Ollama", "ollama", "ollama", "qwen3:27b"],
]) {
  test(`native ${label} failures stop without automatic reload and allow manual retry`, async t => {
    if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
      runNativeTest(`^native ${label} failures`);
      return;
    }
    const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
    const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
    const [{ Context }, Llm, { default: Loader }, Session, ...services] = await Promise.all([
      load("@deepseek-ai/cordis"), load("@deepseek-ai/dsh-llm"), load("@deepseek-ai/cordis-plugin-loader"),
      load("@deepseek-ai/dsh-session"), load("@deepseek-ai/dsh-session-projection"),
      load("@deepseek-ai/dsh-system-prompt"), load("@deepseek-ai/dsh-tools"), load("@deepseek-ai/dsh-agent"),
    ]);
    const [NativeToolExecutor, Retry, { default: AgentLoop }] = await Promise.all([
      load("@deepseek-ai/dsh-tool-executor-native"), load("@deepseek-ai/dsh-llm-retry"), load("@deepseek-ai/dsh-agent-loop"),
    ]);
    let loaded = true;
    let loads = 0;
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      assert.equal(url.origin, "http://127.0.0.1:39456");
      if (url.pathname === "/v1/models") return json({ data: [{ id: model }] });
      if (url.pathname === "/api/v0/models") return json({ data: [{ id: model }] });
      if (url.pathname === "/api/v1/models") return json({ models: [{ key: model, type: "llm",
        loaded_instances: loaded ? [{ id: model, config: { context_length: 32768 } }] : [],
      }] });
      if (url.pathname === "/api/ps") return json({ models: loaded ? [{ name: model, context_length: 32768 }] : [] });
      if (url.pathname === "/api/v1/models/load" || url.pathname === "/api/generate") {
        loads++;
        loaded = true;
        return json({ instance_id: model, load_config: { context_length: 32768 }, done: true });
      }
      assert.equal(url.pathname, "/v1/chat/completions");
      assert.equal(JSON.parse(init.body).model, model);
      requests++;
      if (requests === 1) {
        loaded = false;
        return new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError("terminated")); } }),
          { headers: { "content-type": "text/event-stream" } });
      }
      // A retried completion can also trigger the server's own just-in-time load.
      if (!loaded) { loads++; loaded = true; }
      return new Response('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n'
        + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } });
    });
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    ctx.provide("credentials", { resolve: async () => undefined, readRecord: async () => undefined });
    ctx.provide("subprocess", { resolveExecutable: async () => { throw new Error("no CLI needed"); } });
    await ctx.plugin(Loader);
    for (const service of [Llm, Session, ...services]) await ctx.plugin(service.default);
    await ctx.plugin(NativeToolExecutor);
    await ctx.plugin(Retry);
    await ctx.plugin(AgentLoop, { agents: [] });
    const config = {
      lmStudio: { enabled: false }, ollama: { enabled: false },
      [runtimeId]: { enabled: true, lifecycle: "external", baseURL: "http://127.0.0.1:39456/v1" },
    };
    await ctx.loader.root.update([{ id: "llm-pi-ai",
      name: pathToFileURL(runtimeRequire.resolve("@lencx/minke-model-runtime/dsh")).href, config }]);
    await ctx.loader.await();
    for (let attempt = 0; attempt < 100 && !ctx.llm.listProviders().some(row => row.id === provider); attempt++) await nextTurn();
    const agent = await ctx.agentLoop.create(Session.SessionId(`stopped-${provider}`), { provider, model });
    const send = async () => {
      const idle = agent.whenIdle();
      agent.followup(Llm.createUserMessage({ content: [{ type: "text", text: "hi" }], source: { kind: "user" } }));
      await idle;
    };
    await send();
    assert.equal(requests, 1, "a terminated local backend must not receive an automatic completion retry: " +
      JSON.stringify(agent.session.snapshotEvents().slice(-4)));
    assert.equal(loads, 0, "an engine failure must not automatically reload the local model");
    assert.equal(agent.session.snapshotEvents().some(event => event.type === "llm/retry"), false);
    assert.equal(agent.session.snapshotEvents().at(-1).data.reason.kind, "error");
    await send();
    assert.equal(requests, 2, "a subsequent human request can retry through the native adapter");
    assert.equal(loads, 1, "manual retry may load the selected model using service defaults");
    assert.equal(agent.session.snapshotEvents().at(-1).data.reason.kind, "completed");
  });

  test(`native ${label} capacity follows loaded state and retains standard pi-ai dispatch`, async t => {
    if (process.execArgv.some(arg => arg.includes("register-path-aliases"))) {
      runNativeTest(`^native ${label} capacity`);
      return;
    }
    const runtimeRequire = createRequire(new URL("../runtime/host/package.json", import.meta.url));
    const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
    const [{ Context }, { default: Llm }, { default: Loader }] = await Promise.all([
      load("@deepseek-ai/cordis"), load("@deepseek-ai/dsh-llm"), load("@deepseek-ai/cordis-plugin-loader"),
    ]);
    let context = 0;
    let malformed = false;
    let unavailable = false;
    let hold;
    let stateReads = 0;
    const mutations = [];
    const generations = [];
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/v1/chat/completions") {
        const body = JSON.parse(init.body);
        assert.equal(body.model, model);
        const headers = new Headers(init.headers);
        assert.match(headers.get("user-agent"), /^deepseek-harness\//, "standard DSH attribution must survive composition");
        generations.push({ origin: url.origin, authorization: headers.get("authorization") });
        const events = [
          { choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
        ];
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } });
      }
      assert.equal(url.origin, "http://127.0.0.1:39456");
      if (url.pathname === "/v1/models") return json({ data: [{ id: model, context_window: 262144 }] });
      if (url.pathname === "/api/v0/models") return json({ data: [{ id: model, max_context_length: 262144 }] });
      if (url.pathname === "/api/v1/models" || url.pathname === "/api/ps") {
        stateReads++;
        if (hold) {
          hold.entered.resolve();
          await hold.release.promise;
          init.signal?.throwIfAborted();
        }
        if (unavailable) return new Response("unsupported", { status: 404 });
        if (runtimeId === "ollama") return json({ models: context || malformed
          ? [{ name: model, model, ...(malformed ? {} : { context_length: context }) }] : [] });
        return json({ models: [{
          key: model, type: "llm", max_context_length: 262144,
          loaded_instances: malformed ? [{ id: model, config: {} }]
            : context ? [{ id: model, config: { context_length: context } }] : [],
        }] });
      }
      assert.equal(url.pathname, runtimeId === "ollama" ? "/api/generate" : "/api/v1/models/load",
        "capacity synchronization only performs a selected model's load operation");
      mutations.push(JSON.parse(init.body));
      context = 32768;
      return json({ instance_id: model, load_config: { context_length: context }, done: true });
    });
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    ctx.provide("credentials", { resolve: async () => undefined, readRecord: async () => undefined });
    ctx.provide("subprocess", { resolveExecutable: async () => { throw new Error("no CLI needed"); } });
    await ctx.plugin(Loader);
    await ctx.plugin(Llm);
    const config = {
      lmStudio: { enabled: false }, ollama: { enabled: false },
      [runtimeId]: { enabled: true, lifecycle: "external", baseURL: "http://127.0.0.1:39456/v1", defaultContextWindow: 262144 },
    };
    await ctx.loader.root.update([{ id: "llm-pi-ai",
      name: pathToFileURL(runtimeRequire.resolve("@lencx/minke-model-runtime/dsh")).href, config }]);
    await ctx.loader.await();
    const entry = ctx.loader.resolve("llm-pi-ai");
    const adapter = entry.fiber;
    for (let attempt = 0; attempt < 100 && !ctx.llm.listProviders().some(row => row.id === provider); attempt++) await nextTurn();
    const lookup = () => ctx.llm.resolveModelInfo(provider, model);
    const prepare = signal => ctx.llm.prepareCall({ provider, model }, signal);
    assert.equal((await lookup()).context, undefined, "unloaded catalog capacity is not an effective context");
    assert.deepEqual(mutations, [], "model information queries must not load a model");
    const first = await prepare();
    assert.equal(first.context.contextWindow, 32768, "the first call must capture the loaded capacity, not 262K");
    assert.equal(first.retryPolicy.maxRetries, 0, "discovered local routes leave failed inference stopped");
    assert.deepEqual(mutations, [runtimeId === "ollama" ? { model, prompt: "", stream: false }
      : { model, echo_load_config: true }], "the service owns its load configuration, including retired overrides");
    context = 8192;
    assert.equal((await lookup()).context.contextWindow, 8192, "compaction and model information see external reloads");
    assert.equal((await prepare()).context.contextWindow, 8192, "the next call picks up a smaller loaded context");
    assert.equal(first.context.contextWindow, 32768, "already prepared calls retain their captured metadata");
    malformed = true;
    assert.equal((await lookup()).context, undefined, "invalid native state must not restore catalog capacity");
    await assert.rejects(prepare(), /context|loaded|state/i);
    assert.equal(mutations.length, 1, "unconfirmed state cannot trigger destructive reloads");
    malformed = false;
    unavailable = true;
    assert.equal((await lookup()).context, undefined, "older or unavailable native APIs never reuse stale capacity");
    unavailable = false;
    hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
    const cancellation = new AbortController();
    const cancelled = prepare(cancellation.signal);
    await hold.entered.promise;
    cancellation.abort();
    await assert.rejects(cancelled, error => error.name === "AbortError");
    hold.release.resolve();
    hold = undefined;
    const beforeEdit = await prepare();
    hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
    const preparingDuringEdit = assert.rejects(prepare(), { code: "LOCAL_MODEL_CONFIGURATION_CHANGED" },
      "an edit must cancel preparation before old capacity can mix with the new endpoint");
    await hold.entered.promise;
    await entry.update({ config: { ...config, providers: { [provider]: {
      api: "openai-completions", baseURL: "http://127.0.0.1:39457/v1",
      headers: { Authorization: "Bearer saved-key" }, models: [{ id: model, contextWindow: 16384 }],
      retryPolicy: { mode: "normal", maxRetries: 2 },
    } } } });
    await ctx.loader.await();
    await nextTurn();
    hold.release.resolve();
    hold = undefined;
    await preparingDuringEdit;
    const beforeSavedLookup = stateReads;
    const saved = await prepare();
    assert.equal(saved.context.contextWindow, 16384, "explicit native profiles own their endpoint and capacity");
    assert.equal(saved.retryPolicy.maxRetries, 2, "explicit native profiles own their retry policy too");
    assert.equal(stateReads, beforeSavedLookup, "saved routes must not probe an unrelated local runtime");
    for (const call of [beforeEdit, saved]) {
      const chunks = await Array.fromAsync(call.stream({ ...call.config, messages: [] }));
      assert.equal(chunks.at(-1).reason.kind, "stop", JSON.stringify(chunks));
    }
    assert.deepEqual(generations, [
      { origin: "http://127.0.0.1:39456", authorization: "Bearer local-model" },
      { origin: "http://127.0.0.1:39457", authorization: "Bearer saved-key" },
    ], "native pi-ai preserves dispatch generations, credentials and wire protocol");
    await adapter.dispose();
    assert.equal(ctx.llm.listProviders().some(row => row.id === provider), false, "native registration cleanup is preserved");
  });
}

// Execute the production adapter and lifecycle core. Control only the DSH
// boundary, local HTTP/CLI and process channel; no real services are touched.
function fixture(t, { fetch, refusePublication = false, env = {} } = {}) {
  const module = { exports: {} };
  const port = new EventEmitter();
  Object.assign(port, { env, platform: process.platform, cwd: () => "/fixture" });
  const sent = [];
  port.send = message => { sent.push(message); };
  const warnings = [];
  const mounts = [];
  const updates = [];
  const disposers = [];
  const listeners = new Map();
  const servers = [];
  let registeredAdapter;
  const ctx = {
    llm: { registerAdapter(_providers, adapter) { registeredAdapter = adapter; } },
    extend(meta) { return Object.assign(Object.create(this), meta); },
    logger: { info() {}, warn: message => warnings.push(message) },
    credentials: { resolve: async () => undefined },
    inject(_names, callback) { callback({ settings: { configure: () => () => {} }, effect() {} }); },
    subprocess: {
      resolveExecutable: async candidate => candidate,
      spawn({ argv }) {
        if (argv[1] === "serve") {
          const done = Promise.withResolvers();
          const server = { stopped: false, done: done.promise, terminate() {
            this.stopped = true;
            done.resolve({ exitCode: 0, signal: null });
          } };
          servers.push(server);
          return server;
        }
        assert.deepEqual(Array.from(argv).slice(1), ["server", "status", "--json"]);
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: '{"running":true,"port":1234}' }) } },
        };
      },
    },
    plugin(plugin, config) {
      mounts.push(config);
      plugin.apply(ctx, config);
      return {
        update(next, noSave) {
          assert.equal(noSave, true, "discovery must not overwrite user settings");
          if (refusePublication && Object.keys(next.providers).length > 0) throw new Error("route collision");
          updates.push(next);
        },
        await: async () => {},
      };
    },
    effect(callback) { disposers.push(callback()); },
    on(name, listener) { listeners.set(name, listener); },
  };
  runInNewContext(source, {
    module, exports: module.exports, process: port,
    AbortController, AbortSignal, URL, Response, TextDecoder, structuredClone,
    setTimeout, clearTimeout, fetch,
    require(name) {
      switch (name) {
        case "@deepseek-ai/dsh-credentials": return { credentialRef: value => value };
        case "@deepseek-ai/dsh-launch-environment": return { launchEnvironmentOf: () => ({ get: () => undefined }) };
        case "@deepseek-ai/dsh-llm": return { LlmAdapter: class {}, LlmError: class extends Error {
          constructor(message, code) { super(message); this.code = code; }
          static fromFailure({ message, code }) { return new this(message, code); }
        } };
        case "@deepseek-ai/dsh-llm-pi-ai": return {
          Config: schema.object({ providers: schema.dict(schema.any()).default({}).volatile() }),
          apply(scope) {
            scope.llm.registerAdapter([], {
              async prepareCall(provider, model) {
                return { model: { provider, id: model, name: model },
                  stream: async function* () { yield { type: "fixture-response", provider }; },
                };
              },
            });
          },
        };
        case "@deepseek-ai/schemastery": return schema;
        default: return require(name);
      }
    },
  });
  let disposal;
  let resolved;
  const dispose = () => disposal ??= (async () => {
    for (const callback of disposers.toReversed()) await callback();
  })();
  t.after(dispose);
  return {
    validate: config => module.exports.Config(config),
    apply: config => {
      resolved = module.exports.Config({ lmStudio: { enabled: false }, ollama: { enabled: false }, ...config });
      return module.exports.apply(ctx, resolved);
    },
    async updateProviders(config, providers) {
      config.providers = providers;
      resolved.providers = { get: () => providers };
      listeners.get("loader/volatile-update")();
      await nextTurn();
    },
    async stream(provider, signal) {
      const call = await registeredAdapter.prepareCall(provider, "fixture", signal);
      return await Array.fromAsync(call.stream({ provider, model: "fixture", signal }));
    },
    dispose, mounts, updates, warnings, servers, port, sent,
  };
}

const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("desktop launch preferences supply local defaults without a provider config overlay", t => {
  const f = fixture(t, { env: {
    MINKE_LM_STUDIO_ENABLED: "1", MINKE_LM_STUDIO_COMMAND: "/fixture/lms",
    LM_STUDIO_BASE_URL: "http://127.0.0.1:39456/v1",
    MINKE_OLLAMA_ENABLED: "0", MINKE_OLLAMA_COMMAND: "/fixture/ollama",
  } });
  const config = f.validate({ providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } });
  assert.equal(config.lmStudio.enabled, true);
  assert.equal(config.lmStudio.lifecycle, "ensure-running");
  assert.equal(config.lmStudio.command, "/fixture/lms");
  assert.equal(config.lmStudio.baseURL, "http://127.0.0.1:39456/v1");
  assert.equal(config.ollama.enabled, true);
  assert.equal(config.ollama.lifecycle, "external");
  assert.equal(config.providers.get().openai.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(f.validate({ lmStudio: { enabled: false } }).lmStudio.enabled, false);
});

test("saved providers survive local discovery and native live settings updates", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local-model" }] });
  } });
  const config = {
    providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } },
    ollama: { enabled: true, lifecycle: "external" },
  };
  try {
    await f.apply(config);
    assert.equal(f.mounts[0].providers.openai?.apiKeyEnv, "OPENAI_API_KEY");
  } finally {
    release.resolve();
  }
  await f.stream("ollama");
  assert.equal(f.updates.at(-1).providers.openai.apiKeyEnv, "OPENAI_API_KEY");
  assert.ok(f.updates.at(-1).providers.ollama);
  await f.updateProviders(config, { anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" } });
  assert.equal(f.updates.at(-1).providers.openai, undefined);
  assert.equal(f.updates.at(-1).providers.anthropic.apiKeyEnv, "ANTHROPIC_API_KEY");
  assert.ok(f.updates.at(-1).providers.ollama);
  await f.updateProviders(config, { ollama: { baseURL: "http://localhost:11435/v1", models: [] } });
  assert.equal(f.updates.at(-1).providers.ollama.baseURL, "http://localhost:11435/v1");
});

test("cloud routes are ready while local startup waits; local requests remain cancellable", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local/model" }] });
  } });
  let booted = false;
  const boot = f.apply({ ollama: { enabled: true, lifecycle: "external" } }).then(() => { booted = true; });
  try {
    await nextTurn();
    assert.equal(booted, true, "local discovery must not hold plugin startup");
    assert.equal(f.mounts.length, 1);
    assert.equal(Object.keys(f.mounts[0].providers).length, 0);
    assert.deepEqual(await f.stream("deepseek"), [{ type: "fixture-response", provider: "deepseek" }]);
    const cancellation = new AbortController();
    const local = f.stream("ollama", cancellation.signal);
    cancellation.abort();
    await assert.rejects(local, error => error.name === "AbortError");
    assert.equal(f.updates.length, 0);
  } finally {
    release.resolve();
    await boot;
    await nextTurn();
  }
  assert.deepEqual(Array.from(f.updates[0].providers.ollama.models, model => model.id), ["local/model"]);
  assert.deepEqual(await f.stream("ollama"), [{ type: "fixture-response", provider: "ollama" }]);
});

test("an explicit native route named ollama does not wait for local discovery", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => { await release.promise; return json({ data: [] }); } });
  let completed = false;
  try {
    await f.apply({ providers: { ollama: { baseURL: "http://127.0.0.1:39457/v1" } },
      ollama: { enabled: true, lifecycle: "external" } });
    const request = f.stream("ollama").then(() => { completed = true; });
    await nextTurn();
    assert.equal(completed, true, "saved native providers must stay available during local startup");
    await request;
  } finally {
    release.resolve();
  }
});

for (const refusePublication of [false, true]) {
  test(`owned startup process is cleaned up after ${refusePublication ? "publication failure" : "disposal during discovery"}`, async t => {
    const release = Promise.withResolvers();
    let reads = 0;
    const f = fixture(t, { refusePublication, fetch: async () => {
      if (++reads === 1) throw new Error("connection refused");
      await release.promise;
      return json({ data: [{ id: "owned/model" }] });
    } });
    const boot = f.apply({ ollama: { enabled: true, lifecycle: "ensure-running" } });
    let disposing;
    try {
      await nextTurn();
      assert.equal(f.servers.length, 1);
      disposing = refusePublication ? undefined : f.dispose();
    } finally {
      release.resolve();
      await boot;
      await nextTurn();
      await disposing;
    }
    assert.equal(f.servers[0].stopped, true);
    assert.equal(f.updates.some(update => Object.keys(update.providers).length > 0), false);
    if (refusePublication) {
      assert.match(f.warnings[0], /route collision/u);
      assert.deepEqual(await f.stream("deepseek"), [{ type: "fixture-response", provider: "deepseek" }]);
      await assert.rejects(f.stream("ollama"), /route collision/);
    }
  });
}

test("an auto-start edit admitted during discovery waits for publication before acknowledgement", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, { fetch: async () => {
    await release.promise;
    return json({ data: [{ id: "local/model" }] });
  } });
  const boot = f.apply({ ollama: { enabled: true, lifecycle: "external" } });
  try {
    await nextTurn();
    f.port.emit("message", createReconfigureModelRuntimesRequest(7, {
      lmStudio: { enabled: false }, ollama: { enabled: true },
    }, "apply", "ollama"));
    await nextTurn();
    assert.equal(f.sent.length, 0);
  } finally {
    release.resolve();
    await boot;
    await nextTurn();
  }
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].type, "model-runtimes/reconfigured");
  assert.equal(f.sent[0].requestId, 7);
  assert.deepEqual(Array.from(f.updates.at(-1).providers.ollama.models, model => model.id), ["local/model"]);
});
