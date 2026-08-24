import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  prepareModelRuntime,
  resolveLocalOpenAIBaseURL,
} from "@lencx/minke-model-runtime";
import {
  LiveModelRuntime,
  installModelRuntimeControl,
} from "@lencx/minke-model-runtime/live";
import {
  createReconfigureModelRuntimesRequest,
} from "@lencx/minke-model-runtime/contract";
import {
  externalRuntimeEnvironment,
} from "@lencx/minke-model-runtime/process-environment";

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function commandResult(stdout = "", exitCode = 0) {
  return {
    executable: "lms",
    exitCode,
    signal: null,
    stdout,
    stderr: "",
  };
}

function createHost(options = {}) {
  const commands = [];
  const logs = [];
  return {
    commands,
    logs,
    host: {
      localRuntimeCommands: {
        lmStudio: ["lms"],
        ollama: ["ollama"],
      },
      fetch: options.fetch ?? (async () => {
        throw new Error("connection refused");
      }),
      resolveCredential:
        options.resolveCredential ?? (async () => undefined),
      run: async (candidates, args, timeoutMs) => {
        commands.push({ candidates, args, timeoutMs });
        return await options.run?.(candidates, args, timeoutMs);
      },
      start: async (candidates, args, environment) => {
        commands.push({
          candidates,
          args,
          environment,
          timeoutMs: undefined,
        });
        return await options.start?.(
          candidates,
          args,
          environment,
        );
      },
      sleep: options.sleep ?? (async () => {}),
      log: (level, message) => logs.push({ level, message }),
    },
  };
}

test("product-owned model CLIs receive explicit Node-control tombstones", () => {
  assert.deepEqual(
    externalRuntimeEnvironment({
      OLLAMA_HOST: "127.0.0.1:11434",
      electron_run_as_node: "ambient",
      minke_interactive_node_options: "--original",
      MINKE_INTERACTIVE_NODE_PATH: "/original-modules",
      minke_node_bootstrap: "/runtime/bootstrap.cjs",
      Node_Options: "--require /tmp/ambient.cjs",
      node_path: "/tmp/ambient-modules",
    }),
    {
      OLLAMA_HOST: "127.0.0.1:11434",
      ELECTRON_RUN_AS_NODE: undefined,
      MINKE_INTERACTIVE_NODE_OPTIONS: undefined,
      MINKE_INTERACTIVE_NODE_PATH: undefined,
      MINKE_NODE_BOOTSTRAP: undefined,
      NODE_OPTIONS: undefined,
      NODE_PATH: undefined,
    },
  );
});

test("LM Studio adapter enriches the authoritative OpenAI model catalog", async () => {
  const requests = [];
  const { host } = createHost({
    resolveCredential: async (ref) =>
      ref === "LM_API_TOKEN" ? "private-token" : undefined,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        authorization: init?.headers.authorization,
      });
      if (!url.startsWith("http://localhost:1234/")) {
        throw new Error("fallback unavailable");
      }
      if (url.endsWith("/v1/models")) {
        return json({
          data: [
            { id: "qwen/qwen3-coder" },
            { id: "vision/model" },
            { id: "qwen/qwen3-coder" },
          ],
        });
      }
      return json({
        data: [
          {
            id: "qwen/qwen3-coder",
            type: "llm",
            display_name: "Qwen3 Coder",
            max_context_length: 131072,
          },
          {
            id: "vision/model",
            type: "vlm",
            max_context_length: 32768,
          },
          { id: "embed/model", type: "embeddings" },
        ],
      });
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
        baseURL: "http://localhost:1234/v1/",
      },
    },
    host,
  );

  assert.deepEqual(prepared.providers, {
    "lm-studio": {
      displayName: "LM Studio",
      apiKeyEnv: "LM_API_TOKEN",
      api: "openai-completions",
      baseURL: "http://localhost:1234/v1",
      defaultContextWindow: 32768,
      defaultMaxTokens: 8192,
      defaultInput: ["text"],
      models: [
        {
          id: "qwen/qwen3-coder",
          name: "Qwen3 Coder",
          contextWindow: 131072,
        },
        {
          id: "vision/model",
          contextWindow: 32768,
          input: ["text", "image"],
        },
      ],
    },
  });
  assert.ok(
    requests.some(({ url }) => url === "http://localhost:1234/v1/models"),
  );
  assert.ok(
    requests.some(
      ({ url }) => url === "http://localhost:1234/api/v0/models",
    ),
  );
  assert.ok(
    requests.every(
      ({ authorization }) => authorization === "Bearer private-token",
    ),
  );
  assert.doesNotMatch(JSON.stringify(prepared.providers), /private-token/u);
  await prepared.dispose();
});

