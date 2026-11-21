/**
 * DeepSeek Harness adapter for the Minke model-runtime module.
 * @module @lencx/minke-model-runtime/dsh
 */
import type { Context, Fiber } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-loader";
import type {} from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { LlmError, type LlmAdapter } from "@deepseek-ai/dsh-llm";
import * as LlmPiAi from "@deepseek-ai/dsh-llm-pi-ai";
import type {} from "@deepseek-ai/dsh-subprocess";
import type {
  SubprocessHandle,
} from "@deepseek-ai/dsh-subprocess";
import z from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CommandResult,
  type LmStudioRuntimeConfig,
  type ModelRuntimeConfig,
  type ModelRuntimeHost,
  type OpenAICompatibleRuntimeConfig,
  type OllamaRuntimeConfig,
  type RunningCommand,
} from "./core";
import {
  installModelRuntimeControl,
  LiveModelRuntime,
  modelRuntimeProviderIds,
  waitForModelRuntime,
  type CommitModelRuntimeProviders,
} from "./live.ts";
import { ModelContextAdapter, type CaptureModelContext } from "./context-adapter.ts";
import {
  externalRuntimeEnvironment,
} from "./process-environment.ts";

const COMMAND_OUTPUT_BYTES = 16 * 1024;
const COMMAND_GRACE_MS = 500;
const COMMAND_RESOLVE_TIMEOUT_MS = 2_000;

export const name = "model-runtime";
export const inject = ["credentials", "llm", "subprocess"];

export type Config = ModelRuntimeConfig & LlmPiAi.Config;

// Local context capacity and loading parameters belong to each model service.
// Output limits remain explicit native pi-ai settings.
const lmStudioConfig: z<LmStudioRuntimeConfig> = z
  .object({
    enabled: z.boolean().default(true),
    lifecycle: z
      .union(["external", "ensure-running", "managed"])
      .default(process.env.MINKE_LM_STUDIO_ENABLED === "1" && process.env.MINKE_LM_STUDIO_COMMAND ? "ensure-running" : "external"),
    baseURL: z.string().default(process.env.LM_STUDIO_BASE_URL ?? ""),
    command: z.string().default(process.env.MINKE_LM_STUDIO_COMMAND ?? ""),
    apiKeyEnv: z.string().role("credential-ref").default(""),
    defaultMaxTokens: z.number().step(1).min(1),
  });

const openAICompatibleConfig: z<OpenAICompatibleRuntimeConfig> = z.object({
  id: z.string().required(),
  enabled: z.boolean().default(true),
  displayName: z.string(),
  baseURL: z.string().required(),
  apiKeyEnv: z.string().role("credential-ref"),
  defaultContextWindow: z.number().step(1).min(1),
  defaultMaxTokens: z.number().step(1).min(1),
});

const ollamaConfig: z<OllamaRuntimeConfig> = z
  .object({
    enabled: z.boolean().default(true),
    lifecycle: z
      .union(["external", "ensure-running"])
      .default(process.env.MINKE_OLLAMA_ENABLED === "1" && process.env.MINKE_OLLAMA_COMMAND ? "ensure-running" : "external"),
    baseURL: z.string().default(process.env.OLLAMA_BASE_URL ?? ""),
    command: z.string().default(process.env.MINKE_OLLAMA_COMMAND ?? ""),
    defaultMaxTokens: z.number().step(1).min(1),
  });

// Volatile fields need a fixed object path. An intersection would place the
// native providers field under a branch index and fail Cordis validation.
export const Config: z<Config> = z.object({
  providers: LlmPiAi.Config.dict!.providers!,
  lmStudio: lmStudioConfig,
  ollama: ollamaConfig,
  openAICompatible: z.array(openAICompatibleConfig).default([]),
});

function configuredCommands(
  configured: string | undefined,
  fallbacks: readonly string[],
): string[] {
  if (configured?.trim()) return [configured.trim()];
  return [...fallbacks];
}

function lmStudioCommands(configured: string | undefined): string[] {
  const local =
    process.platform === "win32"
      ? join(homedir(), ".lmstudio", "bin", "lms.exe")
      : join(homedir(), ".lmstudio", "bin", "lms");
  return configuredCommands(configured, [local, "lms"]);
}

function ollamaCommands(configured: string | undefined): string[] {
  const platformCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Ollama.app/Contents/Resources/ollama",
          join(
            homedir(),
            "Applications",
            "Ollama.app",
            "Contents",
            "Resources",
            "ollama",
          ),
        ]
      : process.platform === "win32" &&
          process.env.LOCALAPPDATA !== undefined
        ? [
            join(
              process.env.LOCALAPPDATA,
              "Programs",
              "Ollama",
              "ollama.exe",
            ),
          ]
        : [];
  return configuredCommands(configured, [
    ...platformCandidates,
    "ollama",
  ]);
}

