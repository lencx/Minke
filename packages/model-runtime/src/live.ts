/**
 * Live, per-runtime reconciliation for Minke's local model services.
 * @module @lencx/minke-model-runtime/live
 */
import {
  prepareModelRuntime,
  type ModelRuntimeConfig,
  type ModelRuntimeHost,
  type ModelRuntimeRequest,
  type PreparedModelRuntime,
  type ProviderProfile,
} from "./core.ts";
import type {
  LocalModelRuntimeId,
  ModelRuntimeControlResponse,
  ModelRuntimeReconfigureMode,
  ModelRuntimeSettings,
} from "./contract.ts";
import {
  isMinkeModelRuntimeControlMessage,
  modelRuntimeReconfigureErrorResponse,
  modelRuntimesReconfiguredResponse,
  parseReconfigureModelRuntimesRequest,
} from "./contract.ts";

type RuntimeComponentId =
  | LocalModelRuntimeId
  | "openAICompatible";

interface RuntimeComponent {
  readonly config: ModelRuntimeConfig;
  readonly prepared: PreparedModelRuntime;
  readonly active: boolean;
}

export type PrepareModelRuntime = (
  config: ModelRuntimeConfig,
  host: ModelRuntimeHost,
) => Promise<PreparedModelRuntime>;

export type CommitModelRuntimeProviders = (
  providers: Record<string, ProviderProfile>,
) => Promise<void>;

const COMPONENT_IDS = [
  "lmStudio",
  "ollama",
  "openAICompatible",
] as const satisfies readonly RuntimeComponentId[];

const LOCAL_PROVIDER_IDS = {
  lmStudio: "lm-studio",
  ollama: "ollama",
} as const satisfies Record<LocalModelRuntimeId, string>;

const LOCAL_RUNTIME_NAMES = {
  lmStudio: "LM Studio",
  ollama: "Ollama",
} as const satisfies Record<LocalModelRuntimeId, string>;

function cloneConfig(
  config: ModelRuntimeConfig,
): ModelRuntimeConfig {
  return {
    ...(config.lmStudio === undefined
      ? {}
      : { lmStudio: { ...config.lmStudio } }),
    ...(config.ollama === undefined
      ? {}
      : { ollama: { ...config.ollama } }),
    ...(config.openAICompatible === undefined
      ? {}
      : {
          openAICompatible:
            config.openAICompatible.map((entry) => ({
              ...entry,
            })),
        }),
  };
}

function componentConfig(
  config: ModelRuntimeConfig,
  id: RuntimeComponentId,
): ModelRuntimeConfig {
  if (id === "lmStudio") {
    return config.lmStudio === undefined
      ? {}
      : { lmStudio: { ...config.lmStudio } };
  }
  if (id === "ollama") {
    return config.ollama === undefined
      ? {}
      : { ollama: { ...config.ollama } };
  }
  return config.openAICompatible === undefined
    ? {}
    : {
        openAICompatible:
          config.openAICompatible.map((entry) => ({
            ...entry,
          })),
      };
}

function lifecycleOf(
  config: ModelRuntimeConfig,
  id: LocalModelRuntimeId,
): "external" | "ensure-running" | "managed" {
  return config[id]?.lifecycle ?? "external";
}

function hasRuntimeProvider(
  component: RuntimeComponent,
  id: LocalModelRuntimeId,
): boolean {
  return Object.hasOwn(
    component.prepared.providers,
    LOCAL_PROVIDER_IDS[id],
  );
}

function assertUsableAutoStartCandidate(
  component: RuntimeComponent,
  id: LocalModelRuntimeId,
): void {
  if (
    lifecycleOf(component.config, id) === "ensure-running" &&
    !hasRuntimeProvider(component, id)
  ) {
    throw new Error(
      `model-runtime: ${LOCAL_RUNTIME_NAMES[id]} auto-start completed without an available model provider`,
    );
  }
}

function desiredRuntimeConfig(
  current: ModelRuntimeConfig,
  id: LocalModelRuntimeId,
  autoStart: boolean,
): ModelRuntimeConfig {
  const next = cloneConfig(current);
  const runtime = next[id];
  if (runtime === undefined) return next;
  // Minke's preference controls process ownership, not whether the adapter
  // participates in external discovery. Reassert this invariant here rather
  // than relying on the boot-time Cordis projection to keep `enabled: true`.
  runtime.enabled = true;
  runtime.lifecycle =
    autoStart ? "ensure-running" : "external";
  return next;
}

