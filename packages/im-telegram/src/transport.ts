import {
  TELEGRAM_DEFAULT_ALLOWED_UPDATES,
  TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS,
  TELEGRAM_MAX_TEXT_CHARACTERS,
  TelegramTransportError,
  type TelegramBotIdentity,
  type TelegramDeliveryIntent,
  type TelegramDeliveryReceipt,
  type TelegramInboundBatch,
  type TelegramMediaSource,
  type TelegramSendAudioInput,
  type TelegramSendBase,
  type TelegramSendContactInput,
  type TelegramSendDocumentInput,
  type TelegramSendLocationInput,
  type TelegramSendMessageInput,
  type TelegramSendPhotoInput,
  type TelegramSendRichMarkdownInput,
  type TelegramSendStickerInput,
  type TelegramSendVideoInput,
  type TelegramSendVoiceInput,
  type TelegramTransport,
  type TelegramTransportOptions,
} from "./contract.ts";
import { splitTelegramText } from "./chunk.ts";
import { planTelegramDeliveryIntents } from "./delivery-plan.ts";
import { TelegramNetwork } from "./network.ts";
import { normalizeTelegramUpdate } from "./normalize.ts";
import {
  parseBotIdentity,
  parseSentMessage,
  parseUpdates,
} from "./protocol.ts";

const DEFAULT_GET_UPDATES_LIMIT = 100;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 35_000;
const MAX_CAPTION_CHARACTERS = 1_024;
const MAX_FILE_NAME_CHARACTERS = 255;

type TransportState =
  | "closed"
  | "closing"
  | "credential-invalid"
  | "new"
  | "open"
  | "starting";

interface CombinedSignal {
  readonly dispose: () => void;
  readonly signal: AbortSignal;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TelegramTransportError(
      "invalid-config",
      `${label} must be a positive safe integer`,
    );
  }
  return resolved;
}

function normalizeAllowedUpdates(
  values: readonly string[] | undefined,
): readonly string[] {
  const source = values ?? TELEGRAM_DEFAULT_ALLOWED_UPDATES;
  const normalized = source.map((value) => value.trim());
  if (
    normalized.some(
      (value) => !/^[a-z][a-z0-9_]{0,63}$/u.test(value),
    )
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "allowedUpdates contains an invalid update name",
    );
  }
  return Object.freeze([...new Set(normalized)]);
}

function checkpointOffset(
  checkpoint: string | null,
): number | undefined {
  if (checkpoint === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(checkpoint)) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram checkpoint is invalid",
    );
  }
  const value = Number(checkpoint);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram checkpoint is outside the safe integer range",
    );
  }
  return value;
}

function combineSignals(
  lifecycle: AbortSignal,
  caller: AbortSignal | undefined,
): CombinedSignal {
  const controller = new AbortController();
  const signals =
    caller === undefined ? [lifecycle] : [lifecycle, caller];
  const listeners = new Map<AbortSignal, () => void>();
  for (const signal of signals) {
    const abort = () => controller.abort(signal.reason);
    listeners.set(signal, abort);
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    dispose() {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
    signal: controller.signal,
  };
}

function requiredText(
  value: string,
  label: string,
  maxCharacters: number,
  length: (input: string) => number = (input) =>
    [...input].length,
): string {
  if (
    value.length === 0 ||
    length(value) > maxCharacters
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      `${label} has an invalid length`,
    );
  }
  return value;
}

function optionalCaption(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if ([...value].length > MAX_CAPTION_CHARACTERS) {
    throw new TelegramTransportError(
      "invalid-config",
      "caption exceeds Telegram's character limit",
    );
  }
  return value;
}

function canFallbackRichMarkdown(
  error: unknown,
): boolean {
  return (
    error instanceof TelegramTransportError &&
    error.code === "api" &&
    error.effect === "none" &&
    error.migrateToChatId === undefined &&
    (
      error.apiErrorCode === 400 ||
      error.apiErrorCode === 404
    )
  );
}

