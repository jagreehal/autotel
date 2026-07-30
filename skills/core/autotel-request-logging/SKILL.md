---
name: autotel-request-logging
description: >
  Accumulates request-scoped context and emits one wide-event snapshot per request
  with getRequestLogger(), set(), setLevel(), info/warn/error, and emitNow(). Use
  this skill when adding request-scoped attributes, building canonical log lines, or
  replacing scattered console.log. Do not use for product and analytics events —
  use skill autotel-events — or for span creation itself, which skill
  autotel-instrumentation covers.
---

# Autotel: Request Logging

This skill builds on autotel-instrumentation. Read it first for init and span creation.

Accumulate context with `getRequestLogger(ctx)`, `.set()`, and `.info()`/`.warn()`/`.error()`. Call `.emitNow()` (or rely on middleware) to emit one snapshot per request. Request logger requires an active span. Use inside `trace()` or framework middleware.

Preferred event model: treat request logger emissions as the default way to capture request-correlated events in new code. If a backend still expects span-event rendering, keep compatibility at export/processor level rather than adding new `span.addEvent()` calls in application code.

## Setup

```typescript
import { init, withTracing, getRequestLogger } from 'autotel';

init({ service: 'my-app' });

const handler = withTracing({ name: 'http.request' })(
  (ctx) => async (req: Request, res: Response) => {
    const log = getRequestLogger(ctx);
    log.set({ method: req.method, path: req.url });

    const user = await getAuth(req);
    log.set({ user: { id: user.id } });

    const result = await doWork(req);
    log.set({ result: { id: result.id } });
    log.emitNow();
    return res.json(result);
  },
);
```

When the framework creates the span (e.g. Hono middleware), call `getRequestLogger()` with no args:

```typescript
app.use(autotelMiddleware());
app.get('/api/users', (c) => {
  const log = getRequestLogger();
  log.set({ route: 'users' });
  return c.json({ users: [] });
});
```

## Core Patterns

**Accumulate then emit:**

```typescript
const log = getRequestLogger(ctx);
log.set({ cart: { items: body.items.length } });
log.set({ payment: { method: body.method } });
log.error(err, { step: 'payment' });
log.emitNow();
```

**Set severity without logging:** `.warn()` and `.error()` set `autotel.log.level` for you. Use `setLevel()` when the request degraded but there is nothing to log, or when a warning should not colour the whole snapshot.

```typescript
if (inventory.stale) log.setLevel('warn'); // served from a stale cache
```

Takes `'debug' | 'info' | 'warn' | 'error'`. Adds no log event and records no exception. An explicit level wins: a later `.warn()` / `.error()` leaves it alone. Ignored after `emitNow()`.

**RequestLogSnapshot:** `emitNow()` returns `{ timestamp, traceId, spanId, correlationId, context }`. You can pass `onEmit` in options to forward it.

**Options:** `getRequestLogger(ctx?, { onEmit?: (snapshot) => void })` for custom fan-out on emit.

## Common Mistakes

### HIGH Call getRequestLogger() outside a span

Wrong:

```typescript
function helper() {
  const log = getRequestLogger();
  log.set({ step: 'helper' });
}
```

Correct:

```typescript
// Ensure helper runs inside trace() or middleware-created span
function helper(ctx?: TraceContext) {
  const log = getRequestLogger(ctx);
  log.set({ step: 'helper' });
}
```

Request logger attaches to the active span. If there is no active span, it throws. Wrap the call path with `trace()` or register middleware that creates a span per request.

Source: packages/autotel/src/request-logger.ts

## Version

Targets autotel v2.23.x.

See also:

- `autotel-instrumentation/SKILL.md` for creating the span
- `autotel-structured-errors/SKILL.md`, which uses `.error()` to record errors in the snapshot
