import {
  createReplaceTrustedHostsRequest,
  isMinkeHarnessControlMessage,
  parseHarnessControlResponse,
} from "@minke/harness-overlay/trusted-host-control-contract";

const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;

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

/** Own request acknowledgement and teardown for Harness's private IPC pipe. */
export class HarnessControlChannel {
  readonly #child: HarnessControlChild;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, PendingControlRequest>();
  #nextRequestId = 1;
  #disposed = false;

  constructor(
    child: HarnessControlChild,
    timeoutMs = DEFAULT_CONTROL_TIMEOUT_MS,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new RangeError(
        "Harness control timeout must be a positive integer",
      );
    }
    this.#child = child;
    this.#timeoutMs = timeoutMs;
    child.on("message", this.#onMessage);
    child.on("error", this.#onFailure);
    child.on("exit", this.#onExit);
  }

  /** Atomically replace the authorities accepted by trusted-host routes. */
  replaceTrustedHosts(
    trustedHosts: readonly string[],
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
    const requestId = this.#nextRequestId;
    const request = createReplaceTrustedHostsRequest(
      requestId,
      trustedHosts,
    );
    this.#nextRequestId += 1;
    return new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.#settle(
          requestId,
          new Error(
            `Harness did not acknowledge trusted-host replacement within ${String(this.#timeoutMs)} ms`,
          ),
        );
      }, this.#timeoutMs);
      timeout.unref();
      this.#pending.set(requestId, {
        reject,
        resolve: resolvePromise,
        timeout,
      });
      try {
        this.#child.send?.(request, (error) => {
          if (error !== null) {
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
  }

  readonly #onMessage = (message: unknown): void => {
    if (!isMinkeHarnessControlMessage(message)) return;
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
}
