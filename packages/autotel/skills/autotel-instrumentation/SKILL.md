---
name: autotel-instrumentation
description: >
  trace(), span(), instrument(), init(). Factory vs direct pattern, name inference. Sync init; use node-require for optional deps. Load when wrapping handlers or functions with spans.
type: core
library: autotel
library_version: '2.23.0'
sources:
  - jagreehal/autotel:docs/ARCHITECTURE.md
  - jagreehal/autotel:packages/autotel/src/functional.ts
  - jagreehal/autotel:packages/autotel/CLAUDE.md
---

# Autotel — Instrumentation

Wrap functions and handlers with `trace()`, `span()`, or `instrument()`. Call `init()` once at app startup. Keep init synchronous; use `safeRequire`/`requireModule` for optional dependencies.

For new event emission, prefer correlated logs (OTel Logs API path) over adding new direct span-event calls.

## Setup

```typescript
import { init, trace } from 'autotel';

init({ service: 'my-app' });

const handler = trace(async (req: Request) => {
  return processRequest(req);
});
```

With span context (attributes, request logger):

```typescript
const handler = trace((ctx) => async (req: Request) => {
  ctx.setAttribute('http.route', '/api/checkout');
  const log = getRequestLogger(ctx);
  log.set({ path: req.url });
  return processRequest(req);
});
```

## Core Patterns

**Explicit span name:**

```typescript
const checkout = trace('checkout', async (body) => {
  return processCheckout(body);
});
```

**instrument() with key:**

```typescript
import { instrument } from 'autotel';
const fn = instrument({
  key: 'processOrder',
  fn: async (id) => db.orders.get(id),
});
```

**span() for a child span:**

```typescript
import { span } from 'autotel';
const result = await span('db.query', async () => db.query(sql));
```

**Init with optional config:**

```typescript
init({
  service: 'my-api',
  // see docs/CONFIGURATION.md for full options
});
```

## Common Mistakes

### HIGH Forget to call init() before using trace/span

Wrong:

```typescript
import { trace } from 'autotel';
export const fn = trace(async () => {});
```

Correct:

```typescript
import { init, trace } from 'autotel';
init({ service: 'my-app' });
export const fn = trace(async () => {});
```

SDK must be initialized; trace() and span() rely on the global tracer.

Source: packages/autotel/CLAUDE.md

### MEDIUM Wrong export path for submodules

Wrong:

```typescript
import { Event } from 'autotel'; // Event is on autotel/event
import { createTraceCollector } from 'autotel'; // testing subpath
```

Correct:

```typescript
import { trace, init, getRequestLogger } from 'autotel';
import { Event } from 'autotel/event';
import { createTraceCollector } from 'autotel/testing';
```

Use the exact export paths from package.json (autotel/event, autotel/testing, autotel/attributes, etc.).

Source: packages/autotel/package.json exports

## Version

Targets autotel v2.23.x.

See also: autotel-core/SKILL.md — when to use what. autotel-request-logging/SKILL.md — getRequestLogger requires active span.
