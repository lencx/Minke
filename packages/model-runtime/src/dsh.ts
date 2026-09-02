/**
 * DeepSeek Harness adapter for the Minke model-runtime module.
 * @module @lencx/minke-model-runtime/dsh
 */
import type { Context, Fiber } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type {
  GenerateOptions,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";
import * as LlmPiAi from "@deepseek-ai/dsh-llm-pi-ai";
import type {} from "@deepseek-ai/dsh-subprocess";
import type {
  SubprocessHandle,
} from "@deepseek-ai/dsh-subprocess";
import z from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  prepareModelRuntime,
  type CommandResult,
  type LmStudioRuntimeConfig,
  ModelRuntimeRequestError,
  type ModelRuntimeConfig,
  type ModelRuntimeHost,
  type OpenAICompatibleRuntimeConfig,
  type OllamaRuntimeConfig,
  type RunningCommand,
} from "./core";
import {
  installModelRuntimeControl,
  LiveModelRuntime,
  type CommitModelRuntimeProviders,
} from "./live.ts";
import {
  externalRuntimeEnvironment,
} from "./process-environment.ts";

const COMMAND_OUTPUT_BYTES = 16 * 1024;
const COMMAND_GRACE_MS = 500;
const COMMAND_RESOLVE_TIMEOUT_MS = 2_000;

export const name = "model-runtime";
export const inject = ["credentials", "llm", "subprocess"];

export type Config = ModelRuntimeConfig;

// Capability defaults belong to each model service. The capacity fields below
// are explicit operator overrides only and therefore intentionally have no
// schema default.
const lmStudioConfig: z<LmStudioRuntimeConfig> = z
  .object({
    enabled: z.boolean().default(false),
    lifecycle: z
      .union(["external", "ensure-running", "managed"])
      .default("external"),
    baseURL: z.string().default(""),
    command: z.string().default(""),
    apiKeyEnv: z.string().role("credential-ref").default(""),
    defaultContextWindow: z.number().step(1).min(1),
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
    enabled: z.boolean().default(false),
    lifecycle: z
      .union(["external", "ensure-running"])
      .default("external"),
    baseURL: z.string().default(""),
    command: z.string().default(""),
    defaultContextWindow: z.number().step(1).min(1),
    defaultMaxTokens: z.number().step(1).min(1),
  });

export const Config: z<Config> = z.object({
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

function preparedStream(
  prepared: Pick<
    Awaited<ReturnType<typeof prepareModelRuntime>>,
    "prepareRequest"
  >,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    try {
      await prepared.prepareRequest({
        provider: options.provider,
        model: options.model,
        ...(options.signal === undefined
          ? {}
          : { signal: options.signal }),
      });
    } catch (error) {
      const aborted = options.signal?.aborted === true;
      const failure = {
        message: aborted
          ? "Local model request preparation was aborted"
          : error instanceof Error
            ? error.message
            : String(error),
        code: aborted
          ? "ABORTED"
          : error instanceof ModelRuntimeRequestError
            ? error.code
            : "LOCAL_MODEL_PREPARATION_FAILED",
      };
      yield {
        type: "finish",
        reason: aborted
          ? { kind: "aborted", failure }
          : { kind: "error", failure },
      };
      return;
    }
    yield* next();
  })();
}

async function updatePiAiProviders(
  fiber: Fiber,
  providers: LiveModelRuntime["providers"],
): Promise<void> {
  await Promise.resolve(
    fiber.update({ providers }, true),
  );
  await fiber.await();
}

/**
 * Prepare local model services, mount the upstream configurable LLM adapter,
 * and bind only plugin-owned processes to this DSH fiber's lifetime.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const prepared = await LiveModelRuntime.create(
    config,
    createHost(ctx, config),
  );
  ctx.effect(
    () => async () => await prepared.dispose(),
    "model-runtime service cleanup",
  );
  ctx.on("llm/stream", (options, next) =>
    preparedStream(prepared, options, next)
  );
  let committedProviders = prepared.providers;
  const adapterFiber = ctx.plugin(LlmPiAi, {
    providers: committedProviders,
  });
  await adapterFiber;
  const commit: CommitModelRuntimeProviders =
    async (providers) => {
      const previous = committedProviders;
      try {
        await updatePiAiProviders(adapterFiber, providers);
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
      committedProviders = providers;
    };
  installModelRuntimeControl(ctx, prepared, commit);
}
