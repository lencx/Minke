# @lencx/minke-im-discord

`@lencx/minke-im-discord` is Minke's Discord Bot API and Gateway v10 provider. It validates a Bot token with `GET /users/@me`, receives `MESSAGE_CREATE` events over a resumable WebSocket session, normalizes Discord-specific message context into the Minke Gateway inbox contract, and sends text, replies, and attachments through `POST /channels/{channel.id}/messages`.

The package has no Discord framework dependency. `fetch`, the WebSocket factory, timers, time, randomness, and reconnect backoff are injectable, so the complete auth, heartbeat, reconnect, normalization, rate-limit, abort, and delivery state machine can be exercised without network access.

## Provider lifecycle

Validate before persisting a credential. A host that already called `validateDiscordBotToken()` may pass the returned `bot` to `createDiscordGatewayProvider()` to avoid repeating `/users/@me`; the factory still validates the local identity shape. The durable account key is exactly `discord:${bot.id}` and the provider rejects any other value.

```ts
import {
  createDiscordGatewayProvider,
  discordAccountKey,
  validateDiscordBotToken,
} from "@lencx/minke-im-discord";

const bot = await validateDiscordBotToken({
  token: plaintextToken,
  signal,
});

// Encrypt plaintextToken in the Host vault before constructing a long-lived provider.
const provider = await createDiscordGatewayProvider({
  accountKey: discordAccountKey(bot.id),
  bot,
  generation: 1,
  token: plaintextToken,
});

await provider.start({ signal });
const batch = await provider.receive(mailbox.getCheckpoint(provider.account.accountKey), { signal });
await provider.close();
```

`start()` fetches `/gateway/bot`, refuses an exhausted Identify quota, opens `wss://…?v=10&encoding=json`, and resolves only after `READY` or `RESUMED`. The connection sends Identify after Hello, starts the jittered heartbeat schedule, requires an ACK before the next scheduled heartbeat, reconnects on Opcode 7 or a missing ACK, resumes with the last sequence when Discord permits it, and starts a new session after a non-resumable Invalid Session or close code. Authentication failure, invalid intents, disallowed intents, invalid sharding, required sharding, and unsupported Gateway versions enter a fatal state instead of looping.

Socket open, Gateway Hello, and Gateway Ready each have an independent startup deadline. The defaults are 10, 15, and 30 seconds and can be overridden with `gatewayOpenTimeoutMs`, `gatewayHelloTimeoutMs`, and `gatewayReadyTimeoutMs`; all use the injectable `timers` port. Once a connection or socket-factory failure triggers recovery before the first Ready, a separate 60-second `gatewayInitialReadyTimeoutMs` budget spans every retry and cannot be reset by reconnecting. An expired deadline fails the provider and closes the half-started socket instead of leaving `start()` pending.

`receive(checkpoint)` permits one outstanding receive and returns one normalized `MESSAGE_CREATE` per `GatewayInboundBatch`. The provider retains that head until a later receive presents the exact opaque checkpoint for its Gateway session and dispatch sequence, then removes only that one head. A failed durable mailbox admission can therefore retry from the same checkpoint, while a new Gateway session cannot acknowledge its messages with an older session's sequence. Discord message IDs remain the durable native deduplication key. A Gateway session is resumable only while its in-memory `session_id`, `resume_gateway_url`, and sequence remain available; after a process restart, Minke identifies a new session and relies on native message ID deduplication rather than claiming historical replay.

`MESSAGE_CREATE` events that arrive between host receive calls wait in a bounded pre-admission queue. `maxPendingMessages` defaults to 1,000 and must be a positive integer. Reaching the limit raises `inbound-overflow`, enters the fatal state, and closes the connection; retained events remain drainable by checkpoint before the fatal error becomes authoritative, so the provider never evicts an unpersisted message silently.

## Inbound messages

Each `GatewayInboundEvent.payload` is a `DiscordInboundMessage` containing normalized text, author, attachments, embeds, reply metadata, timestamps, flags, and a discriminated conversation context:

- `direct` contains the DM channel ID.
- `guild-channel` contains channel and guild IDs.
- `guild-thread` contains thread, guild, and known parent-channel IDs plus the thread type.

`conversationId` and `peerId` are the Discord channel or thread ID because replies are sent to that endpoint; `senderId` is the author ID. Messages authored by the connected bot are `bot-echo`, other bot messages are `system`, and human-authored messages are `user-message`. The provider keeps a bounded nonce-to-operation map so a bot echo reconciles the original Gateway `operationId`; an otherwise unknown nonce remains available as `correlationId`.

The default intents are `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT`. `MESSAGE_CONTENT` is privileged: it must be enabled in the Discord Developer Portal and may require approval for verified apps. Override `intents` only when the host intentionally accepts Discord's documented empty content, embed, attachment, and component fields.

## Outbound messages

The provider accepts these Gateway payload shapes during `prepare()`:

```ts
const textPayload = {
  kind: "text",
  text: "Hello",
  replyTo: { messageId: "900000000000000001" },
};

const attachmentPayload = {
  kind: "message",
  text: "Caption",
  attachments: [
    {
      bytes: fileBytes,
      fileName: "report.pdf",
      contentType: "application/pdf",
      description: "Quarterly report",
    },
  ],
  replyTo: {
    messageId: "900000000000000001",
    channelId: "400000000000000001",
    guildId: "500000000000000001",
    failIfNotExists: false,
  },
};
```

Preparation validates Discord snowflakes, the 2,000-character content limit, attachment metadata, and the 25 MiB request ceiling, then copies all caller-owned byte arrays into the durable prepared payload. Delivery suppresses all mentions by default with `allowed_mentions.parse = []`, derives a stable 25-character nonce from the Gateway operation ID, and sends `enforce_nonce: true`. Attachments use Discord's `payload_json` plus `files[n]` multipart contract, with attachment metadata IDs matching their file indices.

Discord's nonce uniqueness window is only a few minutes, so an ambiguous network, timeout, abort-after-dispatch, malformed-success, or 5xx result is reported as `uncertain`, not silently replayed. Explicit 429 responses and locally known rate-limit windows are retryable with `retryAfterMs`; 401 is a terminal `credential-invalid`; 403, 404, and other 4xx responses are rejected. The implementation reads Discord's dynamic rate-limit headers and never hard-codes request quotas.

## Abort, close, and secrets

All async public operations accept `AbortSignal`. Aborting before REST dispatch is effect-free; aborting a message send after dispatch is conservatively uncertain. `close()` cancels HTTP work, heartbeat and reconnect timers, closes the WebSocket with code 1000, and rejects pending receives. Transport errors are redacted and intentionally do not retain a raw `cause`, because fetch implementations can attach request headers to thrown errors. The Bot token is private provider state and never appears in account metadata, normalized messages, status, error messages, or diagnostics.

The package does not persist credentials or Gateway session data. Token encryption, account generation, durable mailbox admission, and explicit credential reset remain Host responsibilities.

## Protocol references

The implementation follows Discord's official [Gateway lifecycle](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [opcodes and close codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes), [message resource](https://docs.discord.com/developers/resources/message), [user resource](https://docs.discord.com/developers/resources/user), [HTTP API reference](https://docs.discord.com/developers/reference), [rate-limit contract](https://docs.discord.com/developers/topics/rate-limits), and [thread model](https://docs.discord.com/developers/topics/threads).
