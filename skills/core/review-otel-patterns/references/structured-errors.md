# Structured errors

`createStructuredError` produces an `Error` carrying enough context to be:

- **Recorded onto a span** when it is thrown through `trace()` / an adapter (ERROR status + exception event), or recorded explicitly with `recordStructuredError(ctx, err)` / `getRequestLogger().error(err)`, which also add `error.why` / `error.fix` / `error.code` / `error.status` / `error.details.*`. Creating the error records nothing by itself.
- **Returned to clients safely** (`parseError` never includes `internal` or `cause`).
- **Self-documenting** (`why` explains the cause, `fix` tells the caller what to do, `link` points at runbook docs).

## Field reference

| Field      | Audience    | Purpose                                               |
| ---------- | ----------- | ----------------------------------------------------- |
| `message`  | Both        | Short, stable summary                                 |
| `status`   | Both        | HTTP status (`parseError` defaults to 500 without it) |
| `why`      | Both        | Human-readable cause (`"Card declined by issuer"`)    |
| `fix`      | Client      | Remediation hint (`"Use a different payment method"`) |
| `link`     | Client      | URL to docs / runbook                                 |
| `code`     | Both        | Machine-readable code (`"PAYMENT_DECLINED"`)          |
| `cause`    | Server only | The underlying error                                  |
| `internal` | Server only | Diagnostic metadata (`{ correlationId, resourceId }`) |
| `details`  | Both        | Structured payload (e.g. validation errors per field) |

## Templates

### Validation (400)

```typescript
throw createStructuredError({
  status: 400,
  code: 'VALIDATION_ERROR',
  message: 'Invalid request body',
  why: 'One or more fields failed validation',
  fix: 'Check the `details` field for per-field errors',
  details: { email: 'must be a valid email', age: 'must be ≥ 18' },
});
```

### Auth (401 / 403)

```typescript
throw createStructuredError({
  status: 403,
  code: 'FORBIDDEN',
  message: 'Not allowed',
  why: 'You do not have access to this resource',
  fix: 'Ask the workspace owner for access',
  link: 'https://docs.example.com/permissions',
  internal: { resourceId: 'proj_123', userRole: 'member' },
});
```

### Payment (402)

```typescript
throw createStructuredError({
  status: 402,
  code: 'PAYMENT_DECLINED',
  message: 'Payment declined',
  why: 'Card declined by issuer — insufficient funds',
  fix: 'Use a different payment method or contact your bank',
  link: 'https://docs.example.com/payments/declined',
  cause: stripeError,
  internal: { stripeChargeId: 'ch_…', riskScore: stripeError.risk_level },
});
```

### Upstream failure (502 / 503 / 504)

```typescript
throw createStructuredError({
  status: 502,
  code: 'UPSTREAM_FAILED',
  message: 'Inventory service is unavailable',
  why: 'Could not reach the inventory service',
  fix: 'Retry in a few minutes',
  cause: fetchError,
  internal: { upstream: 'inventory-svc', retryAttempt: 3 },
});
```

## At HTTP boundaries

```typescript
import { parseError } from 'autotel';

app.onError((error) => {
  // if it was thrown through trace() / an adapter, the span is already ERROR
  // `raw` is the original error: drop it. `internal` and `cause` are never in `body`.
  const { raw: _raw, ...body } = parseError(error);
  return Response.json(body, { status: body.status });
});
```

## Anti-patterns

| Anti-pattern                                                 | Fix                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `throw new Error('something went wrong')`                    | `createStructuredError({ message, status, why, fix })`                                 |
| Putting support IDs in `message` (`"Failed for user 42"`)    | Use `internal: { userId: 42 }`                                                         |
| Returning `details: { error: stack }` to clients             | Stack traces stay in `cause` / span; never serialise them out                          |
| `console.error(e); throw e`                                  | Just throw: inside `trace()` / an adapter the span records it                          |
| Two callers throwing different shapes for the same condition | Centralise: `function declined(reason: string) { throw createStructuredError({ … }) }` |