test("LM Studio loads an explicitly requested external model when it is not loaded", async () => {
  const model = "google/gemma-4-26b-a4b";
  const visionModel = "vision/unloaded";
  const embeddingModel = "nomic/embed-text";
  let loadedContext = 0;
  let nativeListings = 0;
  const mutations = [];
  const { host } = createHost({
    fetch: async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models")) {
        nativeListings += 1;
        return json({
          models: [
            {
              key: model,
              type: "llm",
              max_context_length: 131_072,
              loaded_instances:
                loadedContext === 0
                  ? []
                  : [
                      {
                        id: model,
                        config: {
                          context_length: loadedContext,
                        },
                      },
                    ],
            },
            {
              key: visionModel,
              type: "vlm",
              max_context_length: 65_536,
              loaded_instances: [],
            },
            {
              key: embeddingModel,
              type: "embedding",
              max_context_length: 8_192,
              loaded_instances: [],
            },
          ],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return json({
          data: [
            {
              id: model,
              type: "llm",
              max_context_length: 131_072,
            },
            {
              id: visionModel,
              type: "vlm",
              max_context_length: 65_536,
            },
            {
              id: embeddingModel,
              type: "embedding",
              max_context_length: 8_192,
            },
          ],
        });
      }
      if (url.endsWith("/v1/models")) {
        return json({ data: [] });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        assert.fail("an unloaded external model must not be unloaded");
      }
      if (url.endsWith("/api/v1/models/load")) {
        const body = JSON.parse(init.body);
        mutations.push({ operation: "load", body });
        loadedContext = body.context_length;
        return json({
          type: "llm",
          instance_id: model,
          status: "loaded",
          load_config: {
            context_length: loadedContext,
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
        baseURL: "http://localhost:1234/v1",
      },
    },
    host,
  );

  assert.deepEqual(
    prepared.providers["lm-studio"].models.map(({ id }) => id),
    [model, visionModel],
  );
  assert.deepEqual(
    prepared.providers["lm-studio"].models.find(
      ({ id }) => id === visionModel,
    ).input,
    ["text", "image"],
  );

  await Promise.all([
    prepared.prepareRequest({
      provider: "lm-studio",
      model,
    }),
    prepared.prepareRequest({
      provider: "lm-studio",
      model,
    }),
  ]);

  assert.equal(loadedContext, 32_768);
  assert.ok(
    nativeListings >= 3,
    "discovery, preparation, and post-load verification must use the native state",
  );
  assert.deepEqual(mutations, [
    {
      operation: "load",
      body: {
        model,
        context_length: 32_768,
        echo_load_config: true,
      },
    },
  ]);
  await prepared.dispose();
});

for (
  const {
    label,
    loadedInstances,
  } of [
    {
      label: "missing loaded_instances",
      loadedInstances: undefined,
    },
    {
      label: "a malformed loaded instance",
      loadedInstances: [
        {
          id: "google/gemma-4-26b-a4b",
          config: {},
        },
      ],
    },
  ]
) {
  test(`LM Studio fails closed without mutations for ${label}`, async () => {
    const model = "google/gemma-4-26b-a4b";
    const mutations = [];
    const { host } = createHost({
      fetch: async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("/api/v1/models")) {
          return json({
            models: [
              {
                key: model,
                type: "llm",
                max_context_length: 131_072,
                loaded_instances: loadedInstances,
              },
            ],
          });
        }
        if (url.endsWith("/api/v0/models")) {
          return json({
            data: [
              {
                id: model,
                type: "llm",
                max_context_length: 131_072,
              },
            ],
          });
        }
        if (url.endsWith("/v1/models")) {
          return json({ data: [] });
        }
        if (
          url.endsWith("/api/v1/models/load") ||
          url.endsWith("/api/v1/models/unload")
        ) {
          mutations.push({
            url,
            body: JSON.parse(init.body),
          });
          return json({});
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });

    const prepared = await prepareModelRuntime(
      {
        lmStudio: {
          enabled: true,
          lifecycle: "external",
          baseURL: "http://localhost:1234/v1",
        },
      },
      host,
    );

    await assert.rejects(
      prepared.prepareRequest({
        provider: "lm-studio",
        model,
      }),
      (error) => {
        assert.equal(
          error.code,
          "LM_STUDIO_CONTEXT_STATE_UNSAFE",
        );
        assert.match(error.message, /left LM Studio untouched/u);
        return true;
      },
    );
    assert.deepEqual(mutations, []);
    await prepared.dispose();
  });
}

test("LM Studio rejects an undersized external model before the first request", async () => {
  const model = "qwen/qwen3.8-27b";
  const initialPromptTokens = 7_903;
  let loadedContext = 4_608;
  const mutations = [];
  const { host } = createHost({
    fetch: async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: [
            {
              key: model,
              type: "llm",
              max_context_length: 131_072,
              loaded_instances:
                loadedContext === 0
                  ? []
                  : [
                      {
                        id: model,
                        config: {
                          context_length: loadedContext,
                          eval_batch_size: 512,
                          flash_attention: true,
                          offload_kv_cache_to_gpu: true,
                        },
                      },
                    ],
            },
          ],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return json({
          data: [
            {
              id: model,
              type: "llm",
              max_context_length: 131_072,
            },
          ],
        });
      }
      if (url.endsWith("/v1/models")) {
        return json({ data: [{ id: model }] });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        const body = JSON.parse(init.body);
        mutations.push({ operation: "unload", body });
        assert.equal(body.instance_id, model);
        loadedContext = 0;
        return json({ instance_id: model });
      }
      if (url.endsWith("/api/v1/models/load")) {
        const body = JSON.parse(init.body);
        mutations.push({ operation: "load", body });
        assert.equal(body.model, model);
        loadedContext = body.context_length;
        return json({
          type: "llm",
          instance_id: model,
          status: "loaded",
          load_config: {
            context_length: loadedContext,
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
        baseURL: "http://localhost:1234/v1",
      },
    },
    host,
  );
  assert.equal(
    prepared.providers["lm-studio"].models[0].contextWindow,
    32_768,
  );

  await assert.rejects(
    prepared.prepareRequest({
      provider: "lm-studio",
      model,
    }),
    (error) => {
      assert.equal(error.code, "LM_STUDIO_CONTEXT_TOO_SMALL");
      assert.match(error.message, /4608/u);
      assert.match(error.message, /32768/u);
      assert.match(error.message, /unload and reload/u);
      return true;
    },
  );
  assert.equal(loadedContext, 4_608);
  assert.ok(initialPromptTokens >= loadedContext);
  assert.deepEqual(mutations, []);

  loadedContext = 32_768;
  await prepared.prepareRequest({
    provider: "lm-studio",
    model,
  });
  await prepared.dispose();
});

test("LM Studio expands an undersized model only when Minke started the service", async () => {
  const model = "qwen/qwen3.8-27b";
  let running = false;
  let loadedContext = 4_608;
  const mutations = [];
  const { host } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(JSON.stringify({ running, port: 1234 }));
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      return undefined;
    },
    fetch: async (input, init = {}) => {
      if (!running) throw new Error("not ready");
      const url = String(input);
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: [
            {
              key: model,
              type: "llm",
              max_context_length: 131_072,
              loaded_instances: loadedContext === 0
                ? []
                : [
                    {
                      id: model,
                      config: {
                        context_length: loadedContext,
                        eval_batch_size: 512,
                        flash_attention: true,
                        offload_kv_cache_to_gpu: true,
                      },
                    },
                  ],
            },
          ],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return json({
          data: [
            {
              id: model,
              type: "llm",
              max_context_length: 131_072,
            },
          ],
        });
      }
      if (url.endsWith("/v1/models")) {
        return json({ data: [{ id: model }] });
      }
      const body = JSON.parse(init.body);
      if (url.endsWith("/api/v1/models/unload")) {
        mutations.push({ operation: "unload", body });
        loadedContext = 0;
        return json({ instance_id: model });
      }
      if (url.endsWith("/api/v1/models/load")) {
        mutations.push({ operation: "load", body });
        loadedContext = body.context_length;
        return json({
          type: "llm",
          instance_id: model,
          status: "loaded",
          load_config: { context_length: loadedContext },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    host,
  );

  await prepared.prepareRequest({
    provider: "lm-studio",
    model,
  });

  assert.equal(loadedContext, 32_768);
  assert.deepEqual(mutations, [
    {
      operation: "unload",
      body: { instance_id: model },
    },
    {
      operation: "load",
      body: {
        model,
        context_length: 32_768,
        eval_batch_size: 512,
        flash_attention: true,
        offload_kv_cache_to_gpu: true,
        echo_load_config: true,
      },
    },
  ]);
  await prepared.dispose();
  assert.equal(running, true);
});

test("LM Studio restores an owned model when context expansion fails", async () => {
  const model = "qwen/qwen3.8-27b";
  let running = false;
  let loadedContext = 4_608;
  const loadContexts = [];
  const { host } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(JSON.stringify({ running, port: 1234 }));
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      return undefined;
    },
    fetch: async (input, init = {}) => {
      if (!running) throw new Error("not ready");
      const url = String(input);
      if (url.endsWith("/api/v1/models")) {
        return json({
          models: [
            {
              key: model,
              type: "llm",
              max_context_length: 131_072,
              loaded_instances: loadedContext === 0
                ? []
                : [
                    {
                      id: model,
                      config: {
                        context_length: loadedContext,
                        flash_attention: true,
                      },
                    },
                  ],
            },
          ],
        });
      }
      if (url.endsWith("/api/v0/models")) {
        return json({
          data: [
            {
              id: model,
              type: "llm",
              max_context_length: 131_072,
            },
          ],
        });
      }
      if (url.endsWith("/v1/models")) {
        return json({ data: [{ id: model }] });
      }
      const body = JSON.parse(init.body);
      if (url.endsWith("/api/v1/models/unload")) {
        loadedContext = 0;
        return json({ instance_id: model });
      }
      if (url.endsWith("/api/v1/models/load")) {
        loadContexts.push(body.context_length);
        if (body.context_length === 32_768) {
          return json(
            { error: "resource guard rejected the load" },
            { status: 500 },
          );
        }
        loadedContext = body.context_length;
        return json({
          type: "llm",
          instance_id: model,
          status: "loaded",
          load_config: { context_length: loadedContext },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    host,
  );

  await assert.rejects(
    prepared.prepareRequest({
      provider: "lm-studio",
      model,
    }),
    (error) => {
      assert.equal(
        error.code,
        "LM_STUDIO_CONTEXT_PREPARATION_FAILED",
      );
      assert.match(error.message, /previous 4608-token configuration was restored/u);
      return true;
    },
  );
  assert.deepEqual(loadContexts, [32_768, 4_608]);
  assert.equal(loadedContext, 4_608);
  await prepared.dispose();
});

test("an unavailable LM Studio adds no invalid empty provider", async () => {
  const { host } = createHost();

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
        baseURL: "",
      },
    },
    host,
  );

  assert.deepEqual(prepared.providers, {});
  await prepared.dispose();
});

test("ensure-running starts an unavailable LM Studio service and leaves it shared", async () => {
  let running = false;
  const { host, commands } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(
          JSON.stringify({
            running,
            ...(running ? { port: 45999 } : {}),
          }),
        );
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      if (args[1] === "stop") {
        running = false;
        return commandResult();
      }
      return undefined;
    },
    fetch: async (input) => {
      const url = String(input);
      if (!running || !url.startsWith("http://127.0.0.1:45999/")) {
        throw new Error("not ready");
      }
      return json({
        data: url.endsWith("/v1/models")
          ? [{ id: "local/custom-port" }]
          : [
              {
                id: "local/custom-port",
                type: "llm",
                max_context_length: 65536,
              },
            ],
      });
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    host,
  );

  assert.equal(
    prepared.providers["lm-studio"].baseURL,
    "http://127.0.0.1:45999/v1",
  );
  assert.equal(
    prepared.providers["lm-studio"].headers.Authorization,
    "Bearer local-model",
  );
  const start = commands.find(({ args }) => args[1] === "start");
  assert.ok(start);
  assert.equal(
    start.timeoutMs,
    60_000,
    "LM Studio cold-start must fit inside the desktop control window",
  );
  await prepared.dispose();
  assert.equal(running, true);
  assert.equal(
    commands.some(({ args }) => args[1] === "stop"),
    false,
  );
});

test("live model-runtime reconciliation starts LM Studio and refreshes its catalog", async () => {
  let running = false;
  let catalog = ["local/first"];
  const commits = [];
  const { host, commands } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(JSON.stringify({
          running,
          ...(running ? { port: 1234 } : {}),
        }));
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      return commandResult();
    },
    fetch: async (input) => {
      if (!running) throw new Error("not ready");
      return json({
        data: String(input).endsWith("/v1/models")
          ? catalog.map((id) => ({ id }))
          : catalog.map((id) => ({ id, type: "llm" })),
      });
    },
  });
  const runtime = await LiveModelRuntime.create(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
      },
    },
    host,
  );

  assert.deepEqual(runtime.providers, {});
  await runtime.reconfigure(
    {
      lmStudio: { enabled: true },
      ollama: { enabled: false },
    },
    async (providers) => {
      commits.push(providers);
    },
  );
  assert.ok(commands.some(({ args }) => args[1] === "start"));
  assert.deepEqual(
    runtime.providers["lm-studio"].models.map(({ id }) => id),
    ["local/first"],
  );

  catalog = ["local/first", "local/second"];
  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    async (providers) => {
      commits.push(providers);
    },
  );
  assert.deepEqual(
    commits.at(-1)["lm-studio"].models.map(({ id }) => id),
    ["local/first", "local/second"],
  );
  assert.equal(
    commands.some(({ args }) => args[1] === "stop"),
    false,
  );
  await runtime.dispose();
});

