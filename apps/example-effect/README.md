# Autotel + Effect Example

A request handler that runs an [Effect v4](https://effect.website/) program, which is where the two tracers have to agree. [`autotel-effect`](../../packages/autotel-effect) bridges `Effect.withSpan` to autotel's global OpenTelemetry provider, and the Effect's spans join the trace of the request it runs inside.

## Try it

```bash
pnpm install
pnpm start
```

From the monorepo root:

```bash
pnpm --filter @jagreehal/example-effect start
```

It serves `/api/todos`, calls it, and prints what was exported — one trace:

```text
trace d7e26049…
  └── GET /api/todos
    └── todo.list
      └── db.query
```

Set `OTLP_ENDPOINT` and the same spans go to your backend as well.

## Why it is one trace

From effect 4.0.5, an Effect span takes the active OpenTelemetry span as its parent. The program here is built once at startup, before any request exists; the parent is read when the effect **runs**, so it still joins the right request.

## How it works

1. **`instrumentation.ts` runs first** — loaded via `tsx --import ./instrumentation.ts`. Calls `autotel.init()` and registers the global `TracerProvider`.

2. **`autotel-effect` provides Effect's tracer** — `layer({ serviceName: 'example-effect' })` wires `OtelTracer.layerGlobal` to that provider. No Effect NodeSdk or OTLP layer in the app.

3. **The Effect joins the surrounding trace** — the handler's span becomes the parent of `todo.list`.

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
import { layer } from 'autotel-effect';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';

const listTodos = pipe(
  Effect.succeed(todos),
  Effect.withSpan('db.query'),
  Effect.withSpan('todo.list'),
  Effect.provide(layer({ serviceName: 'example-effect' })),
);

// `trace.run` stands in for autotel's `node:http` instrumentation here:
// whatever opens the request span, the Effect's spans nest under it.
await trace.run('GET /api/todos', async () => {
  const result = await Effect.runPromise(listTodos);
  // ...
});
```

Don't reach for `trace(name, fn)` around a function that returns an `Effect`: the span would end when the Effect is **constructed**, not when it runs. Use `Effect.fn` or `Effect.withSpan`.

## Learn more

- [autotel-effect](../../packages/autotel-effect)
- [autotel](https://github.com/jagreehal/autotel)
- [Effect](https://effect.website/)
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry)
