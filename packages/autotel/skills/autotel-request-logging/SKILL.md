---
name: autotel-request-logging
description: >
  getRequestLogger(), set(), info/warn/error, emitNow(). One snapshot per request; requires active span. Use when adding request-scoped context or replacing scattered console.log.
type: core
library: autotel
library_version: '2.23.0'
requires:
  - autotel-instrumentation
sources:
  - jagreehal/autotel:packages/autotel/src/request-logger.ts
  - jagreehal/autotel:docs/AGENT-GUIDE.md
---

# Autotel — Request Logging

This skill builds on autotel-instrumentation. Read it first for init and span creation.

Accumulate context with `getRequestLogger(ctx)`, `.set()`, and `.info()`/`.warn()`/`.error()`. Call `.emitNow()` (or rely on middleware) to emit one snapshot per request. Request logger requires an active span — use inside `trace()` or framework middleware.

## Setup

```typescript
import { init, trace, getRequestLogger } from 'autotel';

init({ service: 'my-app' });

const handler = trace((ctx) => async (req: Request, res: Response) => {
  const log = getRequestLogger(ctx);
  log.set({ method: req.method, path: req.url });

  const user = await getAuth(req);
  log.set({ user: { id: user.id } });

  const result = await doWork(req);
  log.set({ result: { id: result.id } });
  log.emitNow();
  return res.json(result);
});
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

See also: autotel-instrumentation/SKILL.md — creating the span. autotel-structured-errors/SKILL.md — use .error() to record errors in the snapshot.
