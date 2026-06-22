# example-ai-sdk-observer

Capture **Vercel AI SDK + Ollama** runs as canonical `gen_ai.*` spans via
`autotel-genai`'s [`autotelTelemetry()`](../../packages/autotel-genai) — the AI
SDK `Telemetry` integration.

```ts
import { registerTelemetry } from 'ai';
import { autotelTelemetry } from 'autotel-genai/observer';

registerTelemetry(autotelTelemetry({ tracer, captureContent: true }));
```

After that one line, every `generateText` / `streamText` / `embed` call streams
an `invoke_agent › chat › execute_tool` span tree with token usage, **cost**
(`gen_ai.usage.cost.usd`), and **streaming timing** (`time_to_first_chunk`,
`output_tokens_per_second`) — the extras `@ai-sdk/otel` doesn't emit.

Uses [`ai-sdk-ollama`](https://github.com/jagreehal/ai-sdk-ollama)'s
`generateText` / `streamText` (enhanced Ollama tool reliability) with the
`ollama` provider; they wrap the AI SDK's own functions, so the telemetry
lifecycle fires transparently.

## Run

```bash
ollama serve                     # in another terminal
ollama pull llama3.2
ollama pull nomic-embed-text     # for Demo 4 (embeddings)

pnpm --filter @jagreehal/example-ai-sdk-observer start
```

Override the model with `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL`.

## What it shows

1. **`generateText`** — `invoke_agent › chat` with token usage + cost.
2. **tool loop** — `invoke_agent › chat › execute_tool › chat`, tool args/results captured.
3. **`streamText`** — adds `time_to_first_chunk` and `output_tokens_per_second`.
4. **`embed`** — a standalone `embeddings` span with token usage.

## Related

- Zero-config alternative (no `registerTelemetry` call): `subscribeAiTelemetry()`.
- LangChain/LangGraph equivalent: [`example-langchain-observer`](../example-langchain-observer).
