# AI SDK integration (gen-ai semantic conventions)

autotel implements the **OTel gen-ai semantic conventions** through the `autotel-genai` package. Token usage, tool calls, model info, latency, cost. Captured as standard attributes (`gen_ai.usage.input_tokens`, `gen_ai.tool.name`, `gen_ai.response.finish_reasons`, …) so any backend that understands OTel can render LLM telemetry without custom mapping.

> For the Vercel AI SDK (ai v7+), register `autotelTelemetry()` from `autotel-genai/observer` once. For other clients, `traceGenAI` / `recordGenAiUsage` from `autotel-genai/trace` and `genAiMetricViews` from `autotel-genai/metrics`.

```typescript
import { trace } from 'autotel';
import { registerTelemetry, streamText } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry()); // once, at startup

const handler = trace(async (prompt: string) => {
  const result = streamText({ model: 'anthropic/claude-sonnet-4.6', prompt });
  return result.toTextStreamResponse();
});
```

Captured attributes per call: `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens` / `reasoning.output_tokens` / `cache_read.input_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.response.id`, plus per-tool spans with `gen_ai.tool.name`. Cost (`gen_ai.usage.cost.usd`) is priced from the built-in model pricing table. Prompt/response content is off by default (`autotelTelemetry({ captureContent: true })` to opt in).

## Anti-patterns to detect

| Anti-pattern                       | Fix                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| Manual `result.usage` printing     | `registerTelemetry(autotelTelemetry())`                   |
| Custom `ai.tokens` attribute names | Use OTel gen-ai conventions (`gen_ai.usage.input_tokens`) |
| Tool calls as plain log lines      | Each tool call gets a child span automatically            |
| AI SDK telemetry never registered  | `registerTelemetry(autotelTelemetry())` at startup        |

Deeper coverage — agents, evaluations, cost models, metric views — in `skills/integrations/autotel-genai/SKILL.md`.
