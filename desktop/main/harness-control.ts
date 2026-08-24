import {
  createReplaceTrustedHostsRequest,
  isMinkeHarnessControlMessage,
  parseHarnessControlResponse,
} from "@minke/harness-overlay/trusted-host-control-contract";
import {
  createAgentTurnCancelRequest,
  createAgentTurnRunRequest,
  isAgentTurnProcessMessage,
  parseAgentTurnProcessResponse,
  type AgentTurnInput,
  type AgentTurnResult,
} from "@minke/harness-overlay/agent-turn-contract.ts";
import {
  createReconfigureModelRuntimesRequest,
  isMinkeModelRuntimeControlMessage,
  parseModelRuntimeControlResponse,
  type ModelRuntimeReconfigureMode,
  type ModelRuntimeSettings,
} from "@lencx/minke-model-runtime/contract";

const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;
export const DEFAULT_AGENT_TURN_TIMEOUT_MS = 10 * 60_000;

/**
 * Bounded work performed by one worst-case live reconciliation. LM Studio
 * performs an initial status/discovery pass, one lifecycle command, then up
 * to eight status/discovery retries. Ollama can be reconciled in the same
 * request, so its discovery budget is included before the IPC margin.
 */
export const MODEL_RUNTIME_RECONFIGURE_BUDGET =
  Object.freeze({
    cliLifecycleTimeoutMs: 60_000,
    cliStatusTimeoutMs: 2_000,
    modelRequestTimeoutMs: 1_500,
    startupAttempts: 8,
    startupRetryDelayMs: 250,
    controlDeliveryMarginMs: 15_000,
  });

const startupRetryWaitBudgetMs =
  (MODEL_RUNTIME_RECONFIGURE_BUDGET.startupAttempts - 1) *
  MODEL_RUNTIME_RECONFIGURE_BUDGET.startupRetryDelayMs;
export const LM_STUDIO_COLD_START_BUDGET_MS =
  MODEL_RUNTIME_RECONFIGURE_BUDGET.cliStatusTimeoutMs +
  MODEL_RUNTIME_RECONFIGURE_BUDGET.modelRequestTimeoutMs +
  MODEL_RUNTIME_RECONFIGURE_BUDGET.cliLifecycleTimeoutMs +
  MODEL_RUNTIME_RECONFIGURE_BUDGET.startupAttempts *
    (
      MODEL_RUNTIME_RECONFIGURE_BUDGET.cliStatusTimeoutMs +
      MODEL_RUNTIME_RECONFIGURE_BUDGET.modelRequestTimeoutMs
    ) +
  startupRetryWaitBudgetMs;
export const OLLAMA_COLD_START_BUDGET_MS =
  MODEL_RUNTIME_RECONFIGURE_BUDGET.modelRequestTimeoutMs +
  MODEL_RUNTIME_RECONFIGURE_BUDGET.startupAttempts *
    MODEL_RUNTIME_RECONFIGURE_BUDGET.modelRequestTimeoutMs +
  startupRetryWaitBudgetMs;
export const DEFAULT_MODEL_RUNTIME_CONTROL_TIMEOUT_MS =
  LM_STUDIO_COLD_START_BUDGET_MS +
  OLLAMA_COLD_START_BUDGET_MS +
  MODEL_RUNTIME_RECONFIGURE_BUDGET.controlDeliveryMarginMs;

interface HarnessControlChild {
  readonly connected: boolean;
  send?(
    message: unknown,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(
    event: "message" | "error" | "exit",
    listener: (...args: unknown[]) => void,
  ): unknown;
  off(
    event: "message" | "error" | "exit",
    listener: (...args: unknown[]) => void,
  ): unknown;
}

interface PendingControlRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly timeout: NodeJS.Timeout;
}

interface PendingAgentTurn {
  readonly reject: (error: Error) => void;
  readonly resolve: (result: AgentTurnResult) => void;
  readonly timeout: NodeJS.Timeout;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : reason === undefined
      ? "Agent turn was aborted"
      : String(reason),
    reason instanceof Error ? { cause: reason } : undefined,
  );
  error.name = "AbortError";
  return error;
}

