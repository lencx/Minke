# Minke Harness overlay

This package is Minke's product-owned extension layer for DeepSeek Harness. It is installed into the generated desktop runtime and composed through the public `--patch` bundle seam. Nothing in this package is copied into or applied over `vendor/deepseek-harness`.

Harness development dependencies resolve through workspace overrides to the pinned source checkout. `pnpm harness:stage` installs and builds that checkout before typechecking or runtime tests, so source upgrades do not depend on matching npm packages being published first.

The host composition mounts the separate `@lencx/minke-model-runtime/dsh` adapter:

- `model-runtime` is a DSH plugin that owns local model discovery and optional service lifecycle for exactly two product runtimes: LM Studio and Ollama. LM Studio uses `lms server status --json` / `lms server start` and enriches its OpenAI-compatible catalog with LM Studio's v1 loaded-instance metadata. Before dispatch, it verifies that the selected instance has the configured context window. Selecting an unloaded model explicitly authorizes Minke to load that model with the configured context, even when LM Studio was started externally; Minke still never unloads or reconfigures an existing external instance. If Minke started the service itself, it may also reload an undersized default model instance while preserving its supported load parameters. Ollama uses its OpenAI-compatible `/v1/models` endpoint and starts through `ollama serve`. A generic `openAICompatible` adapter remains available for manually configured loopback servers; it does not gain command discovery or process management.

Product subagents follow the Profile Bundle contract in the pinned `dsh-v0.1.3-alpha.1` runtime and are not embedded in Minke's base runtime. Install one into the `web` Profile:

- Codex: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex`
- Claude Code: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code`

Then restart Minke and enable the matching disabled tool row in a copied Agent Preset. The Bundle owns its pinned platform CLI, provider configuration, and private runtime closure.

The model runtime executes CLIs through `ctx.subprocess`, resolves credential references through `ctx.credentials`, and mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin after service preparation. Discovered provider metadata is only the composition base layer; it is never serialized to `settings.yaml`, and user model settings continue to override it. Secrets are resolved for discovery but never copied into provider profiles.

The independent `@lencx/minke-harness-overlay/web-search` Host entry registers
the credential-free `minke_web_search` model tool. It does not register a
`ctx.web` provider or replace DSH's native `web_search` and `web_fetch`; upstream
provider selection, credentials, retries, and error reporting remain intact.
The persisted `webSearch.fallbackEnabled` compatibility setting defaults to
`true`; Harness startup maps it to the product-owned
`MINKE_WEB_SEARCH_FALLBACK_ENABLED` launch flag and uses it only to enable or
disable this additional tool and its failure router. After a native
`web_search` error, the router retries through the same credential-free engine
and returns a clearly labelled fallback result. After `web_fetch` fails, the
original call remains an error and gains clearly labelled alternative search
sources; snippets are never presented as fetched page content. Cancellation
does not trigger fallback. The built-in Bing RSS endpoint is a bounded
best-effort search route with no stability guarantee.
`MINKE_WEB_SEARCH_BASE_URL` may select a compatible RSS endpoint. The provider
sends no cookies or credentials, follows only same-origin or controlled Bing
country redirects, rejects HTML/challenge responses, and caps response,
title, snippet, URL, result-count, query-count, and time budgets. The tool is
available to full Agent Presets and withheld from `minimal`.

Service policy is explicit:

- `external` only discovers an already-running service;
- `ensure-running` starts a missing service. LM Studio's one-shot CLI leaves the shared service running; an `ollama serve` process started by Minke is owned by the Harness process and stopped with it;
- `managed` stops the service on plugin disposal only when this plugin proved it started that service.

