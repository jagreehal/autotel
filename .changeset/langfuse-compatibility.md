---
'autotel-langfuse': minor
'autotel-genai': minor
'autotel': minor
---

Langfuse compatibility, verified against a self-hosted Langfuse v4 and Langfuse
Cloud, plus a Mastra observer.

- **New package `autotel-langfuse`.** `langfuseCompatibility()`, a span processor
  filling the fields Langfuse keeps in dedicated columns and no OpenTelemetry
  convention covers: trace name, tags, release, version, prompt linking, and the
  absolute "time to first token" derived from streaming timing. It depends on no
  Langfuse package, which is the point: Langfuse ingests plain OTLP and reads
  canonical `gen_ai.*`, so types, usage, cost, input/output, user and session all
  arrive with nothing but a `destinations` entry.
- **`langfuseScores()`**: evaluation results as Langfuse scores. Scores are the
  one thing OTLP cannot carry, so the bridge posts to `/api/public/scores` with
  the same Basic auth as the OTLP endpoint, rather than depending on
  `@langfuse/client`. `autotel-genai` already emits the evaluation event and
  autotel already stamps it with its trace, so it is an event subscriber.
- **`langfuseMedia()`**: base64 payloads uploaded once and referenced by a token,
  instead of megabytes of `data:` URI through the OTLP pipeline on every request.
  `replaceDataUris()` works on the serialised messages directly, so there is no
  message tree to walk. It is an async call in application code rather than a
  span processor, because `onEnd` is synchronous and Langfuse assigns the media
  id — there is nowhere in a processor to await the upload the attribute depends
  on.
- **`gen_ai.prompt.name` and `gen_ai.prompt.version` are now removed from the
  span once mapped**, not copied. Langfuse reads anything under the
  `gen_ai.prompt` prefix as the legacy prompt-content convention and then takes
  input and output from that convention alone, so a span naming its prompt
  arrived with `{"name": ..., "version": ...}` as its input and `{}` as its
  output, discarding `gen_ai.input.messages` and `gen_ai.output.messages`
  entirely. An enricher runs once for the whole pipeline, so this pair is now
  absent from every destination, not only Langfuse.
- **A contract test against a real Langfuse.** `pnpm --filter autotel-langfuse
test:contract` sends spans, a score and a media payload to the stack in
  `docker/langfuse.yml` and reads them back through public API surfaces only.
  `/api/public/v2/metrics` rejects a query naming a dimension it does not have,
  so a rename upstream fails the suite by name instead of quietly emptying a
  column. It runs against Langfuse Cloud too, reading through the entity
  endpoints where they exist and waiting out the rate limiter rather than racing
  it. Nightly in CI, and on pull requests that touch the mapping. The default
  `test` run skips it and needs no Docker.
- **Observed spans attach to the surrounding span.** `createGenAiObserver` forced
  a detached root whenever an event carried no tracked parent, so every AI SDK
  call landed in a trace of its own and a backend that groups by trace id showed
  the pipeline and the model calls it made as unrelated. It now falls back to the
  active context. Pass `resolveParentContext: () => undefined` for the queue and
  background-worker case where the ambient context is the wrong parent.
- **Cost survives the trip.** `gen_ai.usage.cost` is emitted alongside autotel's
  `gen_ai.usage.cost.usd`. Langfuse, and everything else that followed
  OpenLLMetry, reads the former, and a cost recorded only under a name the
  backend does not know is a cost you cannot see.
- **`spanEnrichers`**: span processors that are added to the exporting pipeline
  rather than replacing it. `spanProcessors` takes the pipeline over, so a
  processor that only decorates spans would silently switch off every configured
  destination.
- **`createMastraObserver()`** — Mastra spans as autotel spans. Mastra's
  observability pipeline dispatches `span_started` / `span_ended` events with
  `id` and `parentSpanId`, which is exactly the shape `createGenAiObserver`
  consumes, so the adapter is an `ObservabilityExporter` you pass to the `Mastra`
  constructor. `agent_run` → `invoke_agent`, `model_generation` → `chat`,
  `rag_embedding` → `embeddings`, every tool-call type → `execute_tool`,
  `workflow_run` / `workflow_step` → `invoke_workflow`. Plumbing — model steps
  and chunks, processors, scorers, mappings — is dropped and its children
  reparent to the nearest kept ancestor; pass `skipSpan` to drop additional
  supported types. `model_step` and `model_inference` are dropped deliberately:
  their usage is already summed on the enclosing `model_generation`, so keeping
  both would double-count `gen_ai.usage.*`. `@mastra/otel-exporter` already emits
  canonical `gen_ai.*` to any OTLP endpoint, so this is not about making Mastra
  observable at all — it is about the spans being autotel's. That exporter owns
  its own endpoint and its own span processor and rebuilds spans from Mastra's
  trace ids after the fact, which leaves the agent run in a trace of its own,
  outside every `spanEnricher` — so `langfuseCompatibility` never names its trace
  or links its prompt — and without cost. Mastra dispatches its events
  synchronously, so this adapter emits them on autotel's tracer under the ambient
  context instead: the run nests inside the request span that triggered it,
  reaches every configured destination, and gets priced. Typed structurally, so
  it adds no Mastra dependency, and verified end to end against a real Mastra
  1.57 app running a tool-calling agent on local Ollama.