/** Own request acknowledgement and teardown for Harness's private IPC pipe. */
export class HarnessControlChannel {
  readonly #child: HarnessControlChild;
  readonly #timeoutMs: number;
  readonly #modelRuntimeTimeoutMs: number;
  readonly #agentTurnTimeoutMs: number;
  readonly #pending = new Map<number, PendingControlRequest>();
  readonly #pendingAgentTurns =
    new Map<number, PendingAgentTurn>();
  #nextRequestId = 1;
  #disposed = false;

  constructor(
    child: HarnessControlChild,
    timeoutMs = DEFAULT_CONTROL_TIMEOUT_MS,
    modelRuntimeTimeoutMs =
      DEFAULT_MODEL_RUNTIME_CONTROL_TIMEOUT_MS,
    agentTurnTimeoutMs = DEFAULT_AGENT_TURN_TIMEOUT_MS,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new RangeError(
        "Harness control timeout must be a positive integer",
      );
    }
    if (
      !Number.isSafeInteger(modelRuntimeTimeoutMs) ||
      modelRuntimeTimeoutMs <= 0
    ) {
      throw new RangeError(
        "model-runtime control timeout must be a positive integer",
      );
    }
    if (
      !Number.isSafeInteger(agentTurnTimeoutMs) ||
      agentTurnTimeoutMs <= 0
    ) {
      throw new RangeError(
        "Agent turn timeout must be a positive integer",
      );
    }
    this.#child = child;
    this.#timeoutMs = timeoutMs;
    this.#modelRuntimeTimeoutMs = modelRuntimeTimeoutMs;
    this.#agentTurnTimeoutMs = agentTurnTimeoutMs;
    child.on("message", this.#onMessage);
    child.on("error", this.#onFailure);
    child.on("exit", this.#onExit);
  }

  /** Atomically replace the authorities accepted by trusted-host routes. */
  replaceTrustedHosts(
    trustedHosts: readonly string[],
  ): Promise<void> {
    const requestId = this.#nextRequestId;
    const request = createReplaceTrustedHostsRequest(
      requestId,
      trustedHosts,
    );
    this.#nextRequestId += 1;
    return this.#sendRequest(
      requestId,
      request,
      "trusted-host replacement",
      this.#timeoutMs,
    );
  }

  /** Apply local-runtime lifecycle preferences without restarting Harness. */
  reconfigureModelRuntimes(
    settings: ModelRuntimeSettings,
    mode: ModelRuntimeReconfigureMode = "apply",
  ): Promise<void> {
    const requestId = this.#nextRequestId;
    const request = createReconfigureModelRuntimesRequest(
      requestId,
      settings,
      mode,
    );
    this.#nextRequestId += 1;
    return this.#sendRequest(
      requestId,
      request,
      "model-runtime reconciliation",
      this.#modelRuntimeTimeoutMs,
    );
  }