test("live reconciliation repairs a disabled boot generation before auto-start ACK", async () => {
  const preparedConfigs = [];
  const commits = [];
  const prepare = async (config) => {
    const selected = config.lmStudio;
    preparedConfigs.push(
      selected === undefined ? undefined : { ...selected },
    );
    const available =
      selected?.enabled === true &&
      selected.lifecycle === "ensure-running";
    return {
      providers: available
        ? {
            "lm-studio": {
              displayName: "LM Studio",
              api: "openai-completions",
              baseURL: "http://127.0.0.1:1234/v1",
              defaultContextWindow: 32_768,
              defaultMaxTokens: 8_192,
              defaultInput: ["text"],
              models: [{ id: "local/repaired" }],
            },
          }
        : {},
      async prepareRequest() {},
      async dispose() {},
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      lmStudio: {
        enabled: false,
        lifecycle: "external",
      },
    },
    {},
    prepare,
  );

  await runtime.reconfigure(
    {
      lmStudio: { enabled: true },
      ollama: { enabled: false },
    },
    async (providers) => {
      commits.push(providers);
    },
  );

  assert.deepEqual(preparedConfigs[3], {
    enabled: true,
    lifecycle: "ensure-running",
  });
  assert.deepEqual(
    commits.at(-1)["lm-studio"].models,
    [{ id: "local/repaired" }],
  );
  assert.ok(runtime.providers["lm-studio"]);
  await runtime.dispose();
});

