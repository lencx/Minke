import {
  agentBrowserErrorResponse,
  agentBrowserSuccessResponse,
  isAgentBrowserProcessMessage,
  parseAgentBrowserProcessRequest,
  type AgentBrowserOperationResult,
  type AgentBrowserRequest,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AgentBrowserError,
  asAgentBrowserError,
} from "./cdp.ts";

export interface AgentBrowserProcessChild {
  readonly connected: boolean;
  send?(
    message: unknown,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(
    event: "message" | "error" | "exit" | "disconnect",
    listener: (...args: unknown[]) => void,
  ): unknown;
  off(
    event: "message" | "error" | "exit" | "disconnect",
    listener: (...args: unknown[]) => void,
  ): unknown;
}

export interface AgentBrowserProcessHandler {
  handleProcessRequest(
    request: AgentBrowserRequest,
    signal: AbortSignal,
  ): Promise<AgentBrowserOperationResult>;
  closeOwner(ownerSessionId: string): Promise<void> | void;
}

interface PendingProcessRequest {
  readonly controller: AbortController;
  readonly request: AgentBrowserRequest;
}

function possibleRequestId(value: unknown): number | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const requestId = Reflect.get(value, "requestId");
  return Number.isSafeInteger(requestId) && Number(requestId) > 0
    ? Number(requestId)
    : undefined;
}

/**
 * Server half of the private Harness child-process Agent Browser channel.
 *
 * This channel shares Node's IPC transport with Harness control traffic but
 * has an independent discriminator, parser, pending map, and lifecycle.
 */
export class AgentBrowserProcessChannel {
  readonly #child: AgentBrowserProcessChild;
  readonly #handler: AgentBrowserProcessHandler;
  readonly #onDispose: (() => void) | undefined;
  readonly #pending =
    new Map<number, PendingProcessRequest>();
  readonly #owners = new Set<string>();
  readonly #ownerClosures = new Map<string, Promise<void>>();
  #disposed = false;

  constructor(
    child: AgentBrowserProcessChild,
    handler: AgentBrowserProcessHandler,
    onDispose?: () => void,
  ) {
    this.#child = child;
    this.#handler = handler;
    this.#onDispose = onDispose;
    child.on("message", this.#handleMessage);
    child.on("error", this.#handleFailure);
    child.on("exit", this.#handleExit);
    child.on("disconnect", this.#handleExit);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#child.off("message", this.#handleMessage);
    this.#child.off("error", this.#handleFailure);
    this.#child.off("exit", this.#handleExit);
    this.#child.off("disconnect", this.#handleExit);
    for (const pending of this.#pending.values()) {
      pending.controller.abort(
        new AgentBrowserError(
          "channel_closed",
          "Harness Agent Browser channel closed",
        ),
      );
    }
    this.#pending.clear();
    for (const ownerSessionId of this.#owners) {
      const inFlight = this.#ownerClosures.get(ownerSessionId);
      if (inFlight === undefined) {
        void this.#startOwnerClose(ownerSessionId).catch(() => {
          // Process teardown remains best-effort after the channel is gone.
        });
        continue;
      }
      void inFlight.catch(() => {
        // A failed lifecycle close retains the owner ledger. Channel teardown
        // gets one final retry without racing a close that is still in flight.
        void this.#startOwnerClose(ownerSessionId).catch(() => {});
      });
    }
    this.#owners.clear();
    this.#onDispose?.();
  }

  readonly #handleMessage = (value: unknown): void => {
    if (
      this.#disposed ||
      !isAgentBrowserProcessMessage(value)
    ) {
      return;
    }

    let message;
    try {
      message = parseAgentBrowserProcessRequest(value);
    } catch (error) {
      const requestId = possibleRequestId(value);
      if (
        requestId !== undefined &&
        !this.#pending.has(requestId)
      ) {
        this.#send(agentBrowserErrorResponse(
          requestId,
          error,
          { code: "bad_request", outcome: "known" },
        ));
      }
      return;
    }

    if (message.type === "release-owner") {
      for (const pending of this.#pending.values()) {
        if (
          pending.request.ownerSessionId ===
          message.ownerSessionId
        ) {
          pending.controller.abort(
            new AgentBrowserError(
              "owner_released",
              "Agent Browser owner session was disposed",
            ),
          );
        }
      }
      void this.#startOwnerClose(message.ownerSessionId).catch(() => {
        // Retain the owner ledger so whole-channel disposal can retry.
      });
      return;
    }

    if (message.type === "cancel") {
      this.#pending.get(message.requestId)?.controller.abort(
        new AgentBrowserError(
          "agent_browser_cancelled",
          "Agent Browser request was cancelled",
        ),
      );
      return;
    }

    const duplicate = this.#pending.get(message.requestId);
    if (duplicate !== undefined) {
      // A response is correlated only by request id. Replacing, cancelling, or
      // replying to a duplicate here could make an already-dispatched
      // mutation look like a known failure and would also create two terminal
      // responses. Preserve the first admitted request as the sole authority.
      return;
    }

    const pending: PendingProcessRequest = {
      controller: new AbortController(),
      request: message,
    };
    this.#pending.set(message.requestId, pending);
    this.#owners.add(message.ownerSessionId);
    void this.#run(pending);
  };

  #startOwnerClose(ownerSessionId: string): Promise<void> {
    const existing = this.#ownerClosures.get(ownerSessionId);
    if (existing !== undefined) return existing;

    let closure: Promise<void>;
    try {
      closure = Promise.resolve(
        this.#handler.closeOwner(ownerSessionId),
      );
    } catch (error) {
      closure = Promise.reject(error);
    }
    this.#ownerClosures.set(ownerSessionId, closure);
    void closure.then(
      () => {
        if (
          this.#ownerClosures.get(ownerSessionId) === closure
        ) {
          this.#ownerClosures.delete(ownerSessionId);
        }
        this.#owners.delete(ownerSessionId);
      },
      () => {
        if (
          this.#ownerClosures.get(ownerSessionId) === closure
        ) {
          this.#ownerClosures.delete(ownerSessionId);
        }
      },
    );
    return closure;
  }

  readonly #handleFailure = (): void => {
    this.dispose();
  };

  readonly #handleExit = (): void => {
    this.dispose();
  };

  async #run(pending: PendingProcessRequest): Promise<void> {
    const { request } = pending;
    try {
      const result = await this.#handler.handleProcessRequest(
        request,
        pending.controller.signal,
      );
      if (this.#pending.get(request.requestId) !== pending) return;
      this.#pending.delete(request.requestId);
      this.#send(agentBrowserSuccessResponse(
        request.requestId,
        request.operation,
        result,
      ));
    } catch (error) {
      if (this.#pending.get(request.requestId) !== pending) return;
      this.#pending.delete(request.requestId);
      const browserError = asAgentBrowserError(error);
      this.#send(agentBrowserErrorResponse(
        request.requestId,
        browserError,
        {
          code: browserError.code,
          outcome: browserError.outcome,
        },
      ));
    }
  }

  #send(message: unknown): void {
    if (
      this.#disposed ||
      !this.#child.connected ||
      this.#child.send === undefined
    ) {
      return;
    }
    try {
      this.#child.send(message, (error) => {
        if (error !== null) this.dispose();
      });
    } catch {
      this.dispose();
    }
  }
}
