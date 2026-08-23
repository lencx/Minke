# Minke Harness overlay

This package is Minke's product-owned extension layer for DeepSeek Harness. It is installed into the generated desktop runtime and composed through the public `--patch` bundle seam. Nothing in this package is copied into or applied over `vendor/deepseek-harness`.

The host composition mounts the separate `@lencx/minke-model-runtime/dsh` adapter:

- `model-runtime` is a DSH plugin that owns local model discovery and optional service lifecycle for exactly two product runtimes: LM Studio and Ollama. LM Studio uses `lms server status --json` / `lms server start` and enriches its OpenAI-compatible catalog with LM Studio's v1 loaded-instance metadata. Before dispatch, it verifies that the selected instance has the configured context window. An externally started service is never reconfigured: Minke reports the current and required context lengths and asks the user to reload the model in LM Studio. If Minke started the service itself, it may load or reload the default model instance with the configured context while preserving its supported load parameters. Ollama uses its OpenAI-compatible `/v1/models` endpoint and starts through `ollama serve`. A generic `openAICompatible` adapter remains available for manually configured loopback servers; it does not gain command discovery or process management.

Product subagents follow the Profile Bundle contract in the pinned `dsh-v0.1.1-rc.2` runtime and are not embedded in Minke's base runtime. Install one into the `web` Profile:

- Codex: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex`
- Claude Code: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code`

Then restart Minke and enable the matching disabled tool row in a copied Agent Preset. The Bundle owns its pinned platform CLI, provider configuration, and private runtime closure.

The model runtime executes CLIs through `ctx.subprocess`, resolves credential references through `ctx.credentials`, and mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin after service preparation. Discovered provider metadata is only the composition base layer; it is never serialized to `settings.yaml`, and user model settings continue to override it. Secrets are resolved for discovery but never copied into provider profiles.

Service policy is explicit:

- `external` only discovers an already-running service;
- `ensure-running` starts a missing service. LM Studio's one-shot CLI leaves the shared service running; an `ollama serve` process started by Minke is owned by the Harness process and stopped with it;
- `managed` stops the service on plugin disposal only when this plugin proved it started that service.

Both auto-start preferences default to `false` under `modelRuntime.{lmStudio,ollama}.enabled` in `~/.minke/desktop/minke.config.json`. Electron checks known installation paths and `PATH` without executing either CLI. The Models page always keeps both provider rows available for configuration, while an auto-start switch appears on a row only when its command was found. Changes take effect after restarting Minke. `LM_STUDIO_BASE_URL` and `OLLAMA_BASE_URL` can select explicit loopback endpoints and are also applied to services Minke starts. Without an override, Minke follows the runtimes' official defaults: LM Studio uses `http://127.0.0.1:1234/v1` and Ollama uses `http://127.0.0.1:11434/v1`. Port `0` is rejected because a client Base URL must contain the service's resolved, connectable port. `LM_API_TOKEN` is used for LM Studio when configured.

The browser half owns Minke's product policy, configurable keyboard shortcuts, and post-boot desktop surface adaptation. It uses:

- `settings.onboarding` slot shadowing to bypass Harness's developer-only internal-testing notice without changing the upstream plugin;
- `settings.section` to render its settings page;
- `ctx.workspaces.startSession()` for the New Session action;
- the Settings trigger's accessible DOM contract for the Settings action;
- Harness's `ctx.locale` registry and revision source for synchronized zh/en copy;
- Harness's locale snapshot and `locale/change` event for native desktop copy;
- Harness's `ctx.theme` snapshot and `theme/change` event for native window synchronization;
- a lifecycle-managed DOM adapter for the macOS sidebar, titlebar, and translucent surfaces; the adapter is capability-gated by the isolated preload and removes its observer, markers, and stylesheet on disposal;
- the isolated Minke preload bridge for durable desktop-owned preferences.

Third-party Profile plugins cross the trusted extension boundary. Their package manager hooks may execute during installation, and their Host and Client code is composed into the `web` Profile on every later launch. Such code can reach DSH data, workspaces, credentials through DSH services, and any service the user authorizes. Minke therefore treats the plugin source—not only its install command—as a persistent trust decision.

The Plugins workspace combines desktop-owned Profile installation metadata with the current `pluginInventory/list` projection from DSH's Loader. Installed files and runtime activation are separate facts: a plugin can be active, disabled, pending, isolated after a load failure, missing locally, or have an unknown runtime state when inventory cannot be read. Inventory failure never hides the installed package list. The upstream inventory has no bundle provenance, so Minke correlates Profile bundles to Loader entries by exact package/module name; a bundle that inserts differently named entries is reported as unobserved instead of being assumed healthy. Loader failure details remain in the Host startup log; the workspace offers refresh, restart, repository access, and removal without duplicating the Loader state machine.

The Remote access section is backed by the separate `@lencx/minke-remote-access` package. It persists a default-off Tailscale opt-in, shows the active private HTTPS URL, and keeps command execution and process lifecycle in the desktop host rather than the browser bundle.

The separate document-start extension remains CSS-only. It exists solely because first-paint transparency and Electron drag regions must be present before Harness initializes; it does not traverse or modify the Harness DOM.