test("live reconciliation repairs disabled external discovery without a lifecycle change", async () => {
  const preparedConfigs = [];
  const commits = [];
  const prepare = async (config) => {
    const selected = config.lmStudio;
    preparedConfigs.push(
      selected === undefined ? undefined : { ...selected },
    );
    return {
      providers: selected?.enabled === true
        ? {
            "lm-studio": {
              displayName: "LM Studio",
              api: "openai-completions",
              baseURL: "http://127.0.0.1:1234/v1",
              defaultContextWindow: 32_768,
              defaultMaxTokens: 8_192,
              defaultInput: ["text"],
              models: [{ id: "local/external-repaired" }],
            },
          }
        : {},
      async prepareRequest() {},
      async dispose() {},
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      lmStudio: {
        enabled: false,
        lifecycle: "external",
      },
    },
    {},
    prepare,
  );

  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    async (providers) => {
      commits.push(providers);
    },
  );

  assert.deepEqual(preparedConfigs[3], {
    enabled: true,
    lifecycle: "external",
  });
  assert.deepEqual(
    commits.at(-1)["lm-studio"].models,
    [{ id: "local/external-repaired" }],
  );
  assert.ok(runtime.providers["lm-studio"]);
  await runtime.dispose();
});

for (
  const {
    displayName,
    providerId,
    runtimeId,
  } of [
    {
      displayName: "LM Studio",
      providerId: "lm-studio",
      runtimeId: "lmStudio",
    },
    {
      displayName: "Ollama",
      providerId: "ollama",
      runtimeId: "ollama",
    },
  ]
) {
  test(`live reconciliation rejects an unusable ${displayName} generation`, async () => {
    const disposed = [];
    const preparedRequests = [];
    const commits = [];
    const prepare = async (config) => {
      const selected = config[runtimeId];
      const lifecycle = selected?.lifecycle ?? "external";
      const generation =
        selected === undefined
          ? "unrelated"
          : `${runtimeId}:${lifecycle}`;
      return {
        providers:
          selected === undefined || lifecycle === "ensure-running"
            ? {}
            : {
                [providerId]: {
                  displayName,
                  api: "openai-completions",
                  baseURL: "http://127.0.0.1:1/v1",
                  defaultContextWindow: 32_768,
                  defaultMaxTokens: 8_192,
                  defaultInput: ["text"],
                  models: [{ id: `${providerId}/external` }],
                },
              },
        async prepareRequest(request) {
          if (
            selected !== undefined &&
            request.provider === providerId
          ) {
            preparedRequests.push(generation);
          }
        },
        async dispose() {
          disposed.push(generation);
        },
      };
    };
    const runtime = await LiveModelRuntime.create(
      {
        [runtimeId]: {
          enabled: true,
          lifecycle: "external",
        },
      },
      {},
      prepare,
    );

    try {
      await assert.rejects(
        runtime.reconfigure(
          {
            lmStudio: {
              enabled: runtimeId === "lmStudio",
            },
            ollama: {
              enabled: runtimeId === "ollama",
            },
          },
          async (providers) => {
            commits.push(providers);
          },
        ),
      );
      assert.deepEqual(
        runtime.providers[providerId].models,
        [{ id: `${providerId}/external` }],
      );
      await runtime.prepareRequest({
        provider: providerId,
        model: `${providerId}/external`,
      });
      assert.deepEqual(preparedRequests, [
        `${runtimeId}:external`,
      ]);
      assert.deepEqual(disposed, [
        `${runtimeId}:ensure-running`,
      ]);
      assert.deepEqual(commits, []);
    } finally {
      await runtime.dispose();
    }
  });
}

