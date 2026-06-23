# example-langfuse

**Instrument once with autotel — observe in Langfuse, autotel-devtools, and your
console, all from one canonical span stream.**

The key insight: **Langfuse is a destination, not a span source.** You already
get canonical `gen_ai.*` spans from [`autotel-genai`](../../packages/autotel-genai).
Langfuse ingests plain OTLP (its `LangfuseSpanProcessor` is just an
`OTLPTraceExporter` pointed at `…/api/public/otel/v1/traces` with a Basic-auth
header), and [`autotel-devtools`](../../packages/autotel-devtools) is an OTLP
receiver too. So autotel's **native `destinations`** config fans the same spans
to both — **no `@langfuse/otel`, no `@opentelemetry/*` exporter packages, no
hand-rolled span processors.**

```ts
// instrumentation.ts
import { registerTelemetry } from 'ai';
import { init } from 'autotel';
import { autotelTelemetry } from 'autotel-genai/observer';
import { trace } from '@opentelemetry/api';

init({
  service: 'example-langfuse',
  debug: 'pretty',            // zero-infra local console view
  destinations: [
    // Langfuse — plain OTLP + Basic auth (what LangfuseSpanProcessor does inside)
    {
      endpoint: `${process.env.LANGFUSE_BASEURL}/api/public/otel`,
      headers: { Authorization: `Basic ${base64(`${pub}:${secret}`)}` },
      signals: ['traces'],
    },
    // autotel-devtools — also just an OTLP receiver
    { endpoint: 'http://127.0.0.1:4318', signals: ['traces'] },
  ],
});

// Instrument the AI SDK once. Everything downstream is a consumer.
registerTelemetry(
  autotelTelemetry({ tracer: trace.getTracer('example-langfuse'), captureContent: true }),
);
```

After that, every `generateText` / `streamText` / `embed` call is a canonical
`gen_ai.*` span tree — model, prompt/response, token usage, **cost**, streaming
timing — and it lands in **every** destination at once.

## Why this works

`autotel-genai` emits the canonical `gen_ai.*` semconv (`gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.usage.*`, `gen_ai.usage.cost.usd`, …). Both
Langfuse and autotel-devtools recognise and map those exact attributes — Langfuse
into generations/tool-calls/embeddings, devtools into its GenAI view. The
semantic convention *is* the integration: there's no glue code, and the AI SDK
call is instrumented exactly once.

## Run

```bash
ollama serve                     # in another terminal
ollama pull granite4             # default model — reliable with tools
ollama pull nomic-embed-text     # for Demo 4 (embeddings)

cp apps/example-langfuse/.env.example apps/example-langfuse/.env   # add Langfuse keys (optional)

# fan out to Langfuse (if keys set) + console:
pnpm --filter @jagreehal/example-langfuse start

# also fan out to autotel-devtools:
npx autotel-devtools             # in another terminal → http://127.0.0.1:4318
DEVTOOLS=1 pnpm --filter @jagreehal/example-langfuse start
```

Nothing enabled? It still runs and prints the spans locally — the pipeline is
identical, it just doesn't forward. Set Langfuse keys and/or `DEVTOOLS=1` to fan
them out.

> Default model is `granite4` — it drives the Demo 2 tool loop reliably.
> Override with `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL`. (`llama3.2` tends to
> mangle tool arguments.)

## What it shows

1. **`generateText`** — `invoke_agent › chat` with token usage + cost.
2. **`propagateAttributes`** — the one Langfuse-aware line: wrap a call to attach
   `traceName` / `userId` / `sessionId` / `tags` so the run is a named,
   user-scoped trace in Langfuse. The model call itself is a stock autotel-genai
   tool loop.
3. **`streamText`** — `time_to_first_chunk` / `output_tokens_per_second` ride
   along as generation metadata.
4. **`embed`** — a standalone `embeddings` span with token usage.

Each appears identically in Langfuse and in the devtools GenAI view.

## Variations

- **Even simpler devtools wiring.** autotel has first-class devtools support:
  `init({ devtools: true })` sends to `http://127.0.0.1:4318`, and
  `init({ devtools: { embedded: true } })` auto-starts the receiver. (This sets
  the `endpoint`, so it's an alternative to listing devtools in `destinations`.)

- **Add a real OTLP backend.** Append another entry to `destinations` (Grafana,
  Datadog, Honeycomb, Jaeger…) — same spans, more consumers.

- **Official Langfuse integration.** This example uses autotel's native OTLP for
  zero extra deps. For Langfuse's richer features — media handling (base64 →
  Langfuse media refs), masking, and a `gen_ai`-only export filter — use the
  official [`LangfuseSpanProcessor`](https://www.npmjs.com/package/@langfuse/otel)
  in `spanProcessors` instead. For prompt-version linking
  (`runtimeContext.langfusePrompt`), add the
  [`@langfuse/vercel-ai-sdk`](https://www.npmjs.com/package/@langfuse/vercel-ai-sdk)
  integration alongside `autotelTelemetry()` (`registerTelemetry` is variadic).

## Related

- AI SDK + autotel-genai without Langfuse: [`example-ai-sdk-observer`](../example-ai-sdk-observer).
- LangChain/LangGraph equivalent: [`example-langchain-observer`](../example-langchain-observer).
