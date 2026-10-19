---
name: autotel-instrumentation
description: >
  trace(), span(), instrument(), init(). Factory vs direct pattern, name inference, init order. Load when wrapping handlers or functions with spans.
---

# Autotel: Instrumentation

Wrap functions and handlers with `trace()`, `span()`, or `instrument()`. Call `init()` once at app startup. `init()` is synchronous; don't `await` anything before it.

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
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, // none = nothing exported
  sampling: 'production',
  // see docs/CONFIGURATION.md for full options
});
```

Production options and defaults are listed in `autotel-core/SKILL.md` ("Production init").

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

### HIGH Call traced code before init() runs

Wrong:

```typescript
// server.ts
import { handler } from './routes'; // routes import pg, express, pino…
import { init } from 'autotel';
init({ service: 'my-app', autoInstrumentations: ['http', 'pg'] });
```

Correct:

```typescript
// instrumentation.ts, imported first (ESM: node --import autotel/register)
import { init } from 'autotel';
init({ service: 'my-app', autoInstrumentations: ['http', 'pg'] });

// server.ts
import './instrumentation';
import { handler } from './routes';
```

Wrapping with `trace()` at module load is fine: the wrapper reads the tracer and sampler per call. Calling a wrapped function before `init()` produces no-op spans, and libraries imported before `init()` are never auto-instrumented.

Source: packages/autotel/src/functional-wrapper.ts, packages/autotel/src/auto-instrumentations.ts

### MEDIUM Wrong export path for submodules

Wrong:

```typescript
import { createTraceCollector } from 'autotel'; // testing subpath
import { DeterministicSampler } from 'autotel'; // sampling subpath
```

Correct:

```typescript
import { trace, init, getRequestLogger, Event } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { DeterministicSampler } from 'autotel/sampling';
```

`Event` is exported from both `autotel` and `autotel/event`. Use the exact export paths from package.json (autotel/event, autotel/testing, autotel/sampling, autotel/attributes, etc.).

Source: packages/autotel/package.json exports

## Compatibility

Targets the current workspace public API. Verify package exports when working
against an older installed version.

See also:

- `autotel-core/SKILL.md` for when to use what
- `autotel-request-logging/SKILL.md`, since `getRequestLogger` requires an active span