test("failed live commits preserve old generations and unrelated runtimes", async () => {
  const disposed = [];
  const preparedRequests = [];
  const prepare = async (config) => {
    const id = config.lmStudio !== undefined
      ? "lmStudio"
      : config.ollama !== undefined
        ? "ollama"
        : "openAICompatible";
    const lifecycle =
      id === "openAICompatible"
        ? "external"
        : config[id].lifecycle ?? "external";
    const provider = id === "lmStudio"
      ? "lm-studio"
      : id === "ollama"
        ? "ollama"
        : undefined;
    return {
      providers: provider === undefined
        ? {}
        : {
            [provider]: {
              displayName: provider,
              api: "openai-completions",
              baseURL: "http://127.0.0.1:1/v1",
              defaultContextWindow: 32_768,
              defaultMaxTokens: 8_192,
              defaultInput: ["text"],
              models: [{ id: `${provider}/${lifecycle}` }],
            },
          },
      async prepareRequest(request) {
        if (request.provider === provider) {
          preparedRequests.push(`${id}:${lifecycle}`);
        }
      },
      async dispose() {
        disposed.push(`${id}:${lifecycle}`);
      },
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
      },
      ollama: {
        enabled: true,
        lifecycle: "external",
      },
    },
    {},
    prepare,
  );
  const enabled = {
    lmStudio: { enabled: true },
    ollama: { enabled: false },
  };

  await assert.rejects(
    runtime.reconfigure(enabled, async () => {
      throw new Error("route collision");
    }),
    /route collision/u,
  );
  assert.deepEqual(
    runtime.providers["lm-studio"].models,
    [{ id: "lm-studio/external" }],
  );
  assert.deepEqual(disposed, ["lmStudio:ensure-running"]);

  await runtime.reconfigure(enabled, async () => {});
  assert.equal(
    disposed.includes("lmStudio:external"),
    true,
  );
  assert.equal(
    disposed.includes("ollama:external"),
    false,
  );
  await runtime.prepareRequest({
    provider: "lm-studio",
    model: "lm-studio/ensure-running",
  });
  assert.deepEqual(preparedRequests, [
    "lmStudio:ensure-running",
  ]);
  await runtime.dispose();
});

test("an uncertain live commit forces the previous snapshot to republish", async () => {
  const commits = [];
  const prepare = async (config) => {
    const lifecycle =
      config.lmStudio?.lifecycle ?? "external";
    return {
      providers: config.lmStudio === undefined
        ? {}
        : {
            "lm-studio": {
              displayName: "LM Studio",
              api: "openai-completions",
              baseURL: "http://127.0.0.1:1234/v1",
              defaultContextWindow: 32_768,
              defaultMaxTokens: 8_192,
              defaultInput: ["text"],
              models: [{ id: `lm-studio/${lifecycle}` }],
            },
          },
      async prepareRequest() {},
      async dispose() {},
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "external",
      },
    },
    {},
    prepare,
  );

  await assert.rejects(
    runtime.reconfigure(
      {
        lmStudio: { enabled: true },
        ollama: { enabled: false },
      },
      async () => {
        throw new AggregateError(
          [
            new Error("new publication failed"),
            new Error("publication rollback failed"),
          ],
          "provider update and rollback both failed",
        );
      },
    ),
    /provider update and rollback both failed/u,
  );

  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    async (providers) => {
      commits.push(providers);
    },
    "rollback",
  );
  assert.equal(commits.length, 1);
  assert.deepEqual(
    commits[0]["lm-studio"].models,
    [{ id: "lm-studio/external" }],
  );
  await runtime.dispose();
});

