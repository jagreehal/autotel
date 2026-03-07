---
name: autotel-frameworks
description: >
  Hono, Fastify, TanStack Start, Cloudflare Workers. Middleware and init; getRequestLogger() in handlers. Load when adding Autotel to a web framework.
type: framework
library: autotel
library_version: '2.23.0'
requires:
  - autotel-instrumentation
sources:
  - jagreehal/autotel:packages/autotel-hono/src/index.ts
  - jagreehal/autotel:docs/AGENT-GUIDE.md
  - jagreehal/autotel:AGENTS.md
---

# Autotel — Framework Integration

This skill builds on autotel-instrumentation. Read it first for init() and span creation.

Use framework-specific middleware or wrappers to create a span per request; then call `getRequestLogger()` inside handlers. Each framework package (autotel-hono, autotel-tanstack, autotel-cloudflare) provides the glue.

## Setup

### Hono

```typescript
import { Hono } from 'hono';
import { init, getRequestLogger } from 'autotel';
import { otel } from 'autotel-hono';

init({ service: 'my-api' });

const app = new Hono();
app.use('*', otel({ serviceName: 'my-api' }));

app.post('/api/checkout', async (c) => {
  const log = getRequestLogger();
  log.set({ route: 'checkout' });
  const body = await c.req.json();
  log.set({ cart: { items: body.items?.length } });
  log.emitNow();
  return c.json({ ok: true });
});
```

### Fastify

Use middleware or a wrapper that creates a span per request (see apps/example-fastify). Inside the route, wrap with `trace()` or ensure a span is active, then `getRequestLogger(ctx)` or `getRequestLogger()`.

### TanStack Start

See packages/autotel-tanstack and apps/example-tanstack-start: middleware and env config. Use `getRequestLogger()` inside server handlers when a span is active.

### Cloudflare Workers

See packages/autotel-cloudflare: init at top level, wrap the fetch handler so each request gets a span. Use `getRequestLogger()` or trace context inside the handler.

## Core Patterns

**Register middleware before routes:** Middleware creates the span; getRequestLogger() needs that active span.

**Framework-specific packages:** autotel-hono, autotel-tanstack, autotel-cloudflare. Install the package for your framework and follow its README or CLAUDE.md.

## Common Mistakes

### HIGH Use getRequestLogger() in Hono without registering middleware first

Wrong:

```typescript
const app = new Hono();
app.get('/api/x', (c) => {
  const log = getRequestLogger();
  return c.json({});
});
```

Correct:

```typescript
const app = new Hono();
app.use('*', otel());
app.get('/api/x', (c) => {
  const log = getRequestLogger();
  return c.json({});
});
```

Middleware creates the span per request. Without it, getRequestLogger() has no active span and will throw.

Source: packages/autotel-hono, docs/AGENT-GUIDE.md

## Version

Targets autotel v2.23.x.

See also: autotel-instrumentation/SKILL.md — init and spans. autotel-request-logging/SKILL.md — request logger usage.
