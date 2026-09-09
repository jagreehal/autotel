# Autotel + Effect Example

A request handler that runs an [Effect v4](https://effect.website/) program, which is where the two tracers have to agree. [`autotel-effect`](../../packages/autotel-effect) bridges `Effect.withSpan` to autotel's global OpenTelemetry provider, and `withAutotel` makes the Effect join the trace of the request it runs inside.

## Try it

```bash
pnpm install
pnpm start
```

From the monorepo root:

```bash
pnpm --filter @jagreehal/example-effect start
```

It serves two routes, calls both, and prints what was exported:

```text
trace d7e26049…
  └── GET /api/todos
    └── todo.list
      └── db.query

trace 3d6b4867…
  └── todo.list
    └── db.query

trace 543d1ffc…
  └── GET /api/todos/detached
```

`/api/todos` runs the effect with `withAutotel` — one trace. `/api/todos/detached` runs the same effect without it, and the request span and the Effect spans land in **different traces**.

Set `OTLP_ENDPOINT` and the same spans go to your backend as well.

## Why the second route detaches

Effect takes a span's parent from its own `Tracer.ParentSpan`, not from the ambient OpenTelemetry context, and marks a span as a root when it has none — which is what `@effect/opentelemetry` reads to decide it should ignore the ambient context. So a bare `Effect.runPromise` inside a traced handler opens a new trace, silently. `withAutotel` hands Effect the active autotel span as its parent, and nothing else changes.

The program here is built once at startup, before any request exists. `withAutotel` reads the active span when the effect **runs**, so it still joins the right request.

## How it works

1. **`instrumentation.ts` runs first** — loaded via `tsx --import ./instrumentation.ts`. Calls `autotel.init()` and registers the global `TracerProvider`.

2. **`autotel-effect` provides Effect's tracer** — `layer({ serviceName: 'example-effect' })` wires `OtelTracer.layerGlobal` to that provider. No Effect NodeSdk or OTLP layer in the app.

3. **`withAutotel` joins the surrounding trace** — the handler's span becomes the parent of `todo.list`.

## Snippets

### Initialize autotel (before any Effect code)

```typescript
// instrumentation.ts
import { init } from 'autotel';

init({
  service: 'example-effect',
  endpoint:
    process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

```bash
tsx --import ./instrumentation.ts src/index.ts
```

### Run an Effect inside a request

```typescript
import { trace } from 'autotel';
import { layer, withAutotel } from 'autotel-effect';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';

const listTodos = pipe(
  Effect.succeed(todos),
  Effect.withSpan('db.query'),
  Effect.withSpan('todo.list'),
  Effect.provide(layer({ serviceName: 'example-effect' })),
);

// `trace.run` stands in for autotel's `node:http` instrumentation here:
// whatever opens the request span, `withAutotel` picks it up.
await trace.run('GET /api/todos', async () => {
  const result = await Effect.runPromise(withAutotel(listTodos));
  // ...
});
```

Don't reach for `trace(name, fn)` around a function that returns an `Effect`: the span would end when the Effect is **constructed**, not when it runs. Use `Effect.fn` or `Effect.withSpan`.

## Learn more

- [autotel-effect](../../packages/autotel-effect)
- [autotel](https://github.com/jagreehal/autotel)
- [Effect](https://effect.website/)
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry)
