---
'autotel-genai': minor
---

Track the `open-telemetry/semantic-conventions-genai` registry as of September 2026. `gen_ai.usage.cache_creation.input_tokens` is now emitted as `gen_ai.usage.cache_write.input_tokens` (`GEN_AI.USAGE_CACHE_WRITE_INPUT_TOKENS`), and the workflow duration histogram is `gen_ai.invoke_workflow.duration` (`GEN_AI_METRIC.INVOKE_WORKFLOW_DURATION`). `gen_ai.prompt.version` is now a canonical attribute. Update backend queries that filter on the old names.
