# autotel-audit

Audit and security-event helpers for `autotel`. Provides structured audit logging with automatic tail-sampling bypass and OpenTelemetry attribute normalization.

## What it provides

- **`withAudit(...)`** — Wraps an operation with audit metadata, automatic outcome tagging (success/failure), and optional immediate emit
- **`forceKeepAuditEvent(...)`** — Marks the current trace to bypass tail-drop sampling for compliance/audit trails
- **`setAuditAttributes(...)`** — Writes normalized `audit.*` attributes on the active span with automatic type conversion
- **`securityEvent(...)`** / **`withSecurity(...)`** — Typed security events (OWASP A09-aligned) with a stable `security.*` schema, force-keep by default, a credential-key guard, and automatic counter metrics
- **`createSecuritySignalProcessor(...)`** — Zero-code security signals derived from the HTTP spans you already have: suspicious-path flagging, denied-response metrics, and per-client auth-failure burst detection
- **`hashIdentifier(...)`** — Stable one-way digest for correlating PII-bearing identifiers (emails, IPs) without logging raw values

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

## Security Events (OWASP A09)

OWASP A09:2025 (Security Logging & Alerting Failures) calls out missing logs for important events, unclear messages, and ineffective alerting. `securityEvent()` gives security-relevant behaviours a **stable, queryable schema** so backends can build detection rules and dashboards instead of grepping free text.

```ts
import { securityEvent, hashIdentifier } from 'autotel-audit';

// Inside a trace()-wrapped handler:
securityEvent({
  name: 'auth.login.failed', // autocomplete for well-known names, free-form allowed
  category: 'authentication',
  outcome: 'failure',
  severity: 'warning',
  actorId: hashIdentifier(email), // correlate without logging PII
  reason: 'invalid_password',
});
// Sets: security.event, security.category, security.outcome, security.severity,
//       security.actor_id, security.reason, autotel.security=true
```

### Design guarantees

- **Force-keep by default** — an attack you sampled away is an attack you cannot investigate. Opt out per-event with `forceKeep: false` for high-volume info events.
- **Credential-key guard** — values under credential-shaped keys (`token`, `apiKey`, `password`, …, reusing autotel core's `REDACTOR_PATTERNS.sensitiveKey`) are never emitted, even by accident. Dropped key names are recorded in `security.dropped_keys`.
- **Stable schema** — `security.event` / `security.category` / `security.outcome` / `security.severity` are always present; everything else flattens under `security.*`.
- **Hash, don't log** — `hashIdentifier(value, { salt })` produces a stable sha256 digest for emails/IPs. Never log secrets, hashed or not.

### Wrapping security-sensitive operations

```ts
import { withSecurity } from 'autotel-audit';

await withSecurity(
  {
    name: 'api_key.created',
    category: 'secrets',
    outcome: 'success',
    actorId: user.id,
    keyId: newKey.id, // safe: identifier, not the key material
  },
  async () => createApiKey(user.id),
  { emitNow: true },
);
// Success → outcome as given; thrown error → outcome: 'error',
// severity escalated to at least 'error', logged, rethrown
```

### Categories

`authentication` · `authorization` · `data_access` · `admin_action` · `configuration` · `secrets` · `rate_limit` · `validation` · `supply_chain` · `llm`

### `securityEvent` vs `withAudit`

- **`withAudit`** — compliance trail for business operations ("who did what to which resource").
- **`securityEvent`** — detection signal for security-relevant behaviour ("is the system being abused"). Categories, outcomes, and severities are closed unions so alerting rules don't drift.

They compose: a sensitive admin operation can carry both an `audit.*` trail and a `security.*` event.

### Metrics for alerting

Every `securityEvent()` also increments the `autotel.security.events` counter (attributes: `event`, `category`, `outcome`, `severity`) so security teams can alert on **rates** — failed-login spikes, denied-access bursts — without log-based alerting. Disable per-event with `metrics: false`.

> Cardinality: the event name is a counter attribute. Keep names to a stable catalogue; never interpolate user input into them.

### Library vs backend responsibility

This package's job ends at emitting **structured, correlated, redaction-safe, sampling-exempt** events. Detection rules, alert thresholds, dashboards, and SIEM routing belong in your observability backend.

## Zero-Code Security Signals

Most security-relevant traffic never reaches your handlers — scanners probing `/.env`, traversal attempts, credential stuffing producing 401 storms. `createSecuritySignalProcessor()` derives security signals from the **HTTP spans your instrumentation already produces**, with no per-route code:

```ts
import { init } from 'autotel';
import { createSecuritySignalProcessor } from 'autotel-audit';

init({
  service: 'api',
  spanProcessors: [
    createSecuritySignalProcessor({
      onSignal: (signal) => {
        // optional: forward to Slack/SIEM/pager
      },
    }),
  ],
});
```

What it does:

| Signal | When | Output |
|---|---|---|
| **Suspicious request** | Request path matches a probe pattern (path traversal, `/.env` / `/.git` / `/etc/passwd` probes, SQLi/XSS probes, null bytes) | Span flagged `security.suspicious_request=true` + `security.signal=<pattern>`, **force-kept through tail sampling**, `autotel.security.http.suspicious` counter, `onSignal` callback |
| **Denied response** | Response status is 401/403/429 (configurable) | `autotel.security.http.denied{status}` counter |
| **Auth-failure burst** | One client crosses N denied responses (default 10) inside a sliding window (default 60s), keyed by `client.address` | `autotel.security.anomaly` counter + `onSignal` callback — fired **once per crossing**, so alert volume stays bounded under attack |

Why this pairing matters: a credential-stuffing run at 10% baseline sampling is invisible in traces and a `/.env` probe is one boring 404 in your logs — but flagged spans **bypass tail sampling**, and the counters give security teams something to alert on. The interesting traffic is guaranteed to exist in your backend.

Design notes:

- Patterns are **conservative** (scanner/probe traffic, not a WAF) — `union+station+select` in a search query does not flag. Extend with `extraPatterns`.
- Burst tracking is **per-process** with bounded memory (`maxKeys`, default 10k clients, oldest evicted) — random-IP floods can't grow the map forever. For fleet-wide correlation, alert on the metrics in your backend instead.
- Both metric emission and your `onSignal` callback are guarded — they can never break the span pipeline.

## Integration with Observability Backends

Audit attributes are standard OpenTelemetry span attributes and work with any OTLP-compatible backend (Datadog, New Relic, Jaeger, etc.).

- Attributes are stored as `audit.action`, `audit.resource`, `audit.actorId`, etc.
- Root span contains `autotel.audit: true` for filtering
- Use backend span filters to create audit dashboards and alerts

## See Also

- **[Advanced Features](/advanced)** — Trace helpers, metadata flattening, isolated tracer providers
- **[Request Logging](/integrations/logging)** — Structured request context and event emission
- **[Autotel Core](/)** — `trace()`, `span()`, and request context patterns
