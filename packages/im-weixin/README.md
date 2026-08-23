# Minke Weixin IM transport

`@lencx/minke-im-weixin` implements the Weixin wire protocol used by `@tencent-weixin/openclaw-weixin` without loading or emulating OpenClaw.

This is a Minke-owned SDK-style transport, not an OpenClaw plugin host or compatibility layer. OpenClaw plugin compatibility, if added later, belongs in a separately permissioned host package so the Gateway core does not inherit plugin lifecycle, configuration, or ambient runtime authority.

The public interface owns QR login, long polling, message normalization, typing, encrypted media transfer, tool-progress wire messages, lifecycle notification, and safe operational diagnostics. It deliberately does not own:

- credential or context-token persistence;
- durable checkpoints, message admission, or deduplication;
- authorization, commands, Agent routing, or reply formatting;
- filesystem access, remote media URLs, or SILK transcoding.

## Reliability contract

`receive(checkpoint)` returns both the messages and the next opaque checkpoint. It never persists or advances the checkpoint internally. The Gateway must insert the messages idempotently and commit the returned checkpoint in one transaction before consuming the inbox.

`prepareDelivery(draft)` converts outbound content into a self-versioned opaque payload bound to the current Weixin bot account, operation ID, and recipient. For media, it performs encryption and CDN upload but never calls `sendmessage`; a matching cached prepared payload is validated and reused without another upload. Preparation deliberately excludes `contextToken`, so a long upload cannot freeze an obsolete reply context.

The Gateway encrypts and commits the prepared payload before calling `beginAttempt()`. `deliverPrepared(intent)` validates its operation and recipient bindings, applies the latest durable `contextToken`, and crosses only the `sendmessage` boundary. The convenience `deliver(intent)` composes both operations for non-durable callers; Gateway workers must use the split interface.

Every delivery requires a stable `operationId` supplied by the Gateway outbox. The adapter maps it to Weixin `client_id`, but does not claim that the remote service deduplicates retries. A timeout or connection loss after `sendmessage` therefore reports an unknown remote effect, while upload and preparation failures remain retry-safe or deferred.

Every delivery must echo the latest inbound `replyContext.contextToken` for that peer. Minke refuses tokenless sends because iLink can report apparent success while silently dropping them; scheduled delivery therefore requires the Gateway to persist a fresh per-account, per-peer context token.

Any CGI response with stale-token code `-14` moves the transport into a terminal stale state. Callers must replace it with a new transport constructed from a fresh credential rather than retrying the invalid token.

Inbound BOT echoes preserve `clientId` so a Gateway can reconcile an ambiguous outbox delivery. Message lifecycle, structured references, tool progress, and unknown item types are preserved without rewriting quoted content into the user's text.

## Security contract

Bearer tokens, QR secrets, context tokens, signed CDN parameters, and AES keys are never included in errors. Network requests use HTTPS, reject automatic HTTP redirects, and are restricted to configured trusted host suffixes. Outbound media accepts bytes instead of local paths or arbitrary URLs.

`onDiagnostic` receives only redacted structured events for advisory lifecycle failures and internal CDN retries. The callback cannot affect transport control flow.

The first supported scope is personal/direct Weixin chat. A received `group_id` is preserved as metadata, but group behavior is not yet promised. Voice downloads remain in their original wire codec with accurate encoding metadata; optional SILK transcoding belongs in the Gateway media pipeline.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for protocol-source provenance and license terms.