function runningCommand(handle: SubprocessHandle): RunningCommand {
  return {
    done: handle.done,
    terminate() {
      handle.terminate();
    },
  };
}

function createHost(
  ctx: Context,
  config: Config,
): ModelRuntimeHost {
  return {
    localRuntimeCommands: {
      lmStudio: lmStudioCommands(config.lmStudio?.command),
      ollama: ollamaCommands(config.ollama?.command),
    },
    fetch: globalThis.fetch,
    sleep: async (ms) =>
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    log: (level, message) => {
      if (level === "warn") ctx.logger.warn(message);
      else ctx.logger.info(message);
    },
    resolveCredential: async (ref) => {
      const parsed = credentialRef(ref);
      return (
        (await ctx.credentials.resolve(parsed))?.value ??
        launchEnvironmentOf(ctx).get(ref)?.value
      );
    },
    run: async (candidates, args, timeoutMs) => {
      for (const candidate of candidates) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const executable = await ctx.subprocess.resolveExecutable(
            candidate,
            {},
            controller.signal,
          );
          const handle = ctx.subprocess.spawn({
            argv: [executable, ...args],
            cwd: process.cwd(),
            stdio: {
              stdin: "ignore",
              stdout: { maxBytes: COMMAND_OUTPUT_BYTES },
              stderr: { maxBytes: COMMAND_OUTPUT_BYTES },
            },
            graceMs: COMMAND_GRACE_MS,
            signal: controller.signal,
            env: externalRuntimeEnvironment(),
          });
          const outcome = await handle.done;
          return {
            executable,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            stdout: handle.collected.stdout?.readFrom(0).text ?? "",
            stderr: handle.collected.stderr?.readFrom(0).text ?? "",
          } satisfies CommandResult;
        } catch {
          // An optional CLI candidate may be absent or may time out. Continue
          // through the execution world's remaining candidates.
        } finally {
          clearTimeout(timeout);
        }
      }
      return undefined;
    },
    start: async (candidates, args, environment = {}) => {
      for (const candidate of candidates) {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          COMMAND_RESOLVE_TIMEOUT_MS,
        );
        try {
          const executable = await ctx.subprocess.resolveExecutable(
            candidate,
            {},
            controller.signal,
          );
          clearTimeout(timeout);
          return runningCommand(
            ctx.subprocess.spawn({
              argv: [executable, ...args],
              cwd: process.cwd(),
              stdio: {
                stdin: "ignore",
                stdout: { maxBytes: COMMAND_OUTPUT_BYTES },
                stderr: { maxBytes: COMMAND_OUTPUT_BYTES },
              },
              graceMs: COMMAND_GRACE_MS,
              env: externalRuntimeEnvironment(environment),
            }),
          );
        } catch {
          // Continue through the execution world's remaining candidates.
        } finally {
          clearTimeout(timeout);
        }
      }
      return undefined;
    },
  };
}

async function updatePiAiProviders(
  fiber: Fiber,
  providers: LlmPiAi.Options["providers"],
): Promise<void> {
  await Promise.resolve(
    fiber.update({ providers }, true),
  );
  await fiber.await();
}

function configuredProviders(config: Config): NonNullable<LlmPiAi.Options["providers"]> {
  // Clone the readonly snapshot before passing it to Cordis validation.
  return structuredClone(config.providers.get()) as NonNullable<LlmPiAi.Options["providers"]>;
}

function composeProviders(
  discovered: LiveModelRuntime["providers"],
  config: Config,
): NonNullable<LlmPiAi.Options["providers"]> {
  // A failed local engine may have been stopped deliberately or run out of
  // resources. Replaying the request can load it again. Use DSH's native
  // policy to leave recovery to the next human request.
  const local = Object.fromEntries(Object.entries(discovered).map(([id, profile]) => [
    id,
    id === "lm-studio" || id === "ollama"
      ? { ...profile, retryPolicy: { mode: "normal" as const, maxRetries: 0 } }
      : profile,
  ]));
  return { ...local, ...configuredProviders(config) };
}

