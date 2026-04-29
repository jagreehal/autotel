---
name: autotel-core
description: >
  When to use trace vs span vs request logger vs events in Autotel. Init once at startup, package exports (autotel, autotel/event, autotel/testing). Use for setup and choosing the right API.
type: core
library: autotel
library_version: '2.23.0'
sources:
  - jagreehal/autotel:AGENTS.md
  - jagreehal/autotel:docs/AGENT-GUIDE.md
  - jagreehal/autotel:packages/autotel/CLAUDE.md
---

# Autotel — Core

OpenTelemetry instrumentation for Node.js and edge. Instrument once; stream to any OTLP backend. Use `trace()`/`span()` for spans, `getRequestLogger()` for one snapshot per request, `createStructuredError`/`parseError` for errors, `track()` for product events.

Event guidance: for new instrumentation, emit events as correlated logs (via request logger or logging pipeline bridged to OTel Logs API). Do not introduce new direct span-event dependencies for business/exception events.

## When to Use What

| Need                                  | API                                                              | Import                                 |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| Wrap a function with a span           | `trace(fn)`, `span('Name', fn)`                                  | `autotel`                              |
| Request-scoped attributes + emit once | `getRequestLogger(ctx?)` → `.set()`, `.emitNow()`                | `autotel`                              |
| Throw with why/fix/link               | `createStructuredError({ message, why?, fix?, link?, status? })` | `autotel`                              |
| Parse API errors (client)             | `parseError(err)` → `message`, `why`, `fix`, `link`              | `autotel`                              |
| Product/analytics events              | `track(name, attrs)` or `Event` from `autotel/event`             | `autotel`, `autotel/event`             |
| Init (once at startup)                | `init({ service, ... })`                                         | `autotel` or `autotel/instrumentation` |
| Testing                               | `createTraceCollector()`, `InMemorySpanExporter`                 | `autotel/testing`, `autotel/exporters` |

Request logger requires an active span. Wrap HTTP handlers with `trace()` or framework middleware that creates a span, then call `getRequestLogger()` inside.

## Setup

```typescript
import { init, trace, getRequestLogger } from 'autotel';

init({ service: 'my-app' });

const handler = trace((ctx) => async (req: Request) => {
  const log = getRequestLogger(ctx);
  log.set({ path: req.url });
  const result = await doWork(req);
  log.emitNow();
  return result;
});
```

## Core Patterns

**Factory pattern when you need context (attributes, request logger):**

```typescript
const createUser = trace((ctx) => async (data: UserInput) => {
  ctx.setAttribute('user.id', data.id);
  const log = getRequestLogger(ctx);
  log.set({ user: { id: data.id } });
  return db.users.create(data);
});
```

**Direct pattern when you don't need context:**

```typescript
const getUser = trace(async (id: string) => {
  return db.users.findById(id);
});
```

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

### MEDIUM Use trace() without ctx when you need attributes or request logger

Wrong:

```typescript
const handler = trace(async (req) => {
  const log = getRequestLogger(); // may throw if span not set up for request logger
});
```

Correct:

```typescript
const handler = trace((ctx) => async (req) => {
  const log = getRequestLogger(ctx);
  log.set({ route: req.url });
});
```

Use the factory pattern `(ctx) => async (...)` when you need to set attributes or use the request logger.

Source: docs/AGENT-GUIDE.md

## Version

Targets autotel v2.23.x.

See also: autotel-instrumentation/SKILL.md — init and trace/span in depth. autotel-request-logging/SKILL.md — request logger usage.
