# autotel-effect

Bridge [autotel](https://github.com/jagreehal/autotel) and [Effect v4](https://effect.website/) so `Effect.withSpan` spans export through the same OpenTelemetry pipeline as autotel's HTTP, fetch, and MCP instrumentation.

## Why this exists

Autotel registers the global OpenTelemetry `TracerProvider` and handles export. Effect needs an explicit `Tracer` service in its layer graph before `Effect.withSpan` creates spans. Without a bridge, every app copies the same `@effect/opentelemetry` wiring — including v4 subpath imports and init ordering.

This package is that wiring, maintained once:

| You get                              | Without it                                                         |
| ------------------------------------ | ------------------------------------------------------------------ |
| One import: `layer({ serviceName })` | Copy `OtelTracer.layerGlobal` + `Resource.layer` into `tracing.ts` |
| Correct v4 subpath imports           | Barrel import pulls `@opentelemetry/sdk-trace` at runtime          |
| Documented `--import` init order     | Silent broken traces after Effect upgrades                         |

Autotel still owns export. `@effect/opentelemetry` still owns the Effect tracer implementation. **autotel-effect only connects them.**

## Requirements

- Effect **v4** (`^4.0.0`)
- `@effect/opentelemetry` v4 (peer dependency)
- autotel `init()` loaded **before** your app (see below)

Effect v3 is not supported.

## Install

```bash
npm install autotel autotel-effect effect @effect/opentelemetry
```

## Usage

### 1. Initialize autotel first

```typescript
// instrumentation.ts
import { init } from 'autotel';

init({
  service: 'my-api',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  debug: process.env.OTEL_DEBUG === 'true',
});
```

Run with:

```bash
tsx --import ./instrumentation.ts src/index.ts
# or
node --import ./dist/instrumentation.js dist/index.js
```

### 2. Provide the Effect layer

```typescript
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { layer } from 'autotel-effect';

const AutotelEffect = layer({ serviceName: 'my-api', serviceVersion: '1.0.0' });

const program = Effect.withSpan('my.operation')(Effect.log('hello'));

await Effect.runPromise(program.pipe(Effect.provide(AutotelEffect)));
```

In a server, merge the layer where you assemble services:

```typescript
appLayer.pipe(Layer.provideMerge(layer({ serviceName: 'my-api' })));
```

### 3. Effect spans join the surrounding trace

From effect 4.0.5, an `Effect.withSpan` run inside an autotel span takes that
span as its parent, so a plain `Effect.runPromise` in an instrumented HTTP
handler stays in the request's trace:

```typescript
app.get('/api/todos', async () => {
  // inside autotel's `node:http` span
  return Effect.runPromise(program);
});
```

The parent is the span active when the effect **runs**, so a program assembled
once at startup still joins the request it is run inside.

HTTP spans from autotel's `node:http` instrumentation become parents of
domain spans from `Effect.withSpan`.

### Effect's own HTTP server, and serverless

`HttpRouter.serve` and `HttpRouter.toWebHandler` make the request span in Effect's own server middleware, from
`traceparent` or b3. Two pieces add W3C `baggage`, so a session id the browser sends (autotel-posthog's `joinPostHog`
does) reaches your spans and events.

On a serverless platform (Vercel, Lambda), wrap the web handler:

```typescript
import { webHandler } from 'autotel-effect';

const { handler } = HttpRouter.toWebHandler(
  AppLive.pipe(Layer.provideMerge(layer({ serviceName: 'api' }))),
);

export default webHandler(handler);
```

- The request's baggage is active from the server span down. autotel's `init({ baggage: { keys: ['session.id'] } })`
  stamps the allowed keys on every span; `events: { enrichFromBaggage: { allow: ['session.id'] } }` copies them onto
  `track()` events.
- Spans are flushed after the response, through the platform's `waitUntil` (Vercel's is found for you), so a frozen
  function loses none. Without a `waitUntil` (Lambda), work registered on `WaitUntil` is awaited and spans flushed
  before the response is returned. A failed flush never fails the request or replaces its error.
- `WaitUntil` gives handlers that `waitUntil`, for work after the response (a Slack bot answering after its 200).
  Outside `webHandler` its default does nothing, which is right on a long-running server.

On a long-running server, add the middleware to the router:

```typescript
HttpRouter.serve(
  Layer.mergeAll(AppLive, baggageMiddleware({ spanKeys: ['session.id'] })),
);
```

Effect starts the request span before middleware runs, so `spanKeys` are copied onto it there; the spans below get
them from autotel's `baggage` option as above.

Baggage is whatever the client sent: only the keys your config allows reach a span or an event, and the header is
capped at the W3C limits.

### Callbacks from Promise-based libraries

A bot framework, MCP server or queue consumer calls you with a Promise-based callback, outside the server's layer.
Build one runtime for them, and their spans and logs export like everything else:

```typescript
import { runtime } from 'autotel-effect';

const callbacks = runtime(AnswersLive, { serviceName: 'api' });
bot.onMention(async (message) => {
  const exit = await callbacks.runPromiseExit(answer(message)); // a defect is an Exit, not a lost rejection
});
```

### Don't reach for `trace()` here

autotel's `trace(name, fn)` wraps a function and ends its span when that
function **returns**. A function that returns an `Effect` returns a description
of work, not the work, so the span closes before anything runs and measures the
construction rather than the effect. Use Effect's own instrumentation instead —
`Effect.fn('name')(...)` or `Effect.withSpan('name')` — which is what `layer()`
routes through autotel.

### 4. Logs come with it

One `layer()` call bridges both signals. `Effect.log*` becomes an OpenTelemetry
**log record** (so it reaches any OTLP log backend, including autotel-devtools)
plus a trace-correlated structured line on stdout — no second layer to remember:

