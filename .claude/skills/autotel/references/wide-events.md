# Wide Events (Canonical Log Lines)

## What Is a Wide Event?

A wide event is a single structured record per request containing all context accumulated during processing. Instead of 10 scattered log lines, you get one queryable event with 25+ fields.

Autotel implements this via the `CanonicalLogLineProcessor` - a span processor that emits all span attributes as one structured log record when the span completes.

## Anatomy of a Canonical Log Line

```json
{
  "operation": "processCheckout",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "correlationId": "4bf92f3577b34da6",
  "duration_ms": 312.4,
  "duration": "312ms",
  "status_code": 1,
  "timestamp": "2025-03-03T10:23:45.612Z",
  "user.id": "user-123",
  "user.subscription": "premium",
  "cart.item_count": 3,
  "cart.total_cents": 15999,
  "payment.provider": "stripe",
  "payment.latency_ms": 150,
  "error.type": "PaymentError",
  "error.code": "card_declined",
  "error.why": "Card has insufficient funds",
  "service.name": "checkout-api"
}
```

Core fields (always present):
- `operation` - span name
- `traceId`, `spanId`, `correlationId` - trace identifiers
- `duration_ms` - numeric duration
- `duration` - human-readable duration (`45ms`, `1.2s`, `1m 5s`)
- `status_code` - 0 (unset), 1 (ok), 2 (error)
- `timestamp` - ISO 8601

## Context Grouping

Group related attributes with dot-prefixed keys:

```typescript
// User context
log.set({
  'user.id': user.id,
  'user.subscription': user.plan,
  'user.lifetime_value_cents': user.ltv,
});

// Cart context
log.set({
  'cart.item_count': cart.items.length,
  'cart.total_cents': cart.total,
  'cart.coupon_applied': cart.coupon,
});

// Payment context
log.set({
  'payment.method': payment.method,
  'payment.provider': 'stripe',
  'payment.latency_ms': payment.latencyMs,
});
```

Or use nested objects with `getRequestLogger()` - they flatten automatically:

```typescript
const log = getRequestLogger(ctx);
log.set({
  user: { id: user.id, subscription: user.plan },
  cart: { item_count: cart.items.length, total_cents: cart.total },
});
// Flattens to: user.id, user.subscription, cart.item_count, cart.total_cents
```

## Configuration

```typescript
init({
  service: 'my-app',
  canonicalLogLines: {
    enabled: true,
    rootSpansOnly: true,       // One event per request (not per child span)
    minLevel: 'info',          // Minimum level to emit
    includeResourceAttributes: true,

    // Declarative tail sampling (OR logic - any match keeps the event)
    keep: [
      { status: 500 },         // Keep server errors
      { durationMs: 1000 },    // Keep slow requests
      { path: '/api/checkout' }, // Keep specific routes
    ],

    // Or use a custom predicate (overrides keep)
    shouldEmit: ({ event, level, span }) => {
      return event.duration_ms > 500 || level === 'error';
    },

    // Pretty tree-formatted console output (defaults to NODE_ENV=development)
    pretty: true,

    // Fan-out to external systems
    drain: (event) => analytics.track(event),
    onDrainError: (error, event) => console.warn('drain failed:', error),

    // Custom message format
    messageFormat: (span) => `[${span.name}] completed`,

    // PII redaction
    attributeRedactor: (key, value) => {
      if (key.includes('email')) return '[REDACTED]';
      return value;
    },
  },
});
```

## Drain Pipeline

For production fan-out with batching and retry:

```typescript
import { createDrainPipeline } from 'autotel';

const pipeline = createDrainPipeline({
  batch: { size: 50, intervalMs: 5000 },
  retry: { maxAttempts: 3, backoff: 'exponential' },
  maxBufferSize: 1000,
});

const drain = pipeline(async (batch) => {
  await fetch('https://analytics.example.com/events', {
    method: 'POST',
    body: JSON.stringify(batch),
  });
});

init({
  service: 'my-app',
  canonicalLogLines: {
    enabled: true,
    drain,
  },
});

// On shutdown
process.on('SIGTERM', () => drain.shutdown());
```

## Query Examples

Wide events are queryable as structured data:

```sql
-- Failed payments by decline code
SELECT error.code, error.why, COUNT(*) as count
FROM logs
WHERE error.type = 'PaymentError'
GROUP BY error.code, error.why
ORDER BY count DESC;

-- Slow requests for premium users
SELECT operation, duration_ms, user.id
FROM logs
WHERE duration_ms > 500
  AND user.subscription = 'premium';

-- P95 latency by route
SELECT "http.route",
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
FROM logs
GROUP BY "http.route";

-- Error rate by service
SELECT service.name,
  COUNT(*) FILTER (WHERE status_code = 2) * 100.0 / COUNT(*) as error_rate
FROM logs
GROUP BY service.name;
```
