---
name: autotel-structured-errors
description: >
  Throws and parses errors that explain themselves with message, why, fix, link, and
  status, including reusable catalogs via defineErrorCatalog. Use this skill when
  writing API-route errors, surfacing an API error in UI with parseError, or folding
  repeated inline errors into one catalog. Do not use for recording an already-caught
  error on a span — skill autotel-request-logging covers .error() — or for audit and
  security events, which skill build-audit-trails covers.
---

# Autotel: Structured Errors

Throw errors with `createStructuredError({ message, why?, fix?, link?, status?, cause? })` in API routes and services. On the client, use `parseError(caught)` to get `message`, `status`, `why`, `fix`, `link` for toasts and UI.

## Setup

**Server (API route or service):**

```typescript
import { createStructuredError } from 'autotel';

if (!user) {
  throw createStructuredError({
    message: 'User not found',
    status: 404,
    why: `No user with ID "${userId}"`,
    fix: 'Check the user ID and try again',
    link: 'https://docs.example.com/errors/user-not-found',
  });
}
```

**Client:**

```typescript
import { parseError } from 'autotel';

try {
  await fetch('/api/checkout', { method: 'POST', body: JSON.stringify(data) });
} catch (err) {
  const e = parseError(err);
  toast.error(e.message, { description: e.why });
  if (e.fix) setHelp(e.fix);
  if (e.link) setDocLink(e.link);
}
```

## Core Patterns

**Wrap a caught error (preserve cause):**

```typescript
try {
  await stripe.charges.create(data);
} catch (err) {
  throw createStructuredError({
    message: 'Payment failed',
    status: 402,
    why: err instanceof Error ? err.message : 'Unknown error',
    fix: 'Try a different payment method or contact support',
    link: 'https://docs.stripe.com/declines',
    cause: err,
  });
}
```

**Same error from several places:** define it once with `defineErrorCatalog` instead of copying the wording.

```typescript
import { defineErrorCatalog } from 'autotel';

export const billing = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: {
    status: 402,
    message: 'Card declined',
    why: 'The issuer rejected the charge',
    fix: 'Try a different payment method',
  },
  INSUFFICIENT_FUNDS: {
    status: 402,
    message: ({
      available,
      required,
    }: {
      available: number;
      required: number;
    }) => `Insufficient funds: $${available} of $${required}`,
  },
});

throw billing.PAYMENT_DECLINED({ cause: stripeError });
throw billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });

if (billing.PAYMENT_DECLINED.match(err)) retryWithDifferentCard();
```

Builders return the same `StructuredError`, so `parseError()` still works. Codes default to `namespace.KEY`. A function `message` or `why` takes typed params enforced at every call site. `.match()` compares the catalog code, so renaming an entry breaks the compile instead of skipping the branch.

**Record on current span:** Use `recordStructuredError(ctx, error)` or the request logger's `.error(error, fields)` so the span gets error attributes and status.

For new exception event flows, prefer request-logger/log-based correlation and keep span-event compatibility as an implementation detail (processors/export path), not a new app-level dependency.

**parseError** handles FetchError (ofetch), nested `data.data`, and plain Error. Returns `{ message, status, why?, fix?, link?, raw }`.

## Common Mistakes

### HIGH Throw new Error() in API routes instead of createStructuredError

Wrong:

```typescript
throw new Error('Payment failed');
```

Correct:

```typescript
throw createStructuredError({
  message: 'Payment failed',
  status: 402,
  why: 'Card declined by issuer',
  fix: 'Try a different payment method',
  link: 'https://docs.example.com/payments',
});
```

Clients and agents need structured fields (why, fix, link) for actionable errors. parseError() reads these from API responses.

Source: docs/AGENT-GUIDE.md, AGENTS.md

### MEDIUM Client only shows error.message and ignores why/fix/link

Wrong:

```typescript
catch (err) {
  toast.error(err.message);
}
```

Correct:

```typescript
import { parseError } from 'autotel';
catch (err) {
  const e = parseError(err);
  toast.error(e.message, { description: e.why });
  if (e.fix) showFix(e.fix);
  if (e.link) setDocLink(e.link);
}
```

parseError() extracts status, why, fix, and link from API error responses and FetchError so the UI can show them.

Source: docs/AGENT-GUIDE.md

## Version

Targets autotel v2.23.x.

See also: autotel-request-logging/SKILL.md. Use .error() to record errors in the request snapshot.
