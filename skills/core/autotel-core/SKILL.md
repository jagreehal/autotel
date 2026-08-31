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
| Init (once at startup)                | `init({ service, ... })`                                                                                      | `autotel` or `autotel/instrumentation` |
| Same error thrown from many places    | `defineErrorCatalog(ns, entries)` → typed builders + `.match()`                                               | `autotel`                              |
| Error budgets and burn-rate alerts    | `createSloTracker()`, `evaluateBurnRateAlert()`                                                               | `autotel/slo`                          |
| Split a metric by feature flag        | `recordFeatureFlag(ctx, { key, value })`, `autotelOpenFeatureHook()`                                          | `autotel/feature-flags`                |
| Flush telemetry on SIGTERM / crash    | `init({ processHandlers: true })`                                                                             | `autotel`                              |
| Testing                               | `createTraceCollector()`, `InMemorySpanExporter`                                                              | `autotel/testing`, `autotel/exporters` |

Request logger requires an active span. Wrap HTTP handlers with `trace()` or framework middleware that creates a span, then call `getRequestLogger()` inside.

`processHandlers` is opt-in: importing `autotel` registers no process listeners. Pass `true` for the defaults (SIGTERM/SIGINT plus fatal errors, 2s shutdown timeout), or an object to override `signals`, `fatalErrors`, or `shutdownTimeoutMs`. Leave it off and call `shutdown()` from your own handler when the app already owns its lifecycle.

Backend config rule of thumb: use `endpoint` for one OTLP destination, `destinations` for explicit OTLP fan-out, and `spanProcessors` / `spanExporters` only when you need full manual control.

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
and executes nothing, so a reusable function with an explicit name is just:

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
app.use(autotelMiddleware()); // or wrap route with trace()
app.get('/api/x', () => {
  const log = getRequestLogger();
  log.set({ route: 'x' });
});
```

getRequestLogger() requires an active span. Register middleware that creates a span per request, or wrap the handler with `trace()`.

Source: packages/autotel/src/request-logger.ts

### HIGH Use await import() for init-time optional deps

Wrong:

```typescript
const pkg = await import('optional-dep');
```

Correct:

```typescript
import { safeRequire } from 'autotel';
const pkg = safeRequire('optional-dep');
```

init() must stay synchronous. Use node-require helpers for optional dependencies.

Source: packages/autotel/CLAUDE.md

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

## Compatibility

Targets the current workspace public API. Verify package exports when working
against an older installed version.

See also:

- `autotel-instrumentation/SKILL.md` for init and trace/span in depth
- `autotel-request-logging/SKILL.md` for request logger usage
