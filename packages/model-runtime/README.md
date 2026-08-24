# Minke Model Runtime

`@lencx/minke-model-runtime` owns local model discovery, lifecycle, request preparation, and cleanup for Minke. Its core interface accepts a `ModelRuntimeHost`, so tests and non-Harness callers exercise the same module without Electron or Cordis.

The package exposes three interfaces:

- `@lencx/minke-model-runtime` — the host-neutral runtime core;
- `@lencx/minke-model-runtime/contract` — renderer-safe settings values and parsers shared across desktop processes;
- `@lencx/minke-model-runtime/dsh` — the DeepSeek Harness adapter composed by Minke's product overlay.

The DSH adapter translates `ctx.subprocess`, `ctx.credentials`, the launch environment, and `llm/stream` events into the core host interface. It mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin only after configured local services are ready.

LM Studio supports `external`, `ensure-running`, and `managed` lifecycles. Ollama supports `external` and `ensure-running`. Generic loopback OpenAI-compatible providers remain discovery-only and do not gain process ownership.

LM Studio discovery combines the OpenAI-compatible catalog with the native v1
model state, so installed LLM/VLM models remain selectable when Just-In-Time
loading is disabled and `/v1/models` lists only loaded instances. Embedding
models are excluded. Selecting a canonical model that LM Studio explicitly
reports with an empty, well-formed `loaded_instances` array authorizes Minke to
load that model at the configured context even under the `external` lifecycle;
the native state is read again before the request proceeds. Missing, malformed,
ambiguous, or existing external instance state is never mutated. Native state
discovery and safe loading require LM Studio 0.4 or newer; older versions retain
the OpenAI-compatible discovery behavior.
