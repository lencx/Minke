import {
  WEIXIN_DEFAULT_API_BASE_URL,
  WEIXIN_DEFAULT_CDN_BASE_URL,
  WEIXIN_PREPARED_DELIVERY_ENCODING,
  WeixinTransportError,
  type WeixinDeliveryDraft,
  type WeixinDeliveryIntent,
  type WeixinDeliveryReceipt,
  type WeixinInboundAttachment,
  type WeixinInboundBatch,
  type WeixinMediaBlob,
  type WeixinPreparedDelivery,
  type WeixinPreparedDeliveryIntent,
  type WeixinTransport,
  type WeixinTransportOptions,
} from "./contract.ts";
import {
  normalizeInboundMessage,
  parseGetConfigResponse,
  parseGetUpdatesResponse,
  parseRetResponse,
} from "./codec.ts";
import {
  attachmentKindSupportsDownload,
  downloadInboundMedia,
  normalizeOutboundFileName,
  outboundMediaItem,
  uploadMedia,
} from "./media.ts";
import { WeixinNetwork } from "./network.ts";
import {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  type MessageItem,
  type SendMessageRequest,
} from "./protocol.ts";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const CLOSE_REQUEST_TIMEOUT_MS = 2_000;
const MIN_SERVER_LONG_POLL_TIMEOUT_MS = 1_000;
const MAX_SERVER_LONG_POLL_TIMEOUT_MS = 5 * 60_000;
const MIN_TYPING_TICKET_TTL_MS = 12 * 60 * 60_000;
const TYPING_TICKET_TTL_JITTER_MS = 12 * 60 * 60_000;
const TYPING_CONFIG_INITIAL_RETRY_MS = 2_000;
const TYPING_CONFIG_MAX_RETRY_MS = 60 * 60_000;
const MAX_TYPING_TICKETS = 1_024;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const TOOL_RESULT_STATUSES = new Set([
  "blocked",
  "completed",
  "failed",
  "unknown",
]);

type TransportState =
  | "closed"
  | "closing"
  | "new"
  | "open"
  | "stale"
  | "starting";

interface TypingInput {
  readonly active: boolean;
  readonly contextToken: string;
  readonly recipientId: string;
}

interface TypingTicket {
  readonly refreshAt: number;
  readonly retryDelayMs: number;
  readonly value?: string;
}

function positiveTimeout(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} must be a positive integer`,
    );
  }
  return timeout;
}

function requiredId(
  value: string,
  label: string,
): string {
  const result = value.trim();
  if (result === "") {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} is required`,
    );
  }
  return result;
}

function requiredOpaque(
  value: string | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} is required`,
    );
  }
  return value;
}

function optionalId(
  value: string | undefined,
  label: string,
): string | undefined {
  return value === undefined ? undefined : requiredId(value, label);
}

function eventTime(value: number | undefined): number {
  const resolved = value ?? Date.now();
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new WeixinTransportError(
      "invalid-config",
      "tool progress occurredAt must be a nonnegative integer",
    );
  }
  return resolved;
}

function operationId(value: string): string {
  const result = value.trim();
  if (
    result !== value ||
    !OPERATION_ID_PATTERN.test(result)
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      "operationId contains unsupported characters",
    );
  }
  return result;
}

function combinedSignal(
  lifecycle: AbortSignal,
  external: AbortSignal | undefined,
): AbortSignal {
  return external === undefined
    ? lifecycle
    : AbortSignal.any([lifecycle, external]);
}

function textItem(value: string): MessageItem {
  if (value === "") {
    throw new WeixinTransportError(
      "invalid-config",
      "Weixin text delivery is empty",
    );
  }
  return {
    type: MessageItemType.TEXT,
    text_item: { text: value },
  };
}

function toolProgressItem(
  content:
    | Extract<
        WeixinDeliveryIntent["content"],
        { readonly kind: "tool-call-start" }
      >
    | Extract<
        WeixinDeliveryIntent["content"],
        { readonly kind: "tool-call-result" }
      >,
): MessageItem {
  const toolName = requiredId(content.toolName, "toolName");
  const toolCallId = optionalId(content.toolCallId, "toolCallId");
  const createTime = eventTime(content.occurredAt);
  if (content.kind === "tool-call-start") {
    return {
      create_time_ms: createTime,
      is_completed: false,
      tool_call_start_item: {
        tool_call_id: toolCallId,
        tool_name: toolName,
      },
      type: MessageItemType.TOOL_CALL_START,
    };
  }
  if (!TOOL_RESULT_STATUSES.has(content.status)) {
    throw new WeixinTransportError(
      "invalid-config",
      "tool result status is invalid",
    );
  }
  return {
    create_time_ms: createTime,
    is_completed: true,
    tool_call_result_item: {
      status: content.status,
      tool_call_id: toolCallId,
      tool_name: toolName,
    },
    type: MessageItemType.TOOL_CALL_RESULT,
  };
}

function preparedRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} is invalid`,
    );
  }
  return value as Record<string, unknown>;
}

