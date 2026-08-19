/**
 * Local model discovery, lifecycle, request preparation, and cleanup.
 * @module @lencx/minke-model-runtime
 */
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 8_192;
const MODEL_REQUEST_TIMEOUT_MS = 1_500;
const MODEL_LOAD_TIMEOUT_MS = 10 * 60 * 1_000;
const CLI_STATUS_TIMEOUT_MS = 2_000;
const CLI_LIFECYCLE_TIMEOUT_MS = 15_000;
const STARTUP_ATTEMPTS = 8;
const STARTUP_RETRY_DELAY_MS = 250;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const LOCAL_AUTHORIZATION = "Bearer local-model";

export type ServiceLifecycle = "external" | "ensure-running" | "managed";
export type ModelInput = "text" | "image";
export type LogLevel = "info" | "warn";

export interface ModelProfile {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ModelInput[];
}

export interface ProviderProfile {
  displayName: string;
  api: "openai-completions";
  baseURL: string;
  defaultContextWindow: number;
  defaultMaxTokens: number;
  defaultInput: ["text"];
  models: ModelProfile[];
  apiKeyEnv?: string;
  headers?: Record<string, string>;
}

export interface CommandResult {
  executable: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RunningCommand {
  readonly done: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>;
  terminate(): void;
}

export interface ModelRuntimeHost {
  localRuntimeCommands: {
    lmStudio: readonly string[];
    ollama: readonly string[];
  };
  run(
    candidates: readonly string[],
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CommandResult | undefined>;
  start(
    candidates: readonly string[],
    args: readonly string[],
    environment?: Readonly<Record<string, string>>,
  ): Promise<RunningCommand | undefined>;
  fetch: typeof globalThis.fetch;
  resolveCredential(ref: string): Promise<string | undefined>;
  sleep(ms: number): Promise<void>;
  log(level: LogLevel, message: string): void;
}

export interface LmStudioRuntimeConfig {
  enabled?: boolean;
  lifecycle?: ServiceLifecycle;
  baseURL?: string;
  command?: string;
  apiKeyEnv?: string;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
}

export interface OpenAICompatibleRuntimeConfig {
  id: string;
  enabled?: boolean;
  displayName?: string;
  baseURL: string;
  apiKeyEnv?: string;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
}

export interface OllamaRuntimeConfig {
  enabled?: boolean;
  lifecycle?: Exclude<ServiceLifecycle, "managed">;
  baseURL?: string;
  command?: string;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
}

export interface ModelRuntimeConfig {
  lmStudio?: LmStudioRuntimeConfig;
  ollama?: OllamaRuntimeConfig;
  openAICompatible?: OpenAICompatibleRuntimeConfig[];
}

export interface PreparedModelRuntime {
  providers: Record<string, ProviderProfile>;
  prepareRequest(request: ModelRuntimeRequest): Promise<void>;
  dispose(): Promise<void>;
}

export interface ModelRuntimeRequest {
  provider: string;
  model: string;
  signal?: AbortSignal;
}

export class ModelRuntimeRequestError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelRuntimeRequestError";
    this.code = code;
  }
}

interface ModelListingEntry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  type?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  max_context_length?: unknown;
  max_tokens?: unknown;
}

interface LmStudioStatus {
  running: boolean;
  port?: number;
}

interface LmStudioLoadedInstance {
  id: string;
  contextLength: number;
  loadConfig: {
    eval_batch_size?: number;
    flash_attention?: boolean;
    num_experts?: number;
    offload_kv_cache_to_gpu?: boolean;
  };
}

interface LmStudioModelState {
  key: string;
  maxContextLength?: number;
  loadedInstances: LmStudioLoadedInstance[];
}

interface PreparedAdapter {
  provider?: ProviderProfile;
  prepareRequest?(request: ModelRuntimeRequest): Promise<void>;
  dispose(): Promise<void>;
}

interface ModelRuntimeAdapter {
  readonly providerId: string;
  prepare(host: ModelRuntimeHost): Promise<PreparedAdapter>;
}

function nonEmptyText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized !== "") return normalized;
  }
  return undefined;
}

function positiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0
    ) {
      return value;
    }
  }
  return undefined;
}

function providerId(value: string): string {
  if (value === "" || value.trim() !== value) {
    throw new Error(
      "model-runtime: provider ids must be non-empty and have no surrounding whitespace",
    );
  }
  return value;
}

function unique<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/** Normalize one local OpenAI-compatible endpoint without accepting remote URLs. */
export function resolveLocalOpenAIBaseURL(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !loopback ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.port === "0"
  ) {
    throw new Error(
      "model-runtime: local model base URL must be an unauthenticated loopback HTTP URL with a connectable port",
    );
  }
  const pathname = url.pathname.replace(/\/+$/u, "");
  url.pathname = pathname === "" || pathname === "/" ? "/v1" : pathname;
  return url.toString().replace(/\/$/u, "");
}

function localServiceAddress(baseURL: string): {
  bind: string;
  authority: string;
  port: number;
} {
  const url = new URL(baseURL);
  const port = url.port === "" ? 80 : Number(url.port);
  const bind =
    url.hostname === "localhost"
      ? "127.0.0.1"
      : url.hostname.replace(/^\[(.*)\]$/u, "$1");
  return {
    bind,
    authority: `${url.hostname}:${String(port)}`,
    port,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`model endpoint answered HTTP ${String(response.status)}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("model endpoint listing is too large");
  }
  if (response.body === null) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error("model endpoint listing is too large");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

interface JsonRequestOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function requestJson(
  host: ModelRuntimeHost,
  url: string,
  token: string | undefined,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? MODEL_REQUEST_TIMEOUT_MS,
  );
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  try {
    const response = await host.fetch(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(token === undefined
          ? {}
          : { authorization: `Bearer ${token}` }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal,
    });
    return await readBoundedJson(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchListing(
  host: ModelRuntimeHost,
  url: string,
  token: string | undefined,
): Promise<ModelListingEntry[] | undefined> {
  try {
    const value = await requestJson(host, url, token);
    const data = (value as { data?: unknown } | null)?.data;
    return Array.isArray(data)
      ? data.filter(
          (entry): entry is ModelListingEntry =>
            typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseLmStudioModelStates(
  value: unknown,
): LmStudioModelState[] | undefined {
  const models = objectRecord(value)?.models;
  if (!Array.isArray(models)) return undefined;
  const states: LmStudioModelState[] = [];
  for (const value of models) {
    const model = objectRecord(value);
    const key = nonEmptyText(model?.key);
    if (model === undefined || key === undefined) continue;
    const loaded = Array.isArray(model.loaded_instances)
      ? model.loaded_instances
      : [];
    const loadedInstances = loaded.flatMap(
      (value): LmStudioLoadedInstance[] => {
        const instance = objectRecord(value);
        const config = objectRecord(instance?.config);
        const id = nonEmptyText(instance?.id);
        const contextLength = positiveInteger(config?.context_length);
        if (
          instance === undefined ||
          config === undefined ||
          id === undefined ||
          contextLength === undefined
        ) {
          return [];
        }
        const evalBatchSize = positiveInteger(config.eval_batch_size);
        const flashAttention = optionalBoolean(config.flash_attention);
        const numExperts = positiveInteger(config.num_experts);
        const offloadKvCacheToGpu = optionalBoolean(
          config.offload_kv_cache_to_gpu,
        );
        return [
          {
            id,
            contextLength,
            loadConfig: {
              ...(evalBatchSize === undefined
                ? {}
                : { eval_batch_size: evalBatchSize }),
              ...(flashAttention === undefined
                ? {}
                : { flash_attention: flashAttention }),
              ...(numExperts === undefined
                ? {}
                : { num_experts: numExperts }),
              ...(offloadKvCacheToGpu === undefined
                ? {}
                : {
                    offload_kv_cache_to_gpu: offloadKvCacheToGpu,
                  }),
            },
          },
        ];
      },
    );
    const maxContextLength = positiveInteger(model.max_context_length);
    states.push({
      key,
      ...(maxContextLength === undefined
        ? {}
        : { maxContextLength }),
      loadedInstances,
    });
  }
  return states;
}

async function fetchLmStudioModelStates(
  host: ModelRuntimeHost,
  origin: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<LmStudioModelState[] | undefined> {
  try {
    return parseLmStudioModelStates(
      await requestJson(
        host,
        `${origin}/api/v1/models`,
        token,
        signal === undefined ? {} : { signal },
      ),
    );
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

function lmStudioStateForModel(
  states: readonly LmStudioModelState[],
  model: string,
): {
  state: LmStudioModelState;
  instance?: LmStudioLoadedInstance;
} | undefined {
  const keyed = states.find((state) => state.key === model);
  const hosting = keyed ??
    states.find((state) =>
      state.loadedInstances.some((instance) => instance.id === model)
    );
  if (hosting === undefined) return undefined;
  const exact = hosting.loadedInstances.find(
    (instance) => instance.id === model,
  );
  if (exact !== undefined) return { state: hosting, instance: exact };
  const onlyInstance = hosting.loadedInstances.length === 1
    ? hosting.loadedInstances[0]
    : undefined;
  if (hosting.key === model && onlyInstance !== undefined) {
    return {
      state: hosting,
      instance: onlyInstance,
    };
  }
  return { state: hosting };
}

function lmStudioLoadResult(value: unknown): {
  instanceId: string;
  contextLength?: number;
} {
  const result = objectRecord(value);
  const instanceId = nonEmptyText(result?.instance_id);
  if (result === undefined || instanceId === undefined) {
    throw new Error("LM Studio returned an invalid model-load result");
  }
  const contextLength = positiveInteger(
    objectRecord(result.load_config)?.context_length,
  );
  return {
    instanceId,
    ...(contextLength === undefined ? {} : { contextLength }),
  };
}

async function mutateLmStudioModel(
  host: ModelRuntimeHost,
  origin: string,
  token: string | undefined,
  path: "load" | "unload",
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  return await requestJson(
    host,
    `${origin}/api/v1/models/${path}`,
    token,
    {
      method: "POST",
      body,
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: MODEL_LOAD_TIMEOUT_MS,
    },
  );
}

function contextTooSmallError(
  model: string,
  currentContext: number | undefined,
  requiredContext: number,
): ModelRuntimeRequestError {
  const current =
    currentContext === undefined
      ? "not loaded"
      : `loaded with a ${String(currentContext)}-token context`;
  return new ModelRuntimeRequestError(
    `LM Studio model "${model}" is ${current}, but Minke requires at least `
      + `${String(requiredContext)} context tokens. In LM Studio, unload and reload `
      + `this model with Context Length ${String(requiredContext)} or higher, then retry.`,
    "LM_STUDIO_CONTEXT_TOO_SMALL",
  );
}

class LmStudioContextGate {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly host: ModelRuntimeHost;
  private readonly origin: string;
  private readonly token: string | undefined;
  private readonly targetContext: number;
  private readonly canManageModels: boolean;

  constructor(
    host: ModelRuntimeHost,
    origin: string,
    token: string | undefined,
    targetContext: number,
    canManageModels: boolean,
  ) {
    this.host = host;
    this.origin = origin;
    this.token = token;
    this.targetContext = targetContext;
    this.canManageModels = canManageModels;
  }

  async prepare(model: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const prior = this.pending.get(model) ?? Promise.resolve();
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        signal?.throwIfAborted();
        await this.prepareSerial(model, signal);
      });
    this.pending.set(model, operation);
    try {
      await operation;
    } finally {
      if (this.pending.get(model) === operation) {
        this.pending.delete(model);
      }
    }
  }

  private async prepareSerial(
    model: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const states = await fetchLmStudioModelStates(
      this.host,
      this.origin,
      this.token,
      signal,
    );
    // LM Studio before 0.4 has no v1 management API. Preserve compatibility:
    // the downstream OpenAI adapter remains the only available probe.
    if (states === undefined) return;
    const resolved = lmStudioStateForModel(states, model);
    if (resolved === undefined) return;
    const requiredContext = Math.min(
      this.targetContext,
      resolved.state.maxContextLength ?? this.targetContext,
    );
    if (
      resolved.instance !== undefined &&
      resolved.instance.contextLength >= requiredContext
    ) {
      return;
    }
    if (!this.canManageModels) {
      throw contextTooSmallError(
        model,
        resolved.instance?.contextLength,
        requiredContext,
      );
    }
    if (
      resolved.instance !== undefined &&
      (
        resolved.instance.id !== resolved.state.key ||
        model !== resolved.state.key
      )
    ) {
      throw new ModelRuntimeRequestError(
        `LM Studio model "${model}" uses a custom instance identifier. Minke cannot `
          + `safely preserve that identifier while changing its context. In LM Studio, `
          + `reload this instance with Context Length ${String(requiredContext)} or higher.`,
        "LM_STUDIO_CONTEXT_ALIAS_UNSUPPORTED",
      );
    }

    await this.ensureManagedContext(
      resolved.state,
      resolved.instance,
      requiredContext,
      signal,
    );
  }

  private async ensureManagedContext(
    state: LmStudioModelState,
    instance: LmStudioLoadedInstance | undefined,
    requiredContext: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const desiredBody = {
      model: state.key,
      context_length: requiredContext,
      ...instance?.loadConfig,
      echo_load_config: true,
    };
    if (instance === undefined) {
      try {
        const loaded = lmStudioLoadResult(
          await mutateLmStudioModel(
            this.host,
            this.origin,
            this.token,
            "load",
            desiredBody,
            signal,
          ),
        );
        if (
          loaded.contextLength !== undefined &&
          loaded.contextLength < requiredContext
        ) {
          throw new Error(
            `LM Studio loaded only ${String(loaded.contextLength)} context tokens`,
          );
        }
      } catch (error) {
        throw new ModelRuntimeRequestError(
          `Minke could not load LM Studio model "${state.key}" with `
            + `${String(requiredContext)} context tokens. Reduce the configured context `
            + `or load the model manually in LM Studio.`,
          "LM_STUDIO_CONTEXT_PREPARATION_FAILED",
          { cause: error },
        );
      }
      this.host.log(
        "info",
        `model-runtime: loaded LM Studio model "${state.key}" with ${String(requiredContext)} context tokens`,
      );
      return;
    }

    await mutateLmStudioModel(
      this.host,
      this.origin,
      this.token,
      "unload",
      { instance_id: instance.id },
      signal,
    );
    let replacementId: string | undefined;
    try {
      const loaded = lmStudioLoadResult(
        await mutateLmStudioModel(
          this.host,
          this.origin,
          this.token,
          "load",
          desiredBody,
          signal,
        ),
      );
      replacementId = loaded.instanceId;
      if (
        loaded.contextLength !== undefined &&
        loaded.contextLength < requiredContext
      ) {
        throw new Error(
          `LM Studio loaded only ${String(loaded.contextLength)} context tokens`,
        );
      }
    } catch (error) {
      const rollbackFailures: unknown[] = [];
      if (replacementId !== undefined) {
        try {
          await mutateLmStudioModel(
            this.host,
            this.origin,
            this.token,
            "unload",
            { instance_id: replacementId },
          );
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
      try {
        await mutateLmStudioModel(
          this.host,
          this.origin,
          this.token,
          "load",
          {
            model: state.key,
            context_length: instance.contextLength,
            ...instance.loadConfig,
            echo_load_config: true,
          },
        );
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      throw new ModelRuntimeRequestError(
        rollbackFailures.length === 0
          ? `Minke could not expand LM Studio model "${state.key}" to `
            + `${String(requiredContext)} context tokens; its previous `
            + `${String(instance.contextLength)}-token configuration was restored.`
          : `Minke could not expand or restore LM Studio model "${state.key}". `
            + "Open LM Studio and reload the model manually.",
        rollbackFailures.length === 0
          ? "LM_STUDIO_CONTEXT_PREPARATION_FAILED"
          : "LM_STUDIO_CONTEXT_ROLLBACK_FAILED",
        {
          cause:
            rollbackFailures.length === 0
              ? error
              : new AggregateError([error, ...rollbackFailures]),
        },
      );
    }
    this.host.log(
      "info",
      `model-runtime: expanded LM Studio model "${state.key}" from `
        + `${String(instance.contextLength)} to ${String(requiredContext)} context tokens`,
    );
  }
}

function modelProfile(
  entry: ModelListingEntry,
  metadata?: ModelListingEntry,
): ModelProfile | undefined {
  const id = nonEmptyText(entry.id, metadata?.id);
  if (id === undefined) return undefined;
  const type = nonEmptyText(metadata?.type, entry.type)?.toLowerCase();
  if (type === "embedding" || type === "embeddings") return undefined;
  const name = nonEmptyText(
    metadata?.display_name,
    metadata?.name,
    entry.display_name,
    entry.name,
  );
  const contextWindow = positiveInteger(
    metadata?.max_context_length,
    metadata?.context_window,
    metadata?.context_length,
    entry.max_context_length,
    entry.context_window,
    entry.context_length,
  );
  const maxTokens = positiveInteger(metadata?.max_tokens, entry.max_tokens);
  return {
    id,
    ...(name === undefined || name === id ? {} : { name }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(type === "vlm" ? { input: ["text", "image"] as ModelInput[] } : {}),
  };
}

function mergeLmStudioListings(
  openAI: ModelListingEntry[] | undefined,
  detailed: ModelListingEntry[] | undefined,
): ModelProfile[] {
  if (openAI === undefined) return [];
  const detailedById = new Map<string, ModelListingEntry>();
  for (const entry of detailed ?? []) {
    const id = nonEmptyText(entry.id);
    if (id !== undefined) detailedById.set(id, entry);
  }

  const models = new Map<string, ModelProfile>();
  for (const entry of openAI) {
    const id = nonEmptyText(entry.id);
    const profile = modelProfile(
      entry,
      id === undefined ? undefined : detailedById.get(id),
    );
    if (profile !== undefined && !models.has(profile.id)) {
      models.set(profile.id, profile);
    }
  }
  return [...models.values()];
}

function effectiveLmStudioContext(
  profile: ModelProfile,
  states: readonly LmStudioModelState[] | undefined,
  targetContext: number,
): ModelProfile {
  if (states === undefined) return profile;
  const resolved = lmStudioStateForModel(states, profile.id);
  if (resolved === undefined) return profile;
  const required = Math.min(
    targetContext,
    resolved.state.maxContextLength ?? targetContext,
  );
  const contextWindow = Math.max(
    required,
    resolved.instance?.contextLength ?? 0,
  );
  return { ...profile, contextWindow };
}

async function discoverLmStudioModels(
  host: ModelRuntimeHost,
  baseURL: string,
  token: string | undefined,
  targetContext: number,
): Promise<ModelProfile[]> {
  const endpoint = new URL(baseURL);
  const [openAI, detailed, states] = await Promise.all([
    fetchListing(host, `${baseURL}/models`, token),
    fetchListing(host, `${endpoint.origin}/api/v0/models`, token),
    fetchLmStudioModelStates(host, endpoint.origin, token),
  ]);
  return mergeLmStudioListings(openAI, detailed).map((profile) =>
    effectiveLmStudioContext(profile, states, targetContext)
  );
}

async function discoverOpenAIModels(
  host: ModelRuntimeHost,
  baseURL: string,
  token: string | undefined,
): Promise<ModelProfile[]> {
  const listing = await fetchListing(host, `${baseURL}/models`, token);
  const models = new Map<string, ModelProfile>();
  for (const entry of listing ?? []) {
    const profile = modelProfile(entry);
    if (profile !== undefined && !models.has(profile.id)) {
      models.set(profile.id, profile);
    }
  }
  return [...models.values()];
}

function parseLmStudioStatus(result: CommandResult | undefined):
  | LmStudioStatus
  | undefined {
  if (result?.exitCode !== 0) return undefined;
  try {
    const value = JSON.parse(result.stdout) as {
      running?: unknown;
      port?: unknown;
    };
    if (typeof value.running !== "boolean") return undefined;
    const port =
      typeof value.port === "number" &&
      Number.isSafeInteger(value.port) &&
      value.port >= 1 &&
      value.port <= 65_535
        ? value.port
        : undefined;
    return {
      running: value.running,
      ...(port === undefined ? {} : { port }),
    };
  } catch {
    return undefined;
  }
}

function authProfile(
  apiKeyEnv: string | undefined,
  token: string | undefined,
  apiKeyWasExplicit: boolean,
): Pick<ProviderProfile, "apiKeyEnv" | "headers"> {
  if (apiKeyEnv !== undefined && (token !== undefined || apiKeyWasExplicit)) {
    return { apiKeyEnv };
  }
  return { headers: { Authorization: LOCAL_AUTHORIZATION } };
}

function providerProfile(
  displayName: string,
  baseURL: string,
  models: ModelProfile[],
  defaultContextWindow: number | undefined,
  defaultMaxTokens: number | undefined,
  auth: Pick<ProviderProfile, "apiKeyEnv" | "headers">,
): ProviderProfile {
  return {
    displayName,
    api: "openai-completions",
    baseURL,
    defaultContextWindow:
      positiveInteger(defaultContextWindow) ?? DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: positiveInteger(defaultMaxTokens) ?? DEFAULT_MAX_TOKENS,
    defaultInput: ["text"],
    models,
    ...auth,
  };
}

class LmStudioAdapter implements ModelRuntimeAdapter {
  readonly providerId = "lm-studio";
  private readonly config: LmStudioRuntimeConfig;

  constructor(config: LmStudioRuntimeConfig) {
    this.config = config;
  }

  async prepare(host: ModelRuntimeHost): Promise<PreparedAdapter> {
    const lifecycle = this.config.lifecycle ?? "external";
    const commands = unique([
      ...(nonEmptyText(this.config.command) === undefined
        ? []
        : [nonEmptyText(this.config.command) as string]),
      ...host.localRuntimeCommands.lmStudio,
    ]);
    const configuredBaseURL = nonEmptyText(this.config.baseURL);
    const explicitBaseURL =
      configuredBaseURL === undefined
        ? undefined
        : resolveLocalOpenAIBaseURL(configuredBaseURL);
    const explicitApiKeyEnv = nonEmptyText(this.config.apiKeyEnv);
    const apiKeyEnv = explicitApiKeyEnv ?? "LM_API_TOKEN";
    const token = await host.resolveCredential(apiKeyEnv);
    const auth = authProfile(
      apiKeyEnv,
      nonEmptyText(token),
      explicitApiKeyEnv !== undefined,
    );
    const readStatus = async (): Promise<LmStudioStatus | undefined> =>
      parseLmStudioStatus(
        await host.run(
          commands,
          ["server", "status", "--json"],
          CLI_STATUS_TIMEOUT_MS,
        ),
      );
    const candidates = (status: LmStudioStatus | undefined): string[] =>
      explicitBaseURL === undefined
        ? unique([
            ...(status?.running === true && status.port !== undefined
              ? [`http://127.0.0.1:${String(status.port)}/v1`]
              : []),
            DEFAULT_LM_STUDIO_BASE_URL,
          ])
        : [explicitBaseURL];
    const targetContext =
      positiveInteger(this.config.defaultContextWindow) ??
      DEFAULT_CONTEXT_WINDOW;
    const probe = async (
      status: LmStudioStatus | undefined,
    ): Promise<{ baseURL: string; models: ModelProfile[] } | undefined> => {
      const discovered = await Promise.all(
        candidates(status).map(async (baseURL) => ({
          baseURL,
          models: await discoverLmStudioModels(
            host,
            baseURL,
            nonEmptyText(token),
            targetContext,
          ),
        })),
      );
      return discovered.find(({ models }) => models.length > 0);
    };
    const preparedProvider = (
      selected: { baseURL: string; models: ModelProfile[] },
      canManageModels: boolean,
      dispose: () => Promise<void>,
    ): PreparedAdapter => {
      const contextGate = new LmStudioContextGate(
        host,
        new URL(selected.baseURL).origin,
        nonEmptyText(token),
        targetContext,
        canManageModels,
      );
      return {
        provider: providerProfile(
          "LM Studio",
          selected.baseURL,
          selected.models,
          this.config.defaultContextWindow,
          this.config.defaultMaxTokens,
          auth,
        ),
        prepareRequest: async ({ model, signal }) =>
          await contextGate.prepare(model, signal),
        dispose,
      };
    };

    const beforeStart = await readStatus();
    let selected = await probe(beforeStart);
    if (selected !== undefined) {
      return preparedProvider(selected, false, async () => {});
    }
    if (lifecycle === "external") {
      host.log(
        "info",
        "model-runtime: LM Studio is unavailable; external lifecycle leaves it untouched",
      );
      return { dispose: async () => {} };
    }

    const explicitAddress =
      explicitBaseURL === undefined
        ? undefined
        : localServiceAddress(explicitBaseURL);
    const start = await host.run(
      commands,
      [
        "server",
        "start",
        ...(explicitAddress === undefined
          ? []
          : [
              "--port",
              String(explicitAddress.port),
              "--bind",
              explicitAddress.bind,
            ]),
      ],
      CLI_LIFECYCLE_TIMEOUT_MS,
    );
    if (start === undefined) {
      host.log(
        "info",
        "model-runtime: LM Studio CLI is unavailable; skipping the optional runtime",
      );
      return { dispose: async () => {} };
    }
    const ownsService = beforeStart?.running === false && start.exitCode === 0;
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await host.sleep(STARTUP_RETRY_DELAY_MS);
      selected = await probe(await readStatus());
      if (selected !== undefined) break;
    }

    const stopOwnedService = async (): Promise<void> => {
      if (lifecycle !== "managed" || !ownsService) return;
      const stopped = await host.run(
        commands,
        ["server", "stop"],
        CLI_LIFECYCLE_TIMEOUT_MS,
      );
      if (stopped?.exitCode !== 0) {
        host.log(
          "warn",
          "model-runtime: LM Studio was started by this plugin but could not be stopped cleanly",
        );
      }
    };

    if (selected === undefined) {
      host.log(
        "warn",
        "model-runtime: LM Studio did not expose an OpenAI-compatible model after startup",
      );
      await stopOwnedService();
      return { dispose: async () => {} };
    }
    return preparedProvider(selected, ownsService, stopOwnedService);
  }
}

