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
- `desktop/main/harness-lifecycle.ts` owns the live runtime URL and orders
  runtime start, optional window attachment, and remote exposure. Runtime
  recovery must work while macOS has no open window.

The main Harness renderer receives only
`clipboard-sanitized-write`, only while it is the active main-window
`webContents`, and only for the current Harness origin. Web tabs use a separate
partition and permission policy.

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