  /** Run or recover one durable Harness Agent turn. */
  runAgentTurn(
    input: AgentTurnInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<AgentTurnResult> {
    const requestId = this.#nextRequestId;
    const request = createAgentTurnRunRequest(requestId, input);
    this.#nextRequestId += 1;
    const signal = options.signal;
    if (signal?.aborted === true) {
      return Promise.reject(abortError(signal));
    }
    if (
      this.#disposed ||
      !this.#child.connected ||
      this.#child.send === undefined
    ) {
      return Promise.reject(
        new Error("Harness control channel is unavailable"),
      );
    }

    return new Promise<AgentTurnResult>(
      (resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          this.#sendAgentTurnCancel(requestId);
          this.#settleAgentTurn(
            requestId,
            new Error(
              `Harness did not complete Agent turn within ${String(this.#agentTurnTimeoutMs)} ms`,
            ),
          );
        }, this.#agentTurnTimeoutMs);
        timeout.unref();
        const onAbort = signal === undefined
          ? undefined
          : (): void => {
              this.#sendAgentTurnCancel(requestId);
              this.#settleAgentTurn(
                requestId,
                abortError(signal),
              );
            };
        this.#pendingAgentTurns.set(requestId, {
          reject,
          resolve: resolvePromise,
          timeout,
          ...(signal === undefined ? {} : { signal }),
          ...(onAbort === undefined ? {} : { onAbort }),
        });
        signal?.addEventListener("abort", onAbort as () => void, {
          once: true,
        });
        if (signal?.aborted === true) {
          onAbort?.();
          return;
        }
        try {
          this.#child.send?.(request, (error) => {
            if (error != null) {
              this.#settleAgentTurn(requestId, error);
            }
          });
        } catch (error) {
          this.#settleAgentTurn(
            requestId,
            error instanceof Error
              ? error
              : new Error(String(error)),
          );
        }
      },
    );
  }

  #sendRequest(
    requestId: number,
    request: unknown,
    description: string,
    timeoutMs: number,
  ): Promise<void> {
    if (
      this.#disposed ||
      !this.#child.connected ||
      this.#child.send === undefined
    ) {
      return Promise.reject(
        new Error("Harness control channel is unavailable"),
      );
    }
    return new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.#settle(
          requestId,
          new Error(
            `Harness did not acknowledge ${description} within ${String(timeoutMs)} ms`,
          ),
        );
      }, timeoutMs);
      timeout.unref();
      this.#pending.set(requestId, {
        reject,
        resolve: resolvePromise,
        timeout,
      });
      try {
        this.#child.send?.(request, (error) => {
          if (error != null) {
            this.#settle(requestId, error);
          }
        });
      } catch (error) {
        this.#settle(
          requestId,
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      }
    });
  }

  /** Reject pending requests and detach from the child process. */
  dispose(
    error = new Error("Harness control channel closed"),
  ): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#child.off("message", this.#onMessage);
    this.#child.off("error", this.#onFailure);
    this.#child.off("exit", this.#onExit);
    for (const requestId of [...this.#pending.keys()]) {
      this.#settle(requestId, error);
    }
    for (
      const requestId of [...this.#pendingAgentTurns.keys()]
    ) {
      this.#settleAgentTurn(requestId, error);
    }
  }

  readonly #onMessage = (message: unknown): void => {
    if (isAgentTurnProcessMessage(message)) {
      let response;
      try {
        response = parseAgentTurnProcessResponse(message);
      } catch {
        return;
      }
      if (response.type === "agent-turn/error") {
        this.#settleAgentTurn(
          response.requestId,
          new Error(
            `${response.code}: ${response.message}`,
          ),
        );
      } else {
        this.#settleAgentTurn(
          response.requestId,
          undefined,
          response.result,
        );
      }
      return;
    }
    if (isMinkeHarnessControlMessage(message)) {
      let response;
      try {
        response = parseHarnessControlResponse(message);
      } catch {
        return;
      }
      this.#settle(
        response.requestId,
        response.type === "trusted-hosts/error"
          ? new Error(response.message)
          : undefined,
      );
      return;
    }
    if (!isMinkeModelRuntimeControlMessage(message)) return;
    let response;
    try {
      response = parseModelRuntimeControlResponse(message);
    } catch {
      return;
    }
    this.#settle(
      response.requestId,
      response.type === "model-runtimes/error"
        ? new Error(response.message)
        : undefined,
    );
  };

  readonly #onFailure = (error: unknown): void => {
    this.dispose(
      error instanceof Error
        ? error
        : new Error(String(error)),
    );
  };

  readonly #onExit = (): void => {
    this.dispose();
  };

  #settle(
    requestId: number,
    error?: Error,
  ): void {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return;
    this.#pending.delete(requestId);
    clearTimeout(pending.timeout);
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }

  #sendAgentTurnCancel(requestId: number): void {
    if (
      this.#disposed ||
      !this.#child.connected ||
      this.#child.send === undefined
    ) {
      return;
    }
    try {
      this.#child.send(
        createAgentTurnCancelRequest(requestId),
        () => {
          // Cancellation is best effort; local settlement remains bounded.
        },
      );
    } catch {
      // The request is settled locally by the caller.
    }
  }

  #settleAgentTurn(
    requestId: number,
    error?: Error,
    result?: AgentTurnResult,
  ): void {
    const pending = this.#pendingAgentTurns.get(requestId);
    if (pending === undefined) return;
    this.#pendingAgentTurns.delete(requestId);
    clearTimeout(pending.timeout);
    if (
      pending.signal !== undefined &&
      pending.onAbort !== undefined
    ) {
      pending.signal.removeEventListener(
        "abort",
        pending.onAbort,
      );
    }
    if (error !== undefined) {
      pending.reject(error);
      return;
    }
    if (result === undefined) {
      pending.reject(
        new Error("Harness Agent turn returned no result"),
      );
      return;
    }
    pending.resolve(result);
  }
}