function partialDeliveryError(
  error: unknown,
): TelegramTransportError {
  if (error instanceof TelegramTransportError) {
    return new TelegramTransportError(
      error.code,
      "Telegram delivery may be partially complete",
      {
        apiErrorCode: error.apiErrorCode,
        effect: "unknown",
        migrateToChatId: error.migrateToChatId,
        networkKind: error.networkKind,
        retryAfterMs: error.retryAfterMs,
        retryable: false,
        status: error.status,
      },
    );
  }
  return new TelegramTransportError(
    "protocol",
    "Telegram delivery may be partially complete",
    { effect: "unknown" },
  );
}

function positiveOptionalInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TelegramTransportError(
      "invalid-config",
      `${label} must be a positive safe integer`,
    );
  }
  return value;
}

function finiteNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      `${label} is outside the supported range`,
    );
  }
  return value;
}

function optionalFiniteNumber(
  value: number | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined
    ? undefined
    : finiteNumber(value, label, minimum, maximum);
}

function chatId(value: string): string {
  const normalized = value.trim();
  if (
    !/^-?[1-9][0-9]*$/u.test(normalized) &&
    !/^@[A-Za-z0-9_]{5,64}$/u.test(normalized)
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "chatId is invalid",
    );
  }
  if (
    !normalized.startsWith("@") &&
    !Number.isSafeInteger(Number(normalized))
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "chatId is outside the safe integer range",
    );
  }
  return normalized;
}

function commonParameters(
  input: TelegramSendBase,
): Record<string, unknown> {
  const messageThreadId = positiveOptionalInteger(
    input.messageThreadId,
    "messageThreadId",
  );
  const replyToMessageId = positiveOptionalInteger(
    input.replyToMessageId,
    "replyToMessageId",
  );
  if (
    input.allowSendingWithoutReply !== undefined &&
    replyToMessageId === undefined
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "allowSendingWithoutReply requires replyToMessageId",
    );
  }
  return {
    chat_id: chatId(input.chatId),
    disable_notification: input.disableNotification,
    message_thread_id: messageThreadId,
    protect_content: input.protectContent,
    reply_parameters:
      replyToMessageId === undefined
        ? undefined
        : {
            allow_sending_without_reply:
              input.allowSendingWithoutReply,
            message_id: replyToMessageId,
          },
  };
}

function compactParameters(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

function validateFileName(value: string): string {
  if (
    value.length === 0 ||
    [...value].length > MAX_FILE_NAME_CHARACTERS ||
    /[\/\\\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram upload fileName is invalid",
    );
  }
  return value;
}

function validateMimeType(
  value: string | undefined,
): string {
  const resolved = value?.trim() || "application/octet-stream";
  if (
    resolved.length > 127 ||
    !/^[\x21-\x7e]+\/[\x21-\x7e]+$/u.test(resolved)
  ) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram upload mimeType is invalid",
    );
  }
  return resolved;
}

