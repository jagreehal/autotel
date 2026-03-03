# Code Review Checklist

## Anti-Pattern Detection

| Anti-Pattern | Severity | Fix |
|---|---|---|
| `console.log` for request context | High | Use `getRequestLogger(ctx)` with `log.set()` |
| `console.error` in catch blocks | High | Use `log.error(err)` or `recordStructuredError(ctx, err)` |
| `throw new Error('...')` without context | Medium | Use `createStructuredError({ message, why, fix })` |
| `catch (e) { throw e }` (rethrow without recording) | Medium | Add `log.error(e)` before rethrowing |
| `catch (e) { res.json({ error: e.message }) }` | Medium | Use `parseError(e)` for consistent shape |
| Manual request ID generation | Low | Use `ctx.correlationId` from trace context |
| Separate timing logic (`Date.now()` diffs) | Low | `trace()` handles duration automatically |
| `JSON.stringify` for log output | High | Use `log.set()` - attributes flatten automatically |
| No error context beyond message | Medium | Add `why`, `fix`, `link` fields |
| Logging at start AND end of function | Low | `trace()` handles span lifecycle |

## Review Questions

When reviewing a handler or service function, check:

1. **Is it wrapped with `trace()` or `withAutotel()`?** Every request handler should have tracing.
2. **Does it use `getRequestLogger()` or `useLogger()`?** Context should accumulate on the span.
3. **Are errors structured?** Catch blocks should use `createStructuredError()` or at minimum `log.error(err)`.
4. **Is `parseError()` used for API responses?** Error responses should have consistent shape.
5. **Are attributes grouped with dot notation?** Use `user.id`, `cart.total`, not flat names.
6. **Is there scattered `console.log`?** Replace with `log.set()` or `log.info()`.

## Migration Path: console.log to Autotel

### Step 1: Add trace() wrapper

```typescript
// Before
export async function createUser(data: CreateUserData) {
  console.log('Creating user', data.email);
  const user = await db.users.create(data);
  console.log('User created', user.id);
  return user;
}

// After
import { trace } from 'autotel';

export const createUser = trace(ctx => async (data: CreateUserData) => {
  ctx.setAttributes({ 'user.email': data.email });
  const user = await db.users.create(data);
  ctx.setAttribute('user.id', user.id);
  return user;
});
```

### Step 2: Add request logger for richer context

```typescript
import { trace, getRequestLogger } from 'autotel';

export const createUser = trace(ctx => async (data: CreateUserData) => {
  const log = getRequestLogger(ctx);
  log.set({ feature: 'signup', plan: data.plan });

  const user = await db.users.create(data);
  log.set({ user_id: user.id, user_email: user.email });

  return user;
});
```

### Step 3: Add structured errors

```typescript
import { trace, getRequestLogger, createStructuredError } from 'autotel';

export const createUser = trace(ctx => async (data: CreateUserData) => {
  const log = getRequestLogger(ctx);
  log.set({ feature: 'signup', plan: data.plan });

  const existing = await db.users.findByEmail(data.email);
  if (existing) {
    throw createStructuredError({
      message: 'User already exists',
      why: 'An account with this email address is already registered',
      fix: 'Use a different email or sign in to the existing account',
      code: 'USER_EXISTS',
      status: 409,
    });
  }

  const user = await db.users.create(data);
  log.set({ user_id: user.id });
  return user;
});
```

### Step 4: Add framework adapter (if applicable)

```typescript
// Next.js API route
import { withAutotel, useLogger } from 'autotel-adapters/next';
import { parseError } from 'autotel';

export const POST = withAutotel(async (request) => {
  const log = useLogger(request);
  const body = await request.json();
  log.set({ feature: 'signup' });

  try {
    const user = await createUser(body);
    return Response.json(user);
  } catch (err) {
    const parsed = parseError(err);
    log.set({ error_code: parsed.code });
    return Response.json(
      { error: parsed.message, fix: parsed.fix },
      { status: parsed.status },
    );
  }
});
```
