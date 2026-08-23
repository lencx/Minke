# Minke Model Runtime

`@lencx/minke-model-runtime` owns local model discovery, lifecycle, request preparation, and cleanup for Minke. Its core interface accepts a `ModelRuntimeHost`, so tests and non-Harness callers exercise the same module without Electron or Cordis.

The package exposes three interfaces:

- `@lencx/minke-model-runtime` — the host-neutral runtime core;
- `@lencx/minke-model-runtime/contract` — renderer-safe settings values and parsers shared across desktop processes;
- `@lencx/minke-model-runtime/dsh` — the DeepSeek Harness adapter composed by Minke's product overlay.

The DSH adapter translates `ctx.subprocess`, `ctx.credentials`, the launch environment, and `llm/stream` events into the core host interface. It mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin only after configured local services are ready.

LM Studio supports `external`, `ensure-running`, and `managed` lifecycles. Ollama supports `external` and `ensure-running`. Generic loopback OpenAI-compatible providers remain discovery-only and do not gain process ownership.
