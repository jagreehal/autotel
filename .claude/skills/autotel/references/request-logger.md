# Request Logger

## getRequestLogger()

Creates a request-scoped logger that writes to the active span. All fields accumulate on the span and ship as one wide event when the span completes.

```typescript
import { trace, getRequestLogger } from 'autotel';

export const handleOrder = trace(ctx => async (req: OrderRequest) => {
  const log = getRequestLogger(ctx);

  log.set({ feature: 'checkout', tier: req.user.tier });

  const cart = await loadCart(req.cartId);
  log.set({ cart_items: cart.items.length, cart_total: cart.total });

  const payment = await processPayment(cart);
  log.set({ payment_method: payment.method, payment_id: payment.id });

  return { success: true };
});
```

## API

### `getRequestLogger(ctx?, options?)`

- `ctx` - TraceContext from `trace()`. If omitted, uses the active span.
- `options.onEmit` - callback invoked by `emitNow()` for manual fan-out.

### `log.set(fields)`

Merges fields into the span as flattened attributes. Nested objects flatten automatically:

```typescript
log.set({ user: { id: 'u-1', plan: 'pro' } });
// Sets: user.id = 'u-1', user.plan = 'pro'
```

### `log.info(message, fields?)`

Adds a span event at info level. If fields provided, also merges them onto the span:

```typescript
log.info('Cart loaded', { item_count: cart.items.length });
```

### `log.warn(message, fields?)`

Adds a span event at warn level. Sets `autotel.log.level = 'warn'` on the span, which promotes the canonical log line to warn level:

```typescript
log.warn('Inventory low', { sku: item.sku, remaining: 2 });
```

### `log.error(error, fields?)`

Records a structured error on the span. Accepts Error instances or strings. Sets status to ERROR and adds all structured error attributes:

```typescript
try {
  await chargeCard(payment);
} catch (err) {
  log.error(err, { step: 'payment', attempt: 1 });
  throw err;
}
```

### `log.getContext()`

Returns a copy of all fields set via `log.set()`:

```typescript
const snapshot = log.getContext();
// { feature: 'checkout', tier: 'premium', cart_items: 3, ... }
```

### `log.emitNow(overrides?)`

Emits a snapshot immediately (without waiting for span completion). Returns a `RequestLogSnapshot` with traceId, spanId, correlationId, and all context:

```typescript
const snapshot = log.emitNow({ checkpoint: 'pre-payment' });
// { timestamp, traceId, spanId, correlationId, context: {...} }
```

Use `onEmit` for manual fan-out:

```typescript
const log = getRequestLogger(ctx, {
  onEmit: (snapshot) => analytics.track('checkout_step', snapshot.context),
});
log.emitNow({ step: 'cart_loaded' });
```

### `log.fork(label, fn)`

Creates a child request logger for intentional background work tied to this request. Automatically creates a new correlationId for the child:

```typescript
log.fork('async-email', async () => {
  await sendWelcomeEmail(user);
  // This fork has its own correlationId but links to parent
});
```

**Key behavior:**
- Creates a new child span with a new correlationId
- Inherits the parent's traceId for distributed tracing links
- Waits for `fn()` to complete before ending the child span
- Automatically calls `childLog.emitNow()` at the end
- Handles errors and calls `childLog.error(error)` before emit

**Use for:**
- Async work that outlives the request (webhooks, emails, background jobs)
- Fire-and-forget operations that need observability
- Operations that might fail after the main request completes

## Framework Adapters

### useLogger() with withAutotel()

Use `withAutotel()` when you have NO existing autotel middleware. It creates a span and injects a request logger:

```typescript
// Next.js
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const POST = withAutotel(async (request) => {
  const log = useLogger(request);
  log.set({ feature: 'checkout' });
  return Response.json({ ok: true });
});
```

```typescript
// Nitro
import { withAutotelEventHandler, useLogger } from 'autotel-adapters/nitro';

export default withAutotelEventHandler(async (event) => {
  const log = useLogger(event, 'api-service');
  log.set({ route: event.path });
  return { ok: true };
});
```

```typescript
// Cloudflare Workers
import { withAutotelFetch, useLogger } from 'autotel-adapters/cloudflare';

export default {
  fetch: withAutotelFetch(async (request, env, ctx) => {
    const log = useLogger(request);
    log.set({ route: new URL(request.url).pathname });
    return Response.json({ ok: true });
  }),
};
```

### useLogger() alone (middleware already creates span)

Use `useLogger()` alone when middleware already creates the span. Wrapping with `withAutotel` too would create a duplicate span:

```typescript
// Hono with autotel-hono middleware
import { otel } from 'autotel-hono';
import { useLogger } from 'autotel-adapters/hono';

app.use('*', otel());
app.get('/orders/:id', (c) => {
  const log = useLogger(c);
  log.set({ route: c.req.path });
  return c.json({ ok: true });
});
```

## Custom Adapter

Build your own adapter with `createUseLogger`:

```typescript
import { createUseLogger } from 'autotel-adapters/core';

const useLogger = createUseLogger<MyFrameworkContext>({
  adapterName: 'my-framework',
  enrich: (ctx) => ({ request_id: ctx.requestId }),
});
```
