import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareModelRuntime,
  resolveLocalOpenAIBaseURL,
} from "@minke/harness-overlay/model-runtime/core.ts";

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
  assert.ok(commands.some(({ args }) => args[1] === "start"));
  await prepared.dispose();
  assert.equal(running, true);
  assert.equal(
    commands.some(({ args }) => args[1] === "stop"),
    false,
  );
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
