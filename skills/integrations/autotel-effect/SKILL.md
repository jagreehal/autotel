---
name: autotel-effect
description: >
  Use this skill when wiring Effect v4 to autotel so `Effect.withSpan` spans and `Effect.log*` calls export through the same OpenTelemetry pipeline as autotel's HTTP, fetch and MCP instrumentation. Covers the one-call `layer()` bridge and its `logs` option, init ordering with `--import`, why v4 subpath imports matter, what to provide in tests, and serverless (Vercel, Lambda): flushing per invocation and passing waitUntil into Effect handlers.
---

# autotel-effect

Bridges [Effect v4](https://effect.website/) and autotel. `Effect.withSpan` spans export through autotel's OpenTelemetry pipeline, alongside the HTTP, fetch and MCP spans autotel already produces.

It is wiring, not a tracer. Autotel owns export; `@effect/opentelemetry` owns the Effect tracer implementation. This package only connects them, so the same layer graph is not copied into every app.

**Effect v4 only** (`^4.0.0`). v3 is not supported.

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

### 3. Effect spans join the surrounding trace

From effect 4.0.5, an `Effect.withSpan` run inside an autotel span takes that
span as its parent, so a plain `Effect.runPromise` in an instrumented handler
lands in that request's trace:

```typescript
app.get('/api/todos', async () => {
  // inside autotel's `node:http` span
  return Effect.runPromise(program);
});
```

The parent is the span active when the effect **runs**, not when it is built,
so a program assembled once at startup still joins the request it is run inside.

Trace shape:

```text
HTTP GET /api/todos     (autotel node:http)
  └── todo.list         (Effect.withSpan)
        └── db.query    (another withSpan or instrumented client)
```

### 4. Logs come with it

That one call bridges logs as well as spans. `Effect.log*` becomes an OpenTelemetry **log record** — reaching any OTLP log backend, autotel-devtools included — plus a trace-correlated structured line on stdout. A log written inside `Effect.withSpan` carries that span's trace and span ids, so logs and traces line up in the same backend.

Pass `logs: false` for spans only, or an options object to configure the logger:

```typescript
layer({ serviceName: 'my-api', logs: { level: 'debug', pretty: true } });
layer({ serviceName: 'my-api', logs: false });
```

| `logs` option       | Default  | Does                                            |
| ------------------- | -------- | ----------------------------------------------- |
| `mergeWithExisting` | `false`  | Keep Effect's console logger alongside this one |
| `level`             | `'info'` | Minimum level for the stdout line               |
| `pretty`            | `false`  | Human-readable stdout instead of JSON           |
| `console`           | `true`   | Write the stdout line at all                    |

`loggerLayer()` is exported for the case where something else owns the tracer and you only want autotel to own the logs.

## Core Patterns

### The trace is one tree, not two

With `Effect.runPromise(program)` inside the request span, HTTP spans from autotel's `node:http` instrumentation are the parents of domain spans from `Effect.withSpan`:

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

### Annotations and errors keep their shape

`Effect.annotateLogs` values become log-record attributes. Rich values are flattened to the shape the rest of autotel produces: a nested object becomes dot-notation keys, a `Date` becomes an ISO string, an `Error` becomes its message.

```typescript
Effect.annotateLogs({ order: { id: 7 }, at: new Date(0) });
// attributes: { 'order.id': 7, at: '1970-01-01T00:00:00.000Z' }
```

An `Error` in the message parts, or a `Cause` passed to `Effect.logError`, is reported as an `err` attribute with its stack rather than stringified into the message:

```typescript
Effect.fail(new Error('card declined')).pipe(
  Effect.catchCause((cause) => Effect.logError('payment failed', cause)),
);
// body: "payment failed", err: "Error: card declined\n    at ..."
```

### Failed spans read `error.message`

When a `withSpan` fails, `@effect/opentelemetry` sets the span status message and `exception.message` from `error.message`. `Data.TaggedError` populates that from a `message` prop. The `Error` constructor writes `message` as an own property, which shadows a getter on the class. An error that keeps its detail in `reason` or any other prop records an empty message, and your backend groups it as "Unknown error".

```typescript
// ✗ spans record exception.message: ""
class NotFound extends Data.TaggedError('NotFound')<{ reason: string }> {}

// ✓ spans record exception.message: "order 7 not found"
class NotFound extends Data.TaggedError('NotFound')<{ message: string }> {}
```

### Set `level` before expecting debug logs

The stdout line defaults to `level: 'info'`, so `Effect.logDebug` never reaches stdout even when Effect's own minimum log level allows it. Pass `logs: { level: 'debug' }` for both to agree.

### `trace()` is not the tool for a function returning an Effect

autotel's `trace(name, fn)` ends its span when the function **returns**. A
function returning an `Effect` returns a description of work, so the span
measures the construction rather than the run. Use Effect's own
instrumentation — `Effect.fn('name')` or `Effect.withSpan('name')` — which is
what `layer()` routes through autotel.

### Do not reach for a barrel import

The package imports `@effect/opentelemetry/OtelTracer` and `.../Resource` by subpath deliberately. The v4 barrel pulls `@opentelemetry/sdk-trace` in at runtime, which is not what a Node service wants in its graph.

### Effect's HTTP server and serverless: `webHandler`, `baggageMiddleware`, `runtime`

Effect's server middleware makes the request span itself, from `traceparent` or b3. These three add W3C `baggage`, so a session id the browser sends (autotel-posthog's `joinPostHog`) reaches your spans and events, and on serverless they finish batched spans and work after the response before the function freezes.