test("live provider merging preserves Object prototype-shaped route ids", async () => {
  const runtime = await LiveModelRuntime.create(
    {
      openAICompatible: [{
        id: "constructor",
        baseURL: "http://127.0.0.1:1/v1",
      }],
    },
    {},
    async (config) => ({
      providers: config.openAICompatible === undefined
        ? {}
        : {
            constructor: {
              displayName: "Constructor",
              api: "openai-completions",
              baseURL: "http://127.0.0.1:1/v1",
              defaultContextWindow: 32_768,
              defaultMaxTokens: 8_192,
              defaultInput: ["text"],
              models: [{ id: "prototype-safe" }],
            },
          },
      async prepareRequest() {},
      async dispose() {},
    }),
  );

  assert.equal(
    Object.hasOwn(runtime.providers, "constructor"),
    true,
  );
  assert.deepEqual(
    runtime.providers.constructor.models,
    [{ id: "prototype-safe" }],
  );
  await runtime.dispose();
});

test("model-runtime process control acknowledges only after live commit", async () => {
  const port = new EventEmitter();
  const responses = [];
  let cleanup;
  let releaseCommit;
  const commitGate = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  port.send = (message, callback) => {
    responses.push(message);
    callback?.(null);
    return true;
  };
  installModelRuntimeControl(
    {
      effect(callback) {
        cleanup = callback();
      },
    },
    {
      async reconfigure(settings, commit, mode) {
        await commit({});
        assert.equal(settings.lmStudio.enabled, true);
        assert.equal(mode, "apply");
        await commitGate;
      },
    },
    async () => {},
    port,
  );

  port.emit(
    "message",
    createReconfigureModelRuntimesRequest(7, {
      lmStudio: { enabled: true },
      ollama: { enabled: false },
    }),
  );
  await Promise.resolve();
  assert.deepEqual(responses, []);

  releaseCommit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{
    channel: "minke:model-runtime-control",
    protocolVersion: 1,
    requestId: 7,
    type: "model-runtimes/reconfigured",
  }]);
  cleanup();
});

test("LM Studio auto-start honors an explicit loopback endpoint", async () => {
  let running = false;
  const { host, commands } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(JSON.stringify({ running }));
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      return undefined;
    },
    fetch: async (input) => {
      const url = String(input);
      if (!running || !url.startsWith("http://localhost:32123/")) {
        throw new Error("not ready");
      }
      return json({
        data: url.endsWith("/v1/models")
          ? [{ id: "configured/model" }]
          : [{ id: "configured/model", type: "llm" }],
      });
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "ensure-running",
        baseURL: "http://localhost:32123/v1",
      },
    },
    host,
  );

  assert.equal(
    prepared.providers["lm-studio"].baseURL,
    "http://localhost:32123/v1",
  );
  assert.deepEqual(
    commands.find(({ args }) => args[1] === "start")?.args,
    [
      "server",
      "start",
      "--port",
      "32123",
      "--bind",
      "127.0.0.1",
    ],
  );
});

test("managed lifecycle stops only an LM Studio service the plugin started", async () => {
  let running = false;
  const { host, commands } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(
          JSON.stringify({
            running,
            ...(running ? { port: 1234 } : {}),
          }),
        );
      }
      if (args[1] === "start") {
        running = true;
        return commandResult();
      }
      if (args[1] === "stop") {
        running = false;
        return commandResult();
      }
      return undefined;
    },
    fetch: async (input) => {
      if (!running) throw new Error("not ready");
      return json({
        data: String(input).endsWith("/v1/models")
          ? [{ id: "managed/model" }]
          : [{ id: "managed/model", type: "llm" }],
      });
    },
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "managed",
      },
    },
    host,
  );
  assert.equal(running, true);
  await prepared.dispose();
  assert.equal(running, false);
  assert.equal(
    commands.filter(({ args }) => args[1] === "stop").length,
    1,
  );
});

test("managed lifecycle never claims an already-running LM Studio service", async () => {
  let running = true;
  const { host, commands } = createHost({
    run: async (_candidates, args) => {
      if (args[1] === "status") {
        return commandResult(
          JSON.stringify({ running: true, port: 1234 }),
        );
      }
      if (args[1] === "stop") {
        running = false;
        return commandResult();
      }
      return commandResult();
    },
    fetch: async (input) =>
      json({
        data: String(input).endsWith("/v1/models")
          ? [{ id: "shared/model" }]
          : [{ id: "shared/model", type: "llm" }],
      }),
  });

  const prepared = await prepareModelRuntime(
    {
      lmStudio: {
        enabled: true,
        lifecycle: "managed",
      },
    },
    host,
  );
  await prepared.dispose();

  assert.equal(running, true);
  assert.equal(
    commands.some(
      ({ args }) => args[1] === "start" || args[1] === "stop",
    ),
    false,
  );
});

