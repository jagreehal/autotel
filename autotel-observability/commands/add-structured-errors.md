---
description: Replace generic Error throws with autotel createStructuredError and add parseError on client
argument-hint: "<file-or-directory> — e.g. src/ or src/routes/"
---

# Add Structured Errors

You are an autotel structured error specialist. Upgrade generic error handling to autotel's structured error API so errors are machine-parseable and actionable for both agents and users.

## Context

The user wants to replace `new Error()` / `throw new Error()` with `createStructuredError()` on the server, and add `parseError()` on the client, so that error responses carry `message`, `why`, `fix`, `link` — giving users and AI agents actionable context.

## Requirements

$ARGUMENTS

## Instructions

### Step 1: Scan for Generic Errors (Server-Side)

Search the target files for these patterns:

```
throw new Error('...')
throw Error('...')
throw new TypeError('...')
throw new RangeError('...')
res.status(4xx).json({ error: '...' })
res.status(5xx).json({ message: '...' })
new Response('...', { status: 4xx })
```

For each throw/error response site, determine:
1. What HTTP status code applies (400, 401, 403, 404, 409, 422, 500, 502, etc.)
2. Why the error happens (the human-readable cause)
3. How to fix it (the actionable step for the user)
4. Whether a docs link would help

### Step 2: Replace with createStructuredError

**Before:**
```typescript
if (!user) {
  throw new Error('User not found');
}
```

**After:**
```typescript
import { createStructuredError } from 'autotel';

if (!user) {
  throw createStructuredError({
    message: 'User not found',
    status: 404,
    why: `No user with ID "${userId}"`,
    fix: 'Check the user ID and try again',
  });
}
```

**Full parameter reference:**

```typescript
createStructuredError({
  message: string,          // Required — human-readable error message
  status?: number,          // HTTP status code (400-599)
  why?: string,             // Why it happened — for debugging
  fix?: string,             // How to fix it — actionable step
  link?: string,            // URL to docs or help page
  code?: string,            // Custom error code (e.g. 'PAYMENT_DECLINED')
  cause?: unknown,          // Original error (for error chaining)
})
```

### Step 3: Common Error Patterns

Apply these patterns based on the error type:

**Validation errors (400/422):**
```typescript
throw createStructuredError({
  message: 'Invalid request',
  status: 422,
  why: `Field "${field}" must be a valid email address`,
  fix: 'Check the field value and resubmit',
});
```

**Authentication errors (401):**
```typescript
throw createStructuredError({
  message: 'Authentication required',
  status: 401,
  why: 'No valid session token found',
  fix: 'Log in and try again',
  link: '/login',
});
```

**Authorization errors (403):**
```typescript
throw createStructuredError({
  message: 'Permission denied',
  status: 403,
  why: `Role "${user.role}" cannot access this resource`,
  fix: 'Contact an admin to request access',
});
```

**Not found errors (404):**
```typescript
throw createStructuredError({
  message: 'Resource not found',
  status: 404,
  why: `No ${resourceType} with ID "${id}"`,
  fix: 'Check the ID and try again',
});
```

**Conflict errors (409):**
```typescript
throw createStructuredError({
  message: 'Conflict',
  status: 409,
  why: 'A resource with this name already exists',
  fix: 'Choose a different name or update the existing resource',
});
```

**External service errors (502):**
```typescript
throw createStructuredError({
  message: 'Payment processing failed',
  status: 502,
  why: error instanceof Error ? error.message : 'Payment provider returned an error',
  fix: 'Try again in a few minutes or use a different payment method',
  cause: error,
});
```

**Catch-rethrow pattern:**
```typescript
try {
  await externalService.call(data);
} catch (error) {
  throw createStructuredError({
    message: 'External service failed',
    status: 502,
    why: error instanceof Error ? error.message : 'Unknown error',
    fix: 'Retry the operation or contact support',
    cause: error,
  });
}
```

### Step 4: Scan for Client-Side Catch Blocks

Search client/frontend code for:

```
catch (err) { ... }
catch (error) { ... }
.catch((err) => ...)
toast.error('Something went wrong')
alert('Error')
```

### Step 5: Add parseError on Client

**Before:**
```typescript
try {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Request failed');
  return await res.json();
} catch (err) {
  toast.error('Something went wrong');
}
```

**After:**
```typescript
import { parseError } from 'autotel';

try {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw body;
  }
  return await res.json();
} catch (err) {
  const error = parseError(err);
  toast.error(error.message, {
    description: error.why,
    action: error.fix
      ? { label: 'How to fix', onClick: () => showHelp(error.fix) }
      : undefined,
  });
  if (error.link) {
    setHelpLink(error.link);
  }
}
```

**parseError return type:**
```typescript
{
  message: string,     // Always present
  status?: number,     // HTTP status code if available
  why?: string,        // Why it happened
  fix?: string,        // How to fix it
  link?: string,       // Docs URL
  raw: unknown,        // Original error object
}
```

### Step 6: UI Patterns for Structured Errors

Adapt the error display to your UI framework:

**Toast notification:**
```typescript
const error = parseError(err);
toast.error(error.message, { description: error.why });
```

**Error banner:**
```tsx
const error = parseError(err);
<ErrorBanner
  title={error.message}
  description={error.why}
  action={error.fix}
  helpLink={error.link}
/>
```

**Form validation:**
```typescript
const error = parseError(err);
if (error.status === 422) {
  setFieldError(error.why || error.message);
}
```

### Step 7: Output Summary

Present changes:

```
## Structured Error Migration

### Server-Side Changes
- src/routes/checkout.ts:15 — throw new Error('User not found') → createStructuredError (404)
- src/routes/checkout.ts:32 — throw new Error('Payment failed') → createStructuredError (502)
- src/routes/users.ts:8 — throw new Error('Unauthorized') → createStructuredError (401)

### Client-Side Changes
- src/client/checkout.tsx:25 — added parseError() + toast with why/fix
- src/client/profile.tsx:40 — added parseError() + error banner

### New Imports
- autotel: createStructuredError (3 files)
- autotel: parseError (2 files)
```

## Guidelines

- **Don't force structured errors everywhere**: Simple internal assertions (`assert(x)`) and programmer errors don't need `createStructuredError`. Focus on errors that reach users or cross API boundaries.
- **Always include `cause`**: When catching and rethrowing, pass the original error as `cause` for full error chain visibility.
- **`why` should be specific**: "Database connection failed" is better than "Internal error". Include IDs, field names, or service names when helpful.
- **`fix` should be actionable**: "Try again in 5 minutes" or "Check your API key" — not "Contact support" unless that's genuinely the only option.
