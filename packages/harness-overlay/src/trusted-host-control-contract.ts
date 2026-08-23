/** Private desktop-to-Harness control messages for live trusted-host updates. */
export const MINKE_HARNESS_CONTROL_CHANNEL =
  "minke:harness-control";
export const MINKE_HARNESS_CONTROL_PROTOCOL_VERSION = 1;

const MAX_TRUSTED_HOSTS = 16;
const MAX_CONTROL_ERROR_LENGTH = 1_024;

export interface ReplaceTrustedHostsRequest {
  readonly channel: typeof MINKE_HARNESS_CONTROL_CHANNEL;
  readonly protocolVersion:
    typeof MINKE_HARNESS_CONTROL_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly type: "trusted-hosts/replace";
  readonly trustedHosts: readonly string[];
}

export type HarnessControlResponse =
  | {
      readonly channel: typeof MINKE_HARNESS_CONTROL_CHANNEL;
      readonly protocolVersion:
        typeof MINKE_HARNESS_CONTROL_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly type: "trusted-hosts/replaced";
    }
  | {
      readonly channel: typeof MINKE_HARNESS_CONTROL_CHANNEL;
      readonly protocolVersion:
        typeof MINKE_HARNESS_CONTROL_PROTOCOL_VERSION;
      readonly requestId: number;
      readonly type: "trusted-hosts/error";
      readonly message: string;
    };

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function parseRequestId(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) <= 0
  ) {
    throw new TypeError(
      "Harness control requestId must be a positive safe integer",
    );
  }
  return Number(value);
}

/** Validate and canonicalize one Harness trusted-host authority. */
export function parseHarnessTrustedHost(
  value: unknown,
): string {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(
      "invalid Harness trusted-host authority",
    );
  }
  try {
    const http = new URL(`http://${value}`);
    const https = new URL(`https://${value}`);
    if (
      http.username !== "" ||
      http.password !== "" ||
      http.pathname !== "/" ||
      http.search !== "" ||
      http.hash !== ""
    ) {
      throw new TypeError(
        "invalid Harness trusted-host authority",
      );
    }
    const port = http.port !== "" ? http.port : https.port;
    const canonical = port === ""
      ? http.hostname
      : `${http.hostname}:${port}`;
    if (canonical !== value.toLowerCase()) {
      throw new TypeError(
        "invalid Harness trusted-host authority",
      );
    }
    return canonical;
  } catch {
    throw new TypeError(
      "invalid Harness trusted-host authority",
    );
  }
}

/** Validate the complete bounded authority replacement sent to Harness. */
export function parseHarnessTrustedHosts(
  value: unknown,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_TRUSTED_HOSTS
  ) {
    throw new TypeError(
      "invalid Harness trusted-host replacement",
    );
  }
  return [...new Set(value.map(parseHarnessTrustedHost))];
}

/** Build one validated request for the private Harness process channel. */
export function createReplaceTrustedHostsRequest(
  requestId: number,
  trustedHosts: readonly string[],
): ReplaceTrustedHostsRequest {
  return {
    channel: MINKE_HARNESS_CONTROL_CHANNEL,
    protocolVersion: MINKE_HARNESS_CONTROL_PROTOCOL_VERSION,
    requestId: parseRequestId(requestId),
    type: "trusted-hosts/replace",
    trustedHosts: parseHarnessTrustedHosts(trustedHosts),
  };
}

/** Whether a process message belongs to Minke's private Harness channel. */
export function isMinkeHarnessControlMessage(
  value: unknown,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "channel") ===
      MINKE_HARNESS_CONTROL_CHANNEL
  );
}

/** Validate one trusted-host replacement arriving in the Harness process. */
export function parseReplaceTrustedHostsRequest(
  value: unknown,
): ReplaceTrustedHostsRequest {
  const request = object(
    value,
    "Harness control request",
  );
  if (
    !hasExactKeys(request, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "trustedHosts",
    ]) ||
    request.channel !== MINKE_HARNESS_CONTROL_CHANNEL ||
    request.protocolVersion !==
      MINKE_HARNESS_CONTROL_PROTOCOL_VERSION ||
    request.type !== "trusted-hosts/replace"
  ) {
    throw new TypeError("invalid Harness control request");
  }
  return createReplaceTrustedHostsRequest(
    parseRequestId(request.requestId),
    parseHarnessTrustedHosts(request.trustedHosts),
  );
}

/** Build the acknowledgement for one applied trusted-host replacement. */
export function replacedTrustedHostsResponse(
  requestId: number,
): HarnessControlResponse {
  return {
    channel: MINKE_HARNESS_CONTROL_CHANNEL,
    protocolVersion: MINKE_HARNESS_CONTROL_PROTOCOL_VERSION,
    requestId: parseRequestId(requestId),
    type: "trusted-hosts/replaced",
  };
}

/** Build a bounded failure response for one rejected replacement. */
export function trustedHostsErrorResponse(
  requestId: number,
  error: unknown,
): HarnessControlResponse {
  const raw =
    error instanceof Error ? error.message : String(error);
  return {
    channel: MINKE_HARNESS_CONTROL_CHANNEL,
    protocolVersion: MINKE_HARNESS_CONTROL_PROTOCOL_VERSION,
    requestId: parseRequestId(requestId),
    type: "trusted-hosts/error",
    message: raw.slice(0, MAX_CONTROL_ERROR_LENGTH),
  };
}

/** Validate one acknowledgement arriving in the desktop process. */
export function parseHarnessControlResponse(
  value: unknown,
): HarnessControlResponse {
  const response = object(
    value,
    "Harness control response",
  );
  const common =
    response.channel === MINKE_HARNESS_CONTROL_CHANNEL &&
    response.protocolVersion ===
      MINKE_HARNESS_CONTROL_PROTOCOL_VERSION;
  if (
    !common ||
    (
      response.type !== "trusted-hosts/replaced" &&
      response.type !== "trusted-hosts/error"
    )
  ) {
    throw new TypeError("invalid Harness control response");
  }
  const requestId = parseRequestId(response.requestId);
  if (response.type === "trusted-hosts/replaced") {
    if (
      !hasExactKeys(response, [
        "channel",
        "protocolVersion",
        "requestId",
        "type",
      ])
    ) {
      throw new TypeError("invalid Harness control response");
    }
    return replacedTrustedHostsResponse(requestId);
  }
  if (
    !hasExactKeys(response, [
      "channel",
      "protocolVersion",
      "requestId",
      "type",
      "message",
    ]) ||
    typeof response.message !== "string" ||
    response.message === "" ||
    response.message.length > MAX_CONTROL_ERROR_LENGTH
  ) {
    throw new TypeError("invalid Harness control response");
  }
  return {
    channel: MINKE_HARNESS_CONTROL_CHANNEL,
    protocolVersion: MINKE_HARNESS_CONTROL_PROTOCOL_VERSION,
    requestId,
    type: "trusted-hosts/error",
    message: response.message,
  };
}
