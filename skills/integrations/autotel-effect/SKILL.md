---
name: autotel-effect
description: >
  Use this skill when wiring Effect v4 to autotel so `Effect.withSpan` spans export through the same OpenTelemetry pipeline as autotel's HTTP, fetch and MCP instrumentation. Covers the one-call `layer()` bridge, init ordering with `--import`, why v4 subpath imports matter, and what to provide in tests.
---

# autotel-effect

Bridges [Effect v4](https://effect.website/) and autotel. `Effect.withSpan` spans export through autotel's OpenTelemetry pipeline, alongside the HTTP, fetch and MCP spans autotel already produces.

It is wiring, not a tracer. Autotel owns export; `@effect/opentelemetry` owns the Effect tracer implementation. This package only connects them, so the same layer graph is not copied into every app.

**Effect v4 only** (`^4.0.0-rc.112`). v3 is not supported.

## Setup

```bash
npm install autotel autotel-effect effect @effect/opentelemetry
```

### 1. Initialize autotel first, out of band

```typescript
// instrumentation.ts
import { init } from 'autotel';

init({
  service: 'my-api',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

```bash
tsx --import ./instrumentation.ts src/index.ts
# or
node --import ./dist/instrumentation.js dist/index.js
```

Ordering is the whole point. `layer()` reads the **global** `TracerProvider`, which `init()` registers. Import your app first and the layer is built against a provider that does not exist yet, so spans go nowhere with no error to say so.

### 2. Provide the layer

```typescript
import * as Effect from 'effect/Effect';
import { layer } from 'autotel-effect';

const AutotelEffect = layer({ serviceName: 'my-api', serviceVersion: '1.0.0' });

const program = Effect.withSpan('todo.list')(loadTodos);

await Effect.runPromise(program.pipe(Effect.provide(AutotelEffect)));
```

In a server, merge it where services are assembled:

```typescript
appLayer.pipe(Layer.provideMerge(layer({ serviceName: 'my-api' })));
```

## Core Patterns

### The trace is one tree, not two

HTTP spans from autotel's `node:http` instrumentation become the parents of domain spans from `Effect.withSpan`:

```text
HTTP GET /api/todos     (autotel node:http)
  └── todo.list         (Effect.withSpan)
        └── db.query    (another withSpan, or an instrumented client)
```

That is the reason to bridge rather than run a second exporter: a separate Effect pipeline produces a second, parentless tree for the same request.

### Provide nothing in unit tests

Effect's default `Tracer` is already an in-memory native tracer, so handler tests need no layer at all — `Effect.withSpan` runs and exports nowhere:

```typescript
await Effect.runPromise(handler(input)); // no autotel, no OTLP
```

Provide `layer(...)` with autotel's `createMemoryExporter()` only in the tests that assert on exported spans.

### Do not reach for a barrel import

The package imports `@effect/opentelemetry/OtelTracer` and `.../Resource` by subpath deliberately. The v4 barrel pulls `@opentelemetry/sdk-trace-web` in at runtime, which is not what a Node service wants in its graph.

## Review checklist

- `init()` runs before the app module is imported — `--import`, not a top-level import inside `src/index.ts`.
- One `layer()` per app, merged into the layer graph; not built per request.
- `serviceName` matches the `service` passed to `init()`, or the resource disagrees with itself.
- Effect v4. On v3 this package does not apply.
- No second exporter: autotel already owns export.
