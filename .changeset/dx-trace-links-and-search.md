---
'autotel-web': major
'autotel-effect': minor
'autotel-genai': minor
'autotel-backends': minor
'autotel-devtools': patch
'autotel-playwright': patch
'autotel-vitest': patch
'autotel-subscribers': patch
---

Connect a trace to the things around it — the test that produced it, the effect that ran inside it, the search that finds it, and the product that prices it.

**`autotel-web`** — `traceparent` goes to same-origin destinations and to the cross-origin APIs named in a new top-level `propagateTo`, the same default full mode has always used (`initFull` takes the same field). Browser spans are recorded whether or not the header goes out, so a cross-origin call keeps its timing, status and errors. `privacy` keeps DNT, GPC and `blockedOrigins`, each of which only subtracts; `privacy.allowedOrigins` still works and is deprecated in favour of `propagateTo`. A host named in `baggage.allowedOrigins` propagates too. `init()` also runs in a window with no `XMLHttpRequest`.

```ts
init({ service: 'my-spa', propagateTo: ['api.myapp.com'] });
```

**`autotel-effect`** — new `withAutotel(effect)`. `Effect.runPromise(withAutotel(program))` hands Effect the autotel span active around the run, so `Effect.withSpan` lands in that request's trace. The span is read when the effect runs, so a program built once at startup still joins the request it runs inside.

**`autotel-genai`** — hosted model ids price as the model they name, so Bedrock, Vertex and cross-region inference profiles (`eu.anthropic.claude-...`) resolve against the built-in table. `createGenAiObserver({ pricing })` and `autotelTelemetry({ pricing })` take your own rates once, merged over it.

**`autotel-backends`** — `createDatadogConfig` sends `dd-otlp-source: llmobs` on direct ingestion, so `gen_ai.*` spans reach Agent Observability with model, provider, usage and cost mapped from the canonical conventions. `llmobs: false` sends only the API key.

**`autotel-vitest`, `autotel-playwright`** — each test carries an `otel-trace` annotation so the report links to its trace, and the reporters put the recorded browser trace, video and screenshot paths onto the test span.

**`autotel-devtools`** — free-text search matches attribute values as well as span name, service and trace id, on traces and logs, as the viewer displays them and including array elements. Search by key with `key = value`. Preflights are answered with the headers they ask for.

**`autotel-subscribers`** — `PostHogSubscriber` resolves from the package root and `autotel-subscribers/posthog`, deprecated and naming its home in `autotel-posthog/subscriber`.