function assertUniqueConfiguredProviders(
  config: ModelRuntimeConfig,
): void {
  const ids: string[] = [];
  if (config.lmStudio?.enabled === true) {
    ids.push("lm-studio");
  }
  if (config.ollama?.enabled === true) ids.push("ollama");
  for (const endpoint of config.openAICompatible ?? []) {
    if (endpoint.enabled === false) continue;
    if (
      endpoint.id === "" ||
      endpoint.id.trim() !== endpoint.id
    ) {
      throw new Error(
        "model-runtime: provider ids must be non-empty and have no surrounding whitespace",
      );
    }
    ids.push(endpoint.id);
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(
        `model-runtime: duplicate provider id "${id}"`,
      );
    }
    seen.add(id);
  }
}

function mergedProviders(
  components: ReadonlyMap<
    RuntimeComponentId,
    RuntimeComponent
  >,
): Record<string, ProviderProfile> {
  const providers = new Map<string, ProviderProfile>();
  for (const id of COMPONENT_IDS) {
    const component = components.get(id);
    if (
      component === undefined ||
      !component.active
    ) {
      continue;
    }
    for (const [provider, profile] of Object.entries(
      component.prepared.providers,
    )) {
      if (providers.has(provider)) {
        throw new Error(
          `model-runtime: duplicate provider id "${provider}"`,
        );
      }
      providers.set(provider, profile);
    }
  }
  return Object.fromEntries(providers);
}

async function disposeAll(
  prepared: readonly PreparedModelRuntime[],
  message: string,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    prepared.map(async (entry) => await entry.dispose()),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : []
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}

/**
 * Own independently prepared LM Studio, Ollama, and custom-provider
 * generations so one auto-start change never tears down an unrelated runtime.
 */
export class LiveModelRuntime {
  readonly #host: ModelRuntimeHost;
  readonly #prepare: PrepareModelRuntime;
  readonly #components = new Map<
    RuntimeComponentId,
    RuntimeComponent
  >();
  readonly #retained = new Set<PreparedModelRuntime>();
  #tail: Promise<void> = Promise.resolve();
  #disposeRequested = false;
  #disposed = false;
  #publicationDirty = false;

  private constructor(
    host: ModelRuntimeHost,
    prepare: PrepareModelRuntime,
  ) {
    this.#host = host;
    this.#prepare = prepare;
  }

