import {
  WEIXIN_PREPARED_DELIVERY_ENCODING,
  WeixinTransportError,
  type WeixinDeliveryIntent,
  type WeixinInboundBatch,
  type WeixinInboundMessage,
  type WeixinPreparedDelivery,
  type WeixinTransport,
} from "@lencx/minke-im-weixin";
import type {
  GatewayAccount,
  GatewayAttemptOutcome,
  GatewayDeliveryAttempt,
  GatewayDeliveryPreparation,
  GatewayInboundBatch,
  GatewayInboundEvent,
  GatewayPreparationOutcome,
} from "./contract.ts";
import type { GatewayProviderSession } from "./provider.ts";

export interface AdaptWeixinInboundBatchInput {
  readonly accountKey: string;
  readonly batch: WeixinInboundBatch;
  readonly generation: number;
}

export interface CreateWeixinGatewayProviderInput {
  readonly accountKey: string;
  readonly generation: number;
  readonly transport: WeixinTransport;
}

function eventKind(
  message: WeixinInboundMessage,
): GatewayInboundEvent["kind"] {
  switch (message.messageType) {
    case "bot":
      return "bot-echo";
    case "user":
      return "user-message";
    case "unknown":
      return "system";
  }
}

function payloadWithoutDeliveryContext(
  message: WeixinInboundMessage,
): Omit<WeixinInboundMessage, "replyContext"> {
  const {
    replyContext: _replyContext,
    ...payload
  } = message;
  return payload;
}

export function adaptWeixinInboundBatch(
  input: AdaptWeixinInboundBatchInput,
): GatewayInboundBatch {
  return {
    accountKey: input.accountKey,
    events: input.batch.messages.map((message) => ({
      conversationId: message.conversationId,
      correlationId: message.clientId,
      deliveryContext: message.replyContext?.contextToken,
      kind: eventKind(message),
      nativeId: message.id,
      occurredAt: message.createdAt,
      payload: payloadWithoutDeliveryContext(message),
      peerId:
        message.replyContext?.recipientId ?? message.senderId,
      senderId: message.senderId,
    })),
    fromCheckpoint: input.batch.fromCheckpoint,
    generation: input.generation,
    nextCheckpoint: input.batch.nextCheckpoint,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "Weixin Gateway payload must be a message object",
    );
  }
  return value as Record<string, unknown>;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value, label);
  if (result === undefined || result.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return result;
}

function optionalTimestamp(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(
      `${label} must be a non-negative safe integer`,
    );
  }
  return Number(value);
}

function weixinContent(
  payload: unknown,
): WeixinDeliveryIntent["content"] {
  const value = record(payload);
  const kind = requiredString(value.kind, "payload.kind");
  switch (kind) {
    case "text":
      return {
        kind,
        text: requiredString(value.text, "payload.text"),
      };
    case "image":
    case "video":
      if (!(value.bytes instanceof Uint8Array)) {
        throw new TypeError(
          `payload.bytes must be Uint8Array for ${kind}`,
        );
      }
      return {
        bytes: new Uint8Array(value.bytes),
        kind,
      };
    case "file":
      if (!(value.bytes instanceof Uint8Array)) {
        throw new TypeError(
          "payload.bytes must be Uint8Array for file",
        );
      }
      return {
        bytes: new Uint8Array(value.bytes),
        fileName: requiredString(
          value.fileName,
          "payload.fileName",
        ),
        kind,
      };
    case "tool-call-start":
      return {
        kind,
        occurredAt: optionalTimestamp(
          value.occurredAt,
          "payload.occurredAt",
        ),
        toolCallId: optionalString(
          value.toolCallId,
          "payload.toolCallId",
        ),
        toolName: requiredString(
          value.toolName,
          "payload.toolName",
        ),
      };
    case "tool-call-result": {
      const status = requiredString(
        value.status,
        "payload.status",
      );
      if (
        status !== "blocked" &&
        status !== "completed" &&
        status !== "failed" &&
        status !== "unknown"
      ) {
        throw new TypeError(
          "payload.status is not a Weixin tool result status",
        );
      }
      return {
        kind,
        occurredAt: optionalTimestamp(
          value.occurredAt,
          "payload.occurredAt",
        ),
        status,
        toolCallId: optionalString(
          value.toolCallId,
          "payload.toolCallId",
        ),
        toolName: requiredString(
          value.toolName,
          "payload.toolName",
        ),
      };
    }
    default:
      throw new TypeError(
        `Unsupported Weixin Gateway payload kind: ${kind}`,
      );
  }
}