class OllamaAdapter implements ModelRuntimeAdapter {
  readonly providerId = "ollama";
  private readonly config: OllamaRuntimeConfig;

  constructor(config: OllamaRuntimeConfig) {
    this.config = config;
  }

  async prepare(host: ModelRuntimeHost): Promise<PreparedAdapter> {
    const lifecycle = this.config.lifecycle ?? "external";
    const commands = unique([
      ...(nonEmptyText(this.config.command) === undefined
        ? []
        : [nonEmptyText(this.config.command) as string]),
      ...host.localRuntimeCommands.ollama,
    ]);
    const configuredBaseURL = nonEmptyText(this.config.baseURL);
    const baseURL = configuredBaseURL === undefined
      ? DEFAULT_OLLAMA_BASE_URL
      : resolveLocalOpenAIBaseURL(configuredBaseURL);
    const auth = authProfile(undefined, undefined, false);
    const profile = (models: ModelProfile[]): ProviderProfile =>
      providerProfile(
        "Ollama",
        baseURL,
        models,
        this.config.defaultContextWindow,
        this.config.defaultMaxTokens,
        auth,
      );
    const discover = async (): Promise<ModelProfile[]> =>
      await discoverOpenAIModels(host, baseURL, undefined);

    let models = await discover();
    if (models.length > 0) {
      return {
        provider: profile(models),
        dispose: async () => {},
      };
    }
    if (lifecycle === "external") {
      host.log(
        "info",
        "model-runtime: Ollama is unavailable; external lifecycle leaves it untouched",
      );
      return { dispose: async () => {} };
    }

    const address = localServiceAddress(baseURL);
    const server = await host.start(
      commands,
      ["serve"],
      {
        OLLAMA_HOST: address.authority,
      },
    );
    if (server === undefined) {
      host.log(
        "info",
        "model-runtime: Ollama CLI is unavailable; skipping auto-start",
      );
      return { dispose: async () => {} };
    }
    void server.done.catch((error: unknown) => {
      host.log(
        "warn",
        `model-runtime: owned Ollama server exited unexpectedly: ${String(error)}`,
      );
    });
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await host.sleep(STARTUP_RETRY_DELAY_MS);
      models = await discover();
      if (models.length > 0) break;
    }

