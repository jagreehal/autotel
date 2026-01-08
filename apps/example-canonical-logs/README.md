# Canonical Log Lines Demo

This demo shows the difference between regular logging and canonical log lines (wide events).

## What are Canonical Log Lines?

Canonical log lines implement "wide events" pattern:
- **One comprehensive log line per request** with ALL context
- **High-cardinality, high-dimensionality data** for powerful queries
- **Queryable as structured data** instead of string search
- **Automatic** - no manual logging needed

## Running the Demos

### Option 1: CLI Demo

```bash
# Show regular logging (traditional approach)
pnpm start:regular

# Show canonical log lines (wide events)
pnpm start:canonical
```

### Option 2: HTTP API Demo (Step-Through)

This mirrors Boris Tane's "Wide Event Builder Simulator" - step through a checkout flow and watch the wide event accumulate context.

```bash
# Terminal 1: Start the server
pnpm start:server

# Terminal 2: Run the step-through demo
./demo.sh

# Or simulate a payment failure
./demo.sh --error
```

#### Manual curl commands

```bash
# Step 1: Initialize request
curl -X POST http://localhost:3000/checkout/start \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req_123"}'

# Step 2: Add user context
curl -X POST http://localhost:3000/checkout/auth \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req_123", "user_id": "user_456"}'

# Step 3: Add cart context
curl -X POST http://localhost:3000/checkout/cart \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req_123", "cart_id": "cart_xyz"}'

# Step 4: Process payment
curl -X POST http://localhost:3000/checkout/payment \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req_123"}'

# Step 5-6: Complete + emit canonical log
curl -X POST http://localhost:3000/checkout/complete \
  -H "Content-Type: application/json" \
  -d '{"request_id": "req_123"}'
```

Watch the server console - when `/checkout/complete` is called, Autotel emits a single canonical log line with ALL context from every step.

## The Difference

### Regular Logging Mode

Multiple log lines per request:
```
[INFO] Checkout started userId=user-123
[INFO] Cart loaded cartId=cart-1 itemCount=2
[INFO] Checkout completed total=63.98 orderId=abc-123
```

**Problems:**
- Context scattered across multiple log lines
- Hard to correlate (need to search for userId, then cartId, then orderId)
- String search required to find related logs
- Difficult to query: "Show me all failed checkouts for premium users"

### Canonical Log Lines Mode

One log line per request with ALL context:
```json
{
  "level": "info",
  "msg": "[processCheckout] Request completed",
  "operation": "processCheckout",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "correlationId": "4bf92f3577b34da",
  "duration_ms": 124.7,
  "status_code": 1,
  "user.id": "user-123",
  "user.email": "alice@example.com",
  "user.subscription": "premium",
  "user.account_age_days": 847,
  "user.lifetime_value_cents": 284700,
  "cart.id": "cart-1",
  "cart.item_count": 2,
  "cart.total_cents": 7998,
  "cart.discount_cents": 1600,
  "cart.final_total_cents": 6398,
  "cart.coupon_applied": "SAVE20",
  "payment.method": "card",
  "payment.provider": "stripe",
  "payment.latency_ms": 150,
  "payment.attempt": 1,
  "order.id": "abc-123",
  "service.name": "checkout-api",
  "timestamp": "2024-01-15T10:23:45.612Z"
}
```

**Benefits:**
- All context in one place
- Queryable: `WHERE user.id = 'user-123' AND error.code IS NOT NULL`
- High-cardinality fields (user.id, order.id) for powerful queries
- No string search needed

## Query Examples

With canonical log lines, you can run powerful queries:

```sql
-- Find all checkout failures for premium users
SELECT * FROM logs
WHERE user.subscription = 'premium'
  AND error.code IS NOT NULL;

-- Group errors by code
SELECT error.code, COUNT(*) 
FROM logs
WHERE error.code IS NOT NULL
GROUP BY error.code;

-- Find slow checkouts with coupons
SELECT * FROM logs
WHERE duration_ms > 200
  AND cart.coupon_applied IS NOT NULL;
```

## How It Works

The canonical log line processor automatically:
1. Captures ALL span attributes when a span ends
2. Includes trace context (traceId, spanId, correlationId)
3. Includes resource attributes (service.name, service.version)
4. Emits as a single structured log record

No manual logging needed. Use `trace()` and `ctx.setAttributes()`:

```typescript
export const processCheckout = trace((ctx) => async (req: CheckoutRequest) => {
  setUser(ctx, { id: req.userId });
  ctx.setAttributes({
    'user.subscription': 'premium',
    'cart.total_cents': req.total,
  });
  // Canonical log line automatically emitted with ALL context
});
```

In practice you'll want to redact PII. Autotel supports this via `attributeRedactor`.

## See Also

- [Boris Tane's article on logging](https://boristane.com/blog/logging-sucks)
- [Autotel README](../../packages/autotel/README.md)