function formValue(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

function mediaRequest(
  input: {
    readonly field: string;
    readonly maxBytes: number;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly source: TelegramMediaSource;
  },
): FormData | Readonly<Record<string, unknown>> {
  if (input.source.kind === "file-id") {
    if (
      input.source.fileId.length === 0 ||
      input.source.fileId.length > 2_048
    ) {
      throw new TelegramTransportError(
        "invalid-config",
        "Telegram fileId is invalid",
      );
    }
    return compactParameters({
      ...input.parameters,
      [input.field]: input.source.fileId,
    });
  }
  if (input.source.bytes.byteLength === 0) {
    throw new TelegramTransportError(
      "invalid-config",
      "Telegram upload must not be empty",
    );
  }
  if (input.source.bytes.byteLength > input.maxBytes) {
    throw new TelegramTransportError(
      "payload-too-large",
      "Telegram upload exceeds the configured size limit",
    );
  }
  const fileName = validateFileName(input.source.fileName);
  const mimeType = validateMimeType(input.source.mimeType);
  const bytes = new Uint8Array(input.source.bytes.byteLength);
  bytes.set(input.source.bytes);
  const form = new FormData();
  for (const [key, value] of Object.entries(input.parameters)) {
    if (value !== undefined) form.set(key, formValue(value));
  }
  form.set(
    input.field,
    new Blob([bytes.buffer], { type: mimeType }),
    fileName,
  );
  return form;
}

function uncertainProtocolError(): TelegramTransportError {
  return new TelegramTransportError(
    "protocol",
    "Telegram send response is invalid",
    { effect: "unknown" },
  );
}

class TelegramTransportImplementation
  implements TelegramTransport
{
  readonly #allowedUpdates: readonly string[];
  readonly #clearWebhookBeforePolling:
    | boolean
    | "on-receive";
  readonly #getUpdatesLimit: number;
  readonly #lifecycle = new AbortController();
  readonly #longPollTimeoutMs: number;
  readonly #maxUploadBytes: number;
  readonly #network: TelegramNetwork;
  readonly #requestTimeoutMs: number;

  #closePromise?: Promise<void>;
  #identity?: TelegramBotIdentity;
  #polling = false;
  #startPromise?: Promise<void>;
  #state: TransportState = "new";
  #webhookCleanupPromise?: Promise<void>;

  constructor(options: TelegramTransportOptions) {
    this.#network = new TelegramNetwork({
      apiBaseUrl: options.apiBaseUrl,
      fetch: options.fetch,
      maxJsonBytes: options.maxJsonBytes,
      token: options.credential.token,
    });
    this.#allowedUpdates = normalizeAllowedUpdates(
      options.allowedUpdates,
    );
    const clearWebhookBeforePolling =
      options.clearWebhookBeforePolling ?? true;
    if (
      typeof clearWebhookBeforePolling !== "boolean" &&
      clearWebhookBeforePolling !== "on-receive"
    ) {
      throw new TelegramTransportError(
        "invalid-config",
        "clearWebhookBeforePolling must be boolean or on-receive",
      );
    }
    this.#clearWebhookBeforePolling =
      clearWebhookBeforePolling;
    this.#getUpdatesLimit = positiveInteger(
      options.getUpdatesLimit,
      DEFAULT_GET_UPDATES_LIMIT,
      "getUpdatesLimit",
    );
    if (this.#getUpdatesLimit > 100) {
      throw new TelegramTransportError(
        "invalid-config",
        "getUpdatesLimit must not exceed 100",
      );
    }
    this.#longPollTimeoutMs = positiveInteger(
      options.longPollTimeoutMs,
      DEFAULT_LONG_POLL_TIMEOUT_MS,
      "longPollTimeoutMs",
    );
    this.#maxUploadBytes = positiveInteger(
      options.maxUploadBytes,
      DEFAULT_MAX_UPLOAD_BYTES,
      "maxUploadBytes",
    );
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
  }

  get identity(): TelegramBotIdentity | undefined {
    return this.#identity;
  }

  #assertUsable(): void {
    if (
      this.#state === "closed" ||
      this.#state === "closing"
    ) {
      throw new TelegramTransportError(
        "invalid-state",
        "Telegram transport is closed",
      );
    }
    if (this.#state === "credential-invalid") {
      throw new TelegramTransportError(
        "credential-invalid",
        "Telegram bot credential is invalid",
      );
    }
  }

  #assertOpen(): void {
    this.#assertUsable();
    if (this.#state !== "open") {
      throw new TelegramTransportError(
        "invalid-state",
        "Telegram transport has not started",
      );
    }
  }

  async #withSignal<T>(
    caller: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const combined = combineSignals(
      this.#lifecycle.signal,
      caller,
    );
    try {
      return await operation(combined.signal);
    } finally {
      combined.dispose();
    }
  }

  async getMe(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramBotIdentity> {
    this.#assertUsable();
    try {
      const identity = await this.#withSignal(
        options.signal,
        async (signal) =>
          parseBotIdentity(
            await this.#network.call({
              body: {},
              method: "getMe",
              signal,
              timeoutMs: this.#requestTimeoutMs,
            }),
          ),
      );
      this.#identity = identity;
      return identity;
    } catch (error) {
      if (
        error instanceof TelegramTransportError &&
        error.code === "credential-invalid"
      ) {
        this.#state = "credential-invalid";
      }
      throw error;
    }
  }

  async #clearWebhook(
    signal: AbortSignal | undefined,
    phase: "receive" | "start",
  ): Promise<void> {
    if (
      this.#clearWebhookBeforePolling === false ||
      (
        this.#clearWebhookBeforePolling === "on-receive" &&
        phase === "start"
      )
    ) {
      return;
    }
    if (this.#webhookCleanupPromise === undefined) {
      const cleanup = this.#withSignal(
        signal,
        async (combined) => {
          const result = await this.#network.call({
            body: { drop_pending_updates: false },
            effectOnUncertainResponse: "unknown",
            method: "deleteWebhook",
            signal: combined,
            timeoutMs: this.#requestTimeoutMs,
          });
          if (result !== true) {
            throw new TelegramTransportError(
              "protocol",
              "Telegram deleteWebhook response is invalid",
              { effect: "unknown" },
            );
          }
        },
      );
      this.#webhookCleanupPromise = cleanup;
      try {
        await cleanup;
      } catch (error) {
        if (
          error instanceof TelegramTransportError &&
          error.code === "aborted" &&
          error.effect === "none" &&
          this.#webhookCleanupPromise === cleanup
        ) {
          this.#webhookCleanupPromise = undefined;
        }
        throw error;
      }
      return;
    }
    await this.#webhookCleanupPromise;
  }

  async start(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    this.#assertUsable();
    if (this.#state === "open") return;
    if (this.#startPromise !== undefined) {
      return await this.#startPromise;
    }
    this.#state = "starting";
    this.#startPromise = (async () => {
      try {
        await this.getMe(options);
        await this.#clearWebhook(options.signal, "start");
        if (
          this.#state !== "closing" &&
          this.#state !== "closed"
        ) {
          this.#state = "open";
        }
      } catch (error) {
        if (this.#state === "starting") {
          this.#state =
            error instanceof TelegramTransportError &&
            error.code === "credential-invalid"
              ? "credential-invalid"
              : "new";
        }
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
  ): Promise<TelegramInboundBatch> {
    this.#assertOpen();
    if (this.#polling) {
      throw new TelegramTransportError(
        "invalid-state",
        "Telegram receive already has an active long poll",
      );
    }
    const offset = checkpointOffset(checkpoint);
    this.#polling = true;
    try {
      await this.#clearWebhook(options.signal, "receive");
      return await this.#withSignal(
        options.signal,
        async (signal) => {
          const result = parseUpdates(
            await this.#network.call({
              body: compactParameters({
                allowed_updates: this.#allowedUpdates,
                limit: this.#getUpdatesLimit,
                offset,
                timeout: Math.max(
                  1,
                  Math.ceil(this.#longPollTimeoutMs / 1_000),
                ),
              }),
              method: "getUpdates",
              signal,
              timeoutMs: this.#requestTimeoutMs,
            }),
          );
          let nextOffset = offset ?? 0;
          const messages = [];
          for (const update of result) {
            if (update.update_id < 0) {
              throw new TelegramTransportError(
                "protocol",
                "Telegram update_id is invalid",
              );
            }
            nextOffset = Math.max(
              nextOffset,
              update.update_id + 1,
            );
            if (!Number.isSafeInteger(nextOffset)) {
              throw new TelegramTransportError(
                "protocol",
                "Telegram update_id exceeds the safe integer range",
              );
            }
            const message = normalizeTelegramUpdate(update);
            if (message !== undefined) messages.push(message);
          }
          return Object.freeze({
            fromCheckpoint: checkpoint,
            messages: Object.freeze(messages),
            nextCheckpoint: String(nextOffset),
            suggestedPollTimeoutMs:
              this.#longPollTimeoutMs,
          });
        },
      );
    } finally {
      this.#polling = false;
    }
  }

  async #sendMethod(
    method: string,
    body: FormData | Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ): Promise<TelegramDeliveryReceipt> {
    this.#assertOpen();
    return await this.#withSignal(signal, async (combined) => {
      const result = await this.#network.call({
        body,
        effectOnUncertainResponse: "unknown",
        method,
        signal: combined,
        timeoutMs: this.#requestTimeoutMs,
      });
      try {
        return Object.freeze(parseSentMessage(result));
      } catch {
        throw uncertainProtocolError();
      }
    });
  }

  async sendMessage(
    input: TelegramSendMessageInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendMessage",
      compactParameters({
        ...commonParameters(input),
        text: requiredText(
          input.text,
          "text",
          TELEGRAM_MAX_TEXT_CHARACTERS,
          (value) => value.length,
        ),
      }),
      options.signal,
    );
  }

  async #sendPlainMarkdownFallback(
    input: TelegramSendRichMarkdownInput,
    options: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt> {
    const chunks = splitTelegramText(input.markdown);
    let deliveredAny = false;
    let receipt: TelegramDeliveryReceipt | undefined;
    for (const [index, text] of chunks.entries()) {
      try {
        receipt = await this.sendMessage(
          {
            allowSendingWithoutReply:
              index === 0
                ? input.allowSendingWithoutReply
                : undefined,
            chatId: input.chatId,
            disableNotification: input.disableNotification,
            messageThreadId: input.messageThreadId,
            protectContent: input.protectContent,
            replyToMessageId:
              index === 0
                ? input.replyToMessageId
                : undefined,
            text,
          },
          options,
        );
        deliveredAny = true;
      } catch (error) {
        if (deliveredAny) {
          throw partialDeliveryError(error);
        }
        throw error;
      }
    }
    if (receipt === undefined) {
      throw new TelegramTransportError(
        "invalid-config",
        "Telegram Rich Markdown must not be empty",
      );
    }
    return receipt;
  }

  async #sendRichMarkdownPart(
    input: TelegramSendRichMarkdownInput,
    options: { readonly signal?: AbortSignal },
  ): Promise<TelegramDeliveryReceipt> {
    const markdown = requiredText(
      input.markdown,
      "markdown",
      TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS,
    );
    try {
      return await this.#sendMethod(
        "sendRichMessage",
        compactParameters({
          ...commonParameters(input),
          rich_message: { markdown },
        }),
        options.signal,
      );
    } catch (error) {
      if (!canFallbackRichMarkdown(error)) {
        throw error;
      }
      return await this.#sendPlainMarkdownFallback(
        { ...input, markdown },
        options,
      );
    }
  }

  async sendRichMarkdown(
    input: TelegramSendRichMarkdownInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    const markdown = requiredText(
      input.markdown,
      "markdown",
      Number.MAX_SAFE_INTEGER,
    );
    const intents = planTelegramDeliveryIntents({
      ...input,
      kind: "rich-markdown",
      markdown,
    });
    let deliveredAny = false;
    let receipt: TelegramDeliveryReceipt | undefined;
    for (const intent of intents) {
      try {
        if (intent.kind === "rich-markdown") {
          receipt = await this.#sendRichMarkdownPart(
            intent,
            options,
          );
        } else if (intent.kind === "document") {
          receipt = await this.sendDocument(intent, options);
        } else {
          throw new TelegramTransportError(
            "invalid-config",
            "Telegram Rich Markdown plan is invalid",
          );
        }
        deliveredAny = true;
      } catch (error) {
        if (deliveredAny) {
          throw partialDeliveryError(error);
        }
        throw error;
      }
    }
    if (receipt === undefined) {
      throw new TelegramTransportError(
        "invalid-config",
        "Telegram Rich Markdown must not be empty",
      );
    }
    return receipt;
  }

  async sendPhoto(
    input: TelegramSendPhotoInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendPhoto",
      mediaRequest({
        field: "photo",
        maxBytes: Math.min(
          this.#maxUploadBytes,
          MAX_PHOTO_UPLOAD_BYTES,
        ),
        parameters: compactParameters({
          ...commonParameters(input),
          caption: optionalCaption(input.caption),
        }),
        source: input.photo,
      }),
      options.signal,
    );
  }

  async sendDocument(
    input: TelegramSendDocumentInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendDocument",
      mediaRequest({
        field: "document",
        maxBytes: this.#maxUploadBytes,
        parameters: compactParameters({
          ...commonParameters(input),
          caption: optionalCaption(input.caption),
        }),
        source: input.document,
      }),
      options.signal,
    );
  }

  async sendAudio(
    input: TelegramSendAudioInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendAudio",
      mediaRequest({
        field: "audio",
        maxBytes: this.#maxUploadBytes,
        parameters: compactParameters({
          ...commonParameters(input),
          caption: optionalCaption(input.caption),
          duration: positiveOptionalInteger(
            input.durationSeconds,
            "durationSeconds",
          ),
          performer: input.performer,
          title: input.title,
        }),
        source: input.audio,
      }),
      options.signal,
    );
  }

  async sendVideo(
    input: TelegramSendVideoInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendVideo",
      mediaRequest({
        field: "video",
        maxBytes: this.#maxUploadBytes,
        parameters: compactParameters({
          ...commonParameters(input),
          caption: optionalCaption(input.caption),
          duration: positiveOptionalInteger(
            input.durationSeconds,
            "durationSeconds",
          ),
          height: positiveOptionalInteger(
            input.height,
            "height",
          ),
          width: positiveOptionalInteger(input.width, "width"),
        }),
        source: input.video,
      }),
      options.signal,
    );
  }

  async sendVoice(
    input: TelegramSendVoiceInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendVoice",
      mediaRequest({
        field: "voice",
        maxBytes: this.#maxUploadBytes,
        parameters: compactParameters({
          ...commonParameters(input),
          caption: optionalCaption(input.caption),
          duration: positiveOptionalInteger(
            input.durationSeconds,
            "durationSeconds",
          ),
        }),
        source: input.voice,
      }),
      options.signal,
    );
  }

  async sendSticker(
    input: TelegramSendStickerInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendSticker",
      mediaRequest({
        field: "sticker",
        maxBytes: this.#maxUploadBytes,
        parameters: compactParameters({
          ...commonParameters(input),
          emoji: input.emoji,
        }),
        source: input.sticker,
      }),
      options.signal,
    );
  }

  async sendLocation(
    input: TelegramSendLocationInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendLocation",
      compactParameters({
        ...commonParameters(input),
        heading: optionalFiniteNumber(
          input.heading,
          "heading",
          1,
          360,
        ),
        horizontal_accuracy: optionalFiniteNumber(
          input.horizontalAccuracy,
          "horizontalAccuracy",
          0,
          1_500,
        ),
        latitude: finiteNumber(
          input.latitude,
          "latitude",
          -90,
          90,
        ),
        live_period: positiveOptionalInteger(
          input.livePeriodSeconds,
          "livePeriodSeconds",
        ),
        longitude: finiteNumber(
          input.longitude,
          "longitude",
          -180,
          180,
        ),
        proximity_alert_radius: positiveOptionalInteger(
          input.proximityAlertRadius,
          "proximityAlertRadius",
        ),
      }),
      options.signal,
    );
  }

  async sendContact(
    input: TelegramSendContactInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    return await this.#sendMethod(
      "sendContact",
      compactParameters({
        ...commonParameters(input),
        first_name: requiredText(
          input.firstName,
          "firstName",
          64,
        ),
        last_name: input.lastName,
        phone_number: requiredText(
          input.phoneNumber,
          "phoneNumber",
          64,
        ),
        vcard: input.vcard,
      }),
      options.signal,
    );
  }

  async send(
    intent: TelegramDeliveryIntent,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TelegramDeliveryReceipt> {
    switch (intent.kind) {
      case "text":
        return await this.sendMessage(intent, options);
      case "rich-markdown":
        return await this.sendRichMarkdown(intent, options);
      case "photo":
        return await this.sendPhoto(intent, options);
      case "document":
        return await this.sendDocument(intent, options);
      case "audio":
        return await this.sendAudio(intent, options);
      case "video":
        return await this.sendVideo(intent, options);
      case "voice":
        return await this.sendVoice(intent, options);
      case "sticker":
        return await this.sendSticker(intent, options);
      case "location":
        return await this.sendLocation(intent, options);
      case "contact":
        return await this.sendContact(intent, options);
    }
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    if (this.#closePromise !== undefined) {
      return await this.#closePromise;
    }
    this.#state = "closing";
    if (!this.#lifecycle.signal.aborted) {
      this.#lifecycle.abort();
    }
    this.#closePromise = (async () => {
      try {
        await this.#startPromise;
      } catch {
        // Closing owns cancellation and intentionally absorbs start failure.
      } finally {
        this.#state = "closed";
      }
    })();
    return await this.#closePromise;
  }
}

export function createTelegramTransport(
  options: TelegramTransportOptions,
): TelegramTransport {
  return new TelegramTransportImplementation(options);
}

export async function validateTelegramBotToken(
  options: TelegramTransportOptions,
  requestOptions: {
    readonly signal?: AbortSignal;
  } = {},
): Promise<TelegramBotIdentity> {
  const transport = createTelegramTransport(options);
  try {
    return await transport.getMe(requestOptions);
  } finally {
    await transport.close();
  }
}
