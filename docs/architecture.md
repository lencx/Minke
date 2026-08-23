# Minke architecture

Minke is a desktop product around a pinned DeepSeek Harness (DSH) runtime. The
load-bearing rule is ownership: upstream code stays pristine, product behavior
lives in Minke modules, and every private upstream dependency has an executable
compatibility gate.

## Runtime boundary

- `vendor/deepseek-harness` is an immutable, commit-pinned submodule.
- `scripts/harness` builds a disposable runtime, applies only declared patches,
  fingerprints the result, and validates it before publication.
- `packages/harness-overlay` is composed through DSH's public Profile Bundle
  seam. Runtime patches are reserved for upstream behavior that no public seam
  can express.
- `desktop/main/harness-lifecycle.ts` owns the live runtime URL and orders old-target detachment, optional window attachment, and delivery of the ready URL to remote access. `packages/remote-access/src/runtime.ts` independently reconciles remote exposure against that URL, including command discovery, retry, transport teardown, and acknowledged trusted-host replacement. Runtime recovery must work while macOS has no open window.

The main Harness renderer receives only
`clipboard-sanitized-write`, only while it is the active main-window
`webContents`, and only for the current Harness origin. Web tabs use a separate
partition and permission policy.

## Remote capability boundary

The top-level Remote Hub is one root-scoped presentation over two independent capabilities: remote device access and IM accounts. It reuses the same `RemoteSettingsRuntime` as Minke Settings, so Tailscale and Cloudflare state cannot drift between surfaces, but an unavailable remote-access bridge does not hide or disable local IM controls.

Weixin authorization and transport lifecycle stay in Electron main behind a finite, authorized, local-only IPC contract. The renderer receives QR content, redacted account labels, dependency state, and bounded errors; grants and provider account identifiers never cross preload. A random data key is wrapped by Electron `safeStorage`; versioned AES-256-GCM envelopes authenticate both the stored grant and each Gateway value, with the canonical row purpose bound as additional authenticated data. The Gateway core exposes storage-neutral mailbox ports and workers; Electron main explicitly composes the optional SQLite adapter for encrypted crash recovery and the monotonic account generation used across unlink and relink.

The IM Gateway uses one complete pre-release schema v1 and does not carry migration code for development databases. An incompatible shared mailbox is rejected rather than migrated in place. The Electron Host shares one startup recovery coordinator across Weixin, Telegram, and Discord, so a channel reconnect cannot globally reclaim another channel's leases. A confirmed Gateway recreation starts a fresh recovery epoch after deleting the database. The Remote Hub's explicit, confirmed Weixin reset removes only Weixin-owned Gateway accounts and their dependent rows, preserving Telegram and Discord data. If the shared mailbox cannot be opened at all, the UI escalates to a separate Gateway-wide recreation confirmation that names its cross-channel data impact. Gateway-wide recreation is exclusive with every channel command; ordinary unlink removes only the credential and never silently deletes inbox or outbox data.

Weixin, Telegram, and Discord can establish their provider transports without Tailscale. Telegram uses Bot API long polling with a durable update checkpoint. Candidate validation does not modify webhook state; only the first receive by a locally committed provider calls `deleteWebhook(drop_pending_updates=false)` and takes long-poll ownership. Discord uses a resumable Gateway v10 session, session-scoped opaque checkpoints for in-process admission replay, and native message IDs for durable deduplication after a process restart. Tailscale exposes the Harness to another device and is not a prerequisite for an IM provider. Agent authorization, route resolution, turn execution, and automatic replies remain explicitly projected as pending rather than being simulated by the channel adapters.

The desktop pre-release intentionally owns at most one account for each IM provider. Replacing a bot token replaces that provider's sole credential; the vault does not pretend to support dormant multi-account state. A replacement is validated and reaches candidate readiness before a serialized vault and mailbox commit. The old receive owner stays active on validation, startup, storage, registration, or candidate-health failure, and every successful handoff drains detached receive owners before the new one polls. While Agent authorization and routing are pending, the receive runner applies a bot-echo-only policy: external events are filtered before SQLite admission while the provider checkpoint still advances atomically. No external message is retained, routed, or answered. Enabling external ingress requires approved-sender DM pairing, explicit Telegram group/topic and Discord guild/channel/thread authorization with mention rules, plus per-account inbox quotas and retention before media resolution or Agent execution.

## Host and client boundary

`minke-host-contract.ts` is the single endpoint catalog and request/response
type map for browser Host RPC. The Host implementation must satisfy the whole
map, and browser adapters validate the capability handshake before their first
operation.

Capabilities describe real behavior. In particular, browser Files currently
declares `watch: false`; the Files controller does not create subscriptions in
that mode. Native Electron Files may advertise watching only when the preload
bridge exposes it.

DSH Profile plugins are trusted extensions, not sandboxed UI add-ons. Install
hooks may run once, while Host and Client code runs on subsequent launches with
access to DSH services, data, workspaces, and user-authorized capabilities.

## Data Home boundary

Minke owns migration orchestration but not DSH's storage formats. The
compatibility adapter recognizes only:

- the `web` Profile manifest;
- `workspace` storage version 2.

The Harness contract gates the upstream formats Minke interprets. Unknown or
incompatible documents remain target-wins conflicts. `session_projcache` is a
derived cache, so Minke does not parse or combine it: a collision keeps the
target cache, while DSH rebuilds missing projections from authoritative session
logs on cold reads. `.credentials.yaml` version 1 is deliberately opaque: Minke
never parses or combines secrets, and a collision preserves both source and
target files while keeping the target active.

Replacement content is staged on the target filesystem and published with one
rename, so the destination never passes through an intentionally missing state.

The migration journal is a recoverable cutover protocol:

1. `pending` — migration is scheduled; the old configuration remains active.
2. `copied` — target data is published for process-restart recovery; activation
   may be retried.
3. configuration points at the target.
4. `completed` — the receipt records the successful cutover.

If the process stops between steps 2–4, startup reconciles the configured path
and completes the receipt without copying again. A failure before the `copied`
receipt is terminal; an activation or completion-receipt failure stays
resumable. This protocol does not claim sudden-power-loss durability; source
Data Homes are retained as the recovery copy.
