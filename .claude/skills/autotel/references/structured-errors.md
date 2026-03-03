# Structured Errors

## createStructuredError()

Creates an Error with diagnostic fields that flatten onto spans:

```typescript
import { createStructuredError } from 'autotel';

throw createStructuredError({
  message: 'Payment declined',
  why: 'Card has insufficient funds for the requested amount',
  fix: 'Prompt the user to update their payment method or reduce cart total',
  code: 'CARD_DECLINED',
  status: 402,
  link: 'https://docs.stripe.com/declines/codes#insufficient-funds',
  details: { amount: 15999, currency: 'usd' },
});
```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `message` | `string` (required) | What happened |
| `why` | `string` | Why it happened (root cause) |
| `fix` | `string` | How to fix it (actionable) |
| `link` | `string` | Documentation URL |
| `code` | `string \| number` | Machine-readable error code |
| `status` | `number` | HTTP status code |
| `cause` | `unknown` | Original error (Error.cause) |
| `details` | `Record<string, unknown>` | Additional context (flattened to `error.details.*`) |

### Span Attributes

When recorded on a span, fields map to:
- `error.type` - error name
- `error.message` - message
- `error.why` - why
- `error.fix` - fix
- `error.link` - link
- `error.code` - code
- `error.status` - status
- `error.details.*` - flattened details object

## recordStructuredError()

Records a structured error onto a trace context (sets status, exception, and attributes):

```typescript
import { trace, recordStructuredError, createStructuredError } from 'autotel';

export const processPayment = trace(ctx => async (req) => {
  try {
    return await stripe.charges.create(req);
  } catch (err) {
    const structured = createStructuredError({
      message: 'Payment processing failed',
      why: 'Stripe API returned an error during charge creation',
      fix: 'Check Stripe dashboard for decline reason and retry',
      code: err.code,
      status: 502,
      cause: err,
    });
    recordStructuredError(ctx, structured);
    throw structured;
  }
});
```

`recordStructuredError(ctx, error)` does three things:
1. `ctx.recordException(error)` - records the exception event
2. `ctx.setStatus({ code: ERROR, message })` - sets span status
3. `ctx.setAttributes(...)` - flattens all structured fields as span attributes

## parseError()

Normalizes any thrown value to a consistent shape:

```typescript
import { parseError } from 'autotel';

try {
  await thirdPartyApi.call();
} catch (err) {
  const parsed = parseError(err);
  // Always returns: { message, status, why?, fix?, link?, code?, details?, raw }
  return Response.json({ error: parsed.message }, { status: parsed.status });
}
```

### What parseError Handles

| Input | Behavior |
|-------|----------|
| `Error` instance | Extracts message, preserves structured fields if present |
| `StructuredError` | Extracts all fields (why, fix, link, code, status, details) |
| Axios/fetch error | Unwraps `.data.data`, `.data`, extracts status/statusCode |
| Plain object | Extracts message, status, structured fields |
| String | Uses as message, defaults status to 500 |
| `null`/`undefined` | Returns `"An error occurred"`, status 500 |

### Common Error Patterns

**API endpoint error response:**
```typescript
export const POST = withAutotel(async (request) => {
  try {
    const result = await processOrder(request);
    return Response.json(result);
  } catch (err) {
    const parsed = parseError(err);
    return Response.json(
      { error: parsed.message, code: parsed.code, fix: parsed.fix },
      { status: parsed.status },
    );
  }
});
```

**Wrapping third-party errors:**
```typescript
try {
  await stripe.charges.create(params);
} catch (err) {
  throw createStructuredError({
    message: 'Payment failed',
    why: `Stripe returned: ${err.message}`,
    fix: 'Check card details or try a different payment method',
    code: err.code ?? 'PAYMENT_ERROR',
    status: err.statusCode ?? 502,
    cause: err,
  });
}
```

**Domain validation errors:**
```typescript
if (order.total <= 0) {
  throw createStructuredError({
    message: 'Invalid order total',
    why: 'Order total must be positive',
    fix: 'Ensure cart has items with positive prices before submitting',
    code: 'INVALID_ORDER_TOTAL',
    status: 400,
    details: { total: order.total, items: order.items.length },
  });
}
```
