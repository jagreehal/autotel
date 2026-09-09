# autotel-effect

## 4.1.0

### Minor Changes

- dfacb4d: Connect a trace to the things around it — the test that produced it, the effect that ran inside it, the search that finds it, and the product that prices it.

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

## 4.0.1

### Patch Changes

- ec24ab1: Carry rich values onto the attributes autotel emits.

  A `Map` now flattens to dot-notation keys the way a nested object does, and a `Set` is read as the array it carries. This holds across every path that turns a value into an attribute — `flattenToAttributes`, `flattenMetadata`, `toAttributeValue`, and the edge execution logger — so the same input gives the same attributes wherever it is attached: structured error details, request logger fields, execution log lines, and spans.

  `Effect.annotateLogs` values flow through the same helper, so an exported log record carries the shape the rest of autotel emits: nested objects as dot-notation keys, a `Date` as an ISO string, an `Error` as its message. The log severity mapping comes from `@effect/opentelemetry` rather than a local copy.

- cd007ec: Ship the Apache-2.0 licence text and NOTICE in every published tarball. The
  packages declared `Apache-2.0` in their metadata but carried no licence text,
  so installs had neither the licence nor the trademark reservation.
- Updated dependencies [ec24ab1]
- Updated dependencies [cd007ec]
  - autotel@7.6.2

## 4.0.0

### Major Changes

- 3926832: Draw the event catalog by what the runtime actually did, and bridge Effect logs.

  **`autotel-eventcatalog`** gains a `map` command that renders the catalog topology as one self-contained HTML file, with every edge labelled by the evidence behind it:

  ```bash
  autotel-eventcatalog map --snapshot snap.json --catalog ./catalog --output map.html
  ```

  - **observed** — a real `track()` call crossed it, stroke weight scaled to volume
  - **declared, never seen** — the catalog says it happens and this run never saw it
  - **ran, not in the catalog** — it happened and nobody wrote it down
  - **consumer asserted** — the event fired; its delivery is a claim from the catalog

  Three modes: `static` (commit it and read it in a PR), `replay` (markers move at a rate drawn from observed counts), and `live` (`--live-url`, and a marker crosses an edge the moment that event fires). Motion is reserved for evidence, so a declared-but-never-seen edge stays still in every mode.

  The map and the drift report pair a rename together as one finding, while still listing both sides. `buildLiveMap()` and `renderLiveMapHtml()` are exported for building your own view, and `normaliseEventId()` is now public so callers can match dotted `track()` names to PascalCase catalog ids the same way the drift report does. The live page is covered by browser tests (`pnpm test:browser`) driving the real artifact in Chromium.

  **`autotel-subscribers`**: `ArchitectureSnapshotSubscriber` now records `sources` on each observation — one entry per distinct `(producer, channel)` pair, with that pair's own count and first/last-seen — so two services publishing the same event name each keep their own traffic. Additive and sorted, so existing readers are unaffected and a committed snapshot stays byte-stable.

  **`autotel-effect`**: `layer()` now bridges logs as well as spans, from the same single call.

  ```typescript
  const AutotelEffect = layer({ serviceName: 'my-api' }); // spans + logs
  ```

  `Effect.log*` is emitted as an OpenTelemetry log record — reaching any OTLP log backend, autotel-devtools included — plus a trace-correlated structured line on stdout, so a log written inside `Effect.withSpan` carries that span's trace and span ids. `Effect.annotateLogs` values become attributes, and an `Error` or `Cause` is reported as `err` with its stack.

  **Breaking:** `Effect.log*` previously went to Effect's console logger and stayed there. Pass `logs: false` to keep `layer()` bridging spans only, or an options object (`level`, `pretty`, `mergeWithExisting`, `console`) to configure the logger. `loggerLayer()` is exported for the case where something else owns the tracer.

## 3.0.0

### Patch Changes

- Updated dependencies [10c3f93]
  - autotel@7.6.0

## 2.0.0

### Patch Changes

- Updated dependencies [a271e71]
  - autotel@7.5.0

## 1.0.0

### Minor Changes

- 29546bf: New package: bridge autotel and Effect v4.

  `layer({ serviceName })` provides Effect's `Tracer` from the global
  OpenTelemetry provider that `autotel.init()` registers, so `Effect.withSpan`
  spans export through autotel and nest under its HTTP and fetch spans. Wraps
  `@effect/opentelemetry`'s `OtelTracer.layerGlobal` with the `Resource` it
  requires — the wiring every Effect app was otherwise copying, including the v4
  subpath imports and the `--import` init ordering.

  Effect v4 only; autotel owns export, `@effect/opentelemetry` owns the tracer.

### Patch Changes

- Updated dependencies [29546bf]
  - autotel@7.4.0