  /** Prepare the initial independent runtime generations. */
  static async create(
    configValue: ModelRuntimeConfig,
    host: ModelRuntimeHost,
    prepare: PrepareModelRuntime = prepareModelRuntime,
  ): Promise<LiveModelRuntime> {
    const config = cloneConfig(configValue);
    assertUniqueConfiguredProviders(config);
    const runtime = new LiveModelRuntime(host, prepare);
    try {
      for (const id of COMPONENT_IDS) {
        const selected = componentConfig(config, id);
        runtime.#components.set(id, {
          config: selected,
          prepared: await prepare(selected, host),
          active: true,
        });
      }
      mergedProviders(runtime.#components);
      return runtime;
    } catch (error) {
      const initialized = [...runtime.#components.values()]
        .map(({ prepared }) => prepared);
      const cleanup = disposeAll(
        initialized,
        "model-runtime: initial live-runtime cleanup failed",
      );
      try {
        await cleanup;
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "model-runtime: initialization and cleanup failed",
        );
      }
      throw error;
    }
  }

  /** Current provider snapshot committed to the active LLM adapter. */
  get providers(): Record<string, ProviderProfile> {
    return mergedProviders(this.#components);
  }

  /** Prepare a request against the generation active after pending updates. */
  async prepareRequest(
    request: ModelRuntimeRequest,
  ): Promise<void> {
    await this.#tail;
    if (this.#disposed) {
      throw new Error("model-runtime: live runtime is disposed");
    }
    for (const component of this.#components.values()) {
      if (!component.active) continue;
      await component.prepared.prepareRequest(request);
    }
  }

  /**
   * Prepare every changed runtime first, then publish one provider snapshot.
   * The commit callback must either apply the complete snapshot or reject
   * after restoring its previous snapshot.
   */
  reconfigure(
    settings: ModelRuntimeSettings,
    commit: CommitModelRuntimeProviders,
    mode: ModelRuntimeReconfigureMode = "apply",
  ): Promise<void> {
    if (this.#disposeRequested) {
      return Promise.reject(
        new Error("model-runtime: live runtime is disposing"),
      );
    }
    const operation = this.#tail.then(async () => {
      if (this.#disposeRequested) {
        throw new Error(
          "model-runtime: live runtime is disposing",
        );
      }
      await this.#reconfigure(settings, commit, mode);
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  /** Dispose active and retained ownership generations after queued work. */
  dispose(): Promise<void> {
    if (this.#disposeRequested) return this.#tail;
    this.#disposeRequested = true;
    const operation = this.#tail.then(async () => {
      if (this.#disposed) return;
      this.#disposed = true;
      const prepared = [
        ...this.#components.values(),
      ].flatMap(({ active, prepared: entry }) =>
        active ? [entry] : []
      );
      prepared.push(...this.#retained);
      this.#components.clear();
      this.#retained.clear();
      await disposeAll(
        [...new Set(prepared)],
        "model-runtime: multiple live-runtime cleanup operations failed",
      );
    });
    this.#tail = operation;
    return operation;
  }

  async #reconfigure(
    settings: ModelRuntimeSettings,
    commit: CommitModelRuntimeProviders,
    mode: ModelRuntimeReconfigureMode,
  ): Promise<void> {
    const candidates = new Map<
      LocalModelRuntimeId,
      RuntimeComponent
    >();
    const disposedForRollback = new Map<
      LocalModelRuntimeId,
      RuntimeComponent
    >();
    try {
      for (const id of ["lmStudio", "ollama"] as const) {
        const current = this.#components.get(id);
        if (
          current === undefined ||
          current.config[id] === undefined
        ) {
          continue;
        }
        const nextConfig = desiredRuntimeConfig(
          current.config,
          id,
          settings[id].enabled,
        );
        const currentLifecycle =
          lifecycleOf(current.config, id);
        const nextLifecycle = lifecycleOf(nextConfig, id);
        if (
          current.active &&
          current.config[id]?.enabled === true &&
          currentLifecycle === nextLifecycle &&
          (
            nextLifecycle !== "ensure-running" ||
            hasRuntimeProvider(current, id)
          )
        ) {
          continue;
        }
        if (
          mode === "rollback" &&
          id === "ollama" &&
          current.active &&
          lifecycleOf(current.config, id) ===
            "ensure-running" &&
          lifecycleOf(nextConfig, id) === "external"
        ) {
          // An apply that was not persisted must undo an Ollama process it
          // may have started. Stop the old owner before external discovery;
          // otherwise the candidate would borrow a process rollback is about
          // to terminate and publish a route that is dead on arrival.
          disposedForRollback.set(id, current);
          await current.prepared.dispose();
        }
        const candidate = {
          config: nextConfig,
          prepared: await this.#prepare(
            nextConfig,
            this.#host,
          ),
          active: true,
        } satisfies RuntimeComponent;
        candidates.set(id, candidate);
        assertUsableAutoStartCandidate(candidate, id);
      }
      if (candidates.size === 0) {
        if (!this.#publicationDirty) return;
        await commit(mergedProviders(this.#components));
        this.#publicationDirty = false;
        return;
      }

      const nextComponents = new Map(this.#components);
      for (const [id, candidate] of candidates) {
        nextComponents.set(id, candidate);
      }
      const nextProviders = mergedProviders(nextComponents);
      // The callback can fail after both its new publication and its
      // internal rollback fail, leaving the adapter's route snapshot
      // uncertain even though this runtime keeps its current components.
      // Only a successful commit proves the two sides are synchronized.
      this.#publicationDirty = true;
      await commit(nextProviders);
      this.#publicationDirty = false;

      const replaced: Array<{
        id: LocalModelRuntimeId;
        previous: RuntimeComponent;
        next: RuntimeComponent;
      }> = [];
      for (const [id, next] of candidates) {
        const previous = this.#components.get(id);
        if (previous === undefined) continue;
        this.#components.set(id, next);
        replaced.push({ id, previous, next });
      }
      for (const { id, previous, next } of replaced) {
        if (
          disposedForRollback.has(id) ||
          !previous.active
        ) {
          continue;
        }
        if (
          (
            id === "ollama" &&
            lifecycleOf(previous.config, id) ===
              "ensure-running" &&
            lifecycleOf(next.config, id) === "external"
          ) ||
          (
            id === "lmStudio" &&
            lifecycleOf(previous.config, id) === "managed"
          )
        ) {
          // A candidate may have borrowed the service owned by the previous
          // generation. Retain that ownership cleanup until Harness exits
          // instead of invalidating the just-committed provider.
          this.#retained.add(previous.prepared);
          continue;
        }
        try {
          await previous.prepared.dispose();
        } catch (error) {
          this.#host.log(
            "warn",
            `model-runtime: previous ${id} generation cleanup failed after live commit: ${String(error)}`,
          );
        }
      }
    } catch (error) {
      const recoveryFailures: unknown[] = [];
      try {
        await disposeAll(
          [...candidates.values()].map(
            ({ prepared }) => prepared,
          ),
          "model-runtime: candidate cleanup failed",
        );
      } catch (cleanupError) {
        recoveryFailures.push(cleanupError);
      }
      if (disposedForRollback.size > 0) {
        for (const [id, previous] of disposedForRollback) {
          try {
            this.#components.set(id, {
              config: previous.config,
              prepared: await this.#prepare(
                previous.config,
                this.#host,
              ),
              active: true,
            });
          } catch (restoreError) {
            // Preserve the desired config but never reuse or republish the
            // disposed generation. A later request at the same lifecycle must
            // prepare it again instead of taking the lifecycle no-op path.
            this.#components.set(id, {
              ...previous,
              active: false,
            });
            recoveryFailures.push(restoreError);
          }
        }
        try {
          // The commit callback restores its previous snapshot when the
          // candidate publication fails. Re-publish what recovery actually
          // produced, which may legitimately contain no provider if the
          // owned service could not restart.
          await commit(mergedProviders(this.#components));
          this.#publicationDirty = false;
        } catch (recoveryCommitError) {
          // Actual process ownership and published routes may now differ.
          // Force the next reconciliation to publish even if no lifecycle
          // changes, so a transient adapter failure can self-heal.
          this.#publicationDirty = true;
          recoveryFailures.push(recoveryCommitError);
        }
      }
      if (recoveryFailures.length > 0) {
        throw new AggregateError(
          [error, ...recoveryFailures],
          "model-runtime: reconciliation recovery failed",
        );
      }
      throw error;
    }
  }
}