test("Ollama auto-start shares discovery but owns its foreground server", async () => {
  let running = false;
  let terminated = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const { host, commands } = createHost({
    fetch: async (input) => {
      if (!running) throw new Error("not running");
      assert.equal(String(input), "http://127.0.0.1:11434/v1/models");
      return json({
        data: [
          { id: "qwen3:8b" },
          { id: "qwen3-vl:8b" },
        ],
      });
    },
    start: async () => {
      running = true;
      return {
        done,
        terminate() {
          terminated = true;
          running = false;
          resolveDone({ exitCode: null, signal: "SIGTERM" });
        },
      };
    },
  });

  const prepared = await prepareModelRuntime(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
        command: "/usr/local/bin/ollama",
      },
    },
    host,
  );

  assert.deepEqual(
    prepared.providers.ollama.models.map(({ id }) => id),
    ["qwen3:8b", "qwen3-vl:8b"],
  );
  assert.ok(
    commands.some(
      ({ candidates, args, environment }) =>
        candidates[0] === "/usr/local/bin/ollama" &&
        args.length === 1 &&
        args[0] === "serve" &&
        environment?.OLLAMA_HOST === "127.0.0.1:11434",
    ),
  );
  await prepared.dispose();
  assert.equal(terminated, true);
});

test("turning off auto-start keeps an owned Ollama usable until Harness exits", async () => {
  let running = false;
  let terminated = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const { host } = createHost({
    fetch: async () => {
      if (!running) throw new Error("not running");
      return json({ data: [{ id: "qwen3:8b" }] });
    },
    start: async () => {
      running = true;
      return {
        done,
        terminate() {
          terminated = true;
          running = false;
          resolveDone({ exitCode: null, signal: "SIGTERM" });
        },
      };
    },
  });
  const runtime = await LiveModelRuntime.create(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    host,
  );

  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    async () => {},
  );
  assert.equal(running, true);
  assert.equal(terminated, false);
  assert.ok(runtime.providers.ollama);

  await runtime.dispose();
  assert.equal(terminated, true);
});

test("rollback stops an Ollama process started by an unpersisted change", async () => {
  let running = false;
  let terminated = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const { host } = createHost({
    fetch: async () => {
      if (!running) throw new Error("not running");
      return json({ data: [{ id: "rollback/model" }] });
    },
    start: async () => {
      running = true;
      return {
        done,
        terminate() {
          terminated = true;
          running = false;
          resolveDone({ exitCode: null, signal: "SIGTERM" });
        },
      };
    },
  });
  const runtime = await LiveModelRuntime.create(
    {
      ollama: {
        enabled: true,
        lifecycle: "external",
      },
    },
    host,
  );
  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: true },
    },
    async () => {},
  );
  assert.equal(running, true);

  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: false },
    },
    async () => {},
    "rollback",
  );
  assert.equal(terminated, true);
  assert.equal(running, false);
  assert.equal(runtime.providers.ollama, undefined);
  await runtime.dispose();
});

test("rollback recovery republishes the providers that were actually restored", async () => {
  let ensurePreparations = 0;
  const commits = [];
  const profile = (model) => ({
    displayName: "Ollama",
    api: "openai-completions",
    baseURL: "http://127.0.0.1:11434/v1",
    defaultContextWindow: 32_768,
    defaultMaxTokens: 8_192,
    defaultInput: ["text"],
    models: [{ id: model }],
  });
  const prepare = async (config) => {
    if (config.ollama === undefined) {
      return {
        providers: {},
        async prepareRequest() {},
        async dispose() {},
      };
    }
    const lifecycle = config.ollama.lifecycle ?? "external";
    const providers = lifecycle === "ensure-running"
      ? ++ensurePreparations === 1
        ? { ollama: profile("owned/initial") }
        : {}
      : { ollama: profile("external/candidate") };
    return {
      providers,
      async prepareRequest() {},
      async dispose() {},
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    {},
    prepare,
  );

  await assert.rejects(
    runtime.reconfigure(
      {
        lmStudio: { enabled: false },
        ollama: { enabled: false },
      },
      async (providers) => {
        commits.push(providers);
        if (commits.length === 1) {
          throw new Error("candidate publish failed");
        }
      },
      "rollback",
    ),
    /candidate publish failed/u,
  );

  assert.equal(ensurePreparations, 2);
  assert.deepEqual(
    commits[0].ollama.models,
    [{ id: "external/candidate" }],
  );
  assert.deepEqual(commits[1], {});
  assert.deepEqual(runtime.providers, {});
  await runtime.dispose();
});

test("a failed rollback restore remains retryable at the same lifecycle", async () => {
  let ensurePreparations = 0;
  const commits = [];
  const profile = (model) => ({
    displayName: "Ollama",
    api: "openai-completions",
    baseURL: "http://127.0.0.1:11434/v1",
    defaultContextWindow: 32_768,
    defaultMaxTokens: 8_192,
    defaultInput: ["text"],
    models: [{ id: model }],
  });
  const prepare = async (config) => {
    if (config.ollama === undefined) {
      return {
        providers: {},
        async prepareRequest() {},
        async dispose() {},
      };
    }
    const lifecycle = config.ollama.lifecycle ?? "external";
    if (lifecycle === "ensure-running") {
      ensurePreparations += 1;
      if (ensurePreparations === 2) {
        throw new Error("owned runtime restart failed");
      }
    }
    return {
      providers: {
        ollama: profile(
          lifecycle === "external"
            ? "external/candidate"
            : `owned/attempt-${ensurePreparations}`,
        ),
      },
      async prepareRequest() {},
      async dispose() {},
    };
  };
  const runtime = await LiveModelRuntime.create(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    {},
    prepare,
  );

  await assert.rejects(
    runtime.reconfigure(
      {
        lmStudio: { enabled: false },
        ollama: { enabled: false },
      },
      async (providers) => {
        commits.push(providers);
        if (commits.length === 1) {
          throw new Error("candidate publish failed");
        }
      },
      "rollback",
    ),
    /reconciliation recovery failed/u,
  );
  assert.equal(ensurePreparations, 2);
  assert.deepEqual(commits[1], {});
  assert.deepEqual(runtime.providers, {});

  await runtime.reconfigure(
    {
      lmStudio: { enabled: false },
      ollama: { enabled: true },
    },
    async (providers) => {
      commits.push(providers);
    },
  );
  assert.equal(ensurePreparations, 3);
  assert.deepEqual(
    runtime.providers.ollama.models,
    [{ id: "owned/attempt-3" }],
  );
  assert.deepEqual(
    commits.at(-1).ollama.models,
    [{ id: "owned/attempt-3" }],
  );
  await runtime.dispose();
});

test("Ollama auto-start binds the configured endpoint", async () => {
  let running = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const { host, commands } = createHost({
    fetch: async (input) => {
      assert.equal(String(input), "http://localhost:32124/v1/models");
      if (!running) throw new Error("not running");
      return json({ data: [{ id: "configured/ollama" }] });
    },
    start: async (_candidates, _args, environment) => {
      assert.equal(environment.OLLAMA_HOST, "localhost:32124");
      running = true;
      return {
        done,
        terminate() {
          running = false;
          resolveDone({ exitCode: null, signal: "SIGTERM" });
        },
      };
    },
  });

  const prepared = await prepareModelRuntime(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
        baseURL: "http://localhost:32124/v1",
      },
    },
    host,
  );

  assert.equal(
    prepared.providers.ollama.baseURL,
    "http://localhost:32124/v1",
  );
  assert.ok(
    commands.some(
      ({ environment }) =>
        environment?.OLLAMA_HOST === "localhost:32124",
    ),
  );
  await prepared.dispose();
});