    let disposed = false;
    const stopOwnedServer = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      server.terminate();
      await server.done.catch(() => undefined);
    };
    if (models.length === 0) {
      host.log(
        "warn",
        "model-runtime: Ollama did not expose an OpenAI-compatible model after startup",
      );
      return {
        dispose: stopOwnedServer,
      };
    }
    return {
      provider: profile(models),
      dispose: stopOwnedServer,
    };
  }
}

class OpenAICompatibleAdapter implements ModelRuntimeAdapter {
  readonly providerId: string;
  private readonly config: OpenAICompatibleRuntimeConfig;

  constructor(config: OpenAICompatibleRuntimeConfig) {
    this.config = config;
    this.providerId = providerId(config.id);
  }

  async prepare(host: ModelRuntimeHost): Promise<PreparedAdapter> {
    const baseURL = resolveLocalOpenAIBaseURL(this.config.baseURL);
    const apiKeyEnv = nonEmptyText(this.config.apiKeyEnv);
    const token =
      apiKeyEnv === undefined
        ? undefined
        : nonEmptyText(await host.resolveCredential(apiKeyEnv));
    const models = await discoverOpenAIModels(host, baseURL, token);
    if (models.length === 0) {
      host.log(
        "info",
        `model-runtime: local provider "${this.providerId}" is unavailable`,
      );
      return { dispose: async () => {} };
    }
    return {
      provider: providerProfile(
        nonEmptyText(this.config.displayName) ?? this.providerId,
        baseURL,
        models,
        this.config.defaultContextWindow,
        this.config.defaultMaxTokens,
        authProfile(apiKeyEnv, token, apiKeyEnv !== undefined),
      ),
      dispose: async () => {},
    };
  }
}

