# AI SDK integration (gen-ai semantic conventions)

autotel implements the **OTel gen-ai semantic conventions** out of the box. Token usage, tool calls, model info, latency, cost. Captured as standard attributes (`gen_ai.usage.input_tokens`, `gen_ai.tool.name`, `gen_ai.response.finish_reasons`, …) so any backend that understands OTel can render LLM telemetry without custom mapping.

> Node.js apps get the same canonical `gen_ai.*` conventions (plus cost, metric views, and agent governance) from the `autotel-genai` package. `traceGenAI` / `recordGenAiUsage` from `autotel-genai/trace` and `genAiMetricViews` from `autotel-genai/metrics`. `withAiTelemetry` below is the edge-runtime entry point.

```typescript
import { trace } from 'autotel';
import { withAiTelemetry } from 'autotel-edge';
import { registerTelemetry } from 'ai';
import { streamText } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry()); // Node / server runtimes

const handler = trace(async (req) => {
  const result = await streamText({
    model: withAiTelemetry('anthropic/claude-sonnet-4.6'),
    messages: req.messages,
  });
  return result.toResponse();
});
```

Captured attributes per call: `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens` / `reasoning.output_tokens` / `cache_read.input_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.response.id`, plus per-tool spans with `gen_ai.tool.name`. Cost estimation (`gen_ai.usage.cost.usd`) comes for free from `autotelTelemetry()` in Node runtimes or if you pass a pricing map to `withAiTelemetry`.

## Anti-patterns to detect

| Anti-pattern                       | Fix                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| Manual `result.usage` printing     | `autotelTelemetry()` or `withAiTelemetry()`               |
| Custom `ai.tokens` attribute names | Use OTel gen-ai conventions (`gen_ai.usage.input_tokens`) |
| Tool calls as plain log lines      | Each tool call gets a child span automatically            |
| AI SDK not registered in Node      | `registerTelemetry(autotelTelemetry())`                   |

Deeper coverage — agents, evaluations, cost models, metric views — in `skills/integrations/autotel-genai/SKILL.md`.
