---
name: autotel-core
description: >
  Explains when to reach for trace vs span vs request logger vs events in Autotel,
  and the package exports each lives behind. Use this skill when setting up autotel,
  calling init(), or choosing between the core APIs. Do not use for a specific
  framework's wiring — use skill autotel-frameworks or skill autotel-adapters — or
  for finding which handlers are uninstrumented — use skill find-observability-gaps.
---

# Autotel: Core

OpenTelemetry instrumentation for Node.js and edge. Instrument once; stream to any OTLP backend. Use `trace()`/`span()` for spans, `getRequestLogger()` for one snapshot per request, `createStructuredError`/`parseError` for errors, `track()` for product events.

Event guidance: for new instrumentation, emit events as correlated logs (via request logger or logging pipeline bridged to OTel Logs API). Do not introduce new direct span-event dependencies for business/exception events.

## When to Use What

| Need                                  | API                                                                                                           | Import                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Trace reusable or immediate work      | `trace(fn)`, `trace(name, fn)`, `instrument({ key, fn })`, `trace.run(name, ctx => result)`, `span(name, fn)` | `autotel`                              |
| Request-scoped attributes + emit once | `getRequestLogger(ctx?)` → `.set()`, `.emitNow()`                                                             | `autotel`                              |
| Throw with why/fix/link               | `createStructuredError({ message, why?, fix?, link?, status? })`                                              | `autotel`                              |
| Parse API errors (client)             | `parseError(err)` → `message`, `why`, `fix`, `link`                                                           | `autotel`                              |
| Product/analytics events              | `track(name, attrs)` or `Event` from `autotel/event`                                                          | `autotel`, `autotel/event`             |
| Init (once at startup)                | `init({ service, ... })`                                                                                      | `autotel`                              |
| Same error thrown from many places    | `defineErrorCatalog(ns, entries)` → typed builders + `.match()`                                               | `autotel`                              |
| Error budgets and burn-rate alerts    | `createSloTracker()`, `evaluateBurnRateAlert()`                                                               | `autotel/slo`                          |
| Split a metric by feature flag        | OpenFeature: automatic from `init()`. Otherwise `recordFeatureFlag({ key, value })`                           | `autotel/feature-flags`                |
| Flush telemetry on SIGTERM / crash    | `init({ processHandlers: true })`                                                                             | `autotel`                              |
| Testing                               | `createTraceCollector()`, `InMemorySpanExporter`                                                              | `autotel/testing`, `autotel/exporters` |

Request logger requires an active span. Wrap HTTP handlers with `trace()` or framework middleware that creates a span, then call `getRequestLogger()` inside.