Both auto-start preferences default to `false` under `modelRuntime.{lmStudio,ollama}.enabled` in `~/.minke/desktop/minke.config.json`. Electron checks known installation paths and `PATH` without executing either CLI. The DSH Models page keeps service lifecycle and provider configuration together through the pinned runtime's public `settings.models.provider-card` and `settings.models.footer` slots: a live LM Studio or Ollama provider card owns its auto-start switch, while an absent provider gets one fallback row after the native add controls. No translated-heading lookup, private form mutation, or document-wide observer is involved. An unavailable local command leaves its switch visible but disabled. Auto-start changes reconcile against the running Harness immediately and persist only after its provider registry acknowledges the update. Turning off auto-start does not kill an Ollama server Minke already started for the current Harness; it remains usable until Harness exits, while every later Harness launch honors the disabled preference. `LM_STUDIO_BASE_URL` and `OLLAMA_BASE_URL` can select explicit loopback endpoints and are also applied to services Minke starts. Without an override, Minke follows the runtimes' official defaults: LM Studio uses `http://127.0.0.1:1234/v1` and Ollama uses `http://127.0.0.1:11434/v1`. Port `0` is rejected because a client Base URL must contain the service's resolved, connectable port. `LM_API_TOKEN` is used for LM Studio when configured.

The browser half owns Minke's product policy, configurable keyboard shortcuts, and post-boot desktop surface adaptation. It uses:

- `settings.onboarding` slot shadowing to bypass Harness's developer-only internal-testing notice without changing the upstream plugin;
- the native opt-in Schedule host and Client plugins, so active schedules appear in the conversation header without a Minke-owned UI fork;
- Harness's native whole-session turn outline and deep-history jump loader, so unloaded turns remain previewable and navigable without a Minke-owned conversation directory;
- one `settings.section` entry with compact labeled secondary tabs for durable Minke preferences;
- `ctx.uiWorkspace.startSession()` for the New Session action;
- the Settings trigger's accessible DOM contract for the Settings action;
- Harness's `ctx.locale` registry and revision source for synchronized zh/en copy;
- Harness's locale snapshot and `locale/change` event for native desktop copy;
- Harness's `ctx.theme` snapshot and `theme/change` event for native window synchronization;
- a lifecycle-managed DOM adapter for the macOS sidebar, titlebar, and translucent surfaces; the adapter is capability-gated by the isolated preload and removes its observer, markers, and stylesheet on disposal;
- the isolated Minke preload bridge for durable desktop-owned preferences.

Third-party Profile plugins cross the trusted extension boundary. Their package manager hooks may execute during installation, and their Host and Client code is composed into the `web` Profile on every later launch. Such code can reach DSH data, workspaces, credentials through DSH services, and any service the user authorizes. Minke therefore treats the plugin source—not only its install command—as a persistent trust decision.

The Plugins workspace combines desktop-owned Profile installation metadata with the current `pluginInventory/list` projection from DSH's Loader. Installed files and runtime activation are separate facts: a plugin can be active, disabled, pending, isolated after a load failure, missing locally, or have an unknown runtime state when inventory cannot be read. Inventory failure never hides the installed package list. The upstream inventory has no bundle provenance, so Minke correlates Profile bundles to Loader entries by exact package/module name; a bundle that inserts differently named entries is reported as unobserved instead of being assumed healthy. Loader failure details remain in the Host startup log; the workspace offers refresh, restart, repository access, and removal without duplicating the Loader state machine.

The unified Minke section contains labeled tabs for Preferences, Browser, Shortcuts, and Storage. Model-related configuration remains under the existing DSH Models entry, so users do not need to switch between two settings directories for one task. Remote access configuration lives only in Connections under Device access, alongside its live status and recovery actions. It is backed by the separate `@lencx/minke-remote-access` package, persists a default-off Tailscale opt-in, shows the active private HTTPS URL, and keeps command execution, retries, trusted-host updates, and process lifecycle in the desktop host rather than the browser bundle. Changing the enable switch applies to the running Harness without restarting Minke.

The separate document-start extension remains CSS-only. It exists solely because first-paint transparency and Electron drag regions must be present before Harness initializes; it does not traverse or modify the Harness DOM.