```typescript
const AutotelEffect = layer({ serviceName: 'my-api' }); // spans + logs
```

Pass `logs: false` for spans only, or an options object to configure the
logger. Log annotations become log metadata, and failure causes are logged as
`err`:

```typescript
Effect.log('charged').pipe(Effect.annotateLogs({ 'order.id': 'o-1' }));
// {"level":"info","msg":"charged","order.id":"o-1","traceId":"...","spanId":"..."}
```

Rich annotation values are flattened to the attribute shape the rest of autotel
produces: a nested object becomes dot-notation keys, a `Date` becomes an ISO
string, an `Error` becomes its message.

```typescript
Effect.annotateLogs({ order: { id: 7 }, at: new Date(0) });
// attributes: { 'order.id': 7, at: '1970-01-01T00:00:00.000Z' }
```

Errors keep their stack: a `Cause` passed to `Effect.logError` (or an `Error`
in the message parts) is logged as `err` rather than stringified into `msg`.
`Effect.withLogSpan('db')` adds `logSpan.db` in milliseconds. The record's
timestamp comes from the fiber's clock, so a test clock sets the time you see.

Options: `mergeWithExisting: true` keeps Effect's console logger alongside this
one; `level` sets the stdout minimum level (default `'info'` — leave it there
and `Effect.logDebug` never reaches stdout even when Effect's own minimum level
allows it); `pretty: true` swaps JSON for human-readable stdout; `console: false`
drops the stdout line and emits only the log record — use it when
`captureConsole()` is on, or every Effect log is reported twice.

### 5. Unit tests: provide nothing

Effect's default `Tracer` is already an in-memory native tracer, so handler tests
need no layer at all — `Effect.withSpan` runs and exports nowhere:

```typescript
await Effect.runPromise(handler(input)); // no autotel, no OTLP
```

Provide `layer(...)` with autotel's `createMemoryExporter()` only in the tests
that assert on exported spans.

## Trace shape

With `Effect.runPromise(program)` inside the request span:

```text
HTTP GET /api/todos     (autotel node:http)
  └── todo.list         (Effect.withSpan)
        └── db.query    (another withSpan or instrumented client)
```

## Span outcomes

`@effect/opentelemetry` marks every failed span as an error. `layer()` reads
the exit the way the HTTP conventions and your domain do:

| The span ended with                                                                    | Status                                              | Exception event                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| A failure listed in `anticipatedErrorIdentifiers` (or matched by `isAnticipatedError`) | OK                                                  | none                                                    |
| A failure Effect marks `ErrorReporter.ignore` (`RouteNotFound`)                        | OK                                                  | none                                                    |
| A server span answering 5xx, even when the handler rendered it as a response           | Error, `error.type` = the status code               | `HttpServerErrorResponse`                               |
| An `HttpClient` 4xx (`StatusCodeError`)                                                | Error, `error.type` = the status code               | none: whether the 4xx is a fault is the caller's to say |
| Interruption only                                                                      | unchanged: `effect.fiber.interrupted`, not an error | none                                                    |
| Anything else                                                                          | Error, with `error.type`                            | yes                                                     |

An anticipated failure never hides a 5xx: a server span that answered 5xx is an
error whatever it failed with.

```typescript
class NotFound extends Data.TaggedError('NotFound')<{ message: string }> {}

const AutotelEffect = layer({
  serviceName: 'orders-api',
  spans: {
    anticipatedErrorIdentifiers: ['NotFound', 'Unauthorized'],
    isAnticipatedError: (error) => isUniqueViolation(error),
  },
});
```

### Structured errors

A failure that carries `why`, `fix`, `link`, `code` or `status` puts them on
the span as `error.why`, `error.fix` and so on, the same attributes
`createStructuredError` produces elsewhere in autotel:

```typescript
class PaymentDeclined extends Data.TaggedError('PaymentDeclined')<{
  message: string;
  why: string;
  fix: string;
  status: number;
}> {}
```

Name the prop `message`: `Data.TaggedError` reads it for `exception.message`,
and any other name reaches your backend as an empty message.

### Dropping spans

`spans.dropSpanSubtrees` takes name prefixes. A matching span starts
unsampled, so neither it nor anything under it is recorded: Effect spans,
database queries and outgoing `fetch` calls alike. Outgoing calls under it send
`traceparent` with the sampled flag off, and errors inside it are not
recorded, so keep real work out of a dropped span.

```typescript
layer({ serviceName: 'worker', spans: { dropSpanSubtrees: ['queue.poll'] } });
```

To drop one span and keep its children, filter it in `init()`.
`effectSpanFilter` matches only Effect's spans, and autotel gives the dropped
span's children its nearest kept ancestor as their parent, so the trace stays
connected:

```typescript
import { init } from 'autotel';
import { effectSpanFilter } from 'autotel-effect';

init({
  service: 'worker',
  spanFilter: effectSpanFilter({
    dropSpanNames: ['queue.tick'],
    dropSpan: (span) => span.attributes['queue.empty'] === true,
  }),
});
```

A filtered span with no parent in this process drops its whole trace.

### One trace with the rest of your app

Effect spans go to the same provider as autotel's HTTP, fetch, database and MCP
spans, so one request is one trace, whichever library opened each span. Inside
`Effect.withSpan`, autotel's own helpers see the same span:
`getActiveTraceContext()`, `getRequestLogger()` and `trace.run()` annotate it
or nest under it.

## Example

See [`apps/example-effect`](../../apps/example-effect) in the autotel monorepo.

## Learn more

- [autotel](https://github.com/jagreehal/autotel)
- [Effect](https://effect.website/)
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry)
