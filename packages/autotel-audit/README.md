# autotel-audit

Audit-focused helpers for `autotel`. Provides structured audit logging with automatic tail-sampling bypass and OpenTelemetry attribute normalization.

## What it provides

- **`withAudit(...)`** — Wraps an operation with audit metadata, automatic outcome tagging (success/failure), and optional immediate emit
- **`forceKeepAuditEvent(...)`** — Marks the current trace to bypass tail-drop sampling for compliance/audit trails
- **`setAuditAttributes(...)`** — Writes normalized `audit.*` attributes on the active span with automatic type conversion

## Features

- **Structured Metadata** — Enforce consistent audit schemas with `AuditMetadata` interface
- **Automatic Outcome Tagging** — Operations auto-tagged as `success` or `failure` (override with explicit `outcome` field)
- **Sampling Bypass** — Force critical audit events through tail-sampling with `forceKeepAuditEvent()` or `options.forceKeep`
- **Type-Safe Attributes** — Automatic serialization of complex types (Objects, Dates, Arrays) to OpenTelemetry-compatible values
- **Request Context Integration** — Propagates actor ID, resource, and action across structured logs
- **Compliance Ready** — Emit audit events immediately (`emitNow: true`) for real-time compliance systems

## Quick Start

```ts
import { trace } from 'autotel';
import { withAudit } from 'autotel-audit';

export const deleteUser = trace(async () => {
  return withAudit(
    { action: 'user.delete', resource: 'user', actorId: 'admin-42' },
    async (_ctx, log) => {
      // business logic
      log.info('User deleted successfully');
      return { ok: true };
    },
    { emitNow: true },
  );
});
```

## API Reference

### `withAudit<T>(metadata, fn, options?)`

Wraps an async operation with audit metadata and handles success/failure outcomes.

**Parameters:**

- `metadata: AuditMetadata` — Audit event metadata (action, resource, actor, etc.)
- `fn: (ctx, logger) => Promise<T>` — Async function receiving audit context and request logger
- `options?: WithAuditOptions` — Optional configuration:
  - `emitNow?: boolean` — Immediately emit the audit event (default: false)
  - `forceKeep?: boolean` — Force event through tail-sampling (default: true)
  - `ctx?: AuditContext` — Provide custom audit context (auto-resolved from trace if omitted)
  - `logger?: RequestLogger` — Override the request logger instance

**Example with custom context:**

```ts
const ctx = {
  traceId: 'abc-123',
  spanId: 'def-456',
  correlationId: 'xyz-789',
  setAttribute: (k, v) => span.setAttribute(k, v),
  setAttributes: (attrs) => span.setAttributes(attrs),
};

await withAudit({ action: 'data.export' }, fn, { ctx, emitNow: true });
```

### `setAuditAttributes(metadata, ctx?)`

Write audit metadata as normalized `audit.*` span attributes without wrapping an operation.

```ts
import { setAuditAttributes } from 'autotel-audit';

setAuditAttributes({
  action: 'config.update',
  resource: 'settings',
  actorId: 'user-123',
  category: 'admin',
});
// Sets: audit.action, audit.resource, audit.actorId, audit.category, autotel.audit=true
```

### `forceKeepAuditEvent(ctx?)`

Mark the active trace to bypass tail-drop sampling. Called automatically by `withAudit` unless `forceKeep: false`.

```ts
import { trace } from 'autotel';
import { forceKeepAuditEvent } from 'autotel-audit';

export const readSecrets = trace(async (req) => {
  if (req.user.role !== 'admin') {
    forceKeepAuditEvent(); // Keep sensitive access attempts
    throw new Error('Unauthorized');
  }
  // ...
});
```

## Type-Safe Metadata

Define audit schemas for different operations:

```ts
import type { AuditMetadata } from 'autotel-audit';

interface DeleteUserAudit extends AuditMetadata {
  action: 'user.delete';
  resource: 'user';
  actorId: string;
  reason?: string;
}

interface PermissionUpdate extends AuditMetadata {
  action: 'permission.update';
  resource: 'role';
  oldValue?: Record<string, boolean>;
  newValue?: Record<string, boolean>;
  actorId: string;
}
```

## Common Patterns

### Emit audit events only on errors

```ts
await withAudit(
  { action: 'account.suspend', resource: 'account', actorId: 'admin-1' },
  async (ctx, log) => {
    try {
      await suspendAccount();
    } catch (err) {
      log.error(err); // Auto-tagged with outcome: failure
      throw;
    }
  },
  { emitNow: true },
);
```

### Track sensitive operations with context

```ts
await withAudit(
  {
    action: 'secret.access',
    resource: 'api-key',
    actorId: user.id,
    secretType: 'api-key',
    env: 'prod',
  },
  async () => {
    // Fetch secret...
  },
  { emitNow: true, forceKeep: true },
);
```

### Nested audit context in complex flows

```ts
export const transferFunds = trace(async (transfer) => {
  return withAudit(
    {
      action: 'transfer.execute',
      resource: 'transaction',
      actorId: transfer.initiator,
      amount: transfer.amount,
      fromAccount: transfer.from,
      toAccount: transfer.to,
    },
    async (ctx, log) => {
      const debitResult = await debitAccount(transfer.from, transfer.amount);
      const creditResult = await creditAccount(transfer.to, transfer.amount);

      log.info('Transfer completed', {
        transactionId: debitResult.txId,
        debitStatus: debitResult.status,
        creditStatus: creditResult.status,
      });

      return { success: true, txId: debitResult.txId };
    },
    { emitNow: true },
  );
});
```

## Compliance & Sampling

### Why force-keep audit events?

Tail-sampling decisions are made after spans complete. Critical audit trails need guaranteed export regardless of sampling rate. `forceKeepAuditEvent()` marks spans as keeper-worthy, ensuring they bypass statistical sampling.

```ts
// Default: force-keep is enabled (critical for audit)
await withAudit(metadata, fn);

// Disable if audit backend has separate retention
await withAudit(metadata, fn, { forceKeep: false });

// Manual control for hybrid scenarios
if (isPrivilegedOperation) {
  forceKeepAuditEvent();
}
```

## Integration with Observability Backends

Audit attributes are standard OpenTelemetry span attributes and work with any OTLP-compatible backend (Datadog, New Relic, Jaeger, etc.).

- Attributes are stored as `audit.action`, `audit.resource`, `audit.actorId`, etc.
- Root span contains `autotel.audit: true` for filtering
- Use backend span filters to create audit dashboards and alerts

## See Also

- **[Advanced Features](/advanced)** — Trace helpers, metadata flattening, isolated tracer providers
- **[Request Logging](/integrations/logging)** — Structured request context and event emission
- **[Autotel Core](/)** — `trace()`, `span()`, and request context patterns