function preparedWeixinDelivery(
  value: unknown,
): WeixinPreparedDelivery | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.encoding !== WEIXIN_PREPARED_DELIVERY_ENCODING ||
    !(candidate.bytes instanceof Uint8Array)
  ) {
    return undefined;
  }
  return {
    bytes: new Uint8Array(candidate.bytes),
    encoding: WEIXIN_PREPARED_DELIVERY_ENCODING,
  };
}

export async function prepareWeixinDelivery(
  transport: WeixinTransport,
  delivery: GatewayDeliveryPreparation,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayPreparationOutcome> {
  let content: WeixinDeliveryIntent["content"];
  try {
    content = weixinContent(delivery.payload);
  } catch {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
  try {
    const prepared = await transport.prepareDelivery(
      {
        content,
        operationId: delivery.operationId,
        prepared:
          delivery.prepared === undefined
            ? undefined
            : preparedWeixinDelivery(
                delivery.prepared.payload,
              ),
        recipientId: delivery.recipientId,
      },
      options,
    );
    return {
      preparedPayload: prepared,
      status: "ready",
    };
  } catch (error) {
    if (!(error instanceof WeixinTransportError)) {
      return {
        reasonCode: "unexpected-transport-error",
        retryAfterMs: 1_000,
        status: "deferred",
      };
    }
    if (error.code === "aborted") {
      return {
        reasonCode: error.code,
        status: "deferred",
      };
    }
    if (error.code === "session-stale") {
      return {
        errorCode: error.code,
        status: "rejected",
        terminal: "session-stale",
      };
    }
    if (error.retryable) {
      return {
        errorCode: error.code,
        retryAfterMs: error.retryAfterMs ?? 0,
        status: "retry",
      };
    }
    return {
      errorCode: error.code,
      status: "rejected",
    };
  }
}

export async function deliverWeixinAttempt(
  transport: WeixinTransport,
  attempt: GatewayDeliveryAttempt,
  options: { readonly signal?: AbortSignal } = {},
): Promise<GatewayAttemptOutcome> {
  const prepared = preparedWeixinDelivery(
    attempt.preparedPayload,
  );
  if (
    attempt.deliveryContext === undefined ||
    prepared === undefined
  ) {
    return {
      errorCode: "invalid-intent",
      status: "rejected",
    };
  }
  try {
    await transport.deliverPrepared(
      {
        contextToken: attempt.deliveryContext,
        operationId: attempt.operationId,
        prepared,
        recipientId: attempt.recipientId,
      },
      options,
    );
    return { status: "accepted" };
  } catch (error) {
    if (!(error instanceof WeixinTransportError)) {
      return {
        errorCode: "unexpected-transport-error",
        status: "uncertain",
      };
    }
    if (error.effect !== "none") {
      return {
        errorCode: error.code,
        status: "uncertain",
      };
    }
    if (error.code === "aborted") {
      return {
        reasonCode: error.code,
        status: "deferred",
      };
    }
    if (error.code === "session-stale") {
      return {
        errorCode: error.code,
        status: "rejected",
        terminal: "session-stale",
      };
    }
    if (error.retryable) {
      return {
        errorCode: error.code,
        retryAfterMs: error.retryAfterMs ?? 0,
        status: "retry",
      };
    }
    return {
      errorCode: error.code,
      status: "rejected",
    };
  }
}

export function createWeixinGatewayProvider(
  input: CreateWeixinGatewayProviderInput,
): GatewayProviderSession {
  const account: GatewayAccount = Object.freeze({
    accountKey: input.accountKey,
    generation: input.generation,
    provider: "weixin",
    providerAccountId: input.transport.accountId,
    requiresDeliveryContext: true,
  });
  return Object.freeze({
    account,
    close: async () => await input.transport.close(),
    deliver: async (
      attempt: GatewayDeliveryAttempt,
      options?: { readonly signal?: AbortSignal },
    ) =>
      await deliverWeixinAttempt(
        input.transport,
        attempt,
        options,
      ),
    prepare: async (
      delivery: GatewayDeliveryPreparation,
      options?: { readonly signal?: AbortSignal },
    ) =>
      await prepareWeixinDelivery(
        input.transport,
        delivery,
        options,
      ),
    receive: async (
      checkpoint: string | null,
      options?: { readonly signal?: AbortSignal },
    ) =>
      adaptWeixinInboundBatch({
        accountKey: account.accountKey,
        batch: await input.transport.receive(
          checkpoint,
          options,
        ),
        generation: account.generation,
      }),
    start: async (options?: { readonly signal?: AbortSignal }) =>
      await input.transport.start(options),
  });
}