interface ModelRuntimeControlContext {
  effect(
    callback: () => () => void,
    label: string,
  ): unknown;
}

interface ModelRuntimeControlProcess {
  on(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  off(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  send?(
    message: ModelRuntimeControlResponse,
    callback?: (error: Error | null) => void,
  ): boolean;
}

function controlRequestId(
  value: unknown,
): number | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const requestId = Reflect.get(value, "requestId");
  return Number.isSafeInteger(requestId) &&
      Number(requestId) > 0
    ? Number(requestId)
    : undefined;
}

/** Bind Minke's private process channel to live provider reconciliation. */
export function installModelRuntimeControl(
  ctx: ModelRuntimeControlContext,
  runtime: Pick<LiveModelRuntime, "reconfigure">,
  commit: CommitModelRuntimeProviders,
  port: ModelRuntimeControlProcess = process,
): void {
  if (port.send === undefined) return;
  ctx.effect(() => {
    const onMessage = (message: unknown): void => {
      if (!isMinkeModelRuntimeControlMessage(message)) return;
      const requestId = controlRequestId(message);
      if (requestId === undefined) return;
      void (async () => {
        let response: ModelRuntimeControlResponse;
        try {
          const request =
            parseReconfigureModelRuntimesRequest(message);
          await runtime.reconfigure(
            request.settings,
            commit,
            request.mode,
          );
          response = modelRuntimesReconfiguredResponse(
            request.requestId,
          );
        } catch (error) {
          response = modelRuntimeReconfigureErrorResponse(
            requestId,
            error,
          );
        }
        port.send?.(response, () => {
          // Parent teardown may close IPC after reconciliation completes.
        });
      })();
    };
    port.on("message", onMessage);
    return () => {
      port.off("message", onMessage);
    };
  }, "model-runtime: live control");
}
