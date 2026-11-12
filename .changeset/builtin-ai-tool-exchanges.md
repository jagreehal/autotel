---
'autotel-builtin-ai': major
'autotel-devtools': patch
---

Trace tool exchanges, sessions, context and metrics on Chrome's built-in AI, measured on Canary 159.

`autotel-builtin-ai`:

- A question on a `LanguageModel` session with `tools` becomes one trace: an `invoke_agent` root, each turn, and an `execute_tool` span per tool run, matched by `callId`.
- Spans carry the GenAI attributes that apply on device (`gen_ai.provider.name`, `gen_ai.conversation.id`, `gen_ai.request.stream`, `gen_ai.output.type`, `gen_ai.response.finish_reasons`, `gen_ai.response.time_to_first_chunk`), plus messages, system instructions, tool definitions and tool arguments and results with `capturePayloads`.
- Session ids and parent ids, turn index, and spans for `clone`, `destroy`, `append` and `measureContextUsage`.
- Context usage, remaining tokens, utilisation and compaction; `SemanticEmbedder` spans carry the embedding space as `gen_ai.request.model`.
- Refusal kinds `user_activation_required`, `feature_disabled` and `download_failed`, plus `builtin_ai.create.user_activation` and `builtin_ai.request.output_languages`.
- Metrics: `gen_ai.client.operation.duration`, `gen_ai.client.operation.time_to_first_chunk` and `builtin_ai.create.duration`.
- Every span carries the device's memory, CPU tier and logical cores. `readTurn()` is exported.

Breaking: the package takes an OpenTelemetry `tracer` (default: the global provider's) in place of `span`, `@opentelemetry/api` replaces `autotel-web` as the peer dependency, and the `autotel-builtin-ai/core` entry is gone. Captured content moves to `gen_ai.input.messages` / `gen_ai.output.messages`, time to first token to `gen_ai.response.time_to_first_chunk` (seconds), and `gen_ai.operation.name` names the GenAI operation; the method stays on `builtin_ai.method`.

`autotel-devtools`: the GenAI view shows a runtime-reported context window and compaction, names built-in AI spans by the API that answered, and gives an agent exchange its own timeline row.
