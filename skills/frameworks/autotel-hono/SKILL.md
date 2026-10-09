---
name: autotel-hono
description: >
  Use this skill when tracing a Hono app with OpenTelemetry — adding the otel() middleware to emit HTTP spans with semantic attributes, capture headers, and record request metrics.
---

# autotel-hono

OpenTelemetry Hono middleware. One middleware call instruments all HTTP requests.

## Setup

```typescript
import { Hono } from 'hono';
import { otel } from 'autotel-hono';

const app = new Hono();
app.use(otel({ serviceName: 'my-api' }));
```

## Configuration

```typescript
app.use(
  otel({
    serviceName: 'my-api',
    captureRequestHeaders: ['x-request-id'],
    captureResponseHeaders: ['x-response-time'],
    captureActiveRequests: true,
    captureRequestDuration: true,
    spanNameFactory: (c) => `${c.req.method} ${c.req.routePath}`,
  }),
);
```

## What Gets Traced

- Every HTTP request gets a span with method, route, URL, status code
- The span and duration end when the body has been sent, so streamed responses (`streamSSE`, AI SDK UI streams) record their full length
- Errors (5xx) are recorded as span exceptions
- Optional: request/response headers, active request count, duration histogram

## Common Mistakes

- Do NOT call `otel()` per-route: register once with `app.use(otel(...))`.
- Do NOT pass a tracer unless you need a custom one: the middleware creates one from the global provider.
- Header capture requires listing header names upfront in config, not at request time.
- In tests with `app.request()`, read the body (`await res.text()`) before asserting on the span; the span ends when the body is consumed.
