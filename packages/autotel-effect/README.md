# autotel-effect

Bridge [autotel](https://github.com/jagreehal/autotel) and [Effect v4](https://effect.website/) so `Effect.withSpan` spans export through the same OpenTelemetry pipeline as autotel's HTTP, fetch, and MCP instrumentation.

## Why this exists

Autotel registers the global OpenTelemetry `TracerProvider` and handles export. Effect needs an explicit `Tracer` service in its layer graph before `Effect.withSpan` creates spans. Without a bridge, every app copies the same `@effect/opentelemetry` wiring — including v4 subpath imports and init ordering.

This package is that wiring, maintained once:

| You get                              | Without it                                                         |
| ------------------------------------ | ------------------------------------------------------------------ |
| One import: `layer({ serviceName })` | Copy `OtelTracer.layerGlobal` + `Resource.layer` into `tracing.ts` |
| Correct v4 subpath imports           | Barrel import pulls `@opentelemetry/sdk-trace-web` at runtime      |
| Documented `--import` init order     | Silent broken traces after Effect upgrades                         |

Autotel still owns export. `@effect/opentelemetry` still owns the Effect tracer implementation. **autotel-effect only connects them.**

## Requirements

- Effect **v4** (`^4.0.0-rc.112`)
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

HTTP spans from autotel's `node:http` instrumentation become parents of domain spans from `Effect.withSpan`.

### 3. Logs come with it

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

Errors keep their stack: a `Cause` passed to `Effect.logError` (or an `Error`
in the message parts) is logged as `err` rather than stringified into `msg`.

Options: `mergeWithExisting: true` keeps Effect's console logger alongside this
one; `level` sets the stdout minimum level (default `'info'` — leave it there
and `Effect.logDebug` never reaches stdout even when Effect's own minimum level
allows it); `pretty: true` swaps JSON for human-readable stdout; `console: false`
drops the stdout line and emits only the log record — use it when
`captureConsole()` is on, or every Effect log is reported twice.

### 4. Unit tests: provide nothing

Effect's default `Tracer` is already an in-memory native tracer, so handler tests
need no layer at all — `Effect.withSpan` runs and exports nowhere:

```typescript
await Effect.runPromise(handler(input)); // no autotel, no OTLP
```

Provide `layer(...)` with autotel's `createMemoryExporter()` only in the tests
that assert on exported spans.

## Trace shape

```text
HTTP GET /api/todos     (autotel node:http)
  └── todo.list         (Effect.withSpan)
        └── db.query    (another withSpan or instrumented client)
```

## Example

See [`apps/example-effect`](../../apps/example-effect) in the autotel monorepo.

## Learn more

- [autotel](https://github.com/jagreehal/autotel)
- [Effect](https://effect.website/)
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry)
