# Designing wide spans

A wide span is a single span per logical unit of work (request, job, message, fork) carrying _all_ the fields you'd ever want to filter or group by. autotel lets you build them with `getRequestLogger().set({ … })` (or an adapter's `useLogger()`). Fields are flattened to OTel attributes with stable dotted keys.

## Anatomy

```typescript
import { withAutotel, useLogger } from 'autotel-adapters/next';

export const POST = withAutotel(async (request: Request) => {
  const log = useLogger(request);

  // Identity
  log.set({ user: { id: 'usr_123', plan: 'enterprise', role: 'admin' } });

  // Inputs
  log.set({ cart: { items: 3, total: 14_999, currency: 'USD' } });

  // Decisions / branches
  log.set({ promo: { applied: 'SUMMER10', discount: 1_500 } });

  // Outputs
  log.set({
    payment: { provider: 'stripe', method: 'card', authCode: 'auth_x' },
  });

  return Response.json({ ok: true });
});
```

OTel attributes recorded:

```
user.id=usr_123
user.plan=enterprise
user.role=admin
cart.items=3
cart.total=14999
cart.currency=USD
promo.applied=SUMMER10
promo.discount=1500
payment.provider=stripe
payment.method=card
payment.authCode=auth_x
```

## Rules of thumb

1. **One wide span per logical unit of work.** Many tiny spans hurt query speed; deep call trees can be opt-in (`autotel-drizzle`, `autotel-mongoose`).
2. **Group with objects.** `{ user: { id, plan } }` not `userId` / `userPlan`. The flatten step keeps the key shape stable.
3. **Capture decisions, not just inputs.** Which branch ran, which promo applied, which fallback fired.
4. **Keep cardinality bounded.** Don't put per-request UUIDs in `span.name`; use `init({ spanNameNormalizer: 'rest-api' })`. Free-text labels go in attributes.
5. **Avoid raw bodies.** Pick the shape: `{ user: { id, plan } }`: never `log.set({ user: requestBody })`.
6. **Trust the redactor, where it runs.** PII you forgot to think about (emails, JWTs, cards) gets masked when `attributeRedactor` is active. It is automatic only when the environment resolves to `production`; set `attributeRedactor: 'default'` explicitly for staging and the like.

## When you need correlated child spans

Use `trace()` to wrap discrete sub-operations whose duration matters:

```typescript
import { trace } from 'autotel';

const fetchInventory = trace('fetchInventory', async (sku: string) => {
  /* … */
});
const reserveStock = trace('reserveStock', async (sku: string, qty: number) => {
  /* … */
});

await fetchInventory(sku);
await reserveStock(sku, qty);
```

Each gets its own span with that name; both are children of the active request span.

## When you need background work

`log.fork('label', fn)` spawns a child span that emits its own wide event with `_parentCorrelationId` set, even after the parent response has been returned. The parent logger needs a correlation id, which autotel middleware / adapters set. Pass `{ lifecycle: { onChildEnter, onChildExit } }` as the third argument if your framework tracks active loggers (Elysia, etc.).

```typescript
log.fork('audit-write', async () => {
  await audit.write({ kind: 'order.created', orderId });
});
return Response.json({ ok: true }); // parent returns immediately
```