**Serverless (Vercel, Lambda): wrap the web handler.**

```typescript
import { layer, webHandler } from 'autotel-effect';

const { handler } = HttpRouter.toWebHandler(
  routes.pipe(Layer.provideMerge(layer({ serviceName: 'api' }))),
);

export default webHandler(handler);
```

`webHandler` makes the request's baggage active from the server span down, finds Vercel's `waitUntil` (or takes one in `options.waitUntil`), flushes after the response through it, and when there is none (Lambda) awaits work registered on `WaitUntil` and flushes before returning. A failed flush never fails the request. Handlers that start work after the response read `WaitUntil`:

```typescript
Effect.gen(function* () {
  const waitUntil = yield* WaitUntil; // the platform's; does nothing on a long-running server
  waitUntil(answerInThread(message));
});
```

Don't look `waitUntil` up from inside a fiber: `@vercel/functions` reads AsyncLocalStorage, which a fiber may not be in, and the call then quietly does nothing.

**Long-running server: add the middleware.**

```typescript
HttpRouter.serve(
  Layer.mergeAll(routes, baggageMiddleware({ spanKeys: ['session.id'] })),
);
```

Pair either with autotel's `init({ baggage: { keys: ['session.id'] }, events: { enrichFromBaggage: { allow: ['session.id'] } } })`: the first stamps the key on spans, the second on `track()` events. Only allowed keys go anywhere; baggage is client input.

**Callbacks from Promise-based libraries: `runtime`.** An Effect run from a bot handler or queue consumer sits outside the server's layers. Build one runtime for them, once, and run with `runPromiseExit` so a defect comes back as an `Exit`:

```typescript
const callbacks = runtime(AnswersLive, { serviceName: 'api' });
const exit = await callbacks.runPromiseExit(answer(message));
```

## Review checklist

- `init()` runs before the app module is imported — `--import`, not a top-level import inside `src/index.ts`.
- One `layer()` per app, merged into the layer graph; not built per request.
- `serviceName` matches the `service` passed to `init()`, or the resource disagrees with itself.
- Effect v4. On v3 this package does not apply.
- No second exporter: autotel already owns export.
- One `layer()` call, not `layer()` merged with `loggerLayer()` — the first already installs the second.
- `logs: { console: false }` wherever `captureConsole()` is on, or each Effect log is reported twice.
- effect 4.0.5 or later, so an `Effect.runPromise` inside an autotel span joins that trace.
- Span instrumentation on an Effect comes from `Effect.fn` / `Effect.withSpan`, never from wrapping the function in `trace()`.
- Every `Data.TaggedError` carries its detail in a `message` prop, so failed spans record a real `exception.message`.
- On serverless, the entry is `webHandler(handler)`: baggage, flush after the response, `WaitUntil`. Work after the response reads `WaitUntil`, never looks `waitUntil` up inside a fiber.
- `HttpRouter.serve` apps add `baggageMiddleware({ spanKeys })`, so the request span carries the session too.
- Effects run from callbacks use `runtime(layer, options)`, so their spans and logs export.