/**
 * Mount configured model routes first, then discover local services in the
 * background. Only requests owned by those services wait for their readiness.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  ctx.inject(["settings"], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber));
  });
  let committedProviders: LiveModelRuntime["providers"] = {};
  let publishedProviders = configuredProviders(config);
  let publication = Promise.resolve();
  let initialize!: (runtime: LiveModelRuntime) => void;
  let initializationFailed!: (error: unknown) => void;
  const ready = new Promise<LiveModelRuntime>((resolve, reject) => {
    initialize = resolve;
    initializationFailed = reject;
  });
  const ownedProviders = new Set(modelRuntimeProviderIds(config));
  const configurationChanged = () => LlmError.fromFailure({
    message: "Model settings changed while resolving local capacity. Retry with the current settings.",
    code: "LOCAL_MODEL_CONFIGURATION_CHANGED",
  });
  const capture: CaptureModelContext = async (request, captureNative) => {
    request.signal?.throwIfAborted();
    if (!ownedProviders.has(request.provider)) {
      const value = await captureNative();
      request.signal?.throwIfAborted();
      return { value, context: undefined };
    }
    if (!Object.hasOwn(config.providers.get(), request.provider)) {
      await waitForModelRuntime(ready, request.signal);
    }
    const publishing = publication;
    await waitForModelRuntime(publishing, request.signal);
    const generation = publishedProviders;
    const configured = config.providers.get();
    // Explicit profiles may point at a different endpoint. Only discovery-owned
    // routes use the local runtime's capacity and readiness.
    const explicit = Object.hasOwn(configured, request.provider);
    const context = explicit ? undefined
      : await (await waitForModelRuntime(ready, request.signal)).prepareRequest(request);
    const value = await captureNative();
    request.signal?.throwIfAborted();
    if (generation !== publishedProviders || publishing !== publication ||
        configured !== config.providers.get()) throw configurationChanged();
    return { value, context };
  };
  const adapterFiber = ctx.plugin({
    ...LlmPiAi,
    apply(child: Context, nativeConfig: LlmPiAi.Config) {
      const lifetime = new AbortController();
      child.effect(() => () => lifetime.abort(configurationChanged()));
      const captureCurrent: CaptureModelContext = (request, captureNative) => capture({
        ...request,
        signal: request.signal === undefined ? lifetime.signal
          : AbortSignal.any([request.signal, lifetime.signal]),
      }, captureNative);
      const nativeLlm = child.llm;
      const llm = new Proxy(nativeLlm, {
        get(target, key) {
          if (key === "registerAdapter") {
            return (providers: string[], adapter: LlmAdapter) =>
              target.registerAdapter(providers, new ModelContextAdapter(adapter, captureCurrent));
          }
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      // Cordis's public scoped context keeps native settings, credentials and
      // registration disposal on the original pi-ai child fiber.
      LlmPiAi.apply(child.extend({ llm }), nativeConfig);
    },
  }, {
    providers: publishedProviders,
  });
  await adapterFiber.await();
  // ConfigEditor validates the owning entry before writing its Profile. Run
  // that candidate through the native adapter's serviceability checks too;
  // validation on the child alone would happen after persistence.
  ctx.on("internal/config", (fiber, next) => {
    const raw = next();
    if (fiber !== ctx.fiber) return raw;
    const candidate = Config(raw as Config);
    adapterFiber.resolveConfig({ providers: composeProviders(committedProviders, candidate) });
    return raw;
  });
  let disposed = false;
  const publish = (providers?: LiveModelRuntime["providers"]): Promise<void> => {
    const next = publication.then(async () => {
      if (disposed) return;
      const local = providers ?? committedProviders;
      // The native Profile owns persisted provider settings. Explicit user
      // profiles take precedence over transient local discovery results.
      const combined = composeProviders(local, config);
      const previous = publishedProviders;
      try {
        await updatePiAiProviders(adapterFiber, combined);
      } catch (error) {
        try {
          await updatePiAiProviders(adapterFiber, previous);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "model-runtime: provider update and rollback both failed",
          );
        }
        throw error;
      }
      committedProviders = local;
      publishedProviders = combined;
    });
    publication = next.catch(() => {});
    return next;
  };
  const commit: CommitModelRuntimeProviders = publish;
  ctx.on("loader/volatile-update", () => {
    void publish().catch(error => ctx.logger.warn("model-runtime: provider settings update failed", error));
  });
  void LiveModelRuntime.create(config, createHost(ctx, config))
    .then(async (prepared) => {
      if (!disposed && Object.keys(prepared.providers).length > 0) {
        try {
          await commit(prepared.providers);
        } catch (error) {
          await prepared.dispose();
          throw error;
        }
      }
      return prepared;
    }).then(initialize, initializationFailed);
  // Keep the child adapter alive until any in-flight publication and owned
  // service cleanup finish. Cordis disposes effects in reverse order.
  ctx.effect(() => async () => {
    disposed = true;
    await publication;
    const prepared = await ready.catch(() => undefined);
    await prepared?.dispose();
  }, "model-runtime service cleanup");
  void ready.catch((error: unknown) => {
    if (!disposed) {
      ctx.logger.warn(`model-runtime: local service initialization failed: ${String(error)}`);
    }
  });
  installModelRuntimeControl(ctx, {
    async reconfigure(...args) {
      await (await ready).reconfigure(...args);
    },
  }, commit);
}