test("an unavailable Ollama adds no invalid empty provider", async () => {
  const { host, commands } = createHost();
  const prepared = await prepareModelRuntime(
    {
      ollama: {
        enabled: true,
        lifecycle: "external",
      },
    },
    host,
  );

  assert.deepEqual(prepared.providers, {});
  assert.equal(
    commands.some(({ args }) => args[0] === "serve"),
    false,
  );
  await prepared.dispose();
});

test("Ollama auto-start stays owned even before a model is installed", async () => {
  let terminated = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const { host } = createHost({
    start: async () => ({
      done,
      terminate() {
        terminated = true;
        resolveDone({ exitCode: null, signal: "SIGTERM" });
      },
    }),
  });

  const prepared = await prepareModelRuntime(
    {
      ollama: {
        enabled: true,
        lifecycle: "ensure-running",
      },
    },
    host,
  );

  assert.deepEqual(prepared.providers, {});
  assert.equal(terminated, false);
  await prepared.dispose();
  assert.equal(terminated, true);
});

test("generic OpenAI-compatible adapters discover configured loopback services", async () => {
  const { host } = createHost({
    resolveCredential: async (ref) =>
      ref === "LOCAL_MODEL_KEY" ? "local-secret" : undefined,
    fetch: async (input, init) => {
      assert.equal(String(input), "http://localhost:11434/v1/models");
      assert.equal(
        init?.headers.authorization,
        "Bearer local-secret",
      );
      return json({
        data: [
          {
            id: "qwen3",
            name: "Qwen 3",
            context_window: 65536,
          },
        ],
      });
    },
  });

  const prepared = await prepareModelRuntime(
    {
      openAICompatible: [
        {
          id: "local-openai",
          displayName: "Local OpenAI",
          baseURL: "http://localhost:11434",
          apiKeyEnv: "LOCAL_MODEL_KEY",
        },
      ],
    },
    host,
  );

  assert.deepEqual(prepared.providers["local-openai"], {
    displayName: "Local OpenAI",
    api: "openai-completions",
    baseURL: "http://localhost:11434/v1",
    defaultContextWindow: 32768,
    defaultMaxTokens: 8192,
    defaultInput: ["text"],
    models: [
      {
        id: "qwen3",
        name: "Qwen 3",
        contextWindow: 65536,
      },
    ],
    apiKeyEnv: "LOCAL_MODEL_KEY",
  });
  assert.doesNotMatch(JSON.stringify(prepared.providers), /local-secret/u);
});

test("model runtime rejects remote endpoints and duplicate provider ids", async () => {
  assert.throws(
    () => resolveLocalOpenAIBaseURL("https://models.example.test/v1"),
    /loopback HTTP URL/u,
  );
  assert.throws(
    () => resolveLocalOpenAIBaseURL("http://127.0.0.1:0/v1"),
    /connectable port/u,
  );

  const { host } = createHost();
  await assert.rejects(
    prepareModelRuntime(
      {
        openAICompatible: [
          {
            id: "duplicate",
            baseURL: "http://127.0.0.1:10001/v1",
          },
          {
            id: "duplicate",
            baseURL: "http://127.0.0.1:10002/v1",
          },
        ],
      },
      host,
    ),
    /duplicate provider id "duplicate"/u,
  );
});
