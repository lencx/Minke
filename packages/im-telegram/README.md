# Minke Telegram IM transport

`@lencx/minke-im-telegram` is Minke's Telegram Bot API transport and Gateway provider. It uses the official HTTPS Bot API directly and has no OpenClaw, desktop, webhook server, or third-party Telegram SDK dependency.

Create a transport with a BotFather token, call `start()` to validate it through `getMe`, clear any legacy webhook without dropping queued updates, and then create the Gateway provider. `identity` is intentionally unavailable until `getMe()` or `start()` succeeds, so a durable Gateway account is always bound to the bot ID returned by Telegram rather than to an unverified token string.

```ts
import {
  createTelegramGatewayProvider,
  createTelegramTransport,
  telegramAccountKey,
} from "@lencx/minke-im-telegram";

const transport = createTelegramTransport({
  credential: { token },
});

await transport.start({ signal });
const identity = transport.identity;
if (identity === undefined) throw new Error("Telegram identity unavailable");

const provider = createTelegramGatewayProvider({
  accountKey: telegramAccountKey(identity.id),
  generation: 1,
  transport,
});
```

`telegramAccountKey(bot.id)` returns the canonical durable identity `telegram:<bot-id>`. Provider creation rejects any account key that does not match the identity returned by the validated transport, so a Host cannot accidentally bind one bot's credential to another bot's mailbox generation.

## Receive and checkpoint contract

`receive(checkpoint)` uses Telegram long polling and returns `{ fromCheckpoint, messages, nextCheckpoint, suggestedPollTimeoutMs }`. A checkpoint is the decimal identifier of the first update not yet admitted. A null checkpoint omits `offset`; otherwise the request sends the durable checkpoint as `offset`. The returned checkpoint is one greater than the highest observed `update_id`, including unsupported update types.

The transport never stores or advances a checkpoint. The Gateway must admit normalized messages and commit `nextCheckpoint` atomically before processing its inbox. Repeating the same checkpoint deliberately replays the same unconfirmed updates.

Inbound normalization covers text, photo, document, audio, video, voice, sticker, location, and contact messages. It retains chat identity and type, sender or sender-chat identity, forum thread ID, reply summary, edit/update kind, Telegram message ID, and the original update ID. Opaque `file_id` values are retained for later download or reuse but are not fetched automatically.

Telegram long polling and webhooks are mutually exclusive. `start()` therefore calls `deleteWebhook` once per transport by default with `drop_pending_updates: false`, preserving queued updates while making the desktop's single-owner long poll the active receive mode. Set `clearWebhookBeforePolling: false` only when the Host owns webhook cleanup separately and can guarantee that no webhook is registered. Cleanup participates in `AbortSignal` and request-timeout cancellation, and an uncertain cleanup attempt is not repeated by the same transport; dispose it and create a fresh transport if the Host chooses to retry.

A Bot API `409` from `getUpdates` remains classified as `conflict` after webhook cleanup because it normally means another long-polling instance is using the same bot token. The Host should surface that ownership conflict rather than deleting the webhook again or silently retrying. See Telegram's official [`deleteWebhook` reference](https://core.telegram.org/bots/api#deletewebhook), [`getUpdates` reference](https://core.telegram.org/bots/api#getupdates), and [Bot FAQ](https://core.telegram.org/bots/faq#long-polling-gives-me-the-same-updates-again-and-again).

## Delivery contract

The transport sends text, photo, document, audio, video, voice, sticker, location, and contact messages. Media sources are either a Telegram `file_id` or caller-owned bytes with a safe filename and MIME type. Local filesystem paths and arbitrary remote URLs are deliberately not accepted. Byte uploads are bounded by `maxUploadBytes` (50 MB by default), while photos also enforce Telegram's 10 MB upload ceiling.

Gateway preparation is local and binds a normalized `TelegramDeliveryIntent` to the outbox operation and recipient. `recipientId` is authoritative for `chat_id`; `messageThreadId` and `replyToMessageId` in the payload preserve topic and reply targeting. Telegram exposes no general client-supplied idempotency key for these send methods, so a timeout, cancellation, malformed success response, or connection loss after a send starts has `effect: "unknown"` and must become an uncertain Gateway delivery rather than an automatic retry.

Structured unsuccessful Bot API responses have `effect: "none"`. A `429` response reads the official `parameters.retry_after` value and exposes `retryAfterMs`; server failures are retryable only when Telegram returned a definite unsuccessful response. See Telegram's official [request/response contract](https://core.telegram.org/bots/api#making-requests), [`ResponseParameters`](https://core.telegram.org/bots/api#responseparameters), [`sendMessage`](https://core.telegram.org/bots/api#sendmessage), and [file sending rules](https://core.telegram.org/bots/api#sending-files).

## Security and cancellation

The Bot API requires the token in the HTTPS request path. Minke validates its structure, pins requests to the official `api.telegram.org` HTTPS host, disables automatic redirects, bounds JSON responses and byte uploads, and never retains request URLs, raw response bodies, Telegram descriptions, or original network exceptions in exported errors. `TelegramTransportError` contains only redacted classification fields such as `code`, `effect`, `retryable`, `retryAfterMs`, `apiErrorCode`, and HTTP status.

Every operation accepts an `AbortSignal`; `requestTimeoutMs` provides an independent deadline. `close()` aborts owned in-flight work. Callers can distinguish `aborted`, `timeout`, `network`, `credential-invalid`, `conflict`, `rate-limited`, protocol, and API failures without inspecting sensitive strings.