`processHandlers` is opt-in: importing `autotel` registers no signal or crash listeners. Pass `true` for the defaults (SIGTERM/SIGINT plus fatal errors, 2s shutdown timeout), or an object to override `signals`, `fatalErrors`, or `shutdownTimeoutMs`. On a signal or crash, the handlers end the spans still running as failed (`error.type` is the signal or the error's class), so a stopped job exports its whole trace. Leave it off and call `shutdown()` from your own handler when the app already owns its lifecycle. Separately, `flushOnExit` (default `true`) flushes on `beforeExit`, so a script that ends on its own keeps its telemetry; it does not fire on `process.exit()` or a signal.

Backend config rule of thumb: use `endpoint` for one OTLP destination, `destinations` for explicit OTLP fan-out, and `spanProcessors` / `spanExporters` only when you need full manual control.

## Production init

```typescript
import { init } from 'autotel';

init({
  service: 'checkout-api',
  version: process.env.APP_VERSION,
  environment: 'production',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY! },
  sampling: 'production',
  processHandlers: true,
});
```

- **`service`**: required. `OTEL_SERVICE_NAME` fills it when the key is left out.
- **`version`**: defaults to `version` in `package.json` in the working directory, else `'1.0.0'`.
- **`environment`**: defaults to `NODE_ENV`, else `'development'`. Sets `deployment.environment.name` (and the legacy `deployment.environment`). `'production'` also switches on PII redaction (`attributeRedactor: 'default'`) unless you pass `attributeRedactor: false` or set `AUTOTEL_REDACT_PII=off`.
- **`endpoint`**: the OTLP base URL; autotel appends `/v1/traces`, `/v1/metrics`, `/v1/logs`. Falls back to `OTEL_EXPORTER_OTLP_ENDPOINT`. With neither (and no `destinations` / exporters / processors) **nothing is exported**: there is no localhost default.
- **`headers`**: an object or a `'key=value,key2=value2'` string. Falls back to `OTEL_EXPORTER_OTLP_HEADERS`.
- **`protocol`**: `'http'` (OTLP/HTTP with a JSON body, the default), `'http/protobuf'` or `'grpc'`. The last two need the matching `@opentelemetry/exporter-*-otlp-proto` / `-grpc` packages in your app. Falls back to `OTEL_EXPORTER_OTLP_PROTOCOL`.
- **`sampling`**: set it. Without `sampling` or `sampler`, wrapped functions keep every span. See `tune-sampling`.
- **`logs`**: off by default. `logs: true` (or `AUTOTEL_LOGS=on`) exports OTel log records to the same endpoint; the HTTP/JSON log exporter ships with autotel.
- **Shutdown**: `await flush()` exports what is buffered (2s timeout by default); `await shutdown()` flushes and stops the SDK, waiting up to 10s (the top-level `init({ shutdownTimeoutMs })` or `shutdown({ timeout })` changes it). Both come from `autotel`.
- **`init()` throws** on an unknown `sampling` preset, an invalid `attributeRedactor` config, `devtools: { embedded: true, port: 0 }`, and an `sdkFactory` that returns nothing. Calling `init()` again warns, shuts the previous pipeline down and starts the new config; `trace()` wrappers, tracers from `getTracer()` and the earlier call's instrumentations follow it. `init()` after `shutdown()` starts a fresh pipeline without a warning. `lockLogger()` makes later calls no-ops.

## Setup

```typescript
import { init, withTracing, getRequestLogger } from 'autotel';

init({ service: 'my-app' });

const handler = withTracing({ name: 'http.request' })(
  (ctx) => async (req: Request) => {
    const log = getRequestLogger(ctx);
    log.set({ path: req.url });
    const result = await doWork(req);
    log.emitNow();
    return result;
  },
);
```

## Core Patterns

**Factory pattern when you need context (attributes, request logger):**

```typescript
const createUser = withTracing({ name: 'user.create' })(
  (ctx) => async (data: UserInput) => {
    ctx.setAttribute('user.id', data.id);
    const log = getRequestLogger(ctx);
    log.set({ user: { id: data.id } });
    return db.users.create(data);
  },
);
```

**Direct pattern when you don't need context:**

```typescript
const getUser = trace(async (id: string) => {
  return db.users.findById(id);
});
```

**One immediate named operation when you do need context:**

```typescript
const result = await trace.run('user.lookup', async (ctx) => {
  ctx.setAttribute('user.id', id);
  return db.users.findById(id);
});
```

**Version.** `trace.run()` needs autotel 7.0 or later. On 6.x the immediate form is `span(name, fn)`, and `trace(...)` still wraps.

**`trace` wraps, `trace.run` runs.** Every `trace(...)` form returns a wrapper
and executes nothing. For the `ctx => async () => …` factory form use
`withTracing({ name })`; autotel warns once when `trace()` is handed one. A
reusable function with an explicit name is:

```typescript
export const createUser = trace('user.create', async (data: NewUser) => {
  return db.users.create(data);
});
```

Inside any traced body, import `ctx` to reach the span — it resolves at any
depth, so a helper further down sees the same span without being passed one:

```typescript
import { trace, ctx } from 'autotel';

export const createUser = trace('user.create', async (data: NewUser) => {
  ctx.setAttribute('user.id', data.id);
  return db.users.create(data);
});
```

`instrument({ key: name, fn })` is the options form of the same wrapper.

**Structured errors in API routes:**

```typescript
import { createStructuredError } from 'autotel';
throw createStructuredError({
  message: 'Not found',
  status: 404,
  why: `No user "${id}"`,
  fix: 'Check the ID and try again',
});
```

**Client: parseError for UI:**

```typescript
import { parseError } from 'autotel';
const e = parseError(err);
toast.error(e.message, { description: e.why });
```

## Common Mistakes

### HIGH Call getRequestLogger() without active span

Wrong:

```typescript
app.get('/api/x', () => {
  const log = getRequestLogger();
  log.set({ route: 'x' });
});
```

Correct:

```typescript
import { otel } from 'autotel-hono';

app.use('*', otel()); // or wrap the route with trace()
app.get('/api/x', (c) => {
  const log = getRequestLogger();
  log.set({ route: 'x' });
  return c.json({});
});
```

getRequestLogger() throws without an active span (or `runWithRequestContext()`). Register middleware that creates a span per request, or wrap the handler with `trace()`. With `autotelMiddleware()` from `autotel-adapters/hono`, use that adapter's `useLogger(c)` instead: it is the logger the middleware emits for you.

Source: packages/autotel/src/request-logger.ts

### HIGH Pass the app's pino/winston/bunyan logger to init()

Wrong:

```typescript
import pino from 'pino';
import { init } from 'autotel';

const logger = pino();
init({ service: 'api', logger });
```

Correct:

```typescript
// instrumentation.ts, loaded first (ESM: node --import autotel/register)
import { init } from 'autotel';
init({ service: 'api', autoInstrumentations: ['http', 'pino'], logs: true });

// logger.ts
import pino from 'pino';
export const logger = pino();
```

The instrumentation patches pino as it loads, so create the logger in its own module after `init()`. `init({ logger })` only receives autotel's own diagnostics. The `autoInstrumentations` array is an allowlist: list `'http'` for request spans. It needs `@opentelemetry/auto-instrumentations-node` installed. Winston also needs `@opentelemetry/winston-transport` for OTLP export.

Source: packages/autotel/src/auto-instrumentations.ts

### MEDIUM Assume trace(fn) has no ambient context

This is valid and often simplest:

```typescript
const handler = trace(async (req) => {
  const log = getRequestLogger(); // valid: trace() made this span active
  log.set({ route: req.url });
});
```

Also correct when explicit context improves clarity:

```typescript
const handler = withTracing({ name: 'http.request' })((ctx) => async (req) => {
  const log = getRequestLogger(ctx);
  log.set({ route: req.url });
});
```

Inside `trace(fn)`, `getRequestLogger()` and `getActiveTraceContext()` resolve
the active function span. Use `withTracing()` when explicit context threading
is clearer, not because the ambient form is unavailable.

Source: docs/AGENT-GUIDE.md

### MEDIUM Return a failure without marking the span

A handler that turns a failure into a value (an HTTP 502, an error result)
returns normally, so `trace()` records success. Set the status before you
return and the span reports the failure:

```typescript
const reply = await trace.run('POST /orders', async (ctx) => {
  const [status, body] = await handleOrder(req);
  if (status >= 500)
    ctx.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
  return [status, body];
});
```

An explicit `ERROR` status gives the span `operation.success: false` and
`error: true`, and the call metrics and tail sampling count the operation as
failed.

Source: packages/autotel/src/functional-wrapper.ts

## Compatibility

Targets the current workspace public API. Verify package exports when working
against an older installed version.

See also:

- `autotel-instrumentation/SKILL.md` for init and trace/span in depth
- `autotel-request-logging/SKILL.md` for request logger usage