function preparedString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value === "") {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} is invalid`,
    );
  }
  return value;
}

function preparedSize(
  value: unknown,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new WeixinTransportError(
      "invalid-config",
      `${label} is invalid`,
    );
  }
  return Number(value);
}

function validatePreparedMedia(
  value: unknown,
): void {
  const media = preparedRecord(value, "prepared media");
  const aesKey = preparedString(
    media.aes_key,
    "prepared media AES key",
  );
  const decodedKey = Buffer.from(aesKey, "base64");
  if (
    decodedKey.byteLength !== 32 ||
    !/^[0-9a-f]{32}$/u.test(decodedKey.toString("ascii"))
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      "prepared media AES key is invalid",
    );
  }
  preparedString(
    media.encrypt_query_param,
    "prepared media download parameter",
  );
  if (media.encrypt_type !== 1) {
    throw new WeixinTransportError(
      "invalid-config",
      "prepared media encryption type is invalid",
    );
  }
}

function validatePreparedItem(value: unknown): MessageItem {
  const item = preparedRecord(value, "prepared message item");
  switch (item.type) {
    case MessageItemType.TEXT: {
      const text = preparedRecord(
        item.text_item,
        "prepared text item",
      );
      textItem(preparedString(text.text, "prepared text"));
      break;
    }
    case MessageItemType.IMAGE: {
      const image = preparedRecord(
        item.image_item,
        "prepared image item",
      );
      validatePreparedMedia(image.media);
      preparedSize(image.mid_size, "prepared image size");
      break;
    }
    case MessageItemType.VIDEO: {
      const video = preparedRecord(
        item.video_item,
        "prepared video item",
      );
      validatePreparedMedia(video.media);
      preparedSize(video.video_size, "prepared video size");
      break;
    }
    case MessageItemType.FILE: {
      const file = preparedRecord(
        item.file_item,
        "prepared file item",
      );
      validatePreparedMedia(file.media);
      const fileName = preparedString(
        file.file_name,
        "prepared file name",
      );
      if (normalizeOutboundFileName(fileName) !== fileName) {
        throw new WeixinTransportError(
          "invalid-config",
          "prepared file name is not canonical",
        );
      }
      const length = preparedString(
        file.len,
        "prepared file length",
      );
      if (
        !/^[1-9][0-9]*$/u.test(length) ||
        !Number.isSafeInteger(Number(length))
      ) {
        throw new WeixinTransportError(
          "invalid-config",
          "prepared file length is invalid",
        );
      }
      break;
    }
    case MessageItemType.TOOL_CALL_START:
    case MessageItemType.TOOL_CALL_RESULT: {
      if (
        !Number.isSafeInteger(item.create_time_ms) ||
        Number(item.create_time_ms) < 0 ||
        typeof item.is_completed !== "boolean"
      ) {
        throw new WeixinTransportError(
          "invalid-config",
          "prepared tool progress metadata is invalid",
        );
      }
      const progress = preparedRecord(
        item.type === MessageItemType.TOOL_CALL_START
          ? item.tool_call_start_item
          : item.tool_call_result_item,
        "prepared tool progress item",
      );
      requiredId(
        preparedString(
          progress.tool_name,
          "prepared tool name",
        ),
        "toolName",
      );
      if (progress.tool_call_id !== undefined) {
        requiredId(
          preparedString(
            progress.tool_call_id,
            "prepared tool call id",
          ),
          "toolCallId",
        );
      }
      if (
        item.type === MessageItemType.TOOL_CALL_RESULT &&
        (
          typeof progress.status !== "string" ||
          !TOOL_RESULT_STATUSES.has(progress.status)
        )
      ) {
        throw new WeixinTransportError(
          "invalid-config",
          "prepared tool result status is invalid",
        );
      }
      break;
    }
    default:
      throw new WeixinTransportError(
        "invalid-config",
        "prepared message item type is unsupported",
      );
  }
  return item as MessageItem;
}

function encodePreparedDelivery(
  account: string,
  operation: string,
  recipient: string,
  item: MessageItem,
): WeixinPreparedDelivery {
  return Object.freeze({
    bytes: new TextEncoder().encode(
      JSON.stringify({
        accountId: account,
        item,
        operationId: operation,
        recipientId: recipient,
        version: 1,
      }),
    ),
    encoding: WEIXIN_PREPARED_DELIVERY_ENCODING,
  });
}

function decodePreparedDelivery(
  prepared: WeixinPreparedDelivery,
  account: string,
  operation: string,
  recipient: string,
): MessageItem {
  if (
    prepared.encoding !== WEIXIN_PREPARED_DELIVERY_ENCODING ||
    !(prepared.bytes instanceof Uint8Array) ||
    prepared.bytes.byteLength === 0 ||
    prepared.bytes.byteLength > 1024 * 1024
  ) {
    throw new WeixinTransportError(
      "invalid-config",
      "prepared delivery encoding is invalid",
    );
  }
  try {
    const envelope = preparedRecord(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          prepared.bytes,
        ),
      ),
      "prepared delivery",
    );
    if (
      envelope.version !== 1 ||
      envelope.accountId !== account ||
      envelope.operationId !== operation ||
      envelope.recipientId !== recipient
    ) {
      throw new WeixinTransportError(
        "invalid-config",
        "prepared delivery is bound to another operation",
      );
    }
    return validatePreparedItem(envelope.item);
  } catch (error) {
    if (error instanceof WeixinTransportError) throw error;
    throw new WeixinTransportError(
      "invalid-config",
      "prepared delivery payload is invalid",
      { cause: error },
    );
  }
}

class WeixinTransportImplementation implements WeixinTransport {
  readonly accountId: string;

  readonly #apiBaseUrl: string;
  readonly #cdnBaseUrl: string;
  readonly #lifecycle = new AbortController();
  readonly #network: WeixinNetwork;
  readonly #requestTimeoutMs: number;
  #longPollTimeoutMs: number;
  #token: string;
  readonly #typingTickets = new Map<string, TypingTicket>();
  readonly #typingQueues = new Map<string, Promise<void>>();
  readonly #activeTyping = new Map<string, TypingInput>();

  #closePromise?: Promise<void>;
  #polling = false;
  #startPromise?: Promise<void>;
  #state: TransportState = "new";

  constructor(options: WeixinTransportOptions) {
    this.accountId = requiredId(
      options.credential.accountId,
      "credential.accountId",
    );
    this.#token = requiredOpaque(
      options.credential.token,
      "credential.token",
    );
    this.#network = new WeixinNetwork({
      ...options,
      onSessionStale: () => {
        if (
          this.#state !== "closed" &&
          this.#state !== "closing"
        ) {
          this.#state = "stale";
          if (!this.#lifecycle.signal.aborted) {
            this.#lifecycle.abort(
              new WeixinTransportError(
                "session-stale",
                "Weixin session credential is stale",
                { remoteCode: -14 },
              ),
            );
          }
        }
      },
    });
    this.#apiBaseUrl = this.#network.trustedUrl(
      options.credential.baseUrl ?? WEIXIN_DEFAULT_API_BASE_URL,
    ).href;
    this.#cdnBaseUrl = this.#network.trustedUrl(
      options.cdnBaseUrl ?? WEIXIN_DEFAULT_CDN_BASE_URL,
    ).href;
    this.#longPollTimeoutMs = positiveTimeout(
      options.longPollTimeoutMs,
      DEFAULT_LONG_POLL_TIMEOUT_MS,
      "longPollTimeoutMs",
    );
    this.#requestTimeoutMs = positiveTimeout(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
  }

  async start(options: {
    readonly signal?: AbortSignal;
  } = {}): Promise<void> {
    this.#assertNotStale();
    if (this.#state === "open") return;
    if (this.#state === "closing" || this.#state === "closed") {
      throw new WeixinTransportError(
        "invalid-state",
        "Weixin transport is closed",
      );
    }
    if (this.#startPromise !== undefined) {
      return await this.#startPromise;
    }
    this.#state = "starting";
    this.#startPromise = (async () => {
      try {
        const notificationStartedAt = Date.now();
        try {
          const raw = await this.#network.json({
            baseUrl: this.#apiBaseUrl,
            body: JSON.stringify({
              base_info: this.#network.baseInfo(),
            }),
            endpoint: "ilink/bot/msg/notifystart",
            method: "POST",
            signal: combinedSignal(
              this.#lifecycle.signal,
              options.signal,
            ),
            timeoutMs: this.#requestTimeoutMs,
            token: this.#token,
          });
          const response = parseRetResponse(raw, "notifyStart");
          if (response.ret !== 0) {
            throw new WeixinTransportError(
              "protocol",
              "Weixin rejected the start notification",
              { remoteCode: response.ret },
            );
          }
        } catch (error) {
          if (
            (
              error instanceof WeixinTransportError &&
              error.code === "session-stale"
            ) ||
            this.#lifecycle.signal.aborted ||
            options.signal?.aborted
          ) {
            throw error;
          }
          this.#network.reportDiagnostic({
            durationMs: Date.now() - notificationStartedAt,
            error,
            operation: "notify-start",
            type: "advisory-failure",
          });
          // The upstream notification is advisory. Polling remains usable
          // when the endpoint is unavailable or rejects the notification.
        }
        if (this.#state === "starting") this.#state = "open";
      } catch (error) {
        if (this.#state === "starting") this.#state = "new";
        throw error;
      } finally {
        this.#startPromise = undefined;
      }
    })();
    return await this.#startPromise;
  }

  async receive(
    checkpoint: string | null,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<WeixinInboundBatch> {
    this.#assertOpen();
    if (this.#polling) {
      throw new WeixinTransportError(
        "invalid-state",
        "only one Weixin receive call may be active",
      );
    }
    this.#polling = true;
    try {
      let raw: unknown;
      try {
        raw = await this.#network.json({
          baseUrl: this.#apiBaseUrl,
          body: JSON.stringify({
            base_info: this.#network.baseInfo(),
            get_updates_buf: checkpoint ?? "",
          }),
          endpoint: "ilink/bot/getupdates",
          method: "POST",
          signal: combinedSignal(
            this.#lifecycle.signal,
            options.signal,
          ),
          timeoutMs: this.#longPollTimeoutMs,
          token: this.#token,
        });
      } catch (error) {
        if (
          error instanceof WeixinTransportError &&
          error.code === "timeout"
        ) {
          return {
            fromCheckpoint: checkpoint,
            messages: [],
            nextCheckpoint: checkpoint ?? "",
          };
        }
        throw error;
      }

      const response = parseGetUpdatesResponse(raw);
      const errorCode =
        response.errcode !== undefined && response.errcode !== 0
          ? response.errcode
          : response.ret !== undefined && response.ret !== 0
            ? response.ret
            : undefined;
      if (errorCode !== undefined) {
        throw new WeixinTransportError(
          "protocol",
          "Weixin getUpdates returned an error",
          { remoteCode: errorCode },
        );
      }
      const nextCheckpoint =
        response.get_updates_buf !== undefined &&
        response.get_updates_buf !== ""
          ? response.get_updates_buf
          : checkpoint ?? "";
      const suggestedPollTimeoutMs =
        response.longpolling_timeout_ms !== undefined &&
        Number.isSafeInteger(response.longpolling_timeout_ms) &&
        response.longpolling_timeout_ms > 0
          ? Math.max(
              MIN_SERVER_LONG_POLL_TIMEOUT_MS,
              Math.min(
                MAX_SERVER_LONG_POLL_TIMEOUT_MS,
                response.longpolling_timeout_ms,
              ),
            )
          : undefined;
      if (suggestedPollTimeoutMs !== undefined) {
        this.#longPollTimeoutMs = suggestedPollTimeoutMs;
      }
      return {
        fromCheckpoint: checkpoint,
        messages: Object.freeze(
          (response.msgs ?? []).map(normalizeInboundMessage),
        ),
        nextCheckpoint,
        suggestedPollTimeoutMs,
      };
    } finally {
      this.#polling = false;
    }
  }

  async deliver(
    intent: WeixinDeliveryIntent,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<WeixinDeliveryReceipt> {
    requiredOpaque(intent.contextToken, "contextToken");
    const prepared = await this.prepareDelivery(
      {
        content: intent.content,
        operationId: intent.operationId,
        recipientId: intent.recipientId,
      },
      options,
    );
    return await this.deliverPrepared(
      {
        contextToken: intent.contextToken,
        operationId: intent.operationId,
        prepared,
        recipientId: intent.recipientId,
        runId: intent.runId,
      },
      options,
    );
  }

  async prepareDelivery(
    draft: WeixinDeliveryDraft,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<WeixinPreparedDelivery> {
    this.#assertOpen();
    const clientId = operationId(draft.operationId);
    const recipientId = requiredId(
      draft.recipientId,
      "recipientId",
    );
    const signal = combinedSignal(
      this.#lifecycle.signal,
      options.signal,
    );
    if (signal.aborted) {
      throw new WeixinTransportError(
        "aborted",
        "Weixin delivery preparation was aborted",
      );
    }
    if (draft.prepared !== undefined) {
      try {
        decodePreparedDelivery(
          draft.prepared,
          this.accountId,
          clientId,
          recipientId,
        );
        return Object.freeze({
          bytes: new Uint8Array(draft.prepared.bytes),
          encoding: WEIXIN_PREPARED_DELIVERY_ENCODING,
        });
      } catch (error) {
        if (
          !(error instanceof WeixinTransportError) ||
          error.code !== "invalid-config"
        ) {
          throw error;
        }
      }
    }
    const fileName =
      draft.content.kind === "file"
        ? normalizeOutboundFileName(draft.content.fileName)
        : undefined;

    let item: MessageItem;
    if (draft.content.kind === "text") {
      item = textItem(draft.content.text);
    } else if (
      draft.content.kind === "tool-call-start" ||
      draft.content.kind === "tool-call-result"
    ) {
      item = toolProgressItem(draft.content);
    } else {
      const uploaded = await uploadMedia(this.#network, {
        apiBaseUrl: this.#apiBaseUrl,
        bytes: draft.content.bytes,
        cdnBaseUrl: this.#cdnBaseUrl,
        kind: draft.content.kind,
        recipientId,
        requestTimeoutMs: this.#requestTimeoutMs,
        signal,
        token: this.#token,
      });
      item = outboundMediaItem({
        fileName,
        kind: draft.content.kind,
        uploaded,
      });
    }
    return encodePreparedDelivery(
      this.accountId,
      clientId,
      recipientId,
      item,
    );
  }

  async deliverPrepared(
    intent: WeixinPreparedDeliveryIntent,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<WeixinDeliveryReceipt> {
    this.#assertOpen();
    const clientId = operationId(intent.operationId);
    const recipientId = requiredId(
      intent.recipientId,
      "recipientId",
    );
    const contextToken = requiredOpaque(
      intent.contextToken,
      "contextToken",
    );
    const signal = combinedSignal(
      this.#lifecycle.signal,
      options.signal,
    );
    const item = decodePreparedDelivery(
      intent.prepared,
      this.accountId,
      clientId,
      recipientId,
    );
    if (signal.aborted) {
      throw new WeixinTransportError(
        "aborted",
        "Weixin prepared delivery was aborted before send",
      );
    }
    const request: SendMessageRequest = {
      msg: {
        client_id: clientId,
        context_token: contextToken,
        from_user_id: "",
        item_list: [item],
        message_state: MessageState.FINISH,
        message_type: MessageType.BOT,
        run_id: intent.runId,
        to_user_id: recipientId,
      },
    };
    try {
      const raw = await this.#network.json({
        baseUrl: this.#apiBaseUrl,
        body: JSON.stringify({
          ...request,
          base_info: this.#network.baseInfo(),
        }),
        effectOnTransportFailure: "unknown",
        endpoint: "ilink/bot/sendmessage",
        method: "POST",
        signal,
        timeoutMs: this.#requestTimeoutMs,
        token: this.#token,
      });
      const response = parseRetResponse(raw, "sendMessage");
      if (
        response.ret !== undefined &&
        response.ret !== 0
      ) {
        throw new WeixinTransportError(
          "protocol",
          "Weixin did not confirm the message",
          {
            effect: "unknown",
            remoteCode: response.ret,
          },
        );
      }
    } catch (error) {
      if (error instanceof WeixinTransportError) {
        throw new WeixinTransportError(
          error.code,
          error.message,
          {
            effect: "unknown",
            networkKind: error.networkKind,
            remoteCode: error.remoteCode,
            retryAfterMs: error.retryAfterMs,
            retryable: false,
            status: error.status,
          },
        );
      }
      throw error;
    }
    return {
      clientIds: Object.freeze([clientId]),
      operationId: clientId,
      outcome: "accepted",
      retrySafety: "unconfirmed",
    };
  }

  async downloadMedia(
    attachment: WeixinInboundAttachment,
    options: {
      readonly maxBytes?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<WeixinMediaBlob> {
    this.#assertOpen();
    if (!attachmentKindSupportsDownload(attachment.kind)) {
      throw new WeixinTransportError(
        "invalid-config",
        "unsupported Weixin attachment kind",
      );
    }
    return await downloadInboundMedia(this.#network, {
      attachment,
      cdnBaseUrl: this.#cdnBaseUrl,
      maxBytes: options.maxBytes,
      requestTimeoutMs: this.#requestTimeoutMs,
      signal: combinedSignal(
        this.#lifecycle.signal,
        options.signal,
      ),
    });
  }

  async setTyping(
    input: TypingInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly sent: boolean }> {
    this.#assertOpen();
    const normalized: TypingInput = {
      active: input.active,
      contextToken: requiredOpaque(
        input.contextToken,
        "contextToken",
      ),
      recipientId: requiredId(
        input.recipientId,
        "recipientId",
      ),
    };
    const key = this.#typingKey(normalized);
    return await this.#withTypingLock(key, async () => {
      this.#assertOpen();
      const sent = await this.#sendTyping(
        normalized,
        combinedSignal(
          this.#lifecycle.signal,
          options.signal,
        ),
        this.#requestTimeoutMs,
      );
      if (sent && normalized.active) {
        this.#activeTyping.set(key, normalized);
      } else if (!normalized.active) {
        this.#activeTyping.delete(key);
      }
      return { sent };
    });
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    if (this.#closePromise !== undefined) {
      return await this.#closePromise;
    }
    const shouldNotify =
      this.#state === "open" || this.#state === "starting";
    const shouldCancelTyping = this.#state === "open";
    this.#state = "closing";
    this.#lifecycle.abort();
    this.#closePromise = (async () => {
      const cancellations = (
        shouldCancelTyping ? [...this.#activeTyping.values()] : []
      ).map(
        async (input) => {
          try {
            await this.#sendTyping(
              { ...input, active: false },
              undefined,
              CLOSE_REQUEST_TIMEOUT_MS,
            );
          } catch {
            // Typing cancellation is ephemeral and best-effort during close.
          }
        },
      );
      await Promise.allSettled(cancellations);
      if (shouldNotify) {
        const notificationStartedAt = Date.now();
        try {
          const raw = await this.#network.json({
            baseUrl: this.#apiBaseUrl,
            body: JSON.stringify({
              base_info: this.#network.baseInfo(),
            }),
            endpoint: "ilink/bot/msg/notifystop",
            method: "POST",
            timeoutMs: CLOSE_REQUEST_TIMEOUT_MS,
            token: this.#token,
          });
          const response = parseRetResponse(raw, "notifyStop");
          if (response.ret !== 0) {
            throw new WeixinTransportError(
              "protocol",
              "Weixin rejected the stop notification",
              { remoteCode: response.ret },
            );
          }
        } catch (error) {
          this.#network.reportDiagnostic({
            durationMs: Date.now() - notificationStartedAt,
            error,
            operation: "notify-stop",
            type: "advisory-failure",
          });
          // Remote notification must never prevent local shutdown.
        }
      }
      this.#activeTyping.clear();
      this.#typingTickets.clear();
      this.#typingQueues.clear();
      this.#token = "";
      this.#state = "closed";
    })();
    return await this.#closePromise;
  }

  #assertOpen(): void {
    this.#assertNotStale();
    if (this.#state !== "open") {
      throw new WeixinTransportError(
        "invalid-state",
        "Weixin transport is not open",
      );
    }
  }

  #assertNotStale(): void {
    if (this.#state === "stale") {
      throw new WeixinTransportError(
        "session-stale",
        "Weixin session credential is stale",
        { remoteCode: -14 },
      );
    }
  }

  #typingKey(input: {
    readonly recipientId: string;
  }): string {
    return input.recipientId;
  }

  async #sendTyping(
    input: TypingInput,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<boolean> {
    const key = this.#typingKey(input);
    let lastRemoteCode: number | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ticket = await this.#typingTicket(
        key,
        input,
        signal,
        timeoutMs,
      );
      if (ticket === undefined) return false;

      const raw = await this.#network.json({
        baseUrl: this.#apiBaseUrl,
        body: JSON.stringify({
          base_info: this.#network.baseInfo(),
          ilink_user_id: input.recipientId,
          status: input.active
            ? TypingStatus.TYPING
            : TypingStatus.CANCEL,
          typing_ticket: ticket,
        }),
        effectOnTransportFailure: "unknown",
        endpoint: "ilink/bot/sendtyping",
        method: "POST",
        signal,
        timeoutMs,
        token: this.#token,
      });
      const response = parseRetResponse(raw, "sendTyping");
      if (response.ret === 0) {
        return true;
      }
      lastRemoteCode = response.ret;
      this.#typingTickets.delete(key);
    }

    throw new WeixinTransportError(
      "protocol",
      "Weixin rejected the typing update",
      { remoteCode: lastRemoteCode },
    );
  }

  async #typingTicket(
    key: string,
    input: TypingInput,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<string | undefined> {
    const cached = this.#typingTickets.get(key);
    const now = Date.now();
    if (cached !== undefined && cached.refreshAt > now) {
      return cached.value;
    }

    try {
      const configRaw = await this.#network.json({
        baseUrl: this.#apiBaseUrl,
        body: JSON.stringify({
          base_info: this.#network.baseInfo(),
          context_token: input.contextToken,
          ilink_user_id: input.recipientId,
        }),
        endpoint: "ilink/bot/getconfig",
        method: "POST",
        signal,
        timeoutMs,
        token: this.#token,
      });
      const config = parseGetConfigResponse(configRaw);
      if (config.ret !== 0) {
        throw new WeixinTransportError(
          "protocol",
          "Weixin rejected the typing configuration request",
          { remoteCode: config.ret },
        );
      }
      const ticket = config.typing_ticket;
      if (!ticket?.trim()) {
        this.#cacheTypingTicket(key, {
          refreshAt:
            now + this.#jitterDelay(TYPING_CONFIG_INITIAL_RETRY_MS),
          retryDelayMs: TYPING_CONFIG_INITIAL_RETRY_MS * 2,
        }, now);
        return undefined;
      }
      this.#cacheTypingTicket(key, {
        refreshAt:
          now +
          MIN_TYPING_TICKET_TTL_MS +
          Math.floor(Math.random() * TYPING_TICKET_TTL_JITTER_MS),
        retryDelayMs: TYPING_CONFIG_INITIAL_RETRY_MS,
        value: ticket,
      }, now);
      return ticket;
    } catch (error) {
      if (
        error instanceof WeixinTransportError &&
        error.code === "session-stale"
      ) {
        throw error;
      }
      const retryDelayMs =
        cached?.retryDelayMs ?? TYPING_CONFIG_INITIAL_RETRY_MS;
      this.#cacheTypingTicket(key, {
        refreshAt: now + this.#jitterDelay(retryDelayMs),
        retryDelayMs: Math.min(
          retryDelayMs * 2,
          TYPING_CONFIG_MAX_RETRY_MS,
        ),
        value: cached?.value,
      }, now);
      if (cached?.value !== undefined) return cached.value;
      throw error;
    }
  }

  #cacheTypingTicket(
    key: string,
    ticket: TypingTicket,
    now: number,
  ): void {
    for (const [cachedKey, cached] of this.#typingTickets) {
      if (cachedKey !== key && cached.refreshAt <= now) {
        this.#typingTickets.delete(cachedKey);
      }
    }
    this.#typingTickets.delete(key);
    while (this.#typingTickets.size >= MAX_TYPING_TICKETS) {
      const oldestKey = this.#typingTickets.keys().next().value;
      if (oldestKey === undefined) break;
      this.#typingTickets.delete(oldestKey);
    }
    this.#typingTickets.set(key, ticket);
  }

  #jitterDelay(value: number): number {
    return Math.max(
      1,
      Math.round(value * (0.5 + Math.random())),
    );
  }

  async #withTypingLock<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#typingQueues.get(key) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(
      () => gate,
      () => gate,
    );
    this.#typingQueues.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#typingQueues.get(key) === tail) {
        this.#typingQueues.delete(key);
      }
    }
  }
}

export function createWeixinTransport(
  options: WeixinTransportOptions,
): WeixinTransport {
  return new WeixinTransportImplementation(options);
}
