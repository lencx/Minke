import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import * as LlmPiAi from "@deepseek-ai/dsh-llm-pi-ai";
import z from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  prepareModelRuntime,
  type CommandResult,
  type LmStudioRuntimeConfig,
  type ModelRuntimeConfig,
  type ModelRuntimeHost,
  type OpenAICompatibleRuntimeConfig,
} from "./core";

const COMMAND_OUTPUT_BYTES = 16 * 1024;
const COMMAND_GRACE_MS = 500;

export const name = "model-runtime";
export const inject = ["credentials", "llm", "subprocess"];

export type Config = ModelRuntimeConfig;

const lmStudioConfig: z<LmStudioRuntimeConfig> = z
  .object({
    enabled: z.boolean().default(false),
    lifecycle: z
      .union(["external", "ensure-running", "managed"])
      .default("external"),
    baseURL: z.string(),
    command: z.string(),
    apiKeyEnv: z.string().role("credential-ref"),
    defaultContextWindow: z.number().step(1).min(1).default(32_768),
    defaultMaxTokens: z.number().step(1).min(1).default(8_192),
  })
  .default({});

const openAICompatibleConfig: z<OpenAICompatibleRuntimeConfig> = z.object({
  id: z.string().required(),
  enabled: z.boolean().default(true),
  displayName: z.string(),
  baseURL: z.string().required(),
  apiKeyEnv: z.string().role("credential-ref"),
  defaultContextWindow: z.number().step(1).min(1).default(32_768),
  defaultMaxTokens: z.number().step(1).min(1).default(8_192),
});

export const Config: z<Config> = z.object({
  lmStudio: lmStudioConfig,
  openAICompatible: z.array(openAICompatibleConfig).default([]),
});

function lmStudioCommands(configured: string | undefined): string[] {
  if (configured?.trim()) return [configured.trim()];
  const local =
    process.platform === "win32"
      ? join(homedir(), ".lmstudio", "bin", "lms.exe")
      : join(homedir(), ".lmstudio", "bin", "lms");
  return [local, "lms"];
}

function createHost(
  ctx: Context,
  config: Config,
): ModelRuntimeHost {
  return {
    lmStudioCommands: lmStudioCommands(config.lmStudio?.command),
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
            env: {},
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
  };
}

/**
 * Prepare local model services, mount the upstream configurable LLM adapter,
 * and bind only plugin-owned processes to this DSH fiber's lifetime.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const prepared = await prepareModelRuntime(config, createHost(ctx, config));
  ctx.effect(
    () => async () => await prepared.dispose(),
    "model-runtime service cleanup",
  );
  await ctx.plugin(LlmPiAi, { providers: prepared.providers });
}
