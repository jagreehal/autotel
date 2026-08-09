# example-langfuse

**Instrument once with autotel. Observe in Langfuse, autotel-devtools, and your
console, all from one canonical span stream.**

The key insight: **Langfuse is a destination, not a span source.** You already
get canonical `gen_ai.*` spans from [`autotel-genai`](../../packages/autotel-genai).
Langfuse ingests plain OTLP (its `LangfuseSpanProcessor` is just an
`OTLPTraceExporter` pointed at `…/api/public/otel/v1/traces` with a Basic-auth
header), and [`autotel-devtools`](../../packages/autotel-devtools) is an OTLP
receiver too. So autotel's **native `destinations`** config fans the same spans
to both. **no `@langfuse/otel`, no `@opentelemetry/*` exporter packages, no
hand-rolled span processors.**

```ts
// instrumentation.ts
import { registerTelemetry } from 'ai';
import { init } from 'autotel';
import { autotelTelemetry } from 'autotel-genai/observer';
import { langfuseCompatibility } from 'autotel-langfuse';
import { trace } from '@opentelemetry/api';

init({
  service: 'example-langfuse',
  // Optional. Fills the fields Langfuse keeps in its own columns: trace name,
  // tags, release, time to first token. `spanEnrichers` composes with
  // `destinations`, where `spanProcessors` would replace them.
  spanEnrichers: [langfuseCompatibility({ tags: ['production'] })],
  debug: 'pretty', // zero-infra local console view
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
  autotelTelemetry({
    tracer: trace.getTracer('example-langfuse'),
    captureContent: true,
  }),
);
```

After that, every `generateText` / `streamText` / `embed` call is a canonical
`gen_ai.*` span tree. Model, prompt/response, token usage, **cost**, streaming
timing. And it lands in **every** destination at once.

## Why this works

`autotel-genai` emits the canonical `gen_ai.*` semconv (`gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.usage.*`, `gen_ai.usage.cost.usd`, …). Both
Langfuse and autotel-devtools recognise and map those exact attributes. Langfuse
into generations/tool-calls/embeddings, devtools into its GenAI view. The
semantic convention _is_ the integration: there's no glue code, and the AI SDK
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

Nothing enabled? It still runs and prints the spans locally. The pipeline is
identical, it just doesn't forward. Set Langfuse keys and/or `DEVTOOLS=1` to fan
them out.

> Default model is `granite4`: it drives the Demo 2 tool loop reliably.
> Override with `OLLAMA_MODEL` / `OLLAMA_EMBED_MODEL`. (`llama3.2` tends to
> mangle tool arguments.)

## What it shows

1. **`generateText`**: `invoke_agent › chat` with token usage and cost.
2. **A user- and session-scoped run**: an app span opened with autotel's
   `withTracing`, tagged with `setUser` / `setSession`. Langfuse reads `user.id`
   and `session.id` under those standard names, so this needs no Langfuse
   package. The AI SDK's spans nest inside the app span, so the pipeline and the
   model calls it made are one trace.
3. **`streamText`**: `time_to_first_chunk` / `output_tokens_per_second` ride
   along, and `langfuseCompatibility()` turns the first of those into the
   absolute timestamp Langfuse stores as time to first token.
4. **`embed`**: a standalone `embeddings` span with token usage.

## What Langfuse does with them

Verified against `docker/langfuse.yml`, reading the rows back out of ClickHouse:

```text
name                       type        parent   trace_name             user_id    tags
support-chat               SPAN        (root)   support-chat           user-123   ['example','ollama']
invoke_agent agent         AGENT       child
chat granite4.1:3b         GENERATION  child
multiply                   TOOL        child
embeddings embeddinggemma  EMBEDDING   (root)   embeddings…            ['example','ollama']
```

Langfuse decided the observation types itself, from `gen_ai.operation.name`.
Model, token usage, input/output messages, and `deployment.environment.name` map
the same way, with no configuration. The `langfuse.*` attributes exist only for
the handful of fields Langfuse keeps in dedicated columns and no OpenTelemetry
convention covers, and `langfuseCompatibility()` fills those:

| Field                        | Where it comes from                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `trace_name`                 | the root span's name, or the `traceName` option                                      |
| `tags`, `release`, `version` | options                                                                              |
| `completion_start_time`      | `gen_ai.response.time_to_first_chunk` plus the span's start time                     |
| `user_id`, `session_id`      | autotel's `setUser` / `setSession`, no mapping needed                                |
| `cost_details`               | `gen_ai.usage.cost`, emitted by autotel-genai beside its own `gen_ai.usage.cost.usd` |

## Variations

- **Even simpler devtools wiring.** autotel has first-class devtools support:
  `init({ devtools: true })` sends to `http://127.0.0.1:4318`, and
  `init({ devtools: { embedded: true } })` auto-starts the receiver. (This sets
  the `endpoint`, so it's an alternative to listing devtools in `destinations`.)

- **Add a real OTLP backend.** Append another entry to `destinations` (Grafana,
  Datadog, Honeycomb, Jaeger…). Same spans, more consumers.

- **Media, masking, and filtering.** Use `langfuseMedia()` to replace base64
  data URIs with Langfuse media references before setting content attributes.
  Use Autotel's `attributeRedactor` and `spanFilter` for masking and filtering;
  both apply to the whole export pipeline, not only the Langfuse destination.

## Related

- AI SDK + autotel-genai without Langfuse: [`example-ai-sdk-observer`](../example-ai-sdk-observer).
- LangChain/LangGraph equivalent: [`example-langchain-observer`](../example-langchain-observer).
