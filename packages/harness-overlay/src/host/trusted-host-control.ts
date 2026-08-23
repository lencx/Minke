import {
  isMinkeHarnessControlMessage,
  parseReplaceTrustedHostsRequest,
  replacedTrustedHostsResponse,
  trustedHostsErrorResponse,
  type HarnessControlResponse,
} from "../trusted-host-control-contract.ts";

interface TrustedHostConnection {
  replaceTrustedHosts(trustedHosts: readonly string[]): void;
}

interface TrustedHostControlContext {
  effect(
    callback: () => () => void,
    label: string,
  ): unknown;
  readonly connection: TrustedHostConnection;
}

export interface HarnessControlProcess {
  on(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  off(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  send?(
    message: HarnessControlResponse,
    callback?: (error: Error | null) => void,
  ): boolean;
}

function requestIdFrom(value: unknown): number | undefined {
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

/** Bind Minke's private process channel to DSH's live trust policy. */
export function installTrustedHostControl(
  ctx: TrustedHostControlContext,
  port: HarnessControlProcess = process,
): void {
  if (port.send === undefined) return;
  ctx.effect(() => {
    const onMessage = (message: unknown): void => {
      if (!isMinkeHarnessControlMessage(message)) return;
      const requestId = requestIdFrom(message);
      if (requestId === undefined) return;
      let response: HarnessControlResponse;
      try {
        const request =
          parseReplaceTrustedHostsRequest(message);
        ctx.connection.replaceTrustedHosts(
          request.trustedHosts,
        );
        response = replacedTrustedHostsResponse(
          request.requestId,
        );
      } catch (error) {
        response = trustedHostsErrorResponse(
          requestId,
          error,
        );
      }
      port.send?.(response, () => {
        // Parent-process teardown can close the channel after replacement.
      });
    };
    port.on("message", onMessage);
    return () => {
      port.off("message", onMessage);
    };
  }, "minke-host: trusted-host control");
}
