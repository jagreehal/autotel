---
name: autotel-structured-errors
description: >
  createStructuredError, parseError, recordStructuredError. API errors with message, why, fix, link; client parsing for UI. Use in API routes and client catch blocks.
type: core
library: autotel
library_version: '2.23.0'
sources:
  - jagreehal/autotel:packages/autotel/src/structured-error.ts
  - jagreehal/autotel:packages/autotel/src/parse-error.ts
  - jagreehal/autotel:docs/AGENT-GUIDE.md
---

# Autotel — Structured Errors

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

**Record on current span:** Use `recordStructuredError(ctx, error)` or the request logger's `.error(error, fields)` so the span gets error attributes and status.

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

See also: autotel-request-logging/SKILL.md — use .error() to record errors in the request snapshot.
