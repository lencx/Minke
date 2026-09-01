# Minke IM Gateway

`@lencx/minke-im-gateway` is Minke's provider-neutral contract and worker boundary for Weixin, Telegram, and Discord. The root entry exports provider ports, channel-neutral message contracts, and receive/delivery runners; it does not select or load a storage engine.

The optional `@lencx/minke-im-gateway/sqlite` entry is the desktop Host's durable mailbox adapter. It owns checkpoint compare-and-swap, durable inbox admission, delivery-context projection, outbox idempotency, leases, attempt fencing, retry schedules, and ambiguous-send recovery. Another Host can implement the same mailbox port without importing SQLite.

The package does not load OpenClaw plugins, store provider credentials, run Agents, or own account-link UI. Provider credentials belong in a credential vault, while a Host composition layer selects a mailbox implementation and connects it to DSH sessions and provider workers.

Provider workers implement the small `GatewayProviderSession` port. `pollGatewayProviderOnce()` owns checkpoint-to-admission ordering, while `dispatchGatewayProviderOnce()` owns claim, preparation, the durable prepared commit, attempt fencing, provider delivery, conservative exception classification, and settlement so channel integrations cannot accidentally reorder the durable state machine.

## Transaction boundary

The desktop SQLite adapter validates the batch's encrypted `fromCheckpoint`, inserts new native message IDs, projects the newest per-peer delivery context, reconciles BOT echoes, and advances `nextCheckpoint` in one transaction. A crash before commit replays the batch; a crash after commit resumes from the durable inbox.

Payloads and delivery contexts are passed through the caller-provided cipher before SQLite sees them. The database stores no bearer credential or plaintext content digest. Minke's Electron Host uses a versioned AES-256-GCM envelope, binds the canonical row purpose as authenticated data, and keeps only a random data key wrapped by operating-system credential protection; an identity cipher is only appropriate in tests.

This pre-release package defines its complete mailbox layout directly as schema v1. It does not migrate earlier development databases; an incompatible local mailbox is rejected and should be recreated.

## Delivery boundary

`enqueue()` creates one durable obligation per provider-visible message and rejects reuse of an operation ID with different content. `claimOutbox()` and provider `prepare()` are before the message-send boundary: preparation may upload media, but it must not make the message visible to the recipient. The runner renews the fenced lease during long preparation, and a successful preparation is encrypted and committed as an opaque outbox attribute while the row remains leased.

`beginAttempt()` requires durable prepared data, reloads the newest per-peer delivery context, persists the ambiguous-capable state, and gives provider `deliver()` the opaque prepared payload rather than the original content. A crash before `beginAttempt()` releases the lease and preserves prepared data for reuse; a crash after `beginAttempt()` converts the orphaned row to `uncertain`, which is never reclaimed automatically.

Only an outcome classified as retry-safe may enter `retry-wait`; a no-effect shutdown abort is `deferred` without consuming the attempt budget. Retry-safe and deferred outcomes retain prepared data, while terminal outcomes clear it. A later provider echo carrying the stable operation ID can reconcile an uncertain row to `confirmed`, while `listUncertain()` and `resolveUncertain()` provide an explicit control-plane path for providers without echoes.

The Weixin adapter maps `context_token` to opaque delivery context and `client_id` to the Gateway operation ID. Provider identity, account generation, and delivery-context policy are fenced together at claim time, so a stale or misbound session cannot send current-generation work. Telegram and Discord adapters should preserve their native checkpoint and correlation semantics instead of reducing them to Weixin-specific fields.

One Host process owns a mailbox. `recover()` is a startup operation for that owner; it must not run while another process is actively dispatching from the same database.

`removeProviderAccounts(provider)` is the destructive provider-recovery boundary. It removes that provider's accounts and lets foreign-key cascades clear their checkpoints, inbox, outbox, delivery contexts, and attempts while preserving every other adapter in the shared mailbox.