/**
 * Prepare configured local runtimes and return provider metadata plus owned
 * lifecycle cleanup. Runtime state remains ephemeral and is never persisted as
 * user settings.
 */
export async function prepareModelRuntime(
  config: ModelRuntimeConfig,
  host: ModelRuntimeHost,
): Promise<PreparedModelRuntime> {
  const adapters: ModelRuntimeAdapter[] = [];
  if (config.lmStudio?.enabled === true) {
    adapters.push(new LmStudioAdapter(config.lmStudio));
  }
  if (config.ollama?.enabled === true) {
    adapters.push(new OllamaAdapter(config.ollama));
  }
  for (const endpoint of config.openAICompatible ?? []) {
    if (endpoint.enabled !== false) {
      adapters.push(new OpenAICompatibleAdapter(endpoint));
    }
  }

  const configuredIds = new Set<string>();
  for (const adapter of adapters) {
    if (configuredIds.has(adapter.providerId)) {
      throw new Error(
        `model-runtime: duplicate provider id "${adapter.providerId}"`,
      );
    }
    configuredIds.add(adapter.providerId);
  }

  const prepared: PreparedAdapter[] = [];
  try {
    for (const adapter of adapters) {
      prepared.push(await adapter.prepare(host));
    }
  } catch (error) {
    await Promise.allSettled(
      prepared.reverse().map(async (entry) => entry.dispose()),
    );
    throw error;
  }

  const providers = Object.fromEntries(
    adapters.flatMap((adapter, index) => {
      const provider = prepared[index]?.provider;
      return provider === undefined
        ? []
        : [[adapter.providerId, provider] as const];
    }),
  );
  const requests = new Map(
    adapters.flatMap((adapter, index) => {
      const prepareRequest = prepared[index]?.prepareRequest;
      return prepareRequest === undefined
        ? []
        : [[adapter.providerId, prepareRequest] as const];
    }),
  );
  let disposed = false;
  return {
    providers,
    prepareRequest: async (request) => {
      await requests.get(request.provider)?.(request);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const outcomes = await Promise.allSettled(
        prepared.reverse().map(async (entry) => entry.dispose()),
      );
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "model-runtime: multiple service cleanup operations failed",
        );
      }
    },
  };
}
