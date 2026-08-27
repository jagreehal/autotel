---
name: autotel-instrumentation
description: >
  trace(), span(), instrument(), init(). Factory vs direct pattern, name inference. Sync init; use node-require for optional deps. Load when wrapping handlers or functions with spans.
---

# Autotel: Instrumentation

Wrap functions and handlers with `trace()`, `span()`, or `instrument()`. Call `init()` once at app startup. Keep init synchronous; use `safeRequire`/`requireModule` for optional dependencies.

For new event emission, prefer correlated logs (OTel Logs API path) over adding new direct span-event calls.

## Setup

```typescript
import {
  getRequestLogger,
  init,
  instrument,
  trace,
  withTracing,
} from 'autotel';

init({ service: 'my-app' });

const handler = trace(async (req: Request) => {
  return processRequest(req);
});
```

With span context (attributes, request logger):

```typescript
const handler = withTracing({ name: 'http.request' })(
  (ctx) => async (req: Request) => {
    ctx.setAttribute('http.route', '/api/checkout');
    const log = getRequestLogger(ctx);
    log.set({ path: req.url });
    return processRequest(req);
  },
);
```

## Core Patterns

**One named operation with explicit context:**

```typescript
const checkout = await trace.run('checkout', async (ctx) => {
  ctx.setAttribute('cart.items', body.items.length);
  return processCheckout(body);
});
```

`trace.run(name, operation)` runs immediately and returns the result.
**Version.** `trace.run()` needs autotel 7.0 or later. On 6.x the immediate form is `span(name, fn)`, and `trace(...)` still wraps.

**`trace` wraps, `trace.run` runs** — so a reusable named function is:

```typescript
export const processOrder = trace('processOrder', async (id: string) =>
  db.orders.get(id),
);
```

`instrument()` is the options form of the same wrapper:

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

**Single backend vs multi-backend OTLP:**

```typescript
init({
  service: 'my-api',
  endpoint: 'https://otlp-gateway-prod.grafana.net/otlp', // single destination
});

init({
  service: 'my-api',
  logs: true,
  destinations: [
    {
      endpoint: 'https://otlp-gateway-prod.grafana.net/otlp',
      headers: 'Authorization=Basic ...',
    },
    {
      endpoint: 'https://api.honeycomb.io',
      headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY! },
      signals: ['traces'],
    },
  ],
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

## Compatibility

Targets the current workspace public API. Verify package exports when working
against an older installed version.

See also:

- `autotel-core/SKILL.md` for when to use what
- `autotel-request-logging/SKILL.md`, since `getRequestLogger` requires an active span
