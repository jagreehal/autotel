# Autotel v3 Migration Guide

## Breaking Direction

Autotel v3 aligns with OpenTelemetry's Span Events deprecation direction:

- New event emission should be log-based and trace-correlated.
- Avoid introducing new app-level `span.addEvent(...)` and `span.recordException(...)` usage.
- Keep span-timeline compatibility as an implementation detail, not the primary app API.

## What to Change

### 1. Replace app-level `ctx.addEvent(...)` with the request logger

Application code should emit events through the request logger, which writes
correlated log records and updates the canonical log line:

```ts
const log = getRequestLogger(ctx);
log.info('checkout.payment_started', { method: 'card', amount });
```

### 2. Replace `ctx.recordException(...)` with structured errors

```ts
log.error(
  createStructuredError({
    message: 'Payment failed',
    why: 'Card declined',
    fix: 'Try another card',
  }),
);
```

Or, when you only need to mark the span and not emit a log:

```ts
recordStructuredError(ctx, error);
```

### 3. Keep `trace()` / `span()` for span lifecycle and attributes

```ts
ctx.setAttribute('checkout.order_id', orderId);
ctx.setStatus({ code: SpanStatusCode.ERROR, message: 'Payment failed' });
```

## Internal helper: `emitCorrelatedEvent`

Autotel's own framework code (workflow, messaging, gen-ai-events, request
logger) uses a small helper, `emitCorrelatedEvent(ctx, name, attrs)`, that:

- Routes through `addEvent` while it remains bound at runtime (preserving the
  span-timeline view in existing backends).
- Falls back to flat, sequence-prefixed attributes
  (`autotel.event.<n>.<name>.<key>`) when `addEvent` is unavailable, so
  multiple events with the same name don't overwrite one another.

This helper is intended for instrumentation libraries (and for autotel's
internal modules), not application code. Application code should prefer the
request logger.

## Compatibility

- Existing span-event data and span-oriented backend views remain supported.
- Existing code using `addEvent` / `recordException` continues to compile and
  run, but those methods are no longer part of the public `TraceContext` type
  surface. They remain bound at runtime through the deprecation window so the
  span-timeline view stays populated.
- New code should treat these methods as compatibility-only.
